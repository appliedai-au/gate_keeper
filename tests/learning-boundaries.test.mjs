import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const evalSource = readFileSync(new URL('../scripts/run-evals.ts', import.meta.url), 'utf8');
const improveSource = readFileSync(new URL('../scripts/improve.ts', import.meta.url), 'utf8');
const libSource = readFileSync(new URL('../scripts/lib.ts', import.meta.url), 'utf8');

test('evaluation cannot mutate the hosted TrueForge agent', () => {
  assert.doesNotMatch(evalSource, /\bsyncAgent\s*\(/);
  assert.match(evalSource, /agent:\s*\{\s*spec:\s*manifest\s*\}/);
  assert.match(evalSource, /buildManifest\(headSha\(\)\)/);
});
test('learning session uses immutable inline spec rather than hosted agent identity', () => {
  assert.doesNotMatch(improveSource, /\?\s*\{\s*name:\s*agent\.name\s*\}/);
  assert.match(improveSource, /spec:\s*buildManifest\(git\("rev-parse","HEAD"\)\)/);
});
test('manual evaluation is held without external budget attestation', () => {
  assert.match(evalSource, /GK_PROVIDER_HARD_BUDGET_CONFIRMED/);
  assert.match(evalSource, /GATE_KEEPER_EVAL_AUTHORIZED/);
  assert.match(improveSource, /GK_PROVIDER_HARD_BUDGET_CONFIRMED/);
});
test('unfinished paid evaluation retains durable no-retry claim', () => {
  assert.match(evalSource, /intent\.json/);
  assert.match(evalSource, /if\(settled \|\| !retainClaim\) unlinkSync/);
  assert.match(evalSource, /const agentCommit=headSha\(\);[\s\S]*?const LOCK=/);
  assert.match(evalSource, /if\(!retainClaim\)/);
  assert.match(evalSource, /retainClaim=true/);
  assert.match(improveSource, /improve-intent\.json/);
});
test('private sessions never intentionally commit to public repository', () => {
  assert.doesNotMatch(evalSource, /git\(\s*["'](?:add|commit|push)["']/);
  assert.doesNotMatch(improveSource, /git\(\s*["'](?:add|commit|push)["']/);
  assert.match(libSource, /PRIVATE_ROOT = resolve/);
  assert.match(libSource, /writeFileSync\(path, JSON\.stringify/);
});
