import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as BAG from '../scripts/learning-v2/compat/gk-bag-3091.mjs';
import {
  CHAIN_ASK, LEGACY_BAG_BLOB, LEGACY_RENDERER_ID,
  mergeReviews, parseRawReview, parseReview, renderReview,
} from '../scripts/learning-v2/legacy-renderer.mjs';

// SOURCE ONLY until the full managed remote gate executes these tests. The
// compatibility reference is the unchanged BAG module and the chain text from
// control commit 3091c2e8ae9e85b020e81bc62ad6520ca68e3cfb. No provider or oracle.
const ORIGINAL_BAG_BLOB = '3abd4181c0470d9b8fd9b81fb51e75ab9734bdc5';
const ORIGINAL_CHAIN = '\n\nEarlier review passes already reported these findings:\n%LIST%\n\nDo another careful pass. Report ONLY real defects that are NOT already listed above (a different line or a different root cause). Do not repeat or rephrase listed findings. If you find nothing new, return {"findings":[]}. Same JSON format.';
const BASE = 'Review the supplied numbered source and return JSON findings.\n\nExtra field: quote the relevant source.';
const SCOPE = 'concurrency-atomicity';

// The literal "N | source" layout and language fence are part of BAG's input
// contract. Fixtures use actual code lines rather than embedding expected bugs.
const CASE = { caseId: 'fit-race', prompt: [
  'Review this shared counter, which several workers can update.',
  '```javascript',
  "1 | import { count } from './counter.js';",
  '2 | const previous = count;',
  '3 | // Preserve the caller-visible result.',
  '4 | count++;',
  '5 | return count;',
  '6 | }',
  '```',
].join('\n') };
const MERGE_CASE = { caseId: 'fit-merge', prompt: [
  'Review these operations.',
  '```javascript',
  '1 | firstOperation();',
  '2 | secondOperation();',
  '3 | thirdOperation();',
  '```',
].join('\n') };

function candidateRule() {
  return { id: 'candidate-rule', coverageCaseIds: ['fit-race'], procedure: {
    scope: SCOPE, languages: ['javascript'],
    applicability: 'A shared counter is updated by concurrent workers.',
    trigger: 'The code reads and writes the same shared counter.',
    evidence: 'Identify the update and the synchronization that covers it.',
    action: 'CANDIDATE_ACTION_SENTINEL: report the unprotected update.',
    sufficientGuard: 'One atomic operation or a lock covers the complete update.',
  } };
}

const artifact = (rules = []) => ({ schema: 'gk-learning-v2-prompt', baseInstructions: BASE, rules });
const finding = (start, comment = 'Observed defect', quote = '') => ({ start, end: start, comment, quote });
const reply = findings => JSON.stringify({ findings });

test('the compatibility BAG bytes and chain text match the pinned legacy source', () => {
  const bytes = readFileSync(new URL('../scripts/learning-v2/compat/gk-bag-3091.mjs', import.meta.url));
  const blob = createHash('sha1').update(Buffer.concat([
    Buffer.from(`blob ${bytes.length}\0`, 'utf8'), bytes,
  ])).digest('hex');
  assert.equal(blob, ORIGINAL_BAG_BLOB);
  assert.equal(LEGACY_BAG_BLOB, ORIGINAL_BAG_BLOB);
  assert.equal(LEGACY_RENDERER_ID, 'gate-keeper-3091-two-pass-v1');
  assert.equal(CHAIN_ASK, ORIGINAL_CHAIN);
});

