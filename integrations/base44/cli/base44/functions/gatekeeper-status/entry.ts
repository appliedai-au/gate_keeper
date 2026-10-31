// Current Base44 CLI/sandbox function entrypoint.
// Deploy ONLY to the already-existing Gate Keeper Base44 app.
// This probes the runtime, not the agent or model. It never calls a paid model.
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";

const ORIGIN = "https://proxy-production-9553.up.railway.app";
const PATH = "/healthz";
const TIMEOUT_MS = 7000;

const noStore = { "Cache-Control": "private, no-store, max-age=0" };
const json = (value, status) => Response.json(value, { status, headers: noStore });

export default async function gatekeeperStatus(req) {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  let user;
  try {
    user = await createClientFromRequest(req).auth.me();
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  if (!user) return json({ error: "unauthorized" }, 401);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);

  const checkedAt = new Date().toISOString();
  const username = secrets.get("GATEKEEPER_PROXY_USERNAME");
  const password = secrets.get("GATEKEEPER_PROXY_PASSWORD");
  if (!username || !password || typeof username !== "string" || typeof password !== "string") {
    return json({ connected: false, runtime: "unavailable", reason: "credentials_not_configured", checkedAt }, 503);
  }

  // The proxy currently has broad access. This integration deliberately limits
  // its own reachable URL to the exact health path; it never forwards a user URL.
  try {
    const authorization = "Basic " + btoa(username + ":" + password);
    const upstream = await fetch(ORIGIN + PATH, {
      method: "GET",
      headers: { Authorization: authorization, Accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!upstream.ok) return json({ connected: false, runtime: "unavailable", checkedAt }, 503);
    return json({ connected: true, runtime: "reachable", checkedAt }, 200);
  } catch {
    return json({ connected: false, runtime: "unavailable", checkedAt }, 503);
  }
}
