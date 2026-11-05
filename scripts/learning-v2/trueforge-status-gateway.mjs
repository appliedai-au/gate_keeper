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

const UPSTREAM_PORT = 8790;
const CONFIG_PATH = '/var/lib/gk-v2-private-journal/status-config.json';
const reject = reason => { throw new Error('GK_STATUS_ROUTER_REFUSED: ' + reason); };
const noStore = Object.freeze({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });

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

/** The router has two outcomes only: dedicated read-only path or unchanged TrueForge. */
export function createStatusRoutingHandler({ statusHandler, proxyHandler }) {
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
    try { pathname = new URL(target, 'http://localhost').pathname; }
    catch { res.writeHead(400, noStore); res.end('{"error":"bad_request"}'); return; }
    if (pathname === LEARNING_STATUS_PATH) {
      void Promise.resolve(statusHandler(req, res)).catch(() => {
        if (!res.headersSent) unavailable(req, res);
        else res.destroy();
      });
    } else {
      proxyHandler(req, res);
    }
  };
}

export function forwardTrueForge(req, res) {
  const headers = { ...req.headers };
  delete headers['proxy-authorization'];
  delete headers['proxy-authenticate'];
  headers.host = '127.0.0.1:' + UPSTREAM_PORT;
  const upstream = httpRequest({
    hostname: '127.0.0.1', port: UPSTREAM_PORT, path: req.url, method: req.method,
    headers, agent: false,
  }, incoming => {
    res.writeHead(incoming.statusCode || 502, incoming.headers);
    incoming.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"error":"trueforge_unavailable"}');
    } else res.destroy();
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

/** Invoked only after the existing root-only volume preflight dropped UID. */
export async function startTrueForgeStatusGateway({ env = process.env, run = spawn,
  statusHandler = configuredStatusHandler({ env }), port = Number(env.PORT || 8080) } = {}) {
  if (process.getuid?.() !== 1000 || env.GK_V2_HOST_BOOTSTRAP !== 'enabled' ||
      env.GK_V3_HTTP_ROUTER !== 'enabled') reject('explicit non-root opt-in startup required');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === UPSTREAM_PORT ||
      port === 8791) reject('invalid external port');
  const child = run(process.execPath, ['node_modules/@truefoundry/trueforge/dist/main.js'], {
    cwd: '/app', stdio: 'inherit',
    env: { ...env, HOST: '127.0.0.1', PORT: String(UPSTREAM_PORT) },
  });
  const server = createServer(createStatusRoutingHandler({
    statusHandler, proxyHandler: forwardTrueForge,
  }));
  const stop = signal => {
    try { child.kill(signal); } catch { /* child already stopped */ }
    server.close();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  child.once('exit', (code, signal) => {
    server.close();
    process.exitCode = code === 0 ? 1 : code || (signal ? 1 : 1);
  });
  await new Promise((resolve, fail) => {
    server.once('error', fail);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', fail);
      resolve();
    });
  });
  return { server, child };
}
