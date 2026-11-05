// Owner-controlled opt-in entrypoint, not a second agent coordinator.
import { startTrueForgeStatusGateway } from './trueforge-status-gateway.mjs';
import { startProductionPilot } from './production-bootstrap.mjs';

const stopped = new AbortController();
const stop = () => stopped.abort();
process.on('SIGTERM', stop); process.on('SIGINT', stop);
const report = result => console.log('GK_PRODUCTION_DRIVER ' + JSON.stringify(result));
const reportHeld = () => report({ status: 'held', code: 'GK_PRODUCTION_STARTUP_INCOMPLETE' });
try {
  const command = process.env.GK_PRODUCTION_COMMAND;
  let prepared = false;
  if (command) {
    try {
      // The gateway captures its status handler once. Publish/recover the real
      // journal-bound status file before constructing that read-only handler.
      // Neither init nor status performs paid work.
      const env = command === 'init' ? process.env : { ...process.env,
        GK_PRODUCTION_COMMAND: 'status', GK_PRODUCTION_OPERATION_ID: '' };
      const result = await startProductionPilot({ env, abortSignal: stopped.signal });
      prepared = result.status === 'finished'; report(result);
    } catch { reportHeld(); }
  }
  if (!stopped.signal.aborted) {
    const gatewayEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GK_PRODUCTION_')));
    const gateway = await startTrueForgeStatusGateway({ env: gatewayEnv });
    gateway.server.once('close', stop); gateway.child.once('exit', stop);
    if (gateway.child.exitCode !== null || gateway.child.signalCode !== null) stop();
    if (prepared && !['init', 'status'].includes(command) && !stopped.signal.aborted) {
      try { report(await startProductionPilot({ abortSignal: stopped.signal })); }
      catch { reportHeld(); }
    }
  }
} finally {
  process.off('SIGTERM', stop); process.off('SIGINT', stop);
}
