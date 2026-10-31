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
test('both paid paths require signed leases rather than a boolean budget flag', () => {
  assert.match(evalSource, /requireSignedBudgetLease\("eval"/);
  assert.match(improveSource, /requireSignedBudgetLease\("improve"/);
  assert.doesNotMatch(evalSource, /GK_PROVIDER_HARD_BUDGET_CONFIRMED/);
  assert.doesNotMatch(improveSource, /GK_PROVIDER_HARD_BUDGET_CONFIRMED/);
  assert.match(evalSource, /GATE_KEEPER_EVAL_AUTHORIZED/);
});
test('improvement requires independently sealed frozen baseline', () => {
  assert.match(improveSource, /validateSealedBaseline\(/);
  assert.match(improveSource, /baseline-receipt\.json/);
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
  assert.match(libSource, /const safe=assertPrivatePath\(path\)/);
  assert.match(libSource, /openSync\(safe,constants\.O_WRONLY/);
  assert.match(libSource, /constants\.O_NOFOLLOW/);
  assert.match(libSource, /writeFileSync\(fd,JSON\.stringify/);
});
