/**
 * Independent, read-only verification of authentic TrueForge SDK artifacts.
 * The caller supplies only IDs already owned by the detached admission ledger.
 * No driver-provided "complete", raw output, score or estimated charge is trusted.
 */
import { createHash } from 'node:crypto';
import { canonical, copy, requireThat } from './contracts.mjs';
import { TURN_CONFIG } from './trueforge-turn.mjs';

export const textSha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const sdkOptions = Object.freeze({ maxRetries: 0, timeoutInSeconds: 60 });
const responseId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u.test(value);

/** Drop SDK undefined optionals only; never serialize response wrappers/headers. */
export function providerJson(value) {
  function visit(item, depth) {
    requireThat(depth <= 64, 'provider JSON depth');
    if (item === null || ['string', 'boolean'].includes(typeof item)) return item;
    if (typeof item === 'number') {
      requireThat(Number.isFinite(item), 'provider finite number');
      return item;
    }
    requireThat(item && typeof item === 'object' &&
      (Array.isArray(item) || [Object.prototype, null].includes(Object.getPrototypeOf(item))),
    'provider plain JSON');
    requireThat(Object.getOwnPropertySymbols(item).length === 0, 'provider JSON symbols');
    if (Array.isArray(item)) return item.map(part => visit(part, depth + 1));
    const result = {};
    for (const key of Object.getOwnPropertyNames(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      requireThat(descriptor.enumerable && Object.hasOwn(descriptor, 'value') &&
        !['__proto__', 'constructor', 'prototype'].includes(key), 'provider JSON property');
      if (descriptor.value !== undefined) result[key] = visit(descriptor.value, depth + 1);
    }
    return result;
  }
  const result = visit(value, 0);
  canonical(result);
  return result;
}

export function assertInlineSession(session, entry) {
  requireThat(session?.id === entry.sessionId && session.shared === false &&
    session.agent?.type === 'inline', 'provider session isolation');
  requireThat(canonical(session.metadata) === canonical(entry.sessionRequest.metadata),
    'provider metadata differs from authority dispatch');
  const spec = providerJson(session.agent.spec);
  // Approved 0.180/0.182 servers add this inert Zod default even when disabled.
  if (spec.config?.sandbox?.enabled === false && spec.config.sandbox.fileDownloads === true) {
    delete spec.config.sandbox.fileDownloads;
  }
  requireThat(canonical(spec) === canonical(entry.sessionRequest.agent.spec),
    'provider inline agent spec differs from frozen dispatch');
  if (entry.createdBySubject !== undefined) {
    requireThat(canonical(session.createdBySubject) === canonical(entry.createdBySubject),
      'provider session owner changed');
  }
}

async function pages(read, label, limit) {
  const values = [], cursors = new Set(), bodies = [];
  let pageToken;
  for (let index = 0; index < 100; index++) {
    const page = await read({ order: 'asc', limit, ...(pageToken ? { pageToken } : {}) });
    const body = providerJson(page.response);
    requireThat(Array.isArray(body?.data) && body.pagination &&
      typeof body.pagination === 'object', label + ' pagination shape');
    values.push(...body.data);
    bodies.push(body);
    requireThat(values.length <= 10000, label + ' item limit');
    const next = body.pagination.nextPageToken;
    if (next === undefined) return { values, bodies };
    requireThat(typeof next === 'string' && next.length > 0 && next.length <= 4096 &&
      !cursors.has(next), label + ' repeated or invalid cursor');
    cursors.add(next);
    pageToken = next;
  }
  throw new Error('GK_AUTHORITY_PROVIDER_PAGINATION_INCOMPLETE');
}

function outputText(output) {
  if (typeof output?.content === 'string') return output.content;
  requireThat(Array.isArray(output?.content) &&
    output.content.every(part => part?.type === 'text' && typeof part.text === 'string'),
  'provider output contains refusal or unsupported content');
  return output.content.map(part => part.text).join('');
}

/**
 * A terminal error is retained as execution evidence, not a successful score.
 * Distinct model-message IDs represent observed inference attempts; initial and
 * final events for one step intentionally share an ID. Costs remain unknown.
 */
export async function inspectProviderCall(provider, entry, { requireComplete = false } = {}) {
  requireThat(responseId(entry.sessionId) && responseId(entry.turnId), 'owned provider IDs absent');
  requireThat(['get', 'getTurn', 'listTurns', 'listTurnEvents'].every(name =>
    typeof provider?.sessions?.[name] === 'function'), 'provider read capabilities absent');
  const session = providerJson((await provider.sessions.get(entry.sessionId, sdkOptions)).data);
  assertInlineSession(session, entry);
  // The 0.182 turn index caps pages at 25; turn events retain their 100-item limit.
  const allTurns = await pages(input =>
    provider.sessions.listTurns(entry.sessionId, input, sdkOptions), 'turns', 25);
  requireThat(allTurns.values.length === 1 && allTurns.values[0].id === entry.turnId,
    'session contains additional or unowned turns');
  const turn = providerJson((await provider.sessions.getTurn(entry.sessionId, entry.turnId, sdkOptions)).data);
  requireThat(turn?.id === entry.turnId && turn.sessionId === entry.sessionId &&
    turn.previousTurnId === null && ['done', 'error', 'cancelled'].includes(turn.state?.status),
  'provider execution remains unresolved');
  requireThat(canonical(turn.input) === canonical(entry.turnRequest.input),
    'provider root turn input differs from frozen dispatch');
  const eventPages = await pages(input =>
    provider.sessions.listTurnEvents(entry.sessionId, entry.turnId, input, sdkOptions), 'events', 100);
  const after = providerJson((await provider.sessions.getTurn(entry.sessionId, entry.turnId, sdkOptions)).data);
  requireThat(canonical(after) === canonical(turn), 'provider turn changed while reading evidence');
  const events = eventPages.values;
  const messages = events.filter(event => event?.type === 'model.message');
  const modelIds = new Set();
  for (const event of messages) {
    requireThat(responseId(event.id) && event.threadId === 'main', 'provider model event identity');
    modelIds.add(event.id);
    if (event.model !== undefined) {
      requireThat(canonical(event.model) === canonical(entry.sessionRequest.agent.spec.model),
        'provider event model drift');
    }
  }
  requireThat(modelIds.size <= 1, 'unexpected additional provider inference');
  const output = turn.state.output;
  let complete = turn.state.status === 'done' && output?.type === 'model.message' &&
    output.threadId === 'main' && modelIds.size === 1 && modelIds.has(output.id) &&
    output.finishReason === 'stop' && Array.isArray(turn.state.requiredActions) &&
    turn.state.requiredActions.length === 0;
  let text = '';
  try { text = outputText(output); } catch { complete = false; }
  const last = messages.filter(event => event.id === output?.id).at(-1);
  if (!last || last.finishReason !== 'stop') complete = false;
  else {
    try { if (outputText(last) !== text) complete = false; } catch { complete = false; }
  }
  for (const event of [...events, ...(output ? [output] : [])]) {
    if (typeof event?.type !== 'string' || /^(tool\.|mcp\.|sandbox\.)/u.test(event.type) ||
      /(?:error|approval_required|response_required|auth_required)$/u.test(event.type) ||
      event.refusal != null && event.refusal !== '' ||
      event.toolCalls !== undefined && (!Array.isArray(event.toolCalls) || event.toolCalls.length !== 0) ||
      event.type.startsWith('model.message') && event.threadId !== 'main' ||
      Array.isArray(event.content) && event.content.some(part => part?.type === 'refusal')) complete = false;
  }
  if (!text.trim()) complete = false;
  requireThat(canonical(entry.sessionRequest.agent.spec.config) === canonical(TURN_CONFIG),
    'authority execution config drift');
  if (requireComplete) requireThat(complete, 'provider output cannot qualify an evaluation');
  const estimatedCostUsd = turn.state.metrics?.totalCostInUsd;
  return {
    callId: entry.callId, sessionId: entry.sessionId, turnId: entry.turnId,
    inputDigest: entry.inputDigest, outputDigest: textSha256(text), text, complete,
    observedModelCalls: modelIds.size, actualMicros: null,
    estimatedCostUsd: typeof estimatedCostUsd === 'number' && Number.isFinite(estimatedCostUsd) &&
      estimatedCostUsd >= 0 ? estimatedCostUsd : null,
    finishReason: output?.finishReason ?? null,
    artifact: { session, turn, turnPages: allTurns.bodies, eventPages: eventPages.bodies },
  };
}
