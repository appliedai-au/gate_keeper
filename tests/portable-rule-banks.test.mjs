// Run only through the managed remote repository gate. Fake SDK; no credentials/network/models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const runUrl = new URL('../proof/three-agent/run.mjs', import.meta.url).href;
const bagUrl = new URL('../proof/three-agent/gk-bag.mjs', import.meta.url).href;
const proposal = (kind = 'general', bad = false) => ({ scope: { kind, languages: kind === 'language' ? ['js'] : [], frameworks: [] },
  when: bad ? 'TEST_BAD_RULE applies to the supplied operation.' : 'TEST_GOOD_RULE applies to the supplied operation.',
  evidence: 'Establish the concrete failing input and the wrong result in the code.',
  unless: 'A working earlier guard prevents the wrong result on every path.' });
const payload = { set: 'train-synthetic', params: { temperature: 0.2, maxTokens: 200 }, agents: { gate_keeper: { system: 'Base reviewer\n\nExtra field: include quote.' } },
  tasks: [['t4-synthetic', 'python'], ['t6-synthetic', 'typescript']].map(([id, lang]) => ({ id, expected: [10, 20], benign: [],
    why: [{ line: 10, why: 'Synthetic defect one ' + (id.startsWith('t6-') ? 'CHECK_ONLY_TRUTH' : 'FIT_ONLY_TRUTH') }, { line: 20, why: 'Synthetic defect two' }],
    prompts: { gate_keeper: 'Context: synthetic operations can fail.\n```' + lang + '\n10 | danger()\n20 | danger2()\n99 | safe()\n```' } })) };
function run(bankFile, rule = proposal(), extra = {}) {
  const source = `
    let seq = 0; const sessions = new Map();
    globalThis.fetch = () => { throw new Error('network forbidden'); };
    globalThis.GK3_SDK = { TrueForge: class { sessions = {
      create: async ({agent,metadata}) => { const id = String(++seq); sessions.set(id,{sys:agent.spec.instructions,label:metadata.label,temperature:agent.spec.model.params.temperature}); return {data:{id}}; },
      createTurn: async (id, {input}) => {
        const s = sessions.get(id); let text; const prompt = input.map(x => x.content).join('\\n');
        const second = s.label.endsWith('/c2'), scenario = process.env.GK3_TEST_PASS_CASE || '';
        const target = scenario.startsWith('first-') ? !second : scenario.startsWith('second-') ? second : false;
        if (target && scenario.endsWith('-exception')) throw new Error('synthetic finding exception');
        if (target && scenario.endsWith('-error')) return {data:{id:'turn',state:{status:'error',output:null,metrics:{totalCostInUsd:0,totalInputTokens:1,totalOutputTokens:1}}}};
        if (target && scenario.endsWith('-invalid')) return {data:{id:'turn',state:{status:'done',output:{content:'invalid synthetic output'},metrics:{totalCostInUsd:0,totalInputTokens:1,totalOutputTokens:1}}}};
        if (scenario === 'valid-empty' || (scenario === 'first-error-second-empty' && second)) return {data:{id:'turn',state:{status:'done',output:{content:'{"findings":[]}'},metrics:{totalCostInUsd:0,totalInputTokens:1,totalOutputTokens:1}}}};
        if (scenario === 'first-error-second-empty' && !second) return {data:{id:'turn',state:{status:'error',output:null,metrics:{totalCostInUsd:0,totalInputTokens:1,totalOutputTokens:1}}}};

        if (s.label.startsWith('i/improve-')) { console.log('MOCK_LEARNER '+JSON.stringify({label:s.label,instructions:s.sys,prompt,temperature:s.temperature})); text = JSON.stringify({rules:[${JSON.stringify(rule)}],why:'Synthetic rule proposal'}); }
        else { console.log('MOCK_REQUEST '+JSON.stringify({label:s.label,instructions:s.sys,prompt,temperature:s.temperature,good:s.sys.includes('TEST_GOOD_RULE'),bad:s.sys.includes('TEST_BAD_RULE')}));
          const fs = s.sys.includes('TEST_BAD_RULE') ? [] : [{line:10,quote:'danger()',comment:'Synthetic defect'}];
          if(s.sys.includes('TEST_GOOD_RULE')) fs.push({line:20,quote:'danger2()',comment:'Second synthetic defect'});
          if(s.sys.includes('TEST_BAD_RULE')) fs.push({line:99,quote:'safe()',comment:'Synthetic false alarm'});
          text=JSON.stringify({findings:fs}); }
        return {data:{id:'turn',state:{status:'done',output:{content:text},metrics:{totalCostInUsd:!second ? Number(process.env.GK3_TEST_FIRST_COST || '0') : 0,totalInputTokens:1,totalOutputTokens:1}}}};
      }
    }; } };
    await import(${JSON.stringify(runUrl)});`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 15000, env: {
    GK3_PAYLOAD_B64: gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64'), GK3_MODEL: 'tfy-direct/glm-5-3-flash',
    GK3_ARMS: 'gate_keeper', GK3_BAG_PATH: bagUrl, GK3_CAP_USD: '10', GK3_TRIALS: '1', GK3_CONCURRENCY: '1',
    GK3_IMPROVE: '1', GK3_IMPROVE_BAG: '1', GK3_IMPROVE_CHAIN: '2', GK3_STRUCTURED_RULES: '1',
    GK3_ROUNDS: '1', GK3_MIN_GAIN: '1', GK3_RULE_BANK: bankFile, ...extra,
  } });
}
const records = (r, prefix) => r.stdout.split('\n').filter((s) => s.startsWith(prefix + ' ')).map((s) => JSON.parse(s.slice(prefix.length + 1)));
const success = (r) => assert.equal(r.status, 0, r.stderr);
function fixture(fn) { const dir = mkdtempSync(join(tmpdir(), 'rule-bank-test-')); try { fn(join(dir, 'rules.json')); } finally { rmSync(dir, { recursive: true, force: true }); } }

