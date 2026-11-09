// CSV export for the reporting service. Customers open these files in Excel or Sheets.

/** One CSV field. */
export function csvField(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Rows (arrays of values) to CSV text, with a header row. */
export function toCsv(header, rows) {
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\n");
}
