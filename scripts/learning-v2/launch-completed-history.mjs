/** A completed-history app image has no Learning driver startup path. */
import { spawn } from 'node:child_process';
import { requireThat } from './contracts.mjs';
import { createCompletedHistoryReader } from './completed-history.mjs';
import { createCompletedStatusHandler } from './completed-history-status.mjs';
import { assertCompletedRoleEnvironment, completedChildEnvironment } from './completed-history-preflight.mjs';

export async function startCompletedHistoryApp({ env = process.env, read = createCompletedHistoryReader,
  run = spawn, startGateway } = {}) {
  assertCompletedRoleEnvironment(env, 'serve');
  requireThat(process.getuid?.() === 1000 && env.GK_V2_HOST_BOOTSTRAP === 'enabled' &&
    env.GK_V3_HTTP_ROUTER === 'enabled', 'completed app requires retained-volume preflight and non-root identity');
  const reader = await read({ actualSourceCommit: env.RAILWAY_GIT_COMMIT_SHA });
  requireThat(reader.sourceCommit === env.RAILWAY_GIT_COMMIT_SHA, 'completed reader is not actual serving C');
  await reader.readStatus(); // Full closure/proof acceptance precedes all child/listener work.
  const statusHandler = createCompletedStatusHandler(reader);
  const start = startGateway ?? (await import('./trueforge-status-gateway.mjs')).startTrueForgeStatusGateway;
  let spawned = false;
  return start({ env, statusHandler, run(executable, args, options) {
    requireThat(!spawned && executable === process.execPath && args.length === 1 &&
      args[0] === 'node_modules/@truefoundry/trueforge/dist/main.js' && options.cwd === '/app' &&
      options.env?.RAILWAY_GIT_COMMIT_SHA === env.RAILWAY_GIT_COMMIT_SHA,
    'completed app allows exactly one actual-C TrueForge transport child');
    const childEnv = completedChildEnvironment(env);
    childEnv.HOST = '127.0.0.1'; childEnv.PORT = '8790'; spawned = true;
    return run(executable, args, { ...options, env: childEnv });
  } });
}