test('accepted rules persist and carry into a later run behind an original-baseline comparison', () => fixture((path) => {
  const a = run(path); success(a);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).accepted.length, 1);
  assert.equal(records(a, 'GK3_SUMMARY')[0].best.net, 4);
  const b = run(path, proposal(), { GK3_ROUNDS: '0', GK3_MODEL: 'tfy-direct/test-model-b' }); success(b);
  assert.equal(records(b, 'GK3_CARRIED')[0].activated, true);
  assert.equal(records(b, 'GK3_SUMMARY')[0].best.net, 4);
}));

test('harmful rules are banked as negative learning and never carried into the reviewer', () => fixture((path) => {
  const a = run(path, proposal('general', true)); success(a);
  const bank = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(bank.harmful.length, 1); assert.equal(bank.accepted.length, 0);
  assert.equal(records(a, 'GK3_SUMMARY')[0].best.net, 2);
  const b = run(path, proposal(), { GK3_ROUNDS: '0' }); success(b);
  assert.ok(records(b, 'MOCK_REQUEST').every((x) => !x.bad));
  assert.equal(records(b, 'GK3_SUMMARY')[0].best.net, 2);
}));

test('language-scoped rules affect only matching code', () => fixture((path) => {
  const r = run(path, proposal('language')); success(r);
  const asks = records(r, 'MOCK_REQUEST');
  assert.ok(asks.some((x) => x.label.includes('t6-synthetic') && x.good));
  assert.ok(asks.filter((x) => x.label.includes('t4-synthetic')).every((x) => !x.good));
  assert.equal(records(r, 'GK3_SUMMARY')[0].best.net, 3);
}));

test('malformed seed fails before any review request', () => fixture((path) => {
  const r = run(path, proposal(), { GK3_RULE_BANK_SEED_B64: Buffer.from('{}{}').toString('base64') });
  assert.notEqual(r.status, 0); assert.equal(records(r, 'MOCK_REQUEST').length, 0);
}));

test('delta learning feeds fit-only regressions into the next learner, never reviewer calls', () => fixture((path) => {
  const r = run(path, proposal('general', true), { GK3_DELTA_LEARNING: '1', GK3_ROUNDS: '2' });
  success(r);
  const learners = records(r, 'MOCK_LEARNER');
  assert.equal(learners.length, 2);
  assert.ok(learners[1].prompt.includes('FIT_ONLY_TRUTH'));
  assert.ok(learners[1].prompt.includes('lostRealBugs'));
  assert.ok(learners[1].prompt.includes('addedFalseAlarms'));
  assert.ok(learners.every((x) => !x.prompt.includes('CHECK_ONLY_TRUTH')));
  const reviews = records(r, 'MOCK_REQUEST');
  assert.ok(reviews.length > 0);
  for (const x of reviews) {
    const call = x.instructions + x.prompt;
    for (const secret of ['FIT_ONLY_TRUTH', 'CHECK_ONLY_TRUTH', 'Measured changes caused by recent proposals', 'lostRealBugs', 'addedFalseAlarms'])
      assert.ok(!call.includes(secret), 'learner diagnostic leaked into reviewer: ' + secret);
  }
  const bank = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(bank.accepted.length, 0);
  assert.equal(bank.harmful.length, 1);
  assert.equal(records(r, 'GK3_BANK_DUPLICATE').length, 1);
  assert.equal(bank.history.filter((x) => x.kind === 'duplicate-not-retried').length, 1);
  for (const e of bank.harmful) {
    assert.ok(e.fitFeedback.lostRealBugs.some((x) => x.why.includes('FIT_ONLY_TRUTH') && x.occurrencesChanged === 1));
    assert.ok(e.fitFeedback.addedFalseAlarms.some((x) => x.line === 99 && x.occurrencesChanged === 1));
    for (const key of ['lostRealBugs', 'recoveredRealBugs', 'addedFalseAlarms', 'removedFalseAlarms'])
      assert.ok(e.fitFeedback[key].every((x) => x.task.startsWith('t4-')));
  }
  assert.equal(records(r, 'GK3_SUMMARY')[0].best.net, 2);
}));

