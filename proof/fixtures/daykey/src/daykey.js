// Daily sales report: bucket events by calendar day in Melbourne.

const MELBOURNE_OFFSET_MS = 10 * 60 * 60 * 1000; // AEST, UTC+10

/** Calendar day in Melbourne for a UTC epoch-millisecond timestamp, as "YYYY-MM-DD". */
export function dayKey(tsMs) {
  return new Date(tsMs + MELBOURNE_OFFSET_MS).toISOString().slice(0, 10);
}

/** Sum of amounts per Melbourne day: { "YYYY-MM-DD": cents }. */
export function dailyTotals(events) {
  const out = {};
  for (const e of events) out[dayKey(e.ts)] = (out[dayKey(e.ts)] || 0) + e.cents;
  return out;
}
