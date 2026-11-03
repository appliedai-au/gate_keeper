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
    why: [{ line: 10, why: 'Synthetic defect one' }, { line: 20, why: 'Synthetic defect two' }],
    prompts: { gate_keeper: 'Context: synthetic operations can fail.\n```' + lang + '\n10 | danger()\n20 | danger2()\n99 | safe()\n```' } })) };
function run(bankFile, rule = proposal(), extra = {}) {
  const source = `
    let seq = 0; const sessions = new Map();
    globalThis.fetch = () => { throw new Error('network forbidden'); };
    globalThis.GK3_SDK = { TrueForge: class { sessions = {
      create: async ({agent,metadata}) => { const id = String(++seq); sessions.set(id,{sys:agent.spec.instructions,label:metadata.label}); return {data:{id}}; },
      createTurn: async (id) => {
        const s = sessions.get(id); let text;
        if (s.label.startsWith('i/improve-')) text = JSON.stringify({rules:[${JSON.stringify(rule)}],why:'Synthetic rule proposal'});
        else { console.log('MOCK_REQUEST '+JSON.stringify({label:s.label,good:s.sys.includes('TEST_GOOD_RULE'),bad:s.sys.includes('TEST_BAD_RULE')}));
          const fs = [{line:10,quote:'danger()',comment:'Synthetic defect'}];
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