test('second-pass-only learning preserves every first finding prompt', () => fixture((path) => {
  const r = run(path, proposal(), { GK3_LEARN_PASS2_ONLY: '1' });
  success(r);
  const requests = records(r, 'MOCK_REQUEST');
  const first = requests.filter((x) => !x.label.endsWith('/c2'));
  const second = requests.filter((x) => x.label.endsWith('/c2'));
  assert.ok(first.length > 0 && second.length > 0);
  assert.ok(first.every((x) => x.label.startsWith('gk_bag/') && !x.good && !x.bad));
  for (const task of ['t4-synthetic', 't6-synthetic']) {
    const sameTask = first.filter((x) => x.label.includes(task));
    assert.equal(new Set(sameTask.map((x) => x.instructions + x.prompt)).size, 1);
  }
  assert.ok(second.some((x) => x.good));
  assert.equal(records(r, 'GK3_SUMMARY')[0].best.net, 4);
}));

test('literal selectors inspect code, not contextual mentions, and preserve unmatched reviews', () => fixture((path) => {
  const rule = proposal();
  rule.scope.codeTokens = ['Context: synthetic'];
  const r = run(path, rule, { GK3_CODE_SELECTORS: '1', GK3_LEARN_PASS2_ONLY: '1' });
  success(r);
  assert.ok(records(r, 'MOCK_REQUEST').every((x) => !x.good));
  const bank = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(bank.unproven[0].status, 'unscored-no-fit-coverage');
  assert.equal(bank.accepted.length, 0);
  assert.equal(records(r, 'GK3_SUMMARY')[0].best.net, 2);
}));
test('literal code selectors activate when all tokens occur in code', () => fixture((path) => {
  const rule = proposal();
  rule.scope.codeTokens = ['danger()', 'danger2()'];
  const r = run(path, rule, { GK3_CODE_SELECTORS: '1', GK3_LEARN_PASS2_ONLY: '1' });
  success(r);
  assert.ok(records(r, 'MOCK_REQUEST').some((x) => x.label.endsWith('/c2') && x.good));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).accepted[0].coveredTasks, 2);
  assert.equal(records(r, 'GK3_SUMMARY')[0].best.net, 4);
}));

test('an independent rule probe uses its own cache and never promotes the rule', () => fixture((path) => {
  const a = run(path, proposal('general', true)); success(a);
  const id = JSON.parse(readFileSync(path, 'utf8')).harmful[0].id;
  const b = run(path, proposal(), { GK3_ROUNDS: '0', GK3_PROBE_RULE_ID: id, GK3_PROBE_CACHE_TAG: 'synthetic-pair', GK3_CACHE_DIR: path + '-cache' });
  success(b);
  const c = records(b, 'GK3_CONFIRMATION')[0];
  assert.equal(c.ruleId, id);
  assert.equal(c.promoted, false);
  assert.ok(c.netChange < 0);
  assert.equal(records(b, 'GK3_SUMMARY')[0].best.net, 2);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).accepted.length, 0);
}));

test('learner temperature changes leave every finding call at baseline temperature', () => fixture((path) => {
  const r = run(path, proposal(), { GK3_LEARNER_TEMPERATURE: '0.7' });
  success(r);
  assert.ok(records(r, 'MOCK_LEARNER').every((x) => x.temperature === 0.7));
  assert.ok(records(r, 'MOCK_REQUEST').every((x) => x.temperature === 0.2));
}));

