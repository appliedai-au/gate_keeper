import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatusRoutingHandler } from '../scripts/learning-v2/trueforge-status-gateway.mjs';
import { PRODUCT_PATH } from '../scripts/product/contracts.mjs';
import { LEARNING_STATUS_PATH } from '../integrations/base44/shared/learning-status-contract.js';
import { REVIEW_PATH } from '../integrations/base44/shared/review-contract.js';

function route(url, { product = true } = {}) {
  const calls = [];
  const req = { url };
  const res = { status: null, body: null, headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    end(body) { this.body = body; }, destroy() { assert.fail('routing fixture must not destroy a response'); } };
  const handler = name => (request, response) => {
    assert.equal(request, req); assert.equal(response, res);
    calls.push({ name, url: request.url });
  };
  createStatusRoutingHandler({ statusHandler: handler('learning'), proxyHandler: handler('proxy'),
    reviewHandler: handler('reviews'), ...(product ? { productHandler: handler('product') } : {}) })(req, res);
  return { calls, res };
}

test('ordinary TrueForge paths remain opaque, including malformed percent encodings', () => {
  for (const url of ['/api/v1/sessions/opaque%', '/api/v1/sessions/opaque%GG', '/api/v1/sessions/opaque%FF',
    '/api/v1/sessions/a%2Fb', '/api/v1/sessions/a%5Cb', '/api/v1/sessions/a%25b',
    '/api/v1/sessions/product-v1%GG', '/api/product-v1/%GG', '/gatekeeper/product-v10/%GG',
    '/api/./v1/sessions', '/api/old/../v1/sessions?cursor=%GG']) {
    const result = route(url);
    assert.deepEqual(result.calls, [{ name: 'proxy', url }], url);
    assert.equal(result.res.status, null);
  }
});

test('product path aliases fail closed rather than reaching product or ordinary proxy handlers', () => {
  for (const url of [PRODUCT_PATH + '/%GG', PRODUCT_PATH + '/%FF', PRODUCT_PATH + '/%2Fsession',
    PRODUCT_PATH + '/%5Csession', PRODUCT_PATH + '/%25session', PRODUCT_PATH + '/%73ession',
    PRODUCT_PATH + '/../session', PRODUCT_PATH + '/./session', PRODUCT_PATH + '/%2e%2e/session',
    PRODUCT_PATH + '/%252e%252e/session', '/gatekeeper%2Fproduct-v1/session',
    '/gatekeeper/prod%75ct-v1/session', '/elsewhere/../gatekeeper/product-v1/session',
    '/gatekeeper\\product-v1\\session']) {
    const result = route(url);
    assert.equal(result.res.status, 400, url);
    assert.deepEqual(result.calls, [], url);
    assert.equal(result.res.headers['Cache-Control'], 'private, no-store');
  }
});

test('canonical product routes retain query handling and default to unavailable without setup', () => {
  for (const url of [PRODUCT_PATH, PRODUCT_PATH + '/session', PRODUCT_PATH + '/orgs/team-1/overview?repository=all&search=%GG']) {
    const result = route(url);
    assert.deepEqual(result.calls, [{ name: 'product', url }]);
  }
  const disabled = route(PRODUCT_PATH + '/session', { product: false });
  assert.equal(disabled.res.status, 503);
  assert.deepEqual(disabled.calls, []);
  assert.equal(JSON.parse(disabled.res.body).error.code, 'setup_required');
});

test('learning and private-review routes keep their original handlers', () => {
  assert.deepEqual(route(LEARNING_STATUS_PATH).calls, [{ name: 'learning', url: LEARNING_STATUS_PATH }]);
  assert.deepEqual(route(REVIEW_PATH).calls, [{ name: 'reviews', url: REVIEW_PATH }]);
});
