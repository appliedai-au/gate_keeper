// Execute the actual entrypoint only inside the isolated remote qualifier.
// Process, gateway and driver are explicit synthetic seams; diagnostics are real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';
import { createOperationalDiagnostic } from '../scripts/learning-v2/operational-diagnostics.mjs';
import { productionChildSpec } from '../scripts/learning-v2/production-bootstrap.mjs';

const SECRET = 'TEST-ONLY-DO-NOT-LOG-startup-provider-private-data';
const SOURCE = 'a'.repeat(40);
const OBSERVATION = JSON.stringify({ schema: 'gk-learning-proposal-observation-source-proof-v1',
  sourceProof: { sourceCommit: SOURCE }, gatePolicy: {} });
async function runEntrypoint({ command = 'prepare-proposal-observation', preflight = 'finished',
  requested = 'finished', gatewayFails = false, deadGateway = false, observationProof,
  sourceBudget = null, validateSpec = false, extraEnv = {} } = {}) {
  const source = readFileSync(new URL('../scripts/learning-v2/launch-status-gateway.mjs', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { fileName: 'launch-status-gateway.js', reportDiagnostics: true,
    compilerOptions: { allowJs: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
  const diagnosticLines = [], reports = [], calls = [], gatewayCalls = [], sourceStages = [];
  let remaining = sourceBudget, sourceRequests = 0;
  const fakeProcess = Object.assign(new EventEmitter(), { env: { GK_PRODUCTION_COMMAND: command,
    GK_PRODUCTION_OPERATION_ID: ['resume-review', 'reconcile-usage', 'reconcile-operation'].includes(command) ?
      'TEST-ONLY-private-operation' : '', TRUEFORGE_API_KEY: SECRET, RAILWAY_GIT_COMMIT_SHA: SOURCE,
    ...(observationProof !== undefined ? { GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF: observationProof } : {}), ...extraEnv } });
  const server = new EventEmitter(), child = Object.assign(new EventEmitter(), {
    exitCode: deadGateway ? 1 : null, signalCode: null });
  const dependencies = {
    './production-bootstrap.mjs': { startProductionPilot: async options => {
      const isPreflight = Object.hasOwn(options, 'env');
      const effective = options.env ?? fakeProcess.env;
      calls.push({ command: effective.GK_PRODUCTION_COMMAND, operationId: effective.GK_PRODUCTION_OPERATION_ID,
        isPreflight, signal: options.abortSignal });
      // Exercise the actual pure child specification before a synthetic action.
      // The mandatory full production/source suites cover signed authorization,
      // independent parent/child verifiers and actual custody in their own tests.
      if (validateSpec) productionChildSpec(effective);
      if (sourceBudget !== null) {
        // Explicit quota model only, not fake evidence for the real verifier.
        // The installed two-release receipt needs 28 reads in each independent
        // parent/child verification. The original duplicate invocation needs112.
        for (const role of ['parent', 'child']) {
          sourceStages.push(role + ':started');
          for (let i = 0; i < 28; i++) {
            if (remaining === 0) throw Error('TEST-ONLY source evidence quota unavailable');
            remaining--; sourceRequests++;
          }
          sourceStages.push(role + ':finished');
        }
      }
      const outcome = isPreflight ? preflight : requested;
      if (outcome === 'throw') throw Error(SECRET);
      return { status: outcome, exitCode: outcome === 'finished' ? 0 : 2, signal: null };
    } },
    './trueforge-status-gateway.mjs': { startTrueForgeStatusGateway: async ({ env }) => {
      gatewayCalls.push(env);
      assert.equal(Object.keys(env).some(key => key.startsWith('GK_PRODUCTION_')), false);
      if (gatewayFails) throw Error(SECRET);
      return { server, child };
    } },
    './operational-diagnostics.mjs': { createOperationalDiagnostic: options => createOperationalDiagnostic({
      ...options, emit: line => diagnosticLines.push(line) }) },
  };
  const execute = new vm.Script('(async function(require, process, console, AbortController, exports) {\n' +
    compiled.outputText + '\n})', { filename: 'actual-status-entrypoint.cjs' }).runInThisContext();
  let rejection = null;
  try {
    await execute(name => { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; },
      fakeProcess, { log: line => reports.push(line) }, AbortController, {});
  } catch (error) { rejection = error; }
  const events = diagnosticLines.map(line => JSON.parse(line.slice('GK_OPERATION_DIAGNOSTIC '.length)));
  assert.equal(diagnosticLines.join('\n').includes(SECRET), false);
  assert.equal(reports.join('\n').includes(SECRET), false);
  assert.equal(fakeProcess.listenerCount('SIGTERM'), 0);
  assert.equal(fakeProcess.listenerCount('SIGINT'), 0);
  return { events, calls, gatewayCalls, reports, rejection, sourceRequests, sourceStages, remaining };
}

test('actual entrypoint logs preflight, gateway and explicitly requested preparation in order', async () => {
  const f = await runEntrypoint();
  assert.equal(f.rejection, null);
  assert.deepEqual(f.calls.map(row => row.command), ['status', 'prepare-proposal-observation']);
  assert.equal(f.calls[0].operationId, ''); assert.equal(f.calls[1].isPreflight, false);
  assert.deepEqual(f.events.map(row => [row.stage, row.outcome]), [['startup','started'],
    ['preflight-status','started'], ['preflight-status','finished'], ['gateway-start','started'],
    ['gateway-start','finished'], ['requested-command','started'], ['requested-command','finished']]);
});
for (const preflight of ['held', 'throw']) test('actual entrypoint does not run recovery after preflight ' + preflight, async () => {
  const f = await runEntrypoint({ preflight });
  assert.equal(f.calls.length, 1); assert.equal(f.gatewayCalls.length, 1);
  assert.equal(f.events.some(row => row.stage === 'requested-command'), false);
  assert.ok(f.events.some(row => row.stage === 'preflight-status' && ['held','failed'].includes(row.outcome)));
});
for (const requested of ['held', 'throw']) test('actual entrypoint logs requested command ' + requested + ' without retry', async () => {
  const f = await runEntrypoint({ requested });
  assert.equal(f.calls.length, 2); assert.equal(f.rejection, null);
  const last = f.events.at(-1);
  assert.equal(last.stage, 'requested-command');
  assert.equal(last.outcome, requested === 'held' ? 'held' : 'failed');
  assert.equal(last.reason, requested === 'held' ? 'child-held' : 'startup-incomplete');
});
test('actual gateway startup rejection is redacted and remains a rejection', async () => {
  const f = await runEntrypoint({ gatewayFails: true });
  assert.equal(f.rejection?.message, 'GK_PRODUCTION_STARTUP_INCOMPLETE');
  assert.equal(f.rejection.stack.includes(SECRET), false);
  assert.equal(f.calls.length, 1); assert.equal(f.events.at(-1).stage, 'gateway-start');
  assert.equal(f.events.at(-1).outcome, 'failed');
});
test('dead gateway cannot start recovery and command-free startup stays command-free', async () => {
  const dead = await runEntrypoint({ deadGateway: true });
  assert.equal(dead.calls.length, 1); assert.equal(dead.events.at(-1).outcome, 'held');
  const disabled = await runEntrypoint({ command: '' });
  assert.equal(disabled.calls.length, 0); assert.equal(disabled.gatewayCalls.length, 1);
  const event = disabled.events.find(row => row.stage === 'preflight-status' && row.outcome === 'disabled');
  assert.ok(event); assert.equal(Object.hasOwn(event, 'reason'), false);
});
test('status remains status-only and unknown command text never enters diagnostics', async () => {
  const status = await runEntrypoint({ command: 'status' }); assert.equal(status.calls.length, 1);
  const unknown = await runEntrypoint({ command: SECRET, preflight: 'throw' });
  assert.ok(unknown.events.every(row => row.command !== SECRET)); assert.equal(unknown.calls.length, 1);
});

for (const command of ['run', 'resume-review', 'reconcile-usage', 'reconcile-operation',
  'prepare-proposal-observation', 'consume-proposal-observation']) test('observation startup invokes one full bootstrap for ' + command, async () => {
  const f = await runEntrypoint({ command, observationProof: OBSERVATION, validateSpec: true, sourceBudget: 60 });
  assert.equal(f.rejection, null);
  assert.deepEqual(f.calls.map(row => row.command), [command]);
  assert.equal(f.calls[0].isPreflight, false);
  assert.equal(f.sourceRequests, 56); assert.equal(f.remaining, 4);
  assert.deepEqual(f.sourceStages, ['parent:started','parent:finished','child:started','child:finished']);
  assert.deepEqual(f.events.map(row => [row.stage, row.outcome]), [['startup','started'],
    ['preflight-status','disabled'], ['gateway-start','started'], ['gateway-start','finished'],
    ['requested-command','started'], ['requested-command','finished']]);
  assert.equal(f.events.find(row => row.stage === 'preflight-status').reason, 'observation-direct');
});
test('duplicate A/B flow exhausts the explicit quota model; observation does not remove either command verifier', async () => {
  const legacy = await runEntrypoint({ sourceBudget: 60 });
  assert.equal(legacy.calls.length, 2); assert.equal(legacy.sourceRequests, 60);
  assert.equal(legacy.events.at(-1).outcome, 'failed');
  const insufficient = await runEntrypoint({ observationProof: OBSERVATION, sourceBudget: 55 });
  assert.equal(insufficient.calls.length, 1); assert.equal(insufficient.sourceRequests, 55);
  assert.equal(insufficient.events.at(-1).outcome, 'failed');
  assert.equal(insufficient.reports.some(line => line.includes('"status":"finished"')), false);
});
for (const requested of ['held', 'throw']) test('observation refusal is final with no status fallback or command retry: ' + requested, async () => {
  const f = await runEntrypoint({ observationProof: OBSERVATION, requested });
  assert.equal(f.calls.length, 1);
  assert.equal(f.events.at(-1).outcome, requested === 'held' ? 'held' : 'failed');
});
test('observation commands cannot run before a live gateway', async () => {
  for (const options of [{ gatewayFails: true }, { deadGateway: true }]) {
    const f = await runEntrypoint({ observationProof: OBSERVATION, ...options });
    assert.equal(f.calls.length, 0); assert.equal(f.sourceRequests, 0);
    assert.equal(f.events.some(row => row.stage === 'requested-command'), false);
  }
});
test('descriptor presence is not acceptance: actual child specification rejects malformed proof, source drift and commissioning seeds', async () => {
  for (const options of [
    { observationProof: '{' },
    { observationProof: JSON.stringify({ schema: 'wrong', sourceProof: {}, gatePolicy: {} }) },
    { observationProof: OBSERVATION, extraEnv: { RAILWAY_GIT_COMMIT_SHA: 'b'.repeat(40) } },
    { observationProof: OBSERVATION, extraEnv: { GK_PRODUCTION_BOOTSTRAP_B64: SECRET } },
    { observationProof: OBSERVATION, extraEnv: { GK_PRODUCTION_CONFIG_B64: SECRET } },
  ]) {
    const f = await runEntrypoint({ ...options, validateSpec: true, sourceBudget: 60 });
    assert.equal(f.calls.length, 1); assert.equal(f.sourceRequests, 0);
    assert.equal(f.events.at(-1).stage, 'requested-command');
    assert.equal(f.events.at(-1).outcome, 'failed');
  }
});
test('status/init and absent/blank observation hints retain the commissioning preflight', async () => {
  for (const command of ['status', 'init']) {
    const f = await runEntrypoint({ command, observationProof: OBSERVATION });
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].isPreflight, true);
    assert.equal(f.calls[0].command, command);
  }
  for (const observationProof of [undefined, '', '  ', '\t\n']) {
    const f = await runEntrypoint({ observationProof });
    assert.deepEqual(f.calls.map(row => row.command), ['status', 'prepare-proposal-observation']);
    assert.equal(f.events.some(row => row.reason === 'observation-direct'), false);
  }
});
test('whitespace-only proof is never accepted as direct observation by the actual child specification', async () => {
  for (const observationProof of ['  ', '\t\n']) {
    const f = await runEntrypoint({ observationProof, validateSpec: true, sourceBudget: 60 });
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].command, 'status');
    assert.equal(f.calls[0].isPreflight, true); assert.equal(f.sourceRequests, 0);
    assert.equal(f.events.some(row => row.stage === 'requested-command'), false);
    assert.equal(f.events.some(row => row.reason === 'observation-direct'), false);
    assert.ok(f.events.some(row => row.stage === 'preflight-status' && row.outcome === 'failed'));
  }
});
