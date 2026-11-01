import test from "node:test"; import assert from "node:assert/strict";
import { loginLocation } from "../src/redirect.js";
test("login location uses next", () => assert.equal(loginLocation({ next: "/home" }), "/home"));
test("login location sanitises next", () => assert.equal(loginLocation({ next: "https://evil.test" }), "/"));
