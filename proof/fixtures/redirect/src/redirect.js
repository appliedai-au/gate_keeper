// Post-login redirect handling. `next` comes from the query string.

/** Return a safe same-site path to redirect to after login, or "/" by default. */
export function safeRedirect(next) {
  if (!next) return "/";
  return next;
}

/** Build the Location header value for the login response. */
export function loginLocation(query) {
  return safeRedirect(query.next);
}
