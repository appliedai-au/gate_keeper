import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("proof runner image ships config/ that runners import", () => {
  assert.match(read("Dockerfile.proof"), /^COPY config \.\/config$/m);
  for (const f of ["scripts/proof/native-four-run.mjs", "scripts/proof/sponsor-admission.mjs"])
    assert.match(read(f), /\.\.\/\.\.\/config\//);
});

test("TrueForge runtime version is pinned to an approved list, default 0.180.0", () => {
  const d = read("Dockerfile");
  assert.match(d, /^ARG TRUEFORGE_VERSION=0\.180\.0$/m);
  assert.match(d, /case "\$TRUEFORGE_VERSION" in 0\.180\.0\|0\.182\.0\) ;; \*\)/);
  assert.match(d, /@truefoundry\/trueforge@\$\{TRUEFORGE_VERSION\}/);
});
