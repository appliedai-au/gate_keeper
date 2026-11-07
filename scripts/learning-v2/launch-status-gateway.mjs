// Owner-controlled opt-in entrypoint, not a second agent coordinator.
import { startTrueForgeStatusGateway } from './trueforge-status-gateway.mjs';
import { startProductionPilot } from './production-bootstrap.mjs';
import { createOperationalDiagnostic } from './operational-diagnostics.mjs';

// Observation-mode commands reopen existing A/B commissioning files. Their
// own bootstrap still qualifies the actual source in BOTH parent and child.
// A separate status bootstrap would repeat that full work without publishing
// any status configuration in this mode, exhausting the public evidence quota.
const OBSERVATION_COMMANDS = new Set(['run', 'resume-review', 'reconcile-usage',
  'reconcile-operation', 'prepare-proposal-observation', 'consume-proposal-observation']);
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
  const observationProof = process.env.GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF;
  // This is a routing hint, NOT proof acceptance or execution permission.
  // The single requested startProductionPilot call validates the descriptor,
  // actual image, signed command permission, installed custody and all source
  // evidence before any child is spawned. Missing/malformed proof still holds.
  const directObservation = OBSERVATION_COMMANDS.has(command) &&
    typeof observationProof === 'string' && observationProof.trim() !== '';
  let prepared = false;
  if (command && !directObservation) {
    stage = 'preflight-status';
    diagnostic(stage, 'started', { command: command === 'init' ? 'init' : 'status' });
    try {
      // A/B commissioning must still publish/recover the real status file
      // before the gateway captures its read-only handler. D retains that
      // existing file and never publishes it from a status bootstrap.
      const env = command === 'init' ? process.env : { ...process.env,
        GK_PRODUCTION_COMMAND: 'status', GK_PRODUCTION_OPERATION_ID: '' };
      const result = await startProductionPilot({ env, abortSignal: stopped.signal });
      prepared = result.status === 'finished'; report(result);
      diagnostic(stage, prepared ? 'finished' : 'held', prepared ? {} : { reason: 'child-held' });
    } catch {
      diagnostic(stage, 'failed', { reason: 'startup-incomplete' }); reportHeld();
    }
  } else diagnostic('preflight-status', 'disabled', directObservation ? { reason: 'observation-direct' } : {});
  if (!stopped.signal.aborted) {
    stage = 'gateway-start'; diagnostic(stage, 'started');
    const gatewayEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GK_PRODUCTION_')));
    const gateway = await startTrueForgeStatusGateway({ env: gatewayEnv });
    gateway.server.once('close', stop); gateway.child.once('exit', stop);
    if (gateway.child.exitCode !== null || gateway.child.signalCode !== null) stop();
    diagnostic(stage, stopped.signal.aborted ? 'held' : 'finished',
      stopped.signal.aborted ? { reason: 'child-held' } : {});
    if ((prepared || directObservation) && !['init', 'status'].includes(command) && !stopped.signal.aborted) {
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
