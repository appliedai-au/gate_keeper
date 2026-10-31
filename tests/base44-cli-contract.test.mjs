import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const handler = readFileSync(new URL("../integrations/base44/cli/base44/functions/gatekeeper-status/entry.ts", import.meta.url), "utf8");

test("CLI status handler uses current Base44 structure and approved imports", () => {
  assert.match(handler, /export default async function gatekeeperStatus\(req\)/);
  assert.match(handler, /createClientFromRequest\(req\)\.auth\.me\(\)/);
  assert.match(handler, /secrets\.get\("GATEKEEPER_PROXY_USERNAME"\)/);
  assert.match(handler, /secrets\.get\("GATEKEEPER_PROXY_PASSWORD"\)/);
});

test("CLI status handler rejects non-admin and missing credentials", () => {
  assert.match(handler, /user\.role !== "admin"/);
  assert.match(handler, /if \(!username \|\| !password/);
  assert.match(handler, /method_not_allowed/);
  assert.match(handler, /credentials_not_configured/);
});

test("CLI status handler is fixed-path, no-store, and fail-closed", () => {
  assert.match(handler, /const PATH = "\/healthz"/);
  assert.match(handler, /private, no-store/);
  assert.match(handler, /redirect: "error"/);
  assert.match(handler, /cache: "no-store"/);
  assert.match(handler, /AbortSignal\.timeout/);
  assert.doesNotMatch(handler, /req\.json\(/);
  assert.doesNotMatch(handler, /upstream\.json\(/);
  assert.doesNotMatch(handler, /upstream\.text\(/);
});
