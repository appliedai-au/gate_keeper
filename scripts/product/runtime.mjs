import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { openReviewPool } from '../reviews/runtime.mjs';
import { ProductStore } from './store.mjs';
import { createGitHubClient } from './github.mjs';
import { createProductService, productUnavailable } from './service.mjs';
import { createProductWorker } from './worker.mjs';
import { productReviewRuntime } from './trueforge.mjs';
import { GITHUB_ID, SHA, PRODUCT_PATH } from './contracts.mjs';
import { configuredClientApi } from './client-api.mjs';
import { configuredComparisonApi } from './comparison-api.mjs';
import { configuredLessonApi } from './lesson-api.mjs';

const require = createRequire(import.meta.url);
const unavailable = () => ({ handler: productUnavailable, start() {}, stop() {}, async close() {} });
const refused = () => { throw new Error('setup_required'); };
const publicOrigin = value => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      refused();
    return url.origin;
  } catch { refused(); }
};

/** Read only by the configured server process. No credential value is logged. */
export function productConfiguration(env) {
  if (env.G8S_PRODUCT_ENABLED !== 'enabled') return null;
  const sourceCommit = env.G8S_PRODUCT_SOURCE_COMMIT;
  if (!SHA.test(sourceCommit || '') || sourceCommit !== env.RAILWAY_GIT_COMMIT_SHA || env.STANDALONE !== 'false') refused();
  const apiOrigin = publicOrigin(env.G8S_PUBLIC_API_ORIGIN), frontendOrigin = publicOrigin(env.G8S_FRONTEND_ORIGIN);
  const githubAppId = env.G8S_GITHUB_APP_ID, githubAppSlug = env.G8S_GITHUB_APP_SLUG,
    githubClientId = env.G8S_GITHUB_CLIENT_ID;
  if (!GITHUB_ID.test(githubAppId || '') || !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(githubAppSlug || '') ||
      !/^[A-Za-z0-9_.-]{5,200}$/u.test(githubClientId || '')) refused();
  for (const name of ['G8S_GITHUB_CLIENT_SECRET', 'G8S_GITHUB_APP_PRIVATE_KEY', 'G8S_GITHUB_WEBHOOK_SECRET'])
    if (typeof env[name] !== 'string' || env[name].length < 32) refused();
  const adminGithubIds = new Set((env.G8S_ADMIN_GITHUB_IDS || '').split(',').map(value => value.trim()).filter(Boolean));
  if ([...adminGithubIds].some(value => !GITHUB_ID.test(value))) refused();
  const defaultMonthlyRunLimit = Number(env.G8S_DEFAULT_MONTHLY_RUN_LIMIT || '0');
  if (!Number.isSafeInteger(defaultMonthlyRunLimit) || defaultMonthlyRunLimit < 0 || defaultMonthlyRunLimit > 1000000) refused();
  return { sourceCommit, apiOrigin, frontendOrigin, githubAppId, githubAppSlug, githubClientId, adminGithubIds,
    clientSecret: env.G8S_GITHUB_CLIENT_SECRET, privateKey: env.G8S_GITHUB_APP_PRIVATE_KEY,
    webhookSecret: env.G8S_GITHUB_WEBHOOK_SECRET, workerEnabled: env.G8S_PRODUCT_WORKER_ENABLED === 'enabled',
    model: env.G8S_REVIEW_MODEL, defaultMonthlyRunLimit };
}

/** Disabled by default; no DDL, registration, environment mutation or provider fallback. */
export async function configuredProduct({ env = process.env } = {}) {
  if (env.G8S_PRODUCT_ENABLED !== 'enabled') return unavailable();
  let pool, worker, clientApi, comparisonApi, lessonApi, service;
  try {
    const config = productConfiguration(env);
    pool = openReviewPool(env);
    const store = new ProductStore(pool, { defaultMonthlyRunLimit: config.defaultMonthlyRunLimit });
    await store.ready();
    const github = createGitHubClient({ appId: config.githubAppId, clientId: config.githubClientId,
      clientSecret: config.clientSecret, privateKey: config.privateKey,
      callbackUrl: config.apiOrigin + PRODUCT_PATH + '/auth/github/callback' });
    service = createProductService({ store, github, config });
    clientApi = await configuredClientApi({ env, product: store, github, config, fallback: service.handler });
    comparisonApi = await configuredComparisonApi({ env, product: store, github, config, fallback: clientApi.handler });
    lessonApi = await configuredLessonApi({ env, product: store, config, fallback: comparisonApi.handler });
    if (config.workerEnabled) {
      if (!env.TRUEFORGE_API_KEY?.trim()) refused();
      const sdkVersion = JSON.parse(readFileSync(require.resolve('@truefoundry/trueforge-sdk/package.json'), 'utf8')).version;
      if (!['0.180.0', '0.182.0'].includes(sdkVersion)) refused();
      const { TrueForge } = await import('@truefoundry/trueforge-sdk');
      const client = new TrueForge({ baseUrl: 'http://127.0.0.1:8790', token: env.TRUEFORGE_API_KEY,
        maxRetries: 0, timeoutInSeconds: 20,
        fetch: (input, options) => {
          const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
          if (url.origin !== 'http://127.0.0.1:8790' ||
              !/^\/api\/v1\/sessions(?:\/[^/]+\/turns(?:\/[^/]+(?:\/events)?)?)?$/u.test(url.pathname))
            throw new Error('upstream_route_refused');
          return fetch(input, { ...options, redirect: 'error' });
        } });
      const runtime = productReviewRuntime({ model: config.model, sourceCommit: config.sourceCommit });
      worker = createProductWorker({ store, github, client, runtime, frontendOrigin: config.frontendOrigin,
        ready: async () => {
          try {
            const response = await fetch('http://127.0.0.1:8790/healthz', { redirect: 'error', signal: AbortSignal.timeout(2000) });
            await response.body?.cancel().catch(() => {});
            return response.status === 200;
          } catch { return false; }
        } });
    }
    return { handler: lessonApi.handler,
      start() { worker?.start(); },
      stop() { service.stop(); clientApi.stop(); comparisonApi.stop(); lessonApi.stop(); worker?.stop(); },
      async close() { service.stop(); clientApi.stop(); comparisonApi.stop(); lessonApi.stop(); worker?.stop(); await worker?.drained(); await pool.end(); } };
  } catch {
    service?.stop(); clientApi?.stop(); comparisonApi?.stop(); lessonApi?.stop(); worker?.stop();
    if (pool) await pool.end().catch(() => {});
    return unavailable();
  }
}
