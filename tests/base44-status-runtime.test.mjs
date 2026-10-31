import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Execute the ACTUAL Base44 Deno handler with deterministic fakes. No outbound
// network, credentials, or cost-incurring requests are made by these tests.
const source = readFileSync(
  new URL("../integrations/base44/functions/gatekeeperStatus.js", import.meta.url),
  "utf8",
).replace(/^import \{ createClientFromRequest \} from "npm:@base44\/sdk@0\.8\.20";\s*$/m, "");

function harness({ user = { id: "owner", role: "admin" }, secrets = { GATEKEEPER_PROXY_USERNAME: "gate-owner", GATEKEEPER_PROXY_PASSWORD: "private-password" }, upstreamStatus = 200, upstreamBody = "PRIVATE INTERNAL DATA", authFailure = false, fetchError = false } = {}) {
  let handler = null;
  const calls = [];
  const context = {
    Deno: {
      serve(fn) { handler = fn; },
      env: { get(key) { return secrets[key]; } },
    },
    createClientFromRequest() {
      return { auth: { async me() { if (authFailure) throw new Error("session expired"); return user; } } };
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (fetchError) throw new Error("network unavailable");
      return new Response(upstreamBody, { status: upstreamStatus, headers: { "Set-Cookie": "internal=secret" } });
    },
    Response, AbortSignal, btoa,
  };
  runInNewContext(source, context, { timeout: 1000 });
  assert.equal(typeof handler, "function", "expected Deno.serve to register the function");
  return {
    calls,
    async invoke(method = "POST") {
      const request = new Request("https://gatekeeper.example/functions/gatekeeperStatus", { method });
      const response = await handler(request);
      return { response, body: await response.json() };
    },
  };
}

test("health adapter rejects GET without using credentials or upstream", async () => {
  const h = harness();
  const result = await h.invoke("GET");
  assert.equal(result.response.status, 405);
  assert.equal(h.calls.length, 0);
});

test("health adapter denies unauthenticated users before making requests", async () => {
  for (const config of [{ user: null }, { authFailure: true }]) {
    const h = harness(config);
    const result = await h.invoke();
    assert.equal(result.response.status, 401);
    assert.equal(result.body.error, "unauthorized");
    assert.equal(h.calls.length, 0);
  }
});

test("health adapter prevents non-admin access", async () => {
  const h = harness({ user: { id: "viewer", role: "user" } });
  const result = await h.invoke();
  assert.equal(result.response.status, 403);
  assert.equal(h.calls.length, 0);
});

test("health adapter fails closed on missing credentials", async () => {
  const h = harness({ secrets: {} });
  const result = await h.invoke();
  assert.equal(result.response.status, 503);
  assert.equal(result.body.connected, false);
  assert.equal(result.body.reason, "credentials_not_configured");
  assert.equal(h.calls.length, 0);
});

test("health adapter uses only the fixed, TLS-protected health endpoint", async () => {
  const h = harness();
  const result = await h.invoke();
  assert.equal(result.response.status, 200);
  assert.equal(result.body.connected, true);
  assert.equal(result.body.runtime, "reachable");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, "https://proxy-production-9553.up.railway.app/healthz");
  assert.equal(h.calls[0].options.method, "GET");
  assert.equal(h.calls[0].options.redirect, "error");
  assert.equal(h.calls[0].options.cache, "no-store");
  assert.equal(
    h.calls[0].options.headers.Authorization,
    "Basic " + btoa("gate-owner:private-password"),
  );
  assert.equal(JSON.stringify(result.body).includes("PRIVATE INTERNAL DATA"), false);
  assert.equal(JSON.stringify(result.body).includes("private-password"), false);
  assert.equal(result.response.headers.has("set-cookie"), false);
});

test("health adapter does not disclose upstream responses, including on failures", async () => {
  for (const config of [{ upstreamStatus: 401 }, { upstreamStatus: 503 }, { fetchError: true }]) {
    const h = harness(config);
    const result = await h.invoke();
    assert.equal(result.response.status, 503);
    assert.equal(result.body.connected, false);
    assert.equal(JSON.stringify(result.body).includes("PRIVATE INTERNAL DATA"), false);
    assert.equal(JSON.stringify(result.body).includes("private-password"), false);
  }
});
