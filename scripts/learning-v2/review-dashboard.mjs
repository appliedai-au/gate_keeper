/** Parse only the authenticated dashboard's review section, not quoted examples.
 * Authentication, exact-head acknowledgement and freshness remain the caller's
 * responsibility. Unknown or contradictory dashboard shapes fail closed. */
export function hasCompleteReviewDashboard(body) {
  if (typeof body !== 'string' || body.length > 4 * 1024 * 1024) return false;
  const unquoted = body
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, '')
    .replace(/(```|~~~)[\s\S]*?(?:\1|$)/gu, '')
    .replace(/^[ \t]*>.*$/gmu, '')
    .replace(/`[^`\n]*`/gu, '')
    .trim();
  let section;
  if (unquoted.startsWith('<details>')) {
    const review = unquoted.match(/^<details>\s*<summary><b>Code Review<\/b>\s*<kbd>✅ Approved<\/kbd><\/summary>([\s\S]*?)<\/details>/u);
    if (!review || review[1].includes('<details>')) return false;
    section = review[1];
  } else {
    const review = unquoted.match(/^✅ Approved\r?\n([\s\S]*)$/u);
    if (!review) return false;
    section = review[1];
  }
  const visible = section.replace(/<[^>]*>/gu, ' ').trim();
  const canonicalCount = value => /^(?:0|[1-9][0-9]*)$/u.test(value) &&
    Number.isSafeInteger(Number(value)) && Number(value) <= 1000000;
  const countPattern = /\b([0-9]+)[ \t]+closed\s*\/\s*([0-9]+)[ \t]+(?:findings?|issues?)\b/giu;
  const counts = [...visible.matchAll(countPattern)];
  const openCounts = [...visible.matchAll(/\b([0-9]+)[ \t]+open\b/giu)];
  // Explicit nonzero open counts cannot be cancelled by any clean prose.
  if (openCounts.some(item => !canonicalCount(item[1]) || item[1] !== '0')) return false;
  if (counts.length > 1 || /\bclosed\s*\//iu.test(visible) && counts.length !== 1) return false;
  // Only the one all-closed summary can justify a nonzero total. Outside it,
  // singular/plural findings and issues (including open forms) must be zero.
  // In particular, '12 closed / 12 findings' plus '0 open findings' is valid.
  const outsideSummary = visible.replace(countPattern, '');
  const otherCounts = [...outsideSummary.matchAll(/\b([0-9]+)[ \t]+(?:open[ \t]+)?(?:findings?|issues?)\b/giu)];
  if (otherCounts.some(item => !canonicalCount(item[1]) || item[1] !== '0')) return false;
  if (counts.length === 1) {
    const [, closed, total] = counts[0];
    return canonicalCount(closed) && canonicalCount(total) && closed === total;
  }
  // Count-free summaries must be complete statements, never negated or quoted
  // examples. A numeric suffix inside 10/100 is not a zero observation.
  return /(?:^|[.!?]\s+|\n)\s*(?:No open findings remain[.!]?|No issues found\.|0 (?:findings?|issues?)[.!]?|0 open(?: findings?| issues?)?[.!]?)\s*(?=$|\n)/imu.test(visible);
}
