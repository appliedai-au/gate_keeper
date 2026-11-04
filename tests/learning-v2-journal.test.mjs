/** Source prepared for the complete remote gate; do not run locally. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { FileJournal, MemoryJournal } from "../scripts/learning-v2/journal.mjs";

function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "gk-learning-v2-journal-"));
  chmodSync(root, 0o700);
  const repositoryRoot = join(root, "repository");
  mkdirSync(repositoryRoot, { mode: 0o700 });
  const directory = join(root, "private", "journal");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, directory, repositoryRoot, journal: new FileJournal({ directory, repositoryRoot }) };
}

const firstRecord = directory => join(directory, "000000000001.json");

test("canonical records have matching in-memory and durable heads", async t => {
  const { journal, directory, repositoryRoot } = fixture(t);
  const memory = new MemoryJournal();
  const initial = { type: "experiment.created", configuration: { scope: "atomicity", attempts: 10 } };
  const durable = await journal.append(null, initial);
  const ephemeral = await memory.append(null, {
    configuration: { attempts: 10, scope: "atomicity" }, type: "experiment.created",
  });
  assert.deepEqual(durable, ephemeral);
  assert.match(durable.head, /^[a-f0-9]{64}$/);
  const next = await journal.append(durable.head, { type: "attempt.reserved", number: 1 });
  assert.notEqual(next.head, durable.head);
  assert.deepEqual(await new FileJournal({ directory, repositoryRoot }).read(), next);
  assert.equal(lstatSync(directory).mode & 0o777, 0o700);
  assert.equal(lstatSync(firstRecord(directory)).mode & 0o777, 0o600);
  assert.equal(lstatSync(firstRecord(directory)).nlink, 1);
  assert.deepEqual(readdirSync(directory).sort(), [".head.json", "000000000001.json", "000000000002.json"]);
});

test("empty read and stale-head rejection do not append records", async t => {
  const { journal, directory } = fixture(t);
  assert.deepEqual(await journal.read(), { head: null, events: [] });
  const first = await journal.append(null, { type: "reserved", number: 1 });
  await assert.rejects(journal.append(null, { type: "reserved", number: 2 }), /stale expected head/);
  assert.deepEqual(await journal.read(), first);
  assert.deepEqual(readdirSync(directory).sort(), [".head.json", "000000000001.json"]);
});

test("input objects and returned snapshots cannot mutate stored evidence", async t => {
  const { journal } = fixture(t);
  for (const store of [journal, new MemoryJournal()]) {
    const event = { type: "candidate", procedure: { trigger: "shared state" }, tags: ["one"] };
    const first = await store.append(null, event);
    event.procedure.trigger = "changed input";
    first.events[0].procedure.trigger = "changed output";
    first.events[0].tags.push("two");
    const read = await store.read();
    assert.equal(read.events[0].procedure.trigger, "shared state");
    assert.deepEqual(read.events[0].tags, ["one"]);
    read.events.length = 0;
    assert.equal((await store.read()).events.length, 1);
  }
});

test("unsupported values, accessors, cycles and unsafe keys are rejected before storage", async t => {
  const { journal } = fixture(t);
  const cyclic = { type: "cycle" };
  cyclic.self = cyclic;
  let getterCalled = false;
  const accessor = { type: "accessor" };
  Object.defineProperty(accessor, "data", { enumerable: true, get() { getterCalled = true; return 1; } });
  const invalid = [
    null, [], "event", { value: undefined }, { value: NaN }, { value: Infinity }, { value: -0 },
    { value: 1n }, { value: new Date() }, { value: new Map() }, { value: () => 1 },
    { value: [, 1] }, { [Symbol("hidden")]: 1 }, cyclic, accessor,
    JSON.parse('{"__proto__":{"polluted":true}}'), { constructor: "unsafe" },
  ];
  for (const store of [journal, new MemoryJournal()]) {
    for (const event of invalid) await assert.rejects(store.append(null, event), /JOURNAL_REJECTED:/);
    assert.deepEqual(await store.read(), { head: null, events: [] });
  }
  assert.equal(getterCalled, false);
  assert.equal({}.polluted, undefined);
});

test("an existing writer lock blocks both readers and writers without lock stealing", async t => {
  const { journal, directory } = fixture(t);
  await journal.read();
  const lock = join(directory, ".writer.lock");
  const bytes = "abandoned lock: an old timestamp is not a recovery permit\n";
  writeFileSync(lock, bytes, { mode: 0o600, flag: "wx" });
  await assert.rejects(journal.read(), /writer lock present/);
  await assert.rejects(journal.append(null, { type: "reserved" }), /writer lock present/);
  assert.equal(readFileSync(lock, "utf8"), bytes);
  assert.deepEqual(readdirSync(directory), [".writer.lock"]);
});

test("orphaned pending files remain blocked after an operator removes only the lock", async t => {
  const { journal, directory } = fixture(t);
  await journal.read();
  const lock = join(directory, ".writer.lock");
  const pending = join(directory, ".pending-crashed-writer.json");
  writeFileSync(lock, "partial lock", { mode: 0o600 });
  writeFileSync(pending, '{"partial":', { mode: 0o600 });
  await assert.rejects(journal.read(), /writer lock present/);
  unlinkSync(lock); // An incomplete operator recovery must not hide evidence.
  await assert.rejects(journal.read(), /orphaned pending record/);
  await assert.rejects(journal.append(null, { type: "retry" }), /orphaned pending record/);
  assert.equal(readFileSync(pending, "utf8"), '{"partial":');
});

test("modified record bytes and truncated records cannot become valid history", async t => {
  const { journal, directory } = fixture(t);
  await journal.append(null, { type: "settlement", count: 1 });
  const path = firstRecord(directory);
  const bytes = readFileSync(path, "utf8");
  writeFileSync(path, bytes.replace('"count":1', '"count":2'));
  await assert.rejects(journal.read(), /digest mismatch/);
  writeFileSync(path, bytes.slice(0, -8));
  await assert.rejects(journal.read(), /malformed journal record/);
});

test("sequence gaps and unrelated directory contents fail closed", async t => {
  const { journal, directory } = fixture(t);
  const first = await journal.append(null, { type: "first" });
  await journal.append(first.head, { type: "second" });
  unlinkSync(firstRecord(directory));
  await assert.rejects(journal.read(), /sequence gap/);
  writeFileSync(join(directory, "operator-notes.txt"), "not a journal record", { mode: 0o600 });
  await assert.rejects(journal.read(), /sequence gap|unexpected file/);
});

test("removing a final record cannot masquerade as an earlier valid head", async t => {
  const { journal, directory } = fixture(t);
  const first = await journal.append(null, { type: "attempt.reserved", number: 1 });
  await journal.append(first.head, { type: "attempt.reserved", number: 2 });
  unlinkSync(join(directory, "000000000002.json"));
  await assert.rejects(journal.read(), /head checkpoint mismatch/);
  await assert.rejects(journal.append(first.head, { type: "retry" }), /head checkpoint mismatch/);
  unlinkSync(firstRecord(directory));
  await assert.rejects(journal.read(), /head checkpoint exists without records/);
});

test("journal paths must be disjoint from the repository", t => {
  const { root, repositoryRoot } = fixture(t);
  assert.throws(() => new FileJournal({ directory: repositoryRoot, repositoryRoot }), /must be disjoint/);
  assert.throws(() => new FileJournal({ directory: join(repositoryRoot, "state"), repositoryRoot }), /must be disjoint/);
  assert.throws(() => new FileJournal({ directory: root, repositoryRoot }), /must be disjoint/);
  assert.throws(() => new FileJournal({ directory: "relative-state", repositoryRoot }), /absolute/);
});

test("journal refuses symlink ancestors and a symlink replacing a record", async t => {
  const { root, repositoryRoot, journal, directory } = fixture(t);
  const linkedParent = join(root, "linked");
  mkdirSync(join(root, "target"), { mode: 0o700 });
  symlinkSync(join(root, "target"), linkedParent, "dir");
  const unsafe = new FileJournal({ directory: join(linkedParent, "journal"), repositoryRoot });
  await assert.rejects(unsafe.read(), /symlink or non-directory ancestor/);
  assert.deepEqual(readdirSync(join(root, "target")), []);
  await journal.append(null, { type: "original" });
  const external = join(root, "external.json");
  writeFileSync(external, readFileSync(firstRecord(directory)), { mode: 0o600 });
  unlinkSync(firstRecord(directory));
  symlinkSync(external, firstRecord(directory));
  await assert.rejects(journal.read(), /JOURNAL_REJECTED:/);
  assert.equal(lstatSync(firstRecord(directory)).isSymbolicLink(), true);
});

test("unsafe directory and file permissions are rejected without silently changing them", async t => {
  const { journal, directory } = fixture(t);
  await journal.append(null, { type: "original" });
  chmodSync(firstRecord(directory), 0o644);
  await assert.rejects(journal.read(), /permissions/);
  assert.equal(lstatSync(firstRecord(directory)).mode & 0o777, 0o644);
  chmodSync(firstRecord(directory), 0o600);
  chmodSync(directory, 0o755);
  await assert.rejects(journal.read(), /mode 0700/);
  assert.equal(lstatSync(directory).mode & 0o777, 0o755);
});

test("two independent processes cannot both append against the same head", { timeout: 15000 }, async t => {
  const { journal, directory, repositoryRoot } = fixture(t);
  await journal.read();
  const moduleUrl = new URL("../scripts/learning-v2/journal.mjs", import.meta.url).href;
  const script = `
    import { FileJournal } from ${JSON.stringify(moduleUrl)};
    const store = new FileJournal(${JSON.stringify({ directory, repositoryRoot })});
    process.once("message", async () => {
      let outcome;
      try {
        await store.append(null, { type: "attempt.reserved", writer: process.pid });
        outcome = { result: "committed" };
      } catch (error) {
        outcome = { result: "rejected", message: error.message };
      }
      process.send(outcome, () => process.disconnect());
    });
    process.send({ result: "ready" });
  `;
  const children = [];
  t.after(() => { for (const child of children) if (child.exitCode === null) child.kill(); });
  function writer() {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    let readyResolve, outcomeResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });
    const outcome = new Promise(resolve => { outcomeResolve = resolve; });
    let observed;
    child.on("message", message => {
      if (message.result === "ready") readyResolve();
      else observed = message;
    });
    child.on("error", error => {
      readyResolve();
      outcomeResolve({ result: "process_error", message: error.message });
    });
    child.on("exit", code => {
      readyResolve();
      if (code !== 0 || !observed) outcomeResolve({ result: "process_error", message: `writer exited ${code}: ${stderr}` });
      else outcomeResolve(observed);
    });
    return { child, ready, outcome };
  }
  const writers = [writer(), writer()];
  await Promise.all(writers.map(value => value.ready));
  for (const value of writers) if (value.child.connected) value.child.send("append");
  const outcomes = await Promise.all(writers.map(value => value.outcome));
  assert.equal(outcomes.filter(value => value.result === "process_error").length, 0, JSON.stringify(outcomes));
  assert.equal(outcomes.filter(value => value.result === "committed").length, 1);
  assert.equal(outcomes.filter(value => value.result === "rejected").length, 1);
  assert.match(outcomes.find(value => value.result === "rejected").message, /writer lock present|stale expected head/);
  assert.equal((await journal.read()).events.length, 1);
});
