// Authored for the remote source gate. No model credentials or real inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createReviewBridge } from '../integrations/base44/shared/review-backend.js';
import { validCommand, validReviewInput, REVIEW_PUBLIC_URL } from '../integrations/base44/shared/review-contract.js';
import { parseFindings, observeReview, reviewRuntime } from '../scripts/reviews/trueforge.mjs';
import { configuredReviews } from '../scripts/reviews/runtime.mjs';

const source = 'a'.repeat(40), owner = 'fixture-owner';
const input = { file: 'test.ts', language: 'typescript', context: 'Return the current count.', code: 'export const count = 1;' };
const response = { version: 1, sourceCommit: source, scope: 'configured_admin_owner', enabled: true, job: null, jobs: [] };
const values = { GATEKEEPER_REVIEW_OWNER_ID: owner, GATEKEEPER_REVIEW_ENABLED: 'enabled',
  GATEKEEPER_REVIEW_SOURCE_COMMIT: source, GATEKEEPER_REVIEW_TOKEN: 'fixture_' + 'x'.repeat(40) };
const request = body => new Request('https://app.example/functions/gatekeeperReview', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});

test('only server-authenticated configured admin can read inference capability or use bridge', async () => {
  for (const [user, expected] of [[null, 401], [{ id: owner, role: 'user' }, 403], [{ id: 'other', role: 'admin' }, 403]]) {
    const reads = [], calls = [];
    const bridge = createReviewBridge({ authenticate: async () => user,
      readEnv: key => { reads.push(key); return values[key]; },
      fetchImpl: async (...args) => { calls.push(args); throw new Error('must not be called'); } });
    assert.equal((await bridge(request({ action: 'info' }))).status, expected);
    assert.equal(calls.length, 0);
    assert.equal(reads.includes('GATEKEEPER_REVIEW_TOKEN'), false);
  }
});

test('caller-selected owner, destination, model or unsupported action is rejected before network', async () => {
  let calls = 0;
  const bridge = createReviewBridge({ authenticate: async () => ({ id: owner, role: 'admin' }),
    readEnv: key => values[key], fetchImpl: async () => { calls++; return Response.json(response); } });
  for (const body of [{ action: 'info', ownerId: 'other' }, { action: 'info', url: 'https://outside.example' },
    { action: 'repair' }, { action: 'submit', input, model: 'unapproved' }])
    assert.equal((await bridge(request(body))).status, 400);
  assert.equal(calls, 0);
});

test('bridge has one fixed target, authenticated identity, no redirect and no secret reflection', async () => {
  let observed;
  const bridge = createReviewBridge({ authenticate: async () => ({ id: owner, role: 'admin' }),
    readEnv: key => values[key], fetchImpl: async (url, options) => { observed = { url, options }; return Response.json(response); } });
  const result = await bridge(request({ action: 'info' }));
  assert.equal(result.status, 200);
  assert.equal(observed.url, REVIEW_PUBLIC_URL);
  assert.equal(observed.options.redirect, 'error');
  assert.equal(observed.options.headers['X-Gatekeeper-Review-Owner'], owner);
  assert.equal(observed.options.headers.Authorization, undefined);
  assert.equal((await result.text()).includes(values.GATEKEEPER_REVIEW_TOKEN), false);
});

test('uncertain bridge start is never retried and wrong source/private upstream fields are hidden', async () => {
  let calls = 0;
  const invoke = fetchImpl => createReviewBridge({ authenticate: async () => ({ id: owner, role: 'admin' }),
    readEnv: key => values[key], fetchImpl });
  const uncertain = await invoke(async () => { calls++; throw new Error('private provider credential'); })(request({
    action: 'start', jobId: 'c85f657a-1b83-4de0-9c49-37a8385630a8',
  }));
  assert.equal(calls, 1);
  assert.deepEqual(await uncertain.json(), { error: 'dispatch_uncertain' });
  for (const body of [{ ...response, sourceCommit: 'b'.repeat(40) }, { ...response, privatePrompt: 'sensitive' }]) {
    const result = await invoke(async () => Response.json(body))(request({ action: 'info' }));
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: 'review_unavailable' });
  }
});

