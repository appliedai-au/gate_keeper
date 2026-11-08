import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { generateKeyPairSync } from 'node:crypto';
import { createComparisonApi, configuredComparisonApi, COMPARISON_PATH } from '../scripts/product/comparison-api.mjs';
import { createGitHubClient } from '../scripts/product/github.mjs';
const id = '00000000-0000-4000-8000-000000000001', snapshotId = '00000000-0000-4000-8000-000000000002';
const session = Buffer.alloc(32, 1).toString('base64url');
const config = { apiOrigin: 'https://gate.g8s.test', frontendOrigin: 'https://g8s.test' };
const pr = { head: { sha: 'a'.repeat(40) }, base: { sha: 'b'.repeat(40), ref: 'main' } };
const ctx = { user: { login: 'owner', github_id: '11' }, repository: { github_repo_id: '101', full_name: 'owner/repo' },
  installation: { github_installation_id: '102' }, run: { head_sha: pr.head.sha, base_sha: pr.base.sha, base_branch: 'main', pr_number: 7 }, g8sDigest: 'digest' };
const path = COMPARISON_PATH + '/orgs/alpha/comparisons';
async function invoke(api, url = path, { method = 'GET', body, headers = {}, anonymous = false } = {}) {
  const finalHeaders = { ...(anonymous ? {} : { cookie: '__Host-g8s_session=' + session }),
    ...(method !== 'GET' && method !== 'OPTIONS' ? { origin: config.frontendOrigin, 'x-g8s-request': '1', 'content-type': 'application/json' } : {}), ...headers };
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  Object.assign(req, { url, method, headers: finalHeaders, rawHeaders: Object.entries(finalHeaders).flat() });
  const res = { headersSent: false, status: 0, headers: {}, body: '',
    writeHead(status, values) { this.status = status; this.headers = values; this.headersSent = true; },
    end(body = '') { this.body = body; }, destroy() { assert.fail('unexpected response destruction'); } };
  await api.handler(req, res); return res;
}
function fixture(patch = {}) {
  const calls = [], store = { async rate() {}, async context() { calls.push('context'); return ctx; },
    async capture(_principal, _slug, _runId, body) { calls.push('capture'); assert.equal(body.expectedG8sDigest, ctx.g8sDigest);
      return { comparisonId: id, snapshotId, version: 1, duplicate: false }; },
    async list() { return { comparisons: [], page: { index: 0, hasNext: false } }; },
    async detail() { return { snapshotId, payloadHash: 'hash', g8s: { headSha: pr.head.sha, baseSha: pr.base.sha, findings: [] },
      gitar: { artifacts: [] }, feedback: [] }; },
    async remove() { calls.push('delete'); return { deleted: true }; }, ...patch.store };
  const access = { async mayCommand() { calls.push('permission'); return true; },
    async pullRequest() { calls.push('revision'); return pr; },
    async comparisonEvidence() { calls.push('collect'); return { reviews: [], inline: [], comments: [] }; }, ...patch.access };
  const github = { async installationClient(install, repo, options) {
    assert.equal(install, '102'); assert.equal(repo, '101'); assert.deepEqual(options, { readOnly: true }); return access; } };
  const api = createComparisonApi({ store, github, config, fallback(_req, res) { res.writeHead(202, {}); res.end('original'); } });
  return { api, calls };
}
test('capture verifies access and immutable PR twice, never requests a model or publishes a review', async () => {
  const { api, calls } = fixture(); const result = await invoke(api, path, { method: 'POST', body: { runId: id } });
  assert.equal(result.status, 200); assert.deepEqual(calls, ['context', 'permission', 'revision', 'collect', 'revision', 'capture']);
  assert.equal(JSON.parse(result.body).data.reviewersTriggered, false); assert.equal(JSON.parse(result.body).data.trainingStarted, false);
});
test('a moved PR is refused before evidence collection or persistence', async () => {
  const { api, calls } = fixture({ access: { async pullRequest() { return { ...pr, head: { sha: 'c'.repeat(40) } }; } } });
  const result = await invoke(api, path, { method: 'POST', body: { runId: id } });
  assert.equal(result.status, 409); assert.equal(JSON.parse(result.body).error.code, 'revision_changed');
  assert.equal(calls.includes('collect'), false); assert.equal(calls.includes('capture'), false);
});
test('a PR moving during capture cannot be saved', async () => {
  let reads = 0; const { api, calls } = fixture({ access: { async pullRequest() { return ++reads === 1 ? pr : { ...pr, base: { ...pr.base, sha: 'c'.repeat(40) } }; } } });
  const result = await invoke(api, path, { method: 'POST', body: { runId: id } });
  assert.equal(result.status, 409); assert.equal(calls.includes('capture'), false);
});
test('permission denial and unfinished G8S review cannot collect comparator output', async () => {
  const denied = fixture({ access: { async mayCommand() { return false; } } });
  assert.equal((await invoke(denied.api, path, { method: 'POST', body: { runId: id } })).status, 403);
  assert.equal(denied.calls.includes('collect'), false);
  const early = fixture({ store: { async context() { throw Object.assign(new Error(), { code: 'review_not_complete', status: 409 }); } } });
  assert.equal((await invoke(early.api, path, { method: 'POST', body: { runId: id } })).status, 409);
  assert.deepEqual(early.calls, []);
});
for (const request of [
  { anonymous: true }, { anonymous: true, headers: { authorization: 'Bearer g8s_v1_' + session } },
  { headers: { origin: 'https://other.test' } },
]) test('comparison access requires the correct current-session boundary: ' + JSON.stringify(request), async () => {
  const { api } = fixture(); const result = await invoke(api, path, request); assert.ok([401, 403].includes(result.status));
});
for (const headers of [{ origin: '' }, { 'x-g8s-request': '0' }, { 'content-type': 'text/plain' }])
  test('comparison mutations refuse missing CSRF/JSON boundary: ' + JSON.stringify(headers), async () => {
    const { api, calls } = fixture(); const result = await invoke(api, path, { method: 'POST', body: { runId: id }, headers });
    assert.ok([403, 415].includes(result.status)); assert.equal(calls.includes('capture'), false);
  });
