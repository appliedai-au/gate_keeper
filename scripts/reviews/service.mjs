import { createHash, timingSafeEqual } from 'node:crypto';
import {
  REVIEW_APP_ID, REVIEW_PATH, REVIEW_MAX_BODY_BYTES, REVIEW_MAX_RESPONSE_BYTES,
  REVIEW_ERRORS, validCommand,
} from '../../integrations/base44/shared/review-contract.js';
import { ReviewError, projectJob } from './store.mjs';
import { invokeOnce, checkTurn, observeReview } from './trueforge.mjs';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff' };
function send(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  const json = JSON.stringify(body);
  if (Buffer.byteLength(json) > REVIEW_MAX_RESPONSE_BYTES) {
    res.writeHead(503, headers); res.end('{"error":"review_unavailable"}'); return;
  }
  res.writeHead(status, headers); res.end(json);
}
export function reviewUnavailable(_req, res) { send(res, 503, { error: 'review_unavailable' }); }
const header = (req, name) => typeof req.headers[name] === 'string' ? req.headers[name] : '';
const capabilityMatches = (presented, hash) => /^[A-Za-z0-9_-]{43,128}$/u.test(presented) &&
  timingSafeEqual(createHash('sha256').update(presented).digest(), Buffer.from(hash, 'hex'));

async function readCommand(req) {
  const chunks = [];
  let length = 0;
  req.setTimeout?.(5000, () => req.destroy());
  for await (const chunk of req) {
    length += chunk.length;
    if (length > REVIEW_MAX_BODY_BYTES) throw new ReviewError('invalid_request', 400);
    chunks.push(chunk);
  }
  req.setTimeout?.(0);
  let command;
  try { command = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new ReviewError('invalid_request', 400); }
  if (!validCommand(command)) throw new ReviewError('invalid_request', 400);
  return command;
}

/** A private review request adapter around the existing TrueForge coordinator. */
export function createReviewService({ store, client, runtime, ownerId, tokenHash }) {
  const scope = Object.freeze({ appId: REVIEW_APP_ID, ownerId });
  const work = new Set();
  let stopping = false;
  const reply = (job = null, jobs = []) => ({ version: 1, sourceCommit: runtime.sourceCommit,
    scope: 'configured_admin_owner', enabled: true, job: job ? projectJob(job) : null,
    jobs: jobs.map(row => projectJob(row, false)) });

  async function dispatch(row, claim) {
    let current = row, operation = claim;
    // At most one fresh session and one root turn. No polling loop, retries,
    // fallbacks, auto-resume or additional model iterations are created here.
    while (operation && !stopping) {
      const phase = operation.phase;
      try {
        const response = (await invokeOnce(options => phase === 'session'
          ? client.sessions.create(operation.request, options)
          : client.sessions.createTurn(current.session_id, operation.request, options))).data;
        if (Buffer.byteLength(JSON.stringify(response)) > 524288) throw new ReviewError('dispatch_uncertain');
        let upstreamId;
        try { upstreamId = phase === 'session' ? runtime.checkSession(response, current)
          : checkTurn(response, current.session_id, null, operation.request.input); }
        catch {
          await store.receipt(scope, current.id, phase, response, null);
          return;
        }
        current = await store.receipt(scope, current.id, phase, response, upstreamId);
        if (phase !== 'session' || current.state !== 'session_created' || stopping) return;
        const next = await store.claim(scope, current.id, runtime, runtime.request);
        current = next.row; operation = next.claim;
      } catch {
        // If either the POST or persistence outcome is uncertain, preserve the
        // claim. A fresh browser idempotency key cannot release the active slot.
        try { await store.hold(scope, current.id, phase + '_dispatch', 'dispatch_uncertain'); }
        catch { /* The persisted intent remains dispatching and expires to held. */ }
        return;
      }
    }
  }
  function launch(row, claim) {
    const promise = dispatch(row, claim);
    work.add(promise);
    void promise.finally(() => work.delete(promise)).catch(() => {});
  }

  async function handler(req, res) {
    if (req.url !== REVIEW_PATH) return send(res, 400, { error: 'invalid_request' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
    if (!capabilityMatches(header(req, 'x-gatekeeper-review-token'), tokenHash))
      return send(res, 401, { error: 'unauthorized' });
    if (header(req, 'x-gatekeeper-review-app') !== REVIEW_APP_ID ||
        header(req, 'x-gatekeeper-review-owner') !== ownerId)
      return send(res, 403, { error: 'forbidden' });
    if (header(req, 'x-gatekeeper-review-source') !== runtime.sourceCommit)
      return send(res, 409, { error: 'source_mismatch' });
    if (stopping) return reviewUnavailable(req, res);
    try {
      const command = await readCommand(req);
      if (command.action === 'info') { await store.ready(); return send(res, 200, reply()); }
      if (command.action === 'list') return send(res, 200, reply(null, await store.list(scope)));
      if (command.action === 'submit') {
        const row = await store.admit(scope, command.idempotencyKey, command.input, runtime);
        return send(res, 202, reply(row));
      }
      if (command.action === 'start') {
        const { row, claim } = await store.claim(scope, command.jobId, runtime, runtime.request);
        // The durable intent is committed before asynchronous dispatch and before
        // this acknowledgement. A browser disconnect never triggers redispatch.
        if (claim) launch(row, claim);
        return send(res, 202, reply(row));
      }
      let row = await store.expireDispatch(scope, command.jobId);
      if (row.state === 'running') {
        if (row.source_commit !== runtime.sourceCommit || row.runtime_digest !== runtime.runtimeDigest) {
          row = await store.hold(scope, row.id, 'running', 'runtime_changed');
        } else {
          // A temporary GET failure keeps the known turn running and retryable
          // by observation; it must never restart it or manufacture a result.
          const result = await observeReview({ client, row, runtime });
          if (result) row = await store.finish(scope, row.id, result);
        }
      }
      return send(res, 200, reply(row));
    } catch (error) {
      if (error instanceof ReviewError && REVIEW_ERRORS.includes(error.code))
        return send(res, error.status, { error: error.code });
      return reviewUnavailable(req, res);
    }
  }
  return {
    handler,
    stop() { stopping = true; },
    async drained() { await Promise.allSettled([...work]); },
  };
}
