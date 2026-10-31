// Base44 backend function for the existing Gate Keeper demo app.
// Read-only runtime probe. Do NOT add generic URL forwarding or browser-visible secrets.
// Source: https://github.com/appliedai-au/gate_keeper
import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";

const TRUEFORGE_PROXY = "https://proxy-production-9553.up.railway.app";
const HEALTH_PATH = "/healthz";
const TIMEOUT_MS = 7_000;
const respond = (body, status) => Response.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store, max-age=0" },
});

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return respond({ error: "method_not_allowed" }, 405);
  }

  // Every request must have an authenticated Base44 administrator.
  let user;
  try {
    user = await createClientFromRequest(request).auth.me();
  } catch {
    return respond({ error: "unauthorized" }, 401);
  }
  if (!user) {
    return respond({ error: "unauthorized" }, 401);
  }
  if (user.role !== "admin") {
    return respond({ error: "forbidden" }, 403);
  }

  // These values must be configured as Base44 backend secrets. They are
  // intentionally never returned, logged, or delivered to frontend code.
  const username = Deno.env.get("GATEKEEPER_PROXY_USERNAME");
  const password = Deno.env.get("GATEKEEPER_PROXY_PASSWORD");
  if (!username || !password) {
    return respond({
      connected: false,
      reason: "credentials_not_configured",
      checkedAt: new Date().toISOString(),
    }, 503);
  }

  try {
    const authorization = "Basic " + btoa(username + ":" + password);
    const upstream = await fetch(TRUEFORGE_PROXY + HEALTH_PATH, {
      method: "GET",
      headers: { Authorization: authorization, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Consume neither response content nor credentials. Cancel the unread
    // response body so repeated probes do not accumulate occupied connections.
    const healthy = upstream.ok;
    await upstream.body?.cancel().catch(() => {});
    // A healthy container does NOT prove agent registration or model readiness.
    return respond({
      connected: healthy,
      runtime: healthy ? "reachable" : "unavailable",
      checkedAt: new Date().toISOString(),
    }, healthy ? 200 : 503);
  } catch {
    return respond({
      connected: false,
      runtime: "unavailable",
      checkedAt: new Date().toISOString(),
    }, 503);
  }
});
