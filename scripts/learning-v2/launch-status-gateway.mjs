// Owner-controlled opt-in entrypoint, not a second agent coordinator.
import { startTrueForgeStatusGateway } from './trueforge-status-gateway.mjs';
import { startProductionPilot } from './production-bootstrap.mjs';
import { createOperationalDiagnostic } from './operational-diagnostics.mjs';

const stopped = new AbortController();
const stop = () => stopped.abort();
process.on('SIGTERM', stop); process.on('SIGINT', stop);
const report = result => console.log('GK_PRODUCTION_DRIVER ' + JSON.stringify(result));
const reportHeld = () => report({ status: 'held', code: 'GK_PRODUCTION_STARTUP_INCOMPLETE' });
const diagnostic = createOperationalDiagnostic({ component: 'production-entrypoint' });
let stage = 'startup';
diagnostic(stage, 'started', { command: process.env.GK_PRODUCTION_COMMAND });
try {
  const command = process.env.GK_PRODUCTION_COMMAND;
  let prepared = false;
  if (command) {
    stage = 'preflight-status';
    diagnostic(stage, 'started', { command: command === 'init' ? 'init' : 'status' });
    try {
      // The gateway captures its status handler once. Publish/recover the real
      // journal-bound status file before constructing that read-only handler.
      // Neither init nor status performs paid work.
      const env = command === 'init' ? process.env : { ...process.env,
        GK_PRODUCTION_COMMAND: 'status', GK_PRODUCTION_OPERATION_ID: '' };
      const result = await startProductionPilot({ env, abortSignal: stopped.signal });
      prepared = result.status === 'finished'; report(result);
      diagnostic(stage, prepared ? 'finished' : 'held', prepared ? {} : { reason: 'child-held' });
    } catch {
      diagnostic(stage, 'failed', { reason: 'startup-incomplete' }); reportHeld();
    }
  } else diagnostic('preflight-status', 'disabled');
  if (!stopped.signal.aborted) {
    stage = 'gateway-start'; diagnostic(stage, 'started');
    const gatewayEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GK_PRODUCTION_')));
    const gateway = await startTrueForgeStatusGateway({ env: gatewayEnv });
    gateway.server.once('close', stop); gateway.child.once('exit', stop);
    if (gateway.child.exitCode !== null || gateway.child.signalCode !== null) stop();
    diagnostic(stage, stopped.signal.aborted ? 'held' : 'finished',
      stopped.signal.aborted ? { reason: 'child-held' } : {});
    if (prepared && !['init', 'status'].includes(command) && !stopped.signal.aborted) {
      stage = 'requested-command'; diagnostic(stage, 'started', { command });
      try {
        const result = await startProductionPilot({ abortSignal: stopped.signal }); report(result);
        diagnostic(stage, result.status === 'finished' ? 'finished' : 'held',
          result.status === 'finished' ? { command } : { command, reason: 'child-held' });
      } catch {
        diagnostic(stage, 'failed', { command, reason: 'startup-incomplete' }); reportHeld();
      }
    }
  }
} catch {
  diagnostic(stage, 'failed', { reason: 'startup-incomplete' });
  // Preserve startup rejection, but do not let the runtime print an upstream
  // exception containing a credential, URL, private path or response body.
  throw new Error('GK_PRODUCTION_STARTUP_INCOMPLETE');
} finally {
  process.off('SIGTERM', stop); process.off('SIGINT', stop);
}