test('input limits include CR-only line breaks and output requires valid grounded finding locations', () => {
  assert.equal(validReviewInput(input), true);
  assert.equal(validReviewInput({ ...input, code: 'x\r'.repeat(1001) }), false);
  assert.equal(validReviewInput({ ...input, code: '界'.repeat(16000) }), false);
  assert.equal(validCommand({ action: 'start', jobId: '../../another-owner' }), false);
  assert.deepEqual(parseFindings('```json\n{"findings":[]}\n```', 1), []);
  assert.equal(parseFindings('{"findings":[{"line":2,"category":"bug","severity":"high","comment":"Outside input"}]}', 1), null);
  assert.equal(parseFindings('{"findings":[],"approved":true}', 1), null);
  assert.equal(parseFindings('```json\n{"findings":[]}\n```\nThis is approved.', 1), null);
});

const fixtureRuntime = reviewRuntime({ sourceCommit: source, model: 'fixture/model', instructions: 'Review only.', checklist: 'Check source.' });
function observedClient({ events = undefined, status = 'done', output = undefined, wrongInput = false } = {}) {
  const message = output ?? { type: 'model.message', id: 'message-1', threadId: 'main',
    finishReason: 'stop', content: '{"findings":[]}' };
  return { sessions: {
    getTurn: async (_session, _turn, options) => {
      assert.equal(options.maxRetries, 0);
      return { data: { id: 'turn-1', sessionId: 'session-1', previousTurnId: null,
        input: wrongInput ? [{ type: 'user.message', content: 'different submission' }] : fixtureRuntime.request(row, 'turn').input,
        state: { status, output: message, requiredActions: [] } } };
    },
    listTurnEvents: async () => ({ response: { data: events ?? [message], pagination: {} } }),
    create: async () => assert.fail('a status read must never create a session'),
    createTurn: async () => assert.fail('a status read must never create a turn'),
  } };
}
const row = { session_id: 'session-1', turn_id: 'turn-1', input };
test('complete no-findings response remains real; absent price remains unknown', async () => {
  const result = await observeReview({ client: observedClient(), row, runtime: fixtureRuntime });
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.findings, []);
  assert.equal(result.estimatedCostUsd, null);
});
test('hidden intermediate tools, multiple model iterations and non-main output hold the job', async () => {
  for (const options of [
    { events: [{ type: 'tool.call', id: 'unexpected-tool' }] },
    { events: [{ type: 'model.message', id: 'message-2', threadId: 'main', content: 'extra' }] },
    { output: { type: 'model.message', id: 'message-1', threadId: 'subagent', finishReason: 'stop', content: '{"findings":[]}' } },
  ]) {
    const result = await observeReview({ client: observedClient(options), row, runtime: fixtureRuntime });
    assert.equal(result.state, 'held');
    assert.equal(result.code, 'runtime_policy_violation');
    assert.equal(result.findings, null);
  }
});
test('wrong input is held and an output missing from complete event history cannot become findings', async () => {
  const wrong = await observeReview({ client: observedClient({ wrongInput: true }), row, runtime: fixtureRuntime });
  assert.equal(wrong.state, 'held'); assert.equal(wrong.findings, null);
  const missing = await observeReview({ client: observedClient({ events: [] }), row, runtime: fixtureRuntime });
  assert.equal(missing.state, 'failed'); assert.equal(missing.findings, null);
});
test('disabled review integration has no database or provider dependency', async () => {
  const feature = await configuredReviews({ env: {} });
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  feature.handler({}, res);
  assert.equal(res.status, 503);
  assert.deepEqual(JSON.parse(res.body), { error: 'review_unavailable' });
  await feature.close();
});
test('new review component parses as JSX and never embeds an inference credential', () => {
  const path = 'integrations/base44/components/GateKeeperReview.jsx';
  const text = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const result = ts.transpileModule(text, { fileName: path, reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, allowJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  assert.deepEqual((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), []);
  assert.doesNotMatch(text, /Deno\.env|process\.env|GATEKEEPER_REVIEW_TOKEN|TRUEFORGE_API_KEY|dangerouslySetInnerHTML/);
});
