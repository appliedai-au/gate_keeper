import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { validOwner, validSource } from '../../integrations/base44/shared/review-contract.js';
import { ReviewStore } from './store.mjs';
import { reviewRuntime } from './trueforge.mjs';
import { createReviewService, reviewUnavailable } from './service.mjs';

const require = createRequire(import.meta.url);
const unavailable = () => ({ handler: reviewUnavailable, stop() {}, async close() {} });

/** Reuse the already installed TrueForge server's declared pg dependency. */
export function openReviewPool(env = process.env) {
  const serverPackage = require.resolve('@truefoundry/trueforge/package.json');
  const manifest = JSON.parse(readFileSync(serverPackage, 'utf8'));
  if (manifest.version !== '0.182.0' || !manifest.dependencies?.pg)
    throw new Error('review_runtime_unqualified');
  const { Pool } = createRequire(serverPackage)('pg');
  const options = { max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000,
    idle_in_transaction_session_timeout: 10000, idleTimeoutMillis: 10000, allowExitOnIdle: true };
  if (env.DATABASE_URL?.trim()) {
    const url = new URL(env.DATABASE_URL.trim());
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash)
      throw new Error('review_database_configuration_invalid');
    options.connectionString = url.toString();
  } else {
    for (const name of ['POSTGRES_HOST', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'])
      if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error('review_database_configuration_missing');
    const port = env.POSTGRES_PORT === undefined ? 5432 : Number(env.POSTGRES_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('review_database_configuration_invalid');
    Object.assign(options, { host: env.POSTGRES_HOST, user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB, port });
  }
  // Preserve the upstream server's explicit SSL settings. Do not silently switch
  // to another database, accept URL-level overrides, or disable configured TLS.
  const tls = {};
  for (const [field, key] of [['ca', 'POSTGRES_SSL_CA_PATH'], ['cert', 'POSTGRES_SSL_CERT_PATH'], ['key', 'POSTGRES_SSL_KEY_PATH']])
    if (env[key]?.trim()) tls[field] = readFileSync(env[key].trim(), 'utf8');
  const mode = env.POSTGRES_SSL_MODE?.trim() ?? '';
  if (!['', 'disable', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify'].includes(mode))
    throw new Error('review_database_configuration_invalid');
  options.ssl = mode === 'disable' ? false : mode === 'no-verify' ? { ...tls, rejectUnauthorized: false }
    : Object.keys(tls).length ? tls : mode ? true : false;
  const pool = new Pool(options);
  pool.on('error', () => { /* No raw database errors or credentials in public logs. */ });
  return pool;
}

export async function configuredReviews({ env = process.env } = {}) {
  if (env.GATEKEEPER_REVIEW_ENABLED !== 'enabled') return unavailable();
  let pool;
  try {
    const sourceCommit = env.GATEKEEPER_REVIEW_SOURCE_COMMIT;
    const ownerId = env.GATEKEEPER_REVIEW_OWNER_ID;
    const tokenHash = env.GATEKEEPER_REVIEW_TOKEN_SHA256;
    const model = env.GATEKEEPER_REVIEW_MODEL;
    if (!validSource(sourceCommit) || sourceCommit !== env.RAILWAY_GIT_COMMIT_SHA || !validOwner(ownerId) ||
        typeof tokenHash !== 'string' || !/^[0-9a-f]{64}$/u.test(tokenHash) ||
        typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/u.test(model) ||
        /^gk-v[234]-authority\//u.test(model) || !env.TRUEFORGE_API_KEY?.trim() || env.STANDALONE !== 'false')
      return unavailable();
    pool = openReviewPool(env);
    const store = new ReviewStore(pool);
    await store.ready(); // No migrations, table creation or provider registration on startup.
    const runtime = reviewRuntime({ sourceCommit, model,
      instructions: readFileSync(new URL('../../agent/instructions.md', import.meta.url), 'utf8'),
      checklist: readFileSync(new URL('../../agent/skills/review-checklist/SKILL.md', import.meta.url), 'utf8') });
    const sdkManifest = JSON.parse(readFileSync(require.resolve('@truefoundry/trueforge-sdk/package.json'), 'utf8'));
    if (!['0.180.0', '0.182.0'].includes(sdkManifest.version)) throw new Error('review_sdk_unqualified');
    const { TrueForge } = await import('@truefoundry/trueforge-sdk');
    const client = new TrueForge({ baseUrl: 'http://127.0.0.1:8790', token: env.TRUEFORGE_API_KEY,
      maxRetries: 0, timeoutInSeconds: 20,
      fetch: (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.origin !== 'http://127.0.0.1:8790' || !/^\/api\/v1\/sessions(?:\/[^/]+\/turns(?:\/[^/]+(?:\/events)?)?)?$/u.test(url.pathname))
          throw new Error('review_upstream_route_invalid');
        return fetch(input, { ...init, redirect: 'error' });
      } });
    const service = createReviewService({ store, client, runtime, ownerId, tokenHash });
    return { handler: service.handler, stop: service.stop,
      async close() { service.stop(); await service.drained(); await pool.end(); } };
  } catch {
    if (pool) await pool.end().catch(() => {});
    return unavailable();
  }
}
