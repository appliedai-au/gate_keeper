/** Parent-process boundary: whitelist the child's entire environment. */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, identifier, requireThat } from './contracts.mjs';
import { installProductionConfig, readProductionConfig, PRODUCTION_REPOSITORY_ROOT } from './production-config.mjs';
import { bindBootstrapConfig, fetchProductionConfig, validateBootstrapDescriptor } from './production-bootstrap-config.mjs';

export function productionChildSpec(env) {
  const command = env.GK_PRODUCTION_COMMAND;
  if (command === undefined || command === '') return null;
  requireThat(['init', 'run', 'resume-review', 'reconcile-usage', 'reconcile-operation', 'status'].includes(command), 'production bootstrap command');
  const sourceCommit = hash(env.RAILWAY_GIT_COMMIT_SHA, 'Railway image source commit', 40);
  const operationId = env.GK_PRODUCTION_OPERATION_ID;
  requireThat(['resume-review', 'reconcile-usage', 'reconcile-operation'].includes(command) ? typeof operationId === 'string' :
    operationId === undefined || operationId === '', 'production bootstrap operation argument');
  if (operationId) identifier(operationId, 'production bootstrap operationId');
  return { command, sourceCommit,
    args: [fileURLToPath(new URL('./launch-production-pilot.mjs', import.meta.url)), command,
      ...(operationId ? [operationId] : [])],
    options: { cwd: PRODUCTION_REPOSITORY_ROOT, shell: false, stdio: ['ignore', 'inherit', 'inherit'],
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production', GK_PRODUCTION_SOURCE_COMMIT: sourceCommit } } };
}

/** The parent remains alive until child stdio and process handles close. */
export function superviseProductionChild(child, { signals = process, abortSignal, shutdownGraceMs = 5_000 } = {}) {
  requireThat(Number.isSafeInteger(shutdownGraceMs) && shutdownGraceMs >= 1 && shutdownGraceMs <= 60_000,
    'production child shutdown grace');
  return new Promise((resolvePromise, reject) => {
    let timer, stopping = false, failure = null;
    const kill = signal => { try { child.kill(signal); } catch (error) { failure ??= error; } };
    const stop = signal => {
      if (stopping) return; stopping = true;
      timer = setTimeout(() => kill('SIGKILL'), shutdownGraceMs);
      kill(signal);
    };
    const terminate = () => stop('SIGTERM'), interrupt = () => stop('SIGINT');
    const error = cause => { failure = cause; stop('SIGTERM'); };
    const close = (code, signal) => {
      clearTimeout(timer);
      signals.off('SIGTERM', terminate); signals.off('SIGINT', interrupt);
      abortSignal?.removeEventListener('abort', terminate);
      child.off('error', error);
      if (failure) reject(failure);
      else resolvePromise({ status: !stopping && code === 0 ? 'finished' : 'held', exitCode: code, signal });
    };
    child.on('error', error); child.once('close', close);
    signals.on('SIGTERM', terminate); signals.on('SIGINT', interrupt);
    abortSignal?.addEventListener('abort', terminate, { once: true });
    if (abortSignal?.aborted) terminate();
  });
}

export async function startProductionPilot({ env = process.env, spawnChild = spawn, fetcher = fetch, abortSignal } = {}) {
  const spec = productionChildSpec(env);
  if (spec === null) return { status: 'disabled' };
  requireThat(!abortSignal?.aborted, 'production startup already stopping');
  requireThat(!(env.GK_PRODUCTION_CONFIG_B64 && env.GK_PRODUCTION_BOOTSTRAP_B64), 'use one commissioning input source');
  if (env.GK_PRODUCTION_BOOTSTRAP_B64) {
    const encoded = env.GK_PRODUCTION_BOOTSTRAP_B64;
    requireThat(typeof encoded === 'string' && encoded.length <= 32768 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded), 'bootstrap descriptor encoding');
    const descriptor = validateBootstrapDescriptor(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), spec.sourceCommit);
    let existing;
    try { existing = readProductionConfig(spec.sourceCommit); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) bindBootstrapConfig(descriptor, existing);
    else installProductionConfig(await fetchProductionConfig(descriptor,
      { fetcher, sourceCommit: spec.sourceCommit, signal: abortSignal }), spec.sourceCommit);
  }
  if (env.GK_PRODUCTION_CONFIG_B64) {
    const encoded = env.GK_PRODUCTION_CONFIG_B64;
    requireThat(typeof encoded === 'string' && encoded.length <= 6 * 1024 * 1024 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded), 'commissioning seed encoding');
    installProductionConfig(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')), spec.sourceCommit);
  }
  readProductionConfig(spec.sourceCommit);
  // Never copy process.env into this child. TRUEFORGE_API_KEY, provider PATs,
  // database credentials and historical bootstrap commands are not admitted.
  requireThat(!abortSignal?.aborted, 'production startup stopped before driver dispatch');
  const child = spawnChild(process.execPath, spec.args, spec.options);
  return superviseProductionChild(child, { abortSignal });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireThat(process.argv.length === 2, 'production bootstrap arguments');
    const result = await startProductionPilot();
    console.log('GK_PRODUCTION_DRIVER ' + JSON.stringify(result));
    if (result.status === 'held') process.exitCode = 2;
  } catch {
    console.error(JSON.stringify({ status: 'held', code: 'GK_PRODUCTION_BOOTSTRAP_INCOMPLETE' }));
    process.exitCode = 2;
  }
}
