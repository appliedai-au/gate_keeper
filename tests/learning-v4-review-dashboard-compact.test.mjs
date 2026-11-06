import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCompleteReviewDashboard } from '../scripts/learning-v2/review-dashboard.mjs';

const compact = value => '<kbd>✅ Approved</kbd> <kbd>' + value + '</kbd>';
for (const [value, expected] of [
  ['0 findings', true], ['0 open', true], ['4 closed / 4 findings', true],
  ['10 findings', false], ['100 findings', false], ['1 finding', false],
  ['3 issues', false], ['10 open', false], ['0 closed / 10 findings', false],
  ['Not No issues found.', false], ['No issues found. 1 issue', false],
]) test('compact dashboard: ' + value, () => {
  assert.equal(hasCompleteReviewDashboard(compact(value)), expected);
});
test('compact dashboard refuses extra unaccounted content and substituted approval', () => {
  assert.equal(hasCompleteReviewDashboard(compact('0 findings') + '\n1 issue'), false);
  assert.equal(hasCompleteReviewDashboard(compact('0 findings').replace('✅ Approved', '❌ Needs fixes')), false);
  assert.equal(hasCompleteReviewDashboard('> ' + compact('0 findings')), false);
});
