/** Authentication, exact-head acknowledgement and freshness remain the caller's
 * responsibility. Only current review summaries grant approval; closed finding
 * history, quoted examples and unrelated sections never do. */
function detailsBlock(value) {
  if (!/^<details(?: open)?>/u.test(value)) return null;
  let depth = 0, tokens = 0, end = null, closing = null;
  for (const item of value.matchAll(/<\/?details\b[^>]*>/gu)) {
    if (++tokens > 2004 || !/^<\/?details(?: open)?>$/u.test(item[0])) return null;
    if (item[0] === '</details>') depth--;
    else depth++;
    if (depth < 0 || depth > 4) return null;
    if (depth === 0) { closing = item.index; end = item.index + item[0].length; break; }
  }
  if (end === null) return null;
  const opening = value.match(/^<details(?: open)?>\s*<summary>([\s\S]*?)<\/summary>/u);
  if (!opening || opening[0].length > closing) return null;
  return { summary: opening[1].trim(), body: value.slice(opening[0].length, closing), rest: value.slice(end) };
}

export function hasCompleteReviewDashboard(body) {
  if (typeof body !== 'string' || body.length > 4 * 1024 * 1024) return false;
  const unquoted = body
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, '')
    .replace(/(```|~~~)[\s\S]*?(?:\1|$)/gu, '')
    .replace(/^[ \t]*>.*$/gmu, '')
    .replace(/`[^`\n]*`/gu, '')
    .trim();
  const canonicalCount = value => /^(?:0|[1-9][0-9]*)$/u.test(value) &&
    Number.isSafeInteger(Number(value)) && Number(value) <= 1000000;
  let section;
  if (unquoted.startsWith('<details')) {
    const review = detailsBlock(unquoted);
    if (!review) return false;
    const header = review.summary.match(/^<b>Code Review<\/b>\s*<kbd>✅ Approved<\/kbd>(?:\s*<kbd>([0-9]+) closed \/ ([0-9]+) findings<\/kbd>)?$/u);
    if (!header) return false;
    const headerCount = header[1] === undefined ? null : [header[1], header[2]];
    if (headerCount && (!headerCount.every(canonicalCount) || headerCount[0] !== headerCount[1])) return false;
    const nestedAt = review.body.indexOf('<details');
    section = nestedAt === -1 ? review.body : review.body.slice(0, nestedAt);
    if (nestedAt !== -1) {
      // Actual Gitar dashboards put resolved examples in one explicitly closed
      // group. Count and validate its child headings before excluding history.
      const history = detailsBlock(review.body.slice(nestedAt));
      const closed = history?.summary.match(/^<kbd>✅ ([0-9]+) closed<\/kbd>$/u);
      if (!headerCount || !history || history.rest.trim() || !closed ||
        closed[1] !== headerCount[0] || !canonicalCount(closed[1])) return false;
      let remaining = history.body.trim(), entries = 0;
      while (remaining) {
        const finding = detailsBlock(remaining);
        if (!finding || !/^✅ <b>[^<>]+:<\/b>[^<>]+$/u.test(finding.summary) ||
          /<\/?details\b/u.test(finding.body) || ++entries > 1000) return false;
        remaining = finding.rest.trim();
      }
      if (entries !== Number(closed[1])) return false;
    }
    if (headerCount) section = headerCount[0] + ' closed / ' + headerCount[1] + ' findings\n' + section;
  } else {
    const review = unquoted.match(/^✅ Approved\r?\n([\s\S]*)$/u);
    if (!review || /<\/?details\b/u.test(review[1])) return false;
    section = review[1];
  }
  // Literal quoted examples in a descriptive sentence are not current counts.
  // Strip only complete, whitespace-delimited quotes, not word apostrophes.
  const visible = section.replace(/<[^>]*>/gu, ' ')
    .replace(/(^|[\s(])(['"])[^'"\n]*\2(?=$|[\s.,;:)])/gmu, '$1').trim();
  const countPattern = /\b([0-9]+)[ \t]+closed\s*\/\s*([0-9]+)[ \t]+(?:findings?|issues?)\b/giu;
  const counts = [...visible.matchAll(countPattern)];
  const openCounts = [...visible.matchAll(/\b([0-9]+)[ \t]+open\b/giu)];
  if (openCounts.some(item => !canonicalCount(item[1]) || item[1] !== '0')) return false;
  if (counts.length > 1 || /\bclosed\s*\//iu.test(visible) && counts.length !== 1) return false;
  const outsideSummary = visible.replace(countPattern, '');
  const otherCounts = [...outsideSummary.matchAll(/\b([0-9]+)[ \t]+(?:open[ \t]+)?(?:findings?|issues?)\b/giu)];
  if (otherCounts.some(item => !canonicalCount(item[1]) || item[1] !== '0')) return false;
  if (counts.length === 1) {
    const [, closed, total] = counts[0];
    return canonicalCount(closed) && canonicalCount(total) && closed === total;
  }
  return /(?:^|[.!?]\s+|\n)\s*(?:No open findings remain[.!]?|No issues found\.|0 (?:findings?|issues?)[.!]?|0 open(?: findings?| issues?)?[.!]?)\s*(?=$|\n)/imu.test(visible);
}
