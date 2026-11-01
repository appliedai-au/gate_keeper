import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Static release-contract test. The exact production Dockerfile is included in
// Dockerfile.qualify; it must be safe when deployed without explicit overrides.
test("new proof runners default to an inert standby command", () => {
  const docker = readFileSync(new URL("../Dockerfile.proof", import.meta.url), "utf8");
  const commands = [...docker.matchAll(/^CMD\s+(\[[^\n]+\])\s*$/gm)];
  assert.equal(commands.length, 1, "one and only one default CMD");
  const args = JSON.parse(commands[0][1]);
  assert.deepEqual(args.slice(0, 2), ["node", "-e"]);
  assert.match(args[2], /GK_PROOF_STANDBY/);
  assert.doesNotMatch(args.join(" "), /scripts\/proof\/(?:live\/run|sponsor-smoke|four-rounds)\.mjs/);
  assert.doesNotMatch(docker, /^ENTRYPOINT\s+/m, "entrypoint must not bypass standby");
});

test("qualification image tests production runner's actual Dockerfile", () => {
  const qualify = readFileSync(new URL("../Dockerfile.qualify", import.meta.url), "utf8");
  assert.match(qualify, /COPY Dockerfile\.proof \.\/Dockerfile\.proof/);
  assert.match(qualify, /npm run test:learning-policy/);
});
