/**
 * Compatibility boundary for the existing two-pass Gate Keeper experiment.
 * BAG is the unchanged file from control commit 3091c2e (also present at e054).
 * The chain text and finding conversion follow that runner's evaluation path.
 * Source identity/provenance is recorded in docs/learning-v2/phase-2-adapter.md.
 * This module renders/parses model-visible data; it never knows oracle labels,
 * scores a candidate, signs evidence, reads a bank, or starts a model call.
 */
import * as BAG from './compat/gk-bag-3091.mjs';
import { canonical, copy, requireThat, text } from './contracts.mjs';
import { reviewerInstructions } from './prompts.mjs';

export const LEGACY_RENDERER_ID = 'gate-keeper-3091-two-pass-v1';
export const LEGACY_BAG_BLOB = '3abd4181c0470d9b8fd9b81fb51e75ab9734bdc5';
export const CHAIN_ASK = '\n\nEarlier review passes already reported these findings:\n%LIST%\n\nDo another careful pass. Report ONLY real defects that are NOT already listed above (a different line or a different root cause). Do not repeat or rephrase listed findings. If you find nothing new, return {"findings":[]}. Same JSON format.';

/** Match the legacy last-balanced-findings-object selection on bounded text. */
function lastFindings(output) {
  text(output, 'review output', 200_000);
  let selected = null;
  let framingWork = 0;
  for (let start = output.indexOf('{'); start >= 0; start = output.indexOf('{', start + 1)) {
    let depth = 0, quoted = false, escaped = false;
    for (let index = start; index < output.length; index++) {
      requireThat(++framingWork <= 1_500_000, 'review framing work limit');
      const character = output[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth++;
      else if (character === '}' && --depth === 0) {
        try {
          const parsed = JSON.parse(output.slice(start, index + 1));
          canonical(parsed);
          if (Array.isArray(parsed?.findings)) selected = parsed.findings;
        } catch { /* Keep searching exactly as the existing framing permits. */ }
        break;
      }
    }
  }
  requireThat(Array.isArray(selected) && selected.length <= 256, 'missing or oversized findings array');
  return selected;
}

function checkedFindings(findings) {
  canonical(findings);
  requireThat(Array.isArray(findings) && findings.length <= 512, 'finding count');
  for (const finding of findings) {
    requireThat(finding && Number.isSafeInteger(finding.start) && finding.start > 0 &&
      finding.end === finding.start && typeof finding.quote === 'string' && typeof finding.comment === 'string',
    'malformed converted finding');
  }
  return findings;
}

/** Convert the reply before BAG post-processing, as the legacy second pass does. */
export function parseRawReview(output) {
  const raw = lastFindings(output);
  // The existing runner converts valid line findings this way. V2 refuses an
  // invalid member rather than silently dropping it into an apparently empty
  // successful response; that is an explicit completeness repair.
  const findings = raw.map(item => {
    requireThat(item && typeof item === 'object' && !Array.isArray(item), 'malformed finding member');
    const position = item.line ?? item.code_location?.line_range?.start;
    requireThat((typeof position === 'number' || typeof position === 'string') &&
      String(position).trim().length > 0, 'finding line absent');
    const start = Number(position);
    requireThat(Number.isSafeInteger(start) && start > 0, 'invalid finding line');
    requireThat(item.quote === undefined || typeof item.quote === 'string', 'invalid finding quote');
    requireThat(item.comment === undefined || typeof item.comment === 'string', 'invalid finding comment');
    requireThat(item.title === undefined || typeof item.title === 'string', 'invalid finding title');
    return { start, end: start, quote: item.quote || '', comment: (item.comment || item.title || '').slice(0, 240) };
  });
  return copy(checkedFindings(findings));
}

/** First-pass findings are post-processed before being shown to pass two. */
export function parseReview(output, originalPrompt) {
  text(originalPrompt, 'original case prompt', 200_000);
  const post = BAG.post(originalPrompt, parseRawReview(output), null);
  return copy(checkedFindings(post.out));
}

/** Merge post-processed first findings with raw converted second findings once. */
export function mergeReviews(originalPrompt, first, second) {
  text(originalPrompt, 'original case prompt', 200_000);
  checkedFindings(first);
  checkedFindings(second);
  return copy(checkedFindings(BAG.post(originalPrompt, [...first, ...second], null).out));
}

export function renderReview({ artifact, originalBase, caseInput, scope, pass, firstFindings = [] }) {
  text(originalBase, 'frozen original base', 100_000);
  text(caseInput.prompt, 'original case prompt', 200_000);
  requireThat(artifact?.baseInstructions === originalBase, 'prompt base drift');
  const instructions = reviewerInstructions({ originalInstructions: originalBase, activeVersion: artifact,
    scope, caseId: caseInput.caseId, pass });
  const prepared = BAG.prepare(instructions, caseInput.prompt, {});
  if (pass === 1) return { instructions: prepared.system, message: prepared.prompt };
  checkedFindings(firstFindings);
  const list = firstFindings.length ? firstFindings.map(finding =>
    `- line ${finding.start}: ${finding.comment}`).join('\n') : '(none)';
  return { instructions: prepared.system, message: prepared.prompt + CHAIN_ASK.replace('%LIST%', list) };
}
