import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const lib=readFileSync(new URL("../scripts/lib.ts",import.meta.url),"utf8");
const exporter=readFileSync(new URL("../scripts/export-session.ts",import.meta.url),"utf8");
test("private root rejects symlink ancestors",()=>{
 assert.match(lib,/assertRealDirectory\(PRIVATE_ROOT\)/);
 assert.match(lib,/isSymbolicLink\(\)/);
 assert.match(lib,/realpathSync\(PRIVATE_ROOT\)/);
});
test("private writes confined to private state",()=>{
 assert.match(lib,/relative\(PRIVATE_ROOT,full\)/);
 assert.match(lib,/assertPrivatePath\(path\)/);
 assert.match(lib,/constants\.O_WRONLY\s*\|\s*constants\.O_CREAT\s*\|\s*constants\.O_EXCL\s*\|\s*constants\.O_NOFOLLOW/);
 assert.match(lib,/openSync\(safe,/);
 assert.match(lib,/0o600\)/);
});
test("session exporter cannot stream raw events to stdout",()=>{
 assert.doesNotMatch(exporter,/console\.log\(JSON\.stringify\(exp/);
 assert.match(exporter,/GK_EXPORT_AUTHORIZED/);
 assert.match(exporter,/join\(PRIVATE_ROOT,"exports"/);
 assert.doesNotMatch(exporter,/\bconst\s+\[sessionId,\s*out\]/);
});
