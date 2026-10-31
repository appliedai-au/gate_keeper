// Money helpers for the invoicing service. Amounts arrive as decimal strings.

/** Parse a decimal amount string such as "12.50" into integer cents. */
export function parseAmountCents(input) {
  if (typeof input !== "string") throw new TypeError("amount must be a string");
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new RangeError("invalid amount: " + input);
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac);
}

/** Total of invoice lines [{amount, qty}] in cents. */
export function invoiceTotalCents(lines) {
  return lines.reduce((sum, line) => sum + parseAmountCents(line.amount) * line.qty, 0);
}