test('pass one keeps the frozen original instructions and existing BAG preparation for every candidate', () => {
  const original = BAG.prepare(BASE, CASE.prompt, {});
  const baseline = renderReview({ artifact: artifact(), originalBase: BASE, caseInput: CASE, scope: SCOPE, pass: 1 });
  const candidate = renderReview({ artifact: artifact([candidateRule()]), originalBase: BASE,
    caseInput: CASE, scope: SCOPE, pass: 1 });
  assert.deepEqual(baseline, { instructions: original.system, message: original.prompt });
  assert.deepEqual(candidate, baseline);
  assert.match(candidate.instructions, /## Rules for this code/);
  assert.match(candidate.instructions, /JS\/TS:/);
  assert.match(candidate.message, /L4: read then write: check for a race under concurrent callers/);
  assert.doesNotMatch(candidate.instructions + candidate.message, /CANDIDATE_ACTION_SENTINEL|## Review procedures/);
});

test('pass two includes the candidate only for its reviewed case ID and matching scope', () => {
  const candidate = artifact([candidateRule()]);
  const covered = renderReview({ artifact: candidate, originalBase: BASE, caseInput: CASE,
    scope: SCOPE, pass: 2, firstFindings: [] });
  assert.match(covered.instructions, /CANDIDATE_ACTION_SENTINEL/);
  assert.match(covered.instructions, /Sufficient guard \(do not report when present\): One atomic operation/);
  assert.equal(covered.message, BAG.prepare(BASE, CASE.prompt, {}).prompt + ORIGINAL_CHAIN.replace('%LIST%', '(none)'));

  for (const context of [
    { caseInput: { ...CASE, caseId: 'check-other-code' }, scope: SCOPE },
    { caseInput: CASE, scope: 'identity-and-access' },
  ]) {
    const actual = renderReview({ artifact: candidate, originalBase: BASE, ...context, pass: 2, firstFindings: [] });
    const baseline = renderReview({ artifact: artifact(), originalBase: BASE, ...context, pass: 2, firstFindings: [] });
    assert.deepEqual(actual, baseline);
    assert.doesNotMatch(actual.instructions, /CANDIDATE_ACTION_SENTINEL/);
  }
});

test('existing and candidate procedures retain their separate reviewed case coverage', () => {
  const existing = candidateRule();
  existing.id = 'existing-rule';
  existing.coverageCaseIds = ['check-existing'];
  existing.procedure.action = 'EXISTING_ACTION_SENTINEL: inspect the original invariant.';
  const combined = artifact([existing, candidateRule()]);
  const existingCase = renderReview({ artifact: combined, originalBase: BASE,
    caseInput: { ...CASE, caseId: 'check-existing' }, scope: SCOPE, pass: 2 });
  assert.match(existingCase.instructions, /EXISTING_ACTION_SENTINEL/);
  assert.doesNotMatch(existingCase.instructions, /CANDIDATE_ACTION_SENTINEL/);
  const candidateCase = renderReview({ artifact: combined, originalBase: BASE, caseInput: CASE, scope: SCOPE, pass: 2 });
  assert.match(candidateCase.instructions, /CANDIDATE_ACTION_SENTINEL/);
  assert.doesNotMatch(candidateCase.instructions, /EXISTING_ACTION_SENTINEL/);
});

test('the second-pass chain uses relocated, filtered and deduplicated first-pass findings', () => {
  const first = parseReview(reply([
    { line: 2, quote: 'count++;', comment: 'Counter update is unprotected.' },
    { line: 1, comment: 'IMPORT_ONLY_FINDING' },
    { line: 5, comment: 'ADJACENT_ONLY_FINDING' },
  ]), CASE.prompt);
  assert.deepEqual(first, [finding(4, 'Counter update is unprotected.', 'count++;')]);
  const rendered = renderReview({ artifact: artifact(), originalBase: BASE, caseInput: CASE,
    scope: SCOPE, pass: 2, firstFindings: first });
  assert.equal(rendered.message, BAG.prepare(BASE, CASE.prompt, {}).prompt +
    ORIGINAL_CHAIN.replace('%LIST%', '- line 4: Counter update is unprotected.'));
  assert.doesNotMatch(rendered.message, /IMPORT_ONLY_FINDING|ADJACENT_ONLY_FINDING|- line 2:/);
});

test('raw second-pass lines two and three survive until merging with first-pass line one', () => {
  const first = parseReview(reply([{ line: 1, comment: 'First defect' }]), MERGE_CASE.prompt);
  const second = parseRawReview(reply([
    { line: 2, comment: 'Adjacent duplicate' },
    { line: 3, comment: 'Third-line defect' },
  ]));
  assert.deepEqual(second.map(item => item.start), [2, 3]);
  const merged = mergeReviews(MERGE_CASE.prompt, first, second);
  assert.deepEqual(merged, [finding(1, 'First defect'), finding(3, 'Third-line defect')]);
  assert.deepEqual(merged, BAG.post(MERGE_CASE.prompt, [...first, ...second], null).out);
});

test('valid empty findings and findings removed by the legacy source filter remain valid empty reviews', () => {
  assert.deepEqual(parseRawReview('{"findings":[]}'), []);
  assert.deepEqual(parseReview('{"findings":[]}', CASE.prompt), []);
  const filtered = parseReview(reply([
    { line: 1, comment: 'Import-only observation' },
    { line: 3, comment: 'Comment-only observation' },
    { line: 6, comment: 'Closing-brace-only observation' },
  ]), CASE.prompt);
  assert.deepEqual(filtered, []);
  const rendered = renderReview({ artifact: artifact(), originalBase: BASE, caseInput: CASE,
    scope: SCOPE, pass: 2, firstFindings: filtered });
  assert.ok(rendered.message.endsWith(ORIGINAL_CHAIN.replace('%LIST%', '(none)')));
  assert.deepEqual(mergeReviews(CASE.prompt, [], []), []);
});

test('missing, malformed or blank raw replies cannot be treated as valid empty findings', () => {
  for (const output of ['', ' \n', '{}', '{"findings":null}', '{"findings":{}}',
    '{"findings":[', '[]', 'No defects were found.']) {
    assert.throws(() => parseRawReview(output), /LEARNING_V2_REJECTED/);
  }
});

test('the last balanced findings object wins while quoted braces and escaped quotes preserve framing', () => {
  const comment = 'A literal { brace } and an escaped "quote" are part of the comment.';
  const output = [
    'Earlier draft:', reply([{ line: 1, comment: 'Superseded draft' }]),
    '```json', reply([{ line: 3, comment }]), '```',
    'Trailing prose with an unfinished {',
  ].join('\n');
  assert.deepEqual(parseRawReview(output), [finding(3, comment)]);
  assert.deepEqual(parseRawReview(reply([{ line: 1, comment: 'Earlier' }]) + '\n{"findings":[]}'), []);
});

test('legacy line conversion, title fallback and comment clipping are preserved for valid findings', () => {
  const title = 't'.repeat(260);
  const raw = parseRawReview(reply([
    { line: '4', quote: 'count++;', comment: '', title },
    { code_location: { line_range: { start: 8, end: 11 } }, comment: 'Location form' },
  ]));
  assert.deepEqual(raw, [finding(4, 't'.repeat(240), 'count++;'), finding(8, 'Location form')]);
});

test('an invalid finding member rejects the reply instead of silently making it appear complete', () => {
  for (const invalid of [null, [], 'text', {}, { line: 0 }, { line: -1 }, { line: 1.5 },
    { line: true }, { line: ' ' }, { line: 'Infinity' }, { line: 4, quote: {} },
    { line: 4, comment: 1 }, { line: 4, title: [] }]) {
    assert.throws(() => parseRawReview(reply([{ line: 4, comment: 'Valid member' }, invalid])),
      /LEARNING_V2_REJECTED: .*finding/);
  }
});

test('review text and finding-count bounds reject oversized input before post-processing', () => {
  assert.throws(() => parseRawReview('x'.repeat(200_001)), /review output: invalid text/);
  assert.throws(() => parseRawReview(reply(Array.from({ length: 257 }, (_, index) => ({ line: index + 1 })))),
    /missing or oversized findings array/);
  assert.throws(() => mergeReviews(MERGE_CASE.prompt,
    Array.from({ length: 513 }, (_, index) => finding(index * 2 + 1)), []), /finding count/);
});

test('adversarial unfinished braces exhaust the framing-work allowance despite a small raw reply', () => {
  // 2,000 unmatched openings imply 2,001,000 scan steps without the work cap.
  // This input is far below the separate 200,000-character raw-text ceiling.
  assert.throws(() => parseRawReview('{'.repeat(2000)), /review framing work limit/);
});

test('base drift, invalid pass selection and malformed prior findings fail before rendering another review', () => {
  assert.throws(() => renderReview({ artifact: { ...artifact(), baseInstructions: BASE + ' changed' },
    originalBase: BASE, caseInput: CASE, scope: SCOPE, pass: 1 }), /prompt base drift/);
  for (const pass of [0, 3]) {
    assert.throws(() => renderReview({ artifact: artifact(), originalBase: BASE, caseInput: CASE,
      scope: SCOPE, pass }), /invalid reviewer pass/);
  }
  assert.throws(() => renderReview({ artifact: artifact(), originalBase: BASE, caseInput: CASE,
    scope: SCOPE, pass: 2, firstFindings: [{ start: 4, end: 5, quote: '', comment: 'Invalid span' }] }),
  /malformed converted finding/);
});

test('rendering and merging do not mutate caller-owned first-pass evidence or rule artifacts', () => {
  const current = artifact([candidateRule()]);
  const first = [finding(1, 'First defect')];
  const second = [finding(2, 'Adjacent'), finding(3, 'Third defect')];
  const before = JSON.stringify({ current, first, second });
  renderReview({ artifact: current, originalBase: BASE, caseInput: CASE, scope: SCOPE,
    pass: 2, firstFindings: first });
  mergeReviews(MERGE_CASE.prompt, first, second);
  assert.equal(JSON.stringify({ current, first, second }), before);
});
