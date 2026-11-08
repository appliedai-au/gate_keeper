/**
 * Single-service TrueForge transport adapter. This process does not create a
 * learning coordinator. It forks exactly one packaged TrueForge server on a
 * fixed loopback port and forwards all ordinary requests unchanged.
 *
 * The one owner-bound read-only learning route is served locally and denied
 * without a private, integrity-checked status configuration and real journal.
 */
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { LEARNING_STATUS_PATH } from '../../integrations/base44/shared/learning-status-contract.js';
import { createReadOnlyLearningStatusReader } from './status-reader.mjs';
import { readStatusConfig } from './status-config.mjs';
import { createReadOnlyStatusHandler } from './status-listener.mjs';
import { REVIEW_PATH } from '../../integrations/base44/shared/review-contract.js';
import { configuredReviews } from '../reviews/runtime.mjs';
import { reviewUnavailable } from '../reviews/service.mjs';
import { PRODUCT_PATH } from '../product/contracts.mjs';
import { configuredProduct } from '../product/runtime.mjs';
import { productUnavailable } from '../product/service.mjs';

const UPSTREAM_PORT = 8790;
const CONFIG_PATH = '/var/lib/gk-v2-private-journal/status-config.json';
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const reject = reason => { throw new Error('GK_STATUS_ROUTER_REFUSED: ' + reason); };
const noStore = Object.freeze({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
const isProductPath = value => typeof value === 'string' &&
  (value === PRODUCT_PATH || value.startsWith(PRODUCT_PATH + '/'));

/** Product bindings belong to this gateway, not its model-serving child.
 * This filters inherited environment only; it does not claim OS isolation. */
export function trueforgeTransportEnvironment(env = process.env) {
  return { ...Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('G8S_'))),
    HOST: '127.0.0.1', PORT: String(UPSTREAM_PORT) };
}

function unavailable(_req, res) {
  res.writeHead(503, noStore);
  res.end('{"error":"learning_status_unavailable"}');
}

/** Keep a status configuration with no learning/SDK/writer capabilities. */
export function configuredStatusHandler({ env = process.env, readConfig = readStatusConfig,
  readStatusFactory = createReadOnlyLearningStatusReader } = {}) {
  if (env.GK_V3_READONLY_STATUS !== 'enabled') return unavailable;
  let config;
  try {
    config = readConfig({ path: CONFIG_PATH });
    if (config.directory !== '/var/lib/gk-v2-private-journal/experiment' ||
        config.repositoryRoot !== '/app') reject('status roots differ from pinned host');
    return createReadOnlyStatusHandler({
      readStatus: readStatusFactory({
        directory: config.directory, repositoryRoot: config.repositoryRoot,
        binding: config.binding, trust: config.trust, configDigest: config.configDigest,
      }),
      readToken: config.readToken, binding: config.binding,
    });
  } catch {
    // Never expose private file paths, identities, secrets or trust failures.
    return unavailable;
  }
}

/** Dedicated scoped routes precede unchanged ordinary TrueForge transport. */
export function createStatusRoutingHandler({ statusHandler, proxyHandler, reviewHandler = reviewUnavailable,
  productHandler = productUnavailable }) {
  if (typeof statusHandler !== 'function' || typeof proxyHandler !== 'function') reject('invalid handler');
  return (req, res) => {
    const target = req.url;
    if (typeof target !== 'string' || target.length > 8192 ||
        !target.startsWith('/') || target.startsWith('//') ||
        /[\u0000-\u001f]/u.test(target)) {
      res.writeHead(400, noStore);
      res.end('{"error":"bad_request"}');
      return;
    }
    let pathname;
    try {
      const rawPath = target.split('?')[0];
      pathname = new URL(target, 'http://localhost').pathname;
      let decoded = null;
      try { decoded = decodeURIComponent(rawPath); } catch { /* Unrelated proxy paths stay opaque. */ }
      // Classify exact prefix boundaries, including aliases that normalize out
      // of or into the product route. Never reject unrelated transport just
      // because it contains a percent sign or the words "product-v1".
      const mayBeProduct = isProductPath(pathname) || isProductPath(rawPath) || isProductPath(decoded);
      if (mayBeProduct && (decoded === null || decoded !== rawPath || pathname !== rawPath ||
          decoded.includes('\\') || decoded.split('/').some(segment => segment === '.' || segment === '..'))) {
        throw new Error('noncanonical_path');
      }
    }
    catch { res.writeHead(400, noStore); res.end('{"error":"bad_request"}'); return; }
    const isProduct = isProductPath(pathname);
    if (pathname === LEARNING_STATUS_PATH || pathname === REVIEW_PATH || isProduct) {
      const handler = isProduct ? productHandler : pathname === LEARNING_STATUS_PATH ? statusHandler : reviewHandler;
      void Promise.resolve(handler(req, res)).catch(() => {
        if (!res.headersSent) (isProduct ? productUnavailable : pathname === LEARNING_STATUS_PATH ? unavailable : reviewUnavailable)(req, res);
        else res.destroy();
      });
    } else {
      proxyHandler(req, res);
    }
  };
}

