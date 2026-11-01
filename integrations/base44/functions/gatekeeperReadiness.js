// Metadata-only Gate Keeper ↔ TrueForge readiness check.
// Must run server-side in the EXISTING Base44 app; never call from a public URL.
// Proves reachability and registered agent metadata, NOT billable model readiness.
// No session creation, tool execution, prompts, or model inference.
import { createClientFromRequest } from "npm:@base44/sdk";

const UPSTREAM_ORIGIN = "https://proxy-production-9553.up.railway.app";
const AGENT_NAME = "gate-keeper";
const TIMEOUT_MS = 7_000;
const MAX_LIST_BYTES = 128 * 1024;
const reply = (body, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
});

async function readSmallJson(response) {
  const advertised = Number(response.headers.get("content-length") || 0);
  if (advertised > MAX_LIST_BYTES) throw new Error("oversized_metadata");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("missing_response");
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LIST_BYTES) throw new Error("oversized_metadata");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function get(path, authorization, parseJson = false) {
  // Fixed, code-owned paths only; never interpolate a browser-supplied URL.
  const response = await fetch(UPSTREAM_ORIGIN + path, {
    method: "GET",
    headers: { Authorization: authorization, Accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (parseJson) return readSmallJson(response);
  await response.body?.cancel().catch(() => {});
  return true;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  let user;
  try {
    user = await createClientFromRequest(request).auth.me();
  } catch {
    return reply({ error: "unauthorized" }, 401);
  }
  if (!user?.id) return reply({ error: "unauthorized" }, 401);
  if (user.role !== "admin") return reply({ error: "forbidden" }, 403);

  const checkedAt = new Date().toISOString();
  const username = Deno.env.get("GATEKEEPER_PROXY_USERNAME");
  const password = Deno.env.get("GATEKEEPER_PROXY_PASSWORD");
  if (!username || !password) {
    return reply({
      runtimeReachable: false, agentRegistered: false, modelDeclared: false,
      reviewEnabled: false, status: "credentials_not_configured", checkedAt,
    }, 503);
  }

  try {
    const authorization = "Basic " + btoa(username + ":" + password);
    const healthy = await get("/healthz", authorization);
    if (!healthy) return reply({
      runtimeReachable: false, agentRegistered: false, modelDeclared: false,
      reviewEnabled: false, status: "runtime_unavailable", checkedAt,
    }, 503);

    const agents = await get("/api/v1/agents", authorization, true);
    // TrueForge returns { data: [...] } through its SDK; handle bare-list
    // and common collection wrappers conservatively, never assume success.
    const candidates = Array.isArray(agents) ? agents :
      Array.isArray(agents?.data) ? agents.data :
      Array.isArray(agents?.items) ? agents.items :
      Array.isArray(agents?.agents) ? agents.agents : null;
    if (!candidates) return reply({
      runtimeReachable: true, agentRegistered: false, modelDeclared: false,
      reviewEnabled: false, status: "agent_metadata_unverified", checkedAt,
    }, 503);
    const registered = candidates.find((agent) => agent?.name === AGENT_NAME);
    const model = registered?.manifest?.model?.name ?? registered?.model?.name;
    return reply({
      runtimeReachable: true,
      agentRegistered: !!registered,
      modelDeclared: !!registered && typeof model === "string" && model.length > 0,
      reviewEnabled: false,
      // This function never attests model credentials, paid inference,
      // independent budget leases, tenant isolation or signed evaluation.
      status: registered ? "agent_metadata_verified" : "agent_not_registered",
      checkedAt,
    }, registered ? 200 : 503);
  } catch {
    return reply({
      runtimeReachable: false, agentRegistered: false, modelDeclared: false,
      reviewEnabled: false, status: "probe_failed", checkedAt,
    }, 503);
  }
});
