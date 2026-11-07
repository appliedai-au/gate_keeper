// Server-only Base44 bridge. Never import this module from a page/component.
import {
  REVIEW_APP_ID, REVIEW_PUBLIC_URL, REVIEW_MAX_BODY_BYTES, REVIEW_MAX_RESPONSE_BYTES,
  REVIEW_ERRORS, keysAre, validOwner, validSource, validCommand, validReviewReply, readBoundedJson,
} from "./review-contract.js";

const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const json = (body, status = 200) => Response.json(body, { status, headers });

export function createReviewBridge({ authenticate, readEnv, fetchImpl = fetch }) {
  return async request => {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    let user;
    try { user = await authenticate(request); }
    catch { return json({ error: "unauthorized" }, 401); }
    if (!validOwner(user?.id)) return json({ error: "unauthorized" }, 401);
    if (user.role !== "admin") return json({ error: "forbidden" }, 403);
    // The legacy readEnv injection accepts either a value or a promise. Keep
    // reads ordered: authenticate, confirm the owner, then read the capability.
    let source, token;
    try {
      const owner = await readEnv("GATEKEEPER_REVIEW_OWNER_ID");
      if (!validOwner(owner)) return json({ error: "review_unavailable" }, 503);
      if (user.id !== owner) return json({ error: "forbidden" }, 403);
      if (await readEnv("GATEKEEPER_REVIEW_ENABLED") !== "enabled")
        return json({ error: "review_unavailable" }, 503);
      source = await readEnv("GATEKEEPER_REVIEW_SOURCE_COMMIT");
      token = await readEnv("GATEKEEPER_REVIEW_TOKEN");
    } catch {
      // A hosted secret read can reject. Its value/error never becomes public.
      return json({ error: "review_unavailable" }, 503);
    }
    if (!validSource(source) || typeof token !== "string" || !/^[A-Za-z0-9_-]{43,128}$/u.test(token))
      return json({ error: "review_unavailable" }, 503);
    let command;
    try { command = await readBoundedJson(request.body, REVIEW_MAX_BODY_BYTES); }
    catch { return json({ error: "invalid_request" }, 400); }
    if (!validCommand(command)) return json({ error: "invalid_request" }, 400);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 12000);
    try {
      const upstream = await fetchImpl(REVIEW_PUBLIC_URL, {
        method: "POST", redirect: "error", cache: "no-store", signal: abort.signal,
        headers: {
          "Content-Type": "application/json", "X-Gatekeeper-Review-Token": token,
          "X-Gatekeeper-Review-Owner": user.id, "X-Gatekeeper-Review-App": REVIEW_APP_ID,
          "X-Gatekeeper-Review-Source": source,
        },
        body: JSON.stringify(command),
      });
      const body = await readBoundedJson(upstream.body, REVIEW_MAX_RESPONSE_BYTES);
      if (!upstream.ok) {
        if (keysAre(body, ["error"]) && REVIEW_ERRORS.includes(body.error) &&
            [400, 401, 403, 404, 409, 429, 503].includes(upstream.status))
          return json(body, upstream.status);
        return json({ error: "review_unavailable" }, 503);
      }
      if (!validReviewReply(body, source)) return json({ error: "review_unavailable" }, 503);
      return json(body, upstream.status === 202 ? 202 : 200);
    } catch {
      // A timeout can occur after durable admission/dispatch. Never retry here.
      return json({ error: command.action === "start" ? "dispatch_uncertain" : "review_unavailable" }, 503);
    } finally { clearTimeout(timer); }
  };
}