export function forwardTrueForge(req, res, createRequest = httpRequest) {
  const headers = { ...req.headers };
  delete headers['proxy-authorization'];
  delete headers['proxy-authenticate'];
  headers.host = '127.0.0.1:' + UPSTREAM_PORT;
  const failResponse = () => {
    if (res.destroyed || res.writableEnded) return;
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"error":"trueforge_unavailable"}');
    } else res.destroy();
  };
  const upstream = createRequest({
    hostname: '127.0.0.1', port: UPSTREAM_PORT, path: req.url, method: req.method,
    headers, agent: false,
  }, incoming => {
    const truncated = () => {
      upstream.destroy();
      failResponse();
    };
    // pipe() handles backpressure, but does not forward readable failures.
    // Once headers were sent, end the broken stream without an invented
    // successful HTTP/SSE terminator or retry of the upstream operation.
    incoming.once('aborted', truncated);
    incoming.on('error', truncated);
    incoming.once('close', () => {
      if (!incoming.complete) truncated();
    });
    if (res.destroyed) { incoming.destroy(); upstream.destroy(); return; }
    res.writeHead(incoming.statusCode || 502, incoming.headers);
    incoming.pipe(res);
  });
  upstream.on('error', failResponse);
  // A completed GET has no active request body; SSE clients may disappear
  // hours later without req 'aborted'. Tie upstream custody to response close.
  res.once('close', () => {
    if (!res.writableFinished) upstream.destroy();
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

/** Preserve TrueForge's configured turn/persistence drain, plus a small margin. */
export function configuredShutdownGraceMs(env = process.env) {
  const raw = env.GRACEFUL_TIMEOUT_SECONDS;
  const seconds = raw === undefined || raw.trim() === '' ? 30 : Number(raw);
  if (!Number.isInteger(seconds) || seconds < 1) reject('invalid child shutdown grace');
  const milliseconds = seconds * 1000 + 5000;
  // Node clamps overflowing timers to 1 ms; reject that transport limit,
  // rather than silently killing the child before its configured drain.
  if (!Number.isSafeInteger(milliseconds) || milliseconds > MAX_TIMEOUT_MS) {
    reject('child shutdown grace exceeds timer range');
  }
  return milliseconds;
}

/** Own only transport/child lifetimes; this does not add agent authority. */
export function superviseTrueForgeGateway({ server, child,
  shutdownGraceMs = configuredShutdownGraceMs(), onStopping = () => {} }) {
  if (!Number.isInteger(shutdownGraceMs) || shutdownGraceMs < 1 ||
      shutdownGraceMs > MAX_TIMEOUT_MS) reject('invalid shutdown grace');
  const sockets = new Set();
  let stopping = false, serverClosed = false, childExited = false, childClosed = false;
  let graceTimer, exitTimer, resolveStopped;
  const stopped = new Promise(resolve => { resolveStopped = resolve; });
  const connected = socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };
  const finish = () => {
    if (!stopping || !serverClosed || !childClosed) return;
    clearTimeout(graceTimer);
    clearTimeout(exitTimer);
    process.off('SIGTERM', terminate);
    process.off('SIGINT', interrupt);
    server.off('connection', connected);
    server.off('error', serverFailed);
    resolveStopped();
  };
  const kill = signal => {
    if (!childExited) {
      try { child.kill(signal); } catch { /* final deadline still applies */ }
    }
  };
  const stop = (signal = 'SIGTERM') => {
    if (stopping) return stopped;
    stopping = true;
    onStopping();
    server.close(() => { serverClosed = true; finish(); });
    server.closeIdleConnections();
    kill(signal);
    graceTimer = setTimeout(() => {
      // server.close() alone waits forever for an open SSE/keep-alive socket.
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      kill('SIGKILL');
      // Do not let a stuck child handle or shutdown hook keep this gateway
      // alive indefinitely after the listener and sockets have been closed.
      exitTimer = setTimeout(() => process.exit(process.exitCode || 1), 1000);
      exitTimer.unref();
      finish();
    }, shutdownGraceMs);
    graceTimer.unref();
    return stopped;
  };
  const terminate = () => { void stop('SIGTERM'); };
  const interrupt = () => { void stop('SIGINT'); };
  const serverFailed = () => { process.exitCode = 1; void stop(); };
  server.on('connection', connected);
  server.on('error', serverFailed);
  process.on('SIGTERM', terminate);
  process.on('SIGINT', interrupt);
  child.once('exit', code => {
    childExited = true;
    process.exitCode = code === 0 ? 1 : code || 1;
    void stop();
  });
  child.once('error', () => {
    process.exitCode = 1;
    void stop();
  });
  child.once('close', () => { childClosed = true; finish(); });
  return { stop, stopped };
}

/** Invoked only after the existing root-only volume preflight dropped UID. */
export async function startTrueForgeStatusGateway({ env = process.env, run = spawn,
  statusHandler = configuredStatusHandler({ env }), port = Number(env.PORT || 8080) } = {}) {
  if (process.getuid?.() !== 1000 || env.GK_V2_HOST_BOOTSTRAP !== 'enabled' ||
      env.GK_V3_HTTP_ROUTER !== 'enabled') reject('explicit non-root opt-in startup required');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === UPSTREAM_PORT ||
      port === 8791) reject('invalid external port');
  const shutdownGraceMs = configuredShutdownGraceMs(env);
  const reviews = await configuredReviews({ env });
  const product = await configuredProduct({ env });
  const child = run(process.execPath, ['node_modules/@truefoundry/trueforge/dist/main.js'], {
    cwd: '/app', stdio: 'inherit',
    env: trueforgeTransportEnvironment(env),
  });
  const server = createServer(createStatusRoutingHandler({
    statusHandler, proxyHandler: forwardTrueForge, reviewHandler: reviews.handler, productHandler: product.handler,
  }));
  const lifecycle = superviseTrueForgeGateway({ server, child, shutdownGraceMs,
    onStopping() { reviews.stop(); product.stop(); } });
  void lifecycle.stopped.then(() => Promise.allSettled([reviews.close(), product.close()])).catch(() => {});
  try {
    await new Promise((resolve, fail) => {
      server.once('error', fail);
      server.listen(port, '0.0.0.0', () => {
        server.off('error', fail);
        resolve();
      });
    });
  } catch (error) {
    await lifecycle.stop();
    throw error;
  }
  product.start();
  return { server, child };
}