test('unchanged controls make fresh two-pass calls without changing bank or cache entries', () => fixture((path) => {
  const seed = run(path, proposal('general', true)); success(seed);
  const bankBefore = readFileSync(path, 'utf8');
  const cache = path + '-control-cache';
  const r = run(path, proposal(), { GK3_CONTROL_REPEATS: '3', GK3_CACHE_DIR: cache, GK3_ROUNDS: '10', GK3_LEARN_PASS2_ONLY: '1' });
  success(r);
  assert.equal(records(r, 'MOCK_LEARNER').length, 0);
  const asks = records(r, 'MOCK_REQUEST');
  assert.equal(asks.length, 12); // 3 repeats x 2 tasks x 2 finding calls
  assert.ok(asks.every((x) => !x.good && !x.bad));
  const controls = records(r, 'GK3_CONTROL');
  assert.equal(controls.length, 3);
  assert.ok(controls.every((x) => x.rows.length === 2));
  const summary = records(r, 'GK3_SUMMARY')[0];
  assert.equal(summary.mode, 'unchanged-baseline-controls');
  assert.equal(summary.calls, 12);
  assert.equal(summary.cacheHits, 0);
  assert.equal(summary.complete, true);
  assert.equal(summary.bankChanged, false);
  assert.equal(readFileSync(path, 'utf8'), bankBefore);
  assert.ok(readdirSync(cache).every((x) => x === '.probe'));
}));
test('controls do not create a new bank and stop honestly at the budget guard', () => fixture((path) => {
  const r = run(path, proposal(), { GK3_CONTROL_REPEATS: '3', GK3_CAP_USD: '0' });
  success(r);
  assert.equal(existsSync(path), false);
  assert.equal(records(r, 'MOCK_LEARNER').length, 0);
  assert.equal(records(r, 'MOCK_REQUEST').length, 0);
  const summary = records(r, 'GK3_SUMMARY')[0];
  assert.equal(summary.complete, false);
  assert.equal(summary.samples.length, 1);
  assert.equal(summary.calls, 0);
  assert.equal(summary.spentUsd, 0);
}));
test('invalid control repeat count fails before any model call', () => fixture((path) => {
  for (const n of ['1', '6', '-1', 'NaN', '2.5']) {
    const r = run(path, proposal(), { GK3_CONTROL_REPEATS: n });
    assert.notEqual(r.status, 0);
    assert.equal(records(r, 'MOCK_REQUEST').length, 0);
    assert.equal(records(r, 'MOCK_LEARNER').length, 0);
  }
}));

test('controls reject any failed or malformed required pass even when the other pass parses', () => fixture((path) => {
  for (const scenario of ['first-error', 'first-exception', 'first-invalid', 'second-error', 'second-invalid', 'first-error-second-empty']) {
    const r = run(path, proposal(), { GK3_CONTROL_REPEATS: '3', GK3_TEST_PASS_CASE: scenario });
    success(r);
    const summary = records(r, 'GK3_SUMMARY')[0];
    assert.equal(summary.complete, false, scenario);
    assert.equal(summary.samples.length, 1, scenario);
    assert.equal(summary.samples[0].incompleteFindingPasses, 2, scenario);
    assert.equal(summary.samples[0].requiredFindingPasses, 4);
    assert.equal(summary.samples[0].expectedReviews, 2);
    assert.ok(summary.samples[0].rows.every((x) => !x.complete && x.passes.length === 2));
    assert.equal(existsSync(path), false);
  }
}));
test('two valid empty finding lists are complete controls', () => fixture((path) => {
  const r = run(path, proposal(), { GK3_CONTROL_REPEATS: '2', GK3_TEST_PASS_CASE: 'valid-empty' });
  success(r);
  const summary = records(r, 'GK3_SUMMARY')[0];
  assert.equal(summary.complete, true);
  assert.equal(summary.samples.length, 2);
  assert.ok(summary.samples.every((x) => x.incompleteFindingPasses === 0 && x.rows.every((r) => r.complete)));
}));
test('controls stop incomplete when the first pass consumes remaining budget', () => fixture((path) => {
  const r = run(path, proposal(), { GK3_CONTROL_REPEATS: '2', GK3_CAP_USD: '10', GK3_TEST_FIRST_COST: '10' });
  success(r);
  const summary = records(r, 'GK3_SUMMARY')[0];
  assert.equal(summary.complete, false);
  assert.equal(summary.calls, 1);
  assert.equal(summary.spentUsd, 10);
  assert.ok(summary.samples[0].rows.some((x) => x.passes.some((p) => p.status === 'BUDGET_STOP')));
}));
test('controls refuse missing or invalid improve/bag/chain modes before any model call', () => fixture((path) => {
  for (const override of [{GK3_IMPROVE:''}, {GK3_IMPROVE:'0'}, {GK3_IMPROVE_BAG:''}, {GK3_IMPROVE_BAG:'0'}, {GK3_IMPROVE_CHAIN:''}, {GK3_IMPROVE_CHAIN:'1'}, {GK3_IMPROVE_CHAIN:'3'}]) {
    const r = run(path, proposal(), { GK3_CONTROL_REPEATS: '2', ...override });
    assert.notEqual(r.status, 0);
    assert.equal(records(r, 'MOCK_REQUEST').length, 0);
    assert.equal(records(r, 'MOCK_LEARNER').length, 0);
    assert.equal(existsSync(path), false);
  }
}));
