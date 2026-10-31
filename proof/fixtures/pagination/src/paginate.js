// Pagination helpers for list endpoints. Pages are 1-based.

/** Return page `page` of `items` with `size` items per page, plus the total page count. */
export function paginate(items, page, size) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Number.isInteger(size) || size < 1) throw new RangeError("size must be a positive integer");
  const totalPages = Math.floor(items.length / size);
  const start = page * size;
  return { items: items.slice(start, start + size), page, totalPages };
}

/** Human-readable page summary used by the list views. */
export function pageSummary(items, page, size) {
  const p = paginate(items, page, size);
  return `Page ${p.page} of ${p.totalPages}: ${p.items.join(", ")}`;
}
