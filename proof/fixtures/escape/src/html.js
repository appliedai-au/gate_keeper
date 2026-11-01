// HTML rendering helpers for user-generated content.

/** Escape text for insertion into HTML element content or a double-quoted attribute. */
export function escapeHtml(value) {
  return String(value).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render a link to a user-supplied URL with user-supplied text. */
export function link(href, text) {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
}
