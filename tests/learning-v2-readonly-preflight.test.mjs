import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCatalog, projectLegacyBank, validatePrivateHost } from '../scripts/learning-v2/readonly-preflight.mjs';

test('catalog refuses wrong SDK response shape instead of inventing empty catalogues', async () => {
  const tf = (p, m) => ({ settings: { modelProviders: { list: async () => p } }, models: { list: async () => m } });
  for (const response of [undefined, [], { response: { data: [] } }, { data: { data: [] } }]) {
    await assert.rejects(inspectCatalog(tf(response, { data: [] })), /PROVIDERS_SHAPE_INVALID/);
    await assert.rejects(inspectCatalog(tf({ data: [] }, response)), /MODELS_SHAPE_INVALID/);
  }
  const result = await inspectCatalog(tf({ data: [] }, { data: [] }));
  assert.equal(result.providerCount, 0);
  assert.equal(result.modelCount, 0);
});

test('catalog output contains selected metadata and no credential-bearing fields', async () => {
  const secret = 'SYNTHETIC_PROVIDER_CREDENTIAL_DO_NOT_LOG';
  const tf = { settings: { modelProviders: { list: async () => ({ data: [{ name: 'tfy-direct', manifest: { type: 'openai-compatible', auth: { api_key: secret }, base_url: 'https://example.invalid/?secret=' + secret } }] }) } },
    models: { list: async () => ({ data: [{ name: 'tfy-direct/glm-5-3-flash', provider: { name: 'tfy-direct', secret }, token: secret }] }) } };
  const result = await inspectCatalog(tf);
  assert.equal(result.models[0].name, 'tfy-direct/glm-5-3-flash');
  assert.equal(result.inferenceCalls, 0);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('preflight credentials are destination-bound to the existing private TrueForge endpoint', () => {
  assert.equal(validatePrivateHost('http://trueforge.railway.internal:8080/'), 'http://trueforge.railway.internal:8080');
  for (const url of ['http://other.railway.internal:8080', 'https://example.com', 'http://trueforge.railway.internal:8080?x=1', 'http://user:pass@trueforge.railway.internal:8080', 'http://trueforge.railway.internal:8080/other']) assert.throws(() => validatePrivateHost(url), /HOST_INVALID/);
});

test('legacy export preserves negative and unproven provenance while excluding private traces', () => {
  const secret = 'SYNTHETIC_PRIVATE_TRACE_DO_NOT_LOG';
  const bytes = Buffer.from(JSON.stringify({ version: 1, revision: 53, accepted: [], harmful: [{ id: 'prior', status: 'harmful-in-tested-context', rules: ['Prior rejected procedure'], source: 'a'.repeat(40), netChange: -1, fitFeedback: secret, rawResponse: secret }], unproven: [{ id: 'unknown', rules: ['Prior unproven procedure'], confirmation: { confirmed: false, repeats: 3, pairs: [{ private: secret }] } }], history: [{ kind: 'duplicate-not-retried', rules: ['Prior rejected procedure'], round: 10, token: secret }] }));
  const result = projectLegacyBank(bytes);
  assert.deepEqual(result.counts, { accepted: 0, harmful: 1, unproven: 1, history: 1 });
  assert.equal(result.records[0].netChange, -1);
  assert.equal(result.records[1].confirmation.confirmed, false);
  assert.equal(result.records[2].kind, 'duplicate-not-retried');
  assert.match(result.fileDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.match(result.authority, /not v4 signed promotion/);
  assert.throws(() => projectLegacyBank(Buffer.from('{"version":1}')), /GROUP_INVALID/);
});
