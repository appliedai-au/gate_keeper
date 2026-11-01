import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../integrations/base44/functions/gatekeeperReadiness.js", import.meta.url), "utf8")
  .replace(/^import \{ createClientFromRequest \} from "npm:@base44\/sdk";\s*$/m, "");

function build({ user = { id: "admin", role: "admin" }, secrets = {
  GATEKEEPER_PROXY_USERNAME: "internal-user",
  GATEKEEPER_PROXY_PASSWORD: "sensitive-secret",
}, agents = [{ name: "gate-keeper", manifest: { model: { name: "registered-model" } } }],
  healthStatus = 200, agentsStatus = 200, authError = false, responseRaw = null } = {}) {
  let handler;
  const calls = [];
  const ctx = {
    Deno: { serve(fn) { handler = fn; }, env: { get: (key) => secrets[key] } },
    createClientFromRequest: () => ({ auth: { me: async () => {
      if (authError) throw new Error("no session");
      return user;
    } } }),
    fetch: async (url, options) => {
      calls.push({ url, method: options.method, headers: options.headers });
      if (url.endsWith("/healthz")) return new Response("", { status: healthStatus });
      return new Response(responseRaw ?? JSON.stringify({ data: agents }), {
        status: agentsStatus, headers: { "Content-Type": "application/json" },
      });
    },
    Response, Request, AbortSignal, TextDecoder, Uint8Array, btoa,
  };
  runInNewContext(source, ctx, { timeout: 2000 });
  return {
    calls,
    async run(method = "POST") {
      const response = await handler(new Request("https://app.base44.com/functions/gatekeeperReadiness", { method }));
      return { status: response.status, body: await response.json(), headers: response.headers };
    },
  };
}

test("invalid method and anonymous callers cannot reach the proxy", async () => {
  const invalid = build();
  assert.equal((await invalid.run("GET")).status, 405);
  assert.equal(invalid.calls.length, 0);
  for (const options of [{ user: null }, { authError: true }, { user: { id: "x", role: "user" } }]) {
    const h = build(options);
    const r = await h.run();
    assert.ok([401, 403].includes(r.status));
    assert.equal(h.calls.length, 0);
  }
});

test("missing credentials deny access without any upstream call", async () => {
  const h = build({ secrets: {} });
  const r = await h.run();
  assert.equal(r.status, 503);
  assert.equal(r.body.status, "credentials_not_configured");
  assert.equal(h.calls.length, 0);
});

test("two fixed GET metadata paths only; no billable calls, no leaked response", async () => {
  const h = build();
  const r = await h.run();
  assert.equal(r.status, 200);
  assert.deepEqual(h.calls.map(({ url, method }) => [url, method]), [
    ["https://proxy-production-9553.up.railway.app/healthz", "GET"],
    ["https://proxy-production-9553.up.railway.app/api/v1/agents", "GET"],
  ]);
  assert.equal(r.body.runtimeReachable, true);
  assert.equal(r.body.agentRegistered, true);
  assert.equal(r.body.modelDeclared, true);
  assert.equal(r.body.reviewEnabled, false);
  assert.equal(r.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.doesNotMatch(JSON.stringify(r.body), /sensitive-secret|registered-model|internal-user/);
});

test("unknown agent, metadata failure, or response overflow fail closed", async () => {
  for (const opts of [
    { agents: [{ name: "another-agent" }] },
    { agentsStatus: 401 },
    { responseRaw: "a".repeat(129 * 1024) },
  ]) {
    const h = build(opts);
    const r = await h.run();
    assert.equal(r.status, 503);
    assert.equal(r.body.reviewEnabled, false);
  }
});

test("runtime inaccessible does not advertise connection", async () => {
  const h = build({ healthStatus: 503 });
  const r = await h.run();
  assert.equal(r.status, 503);
  assert.equal(r.body.runtimeReachable, false);
  assert.equal(h.calls.length, 1);
});

test("source never accepts client-selected host, agent, session, or inference request", () => {
  assert.doesNotMatch(source, /request\.json\(/);
  assert.doesNotMatch(source, /\/api\/v1\/sessions/);
  assert.doesNotMatch(source, /session\.create/);
  assert.match(source, /user\.role !== "admin"/);
  assert.match(source, /reviewEnabled: false/);
});
