// Run only through the managed remote repository gate. Fake SDK; no credentials/network/models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
        if (s.label.startsWith('i/improve-')) { console.log('MOCK_LEARNER '+JSON.stringify({label:s.label,instructions:s.sys,prompt,temperature:s.temperature})); text = JSON.stringify({rules:[${JSON.stringify(rule)}],why:'Synthetic rule proposal'}); }
        else { console.log('MOCK_REQUEST '+JSON.stringify({label:s.label,instructions:s.sys,prompt,temperature:s.temperature,good:s.sys.includes('TEST_GOOD_RULE'),bad:s.sys.includes('TEST_BAD_RULE')}));
          const fs = s.sys.includes('TEST_BAD_RULE') ? [] : [{line:10,quote:'danger()',comment:'Synthetic defect'}];
          if(s.sys.includes('TEST_GOOD_RULE')) fs.push({line:20,quote:'danger2()',comment:'Second synthetic defect'});
          if(s.sys.includes('TEST_BAD_RULE')) fs.push({line:99,quote:'safe()',comment:'Synthetic false alarm'});
          text=JSON.stringify({findings:fs}); }
        return {data:{id:'turn',state:{status:'done',output:{content:text},metrics:{totalCostInUsd:0,totalInputTokens:1,totalOutputTokens:1}}}};
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

test('rejected rules remain in the no-repeat bank but never enter reviewer instructions', () => fixture((path) => {
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

test('negative rules are banked only to prevent repetition, never fed to the learner or reviewer', () => fixture((path) => {
  const first = run(path, proposal('general', true), { GK3_DELTA_LEARNING: '1', GK3_ROUNDS: '2' });
  success(first);
  const b = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(b.harmful.length, 1);
  assert.equal(b.accepted.length, 0);
  assert.equal(records(first, 'GK3_BANK_DUPLICATE').length, 1, 'the identical failed proposal must not be scored again');
  assert.equal(records(first, 'GK3_EVAL').length, 2, 'baseline and one candidate only');
  const learners = records(first, 'MOCK_LEARNER');
  assert.equal(learners.length, 2);
  assert.ok(learners.every((x) => !x.prompt.includes('TEST_BAD_RULE')));
  assert.ok(learners.every((x) => !x.prompt.includes('Negative-learning records')));
  assert.ok(learners.every((x) => !x.prompt.includes('Measured changes caused by recent proposals')));
  assert.ok(learners.every((x) => !x.prompt.includes('lostRealBugs')));
  assert.ok(learners.every((x) => !x.prompt.includes('CHECK_ONLY_TRUTH')));
  assert.ok(records(first, 'MOCK_REQUEST').every((x) => !(x.instructions + x.prompt).includes('FIT_ONLY_TRUTH')));
  const entry = b.harmful[0];
  assert.ok(entry.fitFeedback.lostRealBugs.some((x) => x.why.includes('FIT_ONLY_TRUTH')));
  assert.ok(entry.fitFeedback.addedFalseAlarms.some((x) => x.line === 99));
  // A subsequent learner can still propose and accept an unrelated positive rule.
  const next = run(path, proposal(), { GK3_DELTA_LEARNING: '1' });
  success(next);
  assert.ok(records(next, 'MOCK_LEARNER').every((x) => !x.prompt.includes('TEST_BAD_RULE')));
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.harmful.length, 1);
  assert.equal(saved.accepted.length, 1);
}));

test('semantically repeated rejected strategy is banked without evaluation', () => fixture((path) => {
  const bad = proposal();
  bad.when = 'TEST_BAD_RULE under a race, a read lookup feeds a later write and findings should be reported on the write line.';
  const first = run(path, bad); success(first);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).harmful.length, 1);
  const paraphrase = proposal();
  paraphrase.when = 'TEST_BAD_RULE with concurrency, a read lookup feeds an update write; report the finding at the write line, not the lookup.';
  const second = run(path, paraphrase); success(second);
  assert.equal(records(second, 'GK3_BANK_DUPLICATE').length, 1);
  assert.equal(records(second, 'GK3_EVAL').length, 1, 'repeat should not trigger candidate review');
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).harmful.length, 1);
  assert.ok(records(second, 'MOCK_LEARNER').every((x) => !x.prompt.includes(bad.when)));
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

test('independent confirmation of an unproven proposal never promotes it', () => fixture((path) => {
  const a = run(path, proposal(), { GK3_MIN_GAIN: '5' }); success(a);
  const bank = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(bank.unproven.length, 1); assert.equal(bank.harmful.length, 0);
  const id = bank.unproven[0].id;
  const b = run(path, proposal(), { GK3_ROUNDS: '0', GK3_PROBE_RULE_ID: id,
    GK3_PROBE_CACHE_TAG: 'synthetic-pair', GK3_CACHE_DIR: path + '-cache' }); success(b);
  const c = records(b, 'GK3_CONFIRMATION')[0];
  assert.equal(c.ruleId, id);
  assert.equal(c.promoted, false);
  assert.ok(c.netChange > 0);
  assert.equal(records(b, 'GK3_SUMMARY')[0].best.net, 2);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).accepted.length, 0);
}));

test('rejected rules cannot be probed again, even explicitly', () => fixture((path) => {
  const a = run(path, proposal('general', true)); success(a);
  const id = JSON.parse(readFileSync(path, 'utf8')).harmful[0].id;
  const b = run(path, proposal(), { GK3_ROUNDS: '0', GK3_PROBE_RULE_ID: id,
    GK3_PROBE_CACHE_TAG: 'must-refuse', GK3_CACHE_DIR: path + '-cache' });
  assert.notEqual(b.status, 0);
  assert.match(b.stderr, /NEGATIVE_RULE_RETRY_FORBIDDEN/);
  assert.equal(records(b, 'MOCK_REQUEST').length, 0, 'rejected rule refused before model review');
  assert.equal(records(b, 'GK3_CONFIRMATION').length, 0);
}));

test('learner temperature changes leave every finding call at baseline temperature', () => fixture((path) => {
  const r = run(path, proposal(), { GK3_LEARNER_TEMPERATURE: '0.7' });
  success(r);
  assert.ok(records(r, 'MOCK_LEARNER').every((x) => x.temperature === 0.7));
  assert.ok(records(r, 'MOCK_REQUEST').every((x) => x.temperature === 0.2));
}));