for (const suffix of ['?page=-1', '?page=0&page=1', '?owner=someone', '/%2e%2e', '/not-a-uuid', '#secret'])
  test('unknown authority, alias and ambiguous queries are refused: ' + suffix, async () => {
    const { api } = fixture(); assert.ok([400, 404].includes((await invoke(api, path + suffix)).status));
  });
test('deletion requires an explicit boolean and unrelated endpoints retain their handler', async () => {
  const { api, calls } = fixture();
  assert.equal((await invoke(api, path + '/' + id, { method: 'DELETE', body: { confirmed: 'true' } })).status, 400);
  assert.equal(calls.includes('delete'), false);
  assert.equal((await invoke(api, path + '/' + id, { method: 'DELETE', body: { confirmed: true } })).status, 200);
  assert.equal((await invoke(api, '/gatekeeper/product-v1/session')).body, 'original');
});
test('unconfigured optional comparison never breaks the original session handler', async () => {
  const fallback = (_req, res) => { res.writeHead(200, {}); res.end('session'); };
  const disabled = await configuredComparisonApi({ env: {}, product: null, config, fallback });
  assert.equal(disabled.handler, fallback);
  const missing = await configuredComparisonApi({ env: { G8S_COMPARISON_ENABLED: 'enabled' }, product: null, config, fallback });
  assert.equal((await invoke(missing, '/gatekeeper/product-v1/session')).body, 'session');
  assert.equal((await invoke(missing)).status, 503);
});
test('candidate export explicitly blocks automatic training, and errors contain no private exception', async () => {
  const { api } = fixture(); const result = await invoke(api, path + '/' + id + '/candidates');
  const data = JSON.parse(result.body).data; assert.equal(data.automaticTrainingEligible, false); assert.equal(data.trainingStarted, false);
  const broken = fixture({ store: { async list() { throw new Error('PRIVATE-TRANSPORT-SECRET'); } } });
  const error = await invoke(broken.api); assert.equal(error.status, 503); assert.equal(error.body.includes('PRIVATE-TRANSPORT-SECRET'), false);
});

test('GitHub comparison transport uses bounded read-only installation credentials and cannot publish', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); const calls = [];
  const github = createGitHubClient({ appId: '1', clientId: 'SYNTHETIC', clientSecret: 'SYNTHETIC', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    callbackUrl: config.apiOrigin, fetchImpl: async (input, options) => {
      const url = new URL(input); calls.push({ path: url.pathname, method: options.method });
      if (url.pathname.endsWith('/access_tokens')) {
        const body = JSON.parse(options.body); assert.equal(body.permissions.pull_requests, 'read'); assert.deepEqual(body.repository_ids, [101]);
        return Response.json({ token: 'SYNTHETIC_INSTALLATION_TOKEN_12345', expires_at: new Date(Date.now() + 60000).toISOString() }, { status: 201 });
      }
      assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
      return Response.json([]);
    } });
  const client = await github.installationClient('102', '101', { readOnly: true });
  assert.deepEqual(await client.comparisonEvidence('owner/repo', 7), { reviews: [], inline: [], comments: [] });
  assert.deepEqual(calls.map(x => x.path), ['/app/installations/102/access_tokens', '/repos/owner/repo/pulls/7/reviews',
    '/repos/owner/repo/pulls/7/comments', '/repos/owner/repo/issues/7/comments']);
  const before = calls.length; await assert.rejects(client.postReview('owner/repo', 7, {}), { code: 'github_access_denied' }); assert.equal(calls.length, before);
});
