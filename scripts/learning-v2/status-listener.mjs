/**
 * Opt-in read-only HTTP transport for the existing learning-v2 capability.
 * No SDK, issuer, writer, agent, admission, billing or activation dependency.
 *
 * It is loopback-only. An independently reviewed same-container routing
 * integration is required before any external exposure.
 */
import { createServer } from 'node:http';
import { createLearningStatusEndpoint, createLearningStatusTokenAuthenticator } from './status-endpoint.mjs';
import { validateLearningStatusBinding } from '../../integrations/base44/shared/learning-status-contract.js';

const reject = (reason) => { throw new Error('GK_V2_STATUS_TRANSPORT_REFUSED: ' + reason); };
const MAX_HEADER_BYTES = 8192;

export function createReadOnlyStatusHandler({ readStatus, binding, readToken }) {
  if (typeof readStatus !== 'function') reject('read-only capability missing');
  const fixed = validateLearningStatusBinding(binding);
  const authenticate = createLearningStatusTokenAuthenticator({ readToken, binding: fixed });
  const endpoint = createLearningStatusEndpoint({ readStatus, authenticate, binding: fixed });
  return async function nodeHandler(incoming, outgoing) {
    // Do not buffer or parse body; the endpoint accepts exactly GET with none.
    if (incoming.headers['transfer-encoding'] !== undefined ||
        incoming.headers['content-length'] !== undefined ||
        incoming.method !== 'GET') {
      outgoing.writeHead(405, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
      outgoing.end('{"error":"method_not_allowed"}');
      return;
    }
    try {
      if (incoming.rawHeaders && Buffer.byteLength(incoming.rawHeaders.join(':'), 'utf8') > MAX_HEADER_BYTES) {
        outgoing.writeHead(431, { 'Cache-Control': 'no-store' });
        outgoing.end();
        return;
      }
      const url = 'http://127.0.0.1' + incoming.url;
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(','));
      }
      const response = await endpoint(new Request(url, { method: 'GET', headers }));
      const responseHeaders = Object.fromEntries(response.headers.entries());
      // Node writes only the previously bounded status projection or fixed error.
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(await response.text());
    } catch {
      outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      outgoing.end('{"error":"learning_status_unavailable"}');
    }
  };
}

export function createLoopbackStatusServer(options) {
  const handler = createReadOnlyStatusHandler(options);
  return createServer((incoming, outgoing) => {
    void handler(incoming, outgoing);
  });
}

export async function listenReadOnlyStatus(server, { port = 8791, host = '127.0.0.1' } = {}) {
  if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 1024 || port > 65535) {
    reject('loopback port must be fixed and unprivileged');
  }
  await new Promise((resolve, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      resolve();
    });
  });
  return server;
}
