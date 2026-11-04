/**
 * Append-only, compare-and-swap storage for the learning controller.
 *
 * FileJournal requires a dedicated POSIX directory on a filesystem with local
 * exclusive-create, hard-link and fsync semantics. It is not a distributed lock
 * or an authenticity boundary against a malicious process with the same UID.
 * An operator must investigate an abandoned lock/pending record; this module
 * never steals a lock, expires one, repairs evidence, or retries a write.
 *
 * Every record is canonical JSON, hash-linked to its predecessor. A complete
 * temporary file is fsynced, linked into its final create-only name, and the
 * directory and head checkpoint are fsynced before the write can succeed. The
 * checkpoint detects a missing tail record; it is not an external rollback
 * witness if someone replaces the entire directory with an earlier copy.
 * Readers take the same short exclusive lock, so they cannot observe a
 * publication in progress.
 * No timestamp is included in the record hash; event time belongs to the
 * controller's event payload. Lock timestamps are diagnostic, not leases.
 *
 * Records may contain bounded controller snapshots, so the per-record ceiling
 * is 32 MiB. Repeated snapshots retain their full bytes: provision/monitor the
 * private volume for the complete experiment, including one temporary record
 * during publication. This journal never deletes or compacts old evidence.
 */
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync,
  mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync,
  unlinkSync, writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

const RECORD_SCHEMA = "gk-learning-v2-journal-record-v1";
const LOCK_SCHEMA = "gk-learning-v2-journal-lock-v1";
const LOCK_NAME = ".writer.lock";
const HEAD_SCHEMA = "gk-learning-v2-journal-head-v1";
const HEAD_NAME = ".head.json";
const RECORD_NAME = /^[0-9]{12}\.json$/;
const HEAD = /^[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 32 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_SEQUENCE = 999999999999;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function reject(message, cause) {
  throw new Error(`JOURNAL_REJECTED: ${message}`, cause ? { cause } : undefined);
}

/** Reject accessors and exotic values before reading a caller's properties. */
function canonical(value, ancestors = new Set(), depth = 0) {
  if (depth > MAX_DEPTH) reject("JSON nesting exceeds limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) reject("non-canonical number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") reject("unsupported JSON value");
  if (ancestors.has(value)) reject("cyclic JSON value");
  if (Object.getOwnPropertySymbols(value).length) reject("symbol property");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) reject("non-plain array");
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== value.length + 1) reject("sparse or extended array");
      const items = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          reject("sparse array or accessor");
        }
        items.push(canonical(descriptor.value, ancestors, depth + 1));
      }
      return `[${items.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) reject("non-plain object");
    const entries = [];
    for (const key of Object.getOwnPropertyNames(value).sort()) {
      if (FORBIDDEN_KEYS.has(key)) reject("unsafe object key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !("value" in descriptor)) reject("hidden property or accessor");
      entries.push(`${JSON.stringify(key)}:${canonical(descriptor.value, ancestors, depth + 1)}`);
    }
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function copyEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) reject("event must be an object");
  const bytes = canonical(event);
  if (Buffer.byteLength(bytes, "utf8") > MAX_RECORD_BYTES - 1024) reject("event exceeds size limit");
  return JSON.parse(bytes);
}

function expectedHead(value) {
  if (value !== null && (typeof value !== "string" || !HEAD.test(value))) reject("invalid expected head");
}

function recordFor(sequence, previousHead, event) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) reject("sequence limit");
  const body = { schema: RECORD_SCHEMA, sequence, previousHead, event };
  return { ...body, hash: digest(body) };
}

function snapshot(records) {
  return {
    head: records.length ? records[records.length - 1].hash : null,
    events: records.map(record => copyEvent(record.event)),
  };
}

function contains(parent, child) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function currentUid() {
  if (typeof process.getuid !== "function" || constants.O_NOFOLLOW === undefined ||
      constants.O_DIRECTORY === undefined) reject("POSIX ownership and no-follow support required");
  return process.getuid();
}

function syncDirectoryEntry(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Walk before creating each component; never mkdir recursively through a link. */
function directoryPath(path, { create = false, privateLeaf = false } = {}) {
  const uid = currentUid();
  let current = parse(path).root;
  for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    let stat;
    let created = false;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (!create || error.code !== "ENOENT") throw error;
      try {
        mkdirSync(current, { mode: 0o700 });
        created = true;
      } catch (creationError) {
        // Another journal may have created this parent; inspect it as usual.
        if (creationError.code !== "EEXIST") throw creationError;
      }
      stat = lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) reject("symlink or non-directory ancestor");
    if (stat.uid !== uid && stat.uid !== 0) reject("untrusted directory owner");
    // A sticky system temporary directory is permitted. A writable ancestor
    // without the sticky bit allows other UIDs to replace the next component.
    if ((stat.mode & 0o022) && !(stat.mode & 0o1000)) reject("untrusted writable ancestor");
    if (current === path && privateLeaf && (stat.uid !== uid || (stat.mode & 0o777) !== 0o700)) {
      reject("journal directory must be owned by this user with mode 0700");
    }
    if (created) {
      // Fsyncing files inside a new directory does not, by itself, make its
      // entry in its parent durable across a machine/filesystem crash.
      syncDirectoryEntry(current);
      syncDirectoryEntry(dirname(current));
    }
  }
  return realpathSync(path);
}

function privateFile(fd, maximumBytes = MAX_RECORD_BYTES) {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.uid !== currentUid() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1) {
    reject("journal file ownership, permissions, type or link count");
  }
  if (stat.size > maximumBytes) reject("journal file exceeds size limit");
}

function readPrivateFile(path, maximumBytes = MAX_RECORD_BYTES) {
  // NONBLOCK also prevents a corrupt FIFO at a record path from hanging before
  // fstat can reject its type. Regular-file reads retain their normal behavior.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    privateFile(fd, maximumBytes);
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** A deterministic in-memory implementation of the same storage contract. */
export class MemoryJournal {
  #records = [];

  async read() {
    return snapshot(this.#records);
  }

  async append(head, event) {
    expectedHead(head);
    const current = this.#records.length ? this.#records[this.#records.length - 1].hash : null;
    if (head !== current) reject("stale expected head");
    const record = recordFor(this.#records.length + 1, current, copyEvent(event));
    this.#records.push(record);
    return snapshot(this.#records);
  }
}

export class FileJournal {
  #directory;
  #repositoryRoot;

  constructor({ directory, repositoryRoot } = {}) {
    if (typeof directory !== "string" || !isAbsolute(directory) ||
        typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot)) {
      reject("absolute journal and repository paths required");
    }
    this.#directory = resolve(directory);
    this.#repositoryRoot = resolve(repositoryRoot);
    if (contains(this.#repositoryRoot, this.#directory) || contains(this.#directory, this.#repositoryRoot)) {
      reject("journal and repository directories must be disjoint");
    }
  }

  #prepare() {
    const repository = directoryPath(this.#repositoryRoot);
    const directory = directoryPath(this.#directory, { create: true, privateLeaf: true });
    if (contains(repository, directory) || contains(directory, repository)) reject("canonical repository containment");
  }

  #syncDirectory() {
    const fd = openSync(this.#directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isDirectory() || stat.uid !== currentUid() || (stat.mode & 0o777) !== 0o700) {
        reject("journal directory changed");
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  #acquire() {
    this.#prepare();
    const bytes = canonical({
      schema: LOCK_SCHEMA, token: randomUUID(), pid: process.pid,
      createdAt: new Date().toISOString(),
    }) + "\n";
    let fd;
    try {
      fd = openSync(join(this.#directory, LOCK_NAME),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      if (error.code === "EEXIST") reject("writer lock present; recovery or another writer must finish", error);
      throw error;
    }
    try {
      privateFile(fd, 2048);
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // Any failure after exclusive creation leaves the lock in place. A lock
    // age or PID is never sufficient authority to delete it.
    this.#syncDirectory();
    return bytes;
  }

  #release(lockBytes) {
    try {
      const path = join(this.#directory, LOCK_NAME);
      if (readPrivateFile(path, 2048) !== lockBytes) reject("writer lock changed");
      unlinkSync(path);
      // The evidence was already fsynced. Deliberately do not require a durable
      // unlock: after a machine crash, a resurrected lock is safer than retrying
      // an outcome that the caller may not have received.
    } catch (error) {
      if (error.message?.startsWith("JOURNAL_REJECTED:")) throw error;
      reject("lock release failed; operator recovery required", error);
    }
  }

  #readLocked() {
    const entries = readdirSync(this.#directory);
    const hasHead = entries.includes(HEAD_NAME);
    const names = entries.filter(name => name !== LOCK_NAME && name !== HEAD_NAME).sort();
    const records = [];
    let previousHead = null;
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      if (!RECORD_NAME.test(name)) reject("unexpected file or orphaned pending record requires recovery");
      if (name !== `${String(index + 1).padStart(12, "0")}.json`) reject("journal sequence gap");
      const bytes = readPrivateFile(join(this.#directory, name));
      let record;
      try {
        record = JSON.parse(bytes);
      } catch (error) {
        reject("malformed journal record", error);
      }
      if (!record || typeof record !== "object" || Array.isArray(record) ||
          Object.keys(record).sort().join(",") !== "event,hash,previousHead,schema,sequence" ||
          record.schema !== RECORD_SCHEMA || record.sequence !== index + 1 ||
          record.previousHead !== previousHead || typeof record.hash !== "string" || !HEAD.test(record.hash)) {
        reject("journal record schema or lineage mismatch");
      }
      const event = copyEvent(record.event);
      const expected = recordFor(index + 1, previousHead, event);
      if (record.hash !== expected.hash) reject("journal digest mismatch");
      if (bytes !== canonical(expected) + "\n") reject("non-canonical journal encoding");
      records.push(expected);
      previousHead = expected.hash;
    }
    if (records.length) {
      if (!hasHead) reject("head checkpoint missing");
      const expected = { schema: HEAD_SCHEMA, sequence: records.length, hash: previousHead };
      if (readPrivateFile(join(this.#directory, HEAD_NAME), 2048) !== canonical(expected) + "\n") {
        reject("head checkpoint mismatch; missing tail or altered checkpoint");
      }
    } else if (hasHead) {
      reject("head checkpoint exists without records");
    }
    return records;
  }

  #writeHead(record) {
    const temporary = join(this.#directory, `.pending-head-${randomUUID()}.json`);
    const bytes = canonical({ schema: HEAD_SCHEMA, sequence: record.sequence, hash: record.hash }) + "\n";
    const fd = openSync(temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      privateFile(fd, 2048);
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // Only this derived checkpoint is replaced. Evidence records are always
    // linked into a never-before-used, sequence-numbered destination.
    renameSync(temporary, join(this.#directory, HEAD_NAME));
    this.#syncDirectory();
  }

  async read() {
    let lockBytes;
    try {
      lockBytes = this.#acquire();
      return snapshot(this.#readLocked());
    } catch (error) {
      if (error.message?.startsWith("JOURNAL_REJECTED:")) throw error;
      reject("read failed", error);
    } finally {
      if (lockBytes !== undefined) this.#release(lockBytes);
    }
  }

  async append(head, event) {
    expectedHead(head);
    const copied = copyEvent(event);
    let lockBytes;
    let retainLock = false;
    try {
      lockBytes = this.#acquire();
      const records = this.#readLocked();
      const current = records.length ? records[records.length - 1].hash : null;
      if (head !== current) reject("stale expected head");
      const record = recordFor(records.length + 1, current, copied);
      const bytes = canonical(record) + "\n";
      if (Buffer.byteLength(bytes, "utf8") > MAX_RECORD_BYTES) reject("record exceeds size limit");
      const temporary = join(this.#directory, `.pending-${randomUUID()}.json`);
      const destination = join(this.#directory, `${String(record.sequence).padStart(12, "0")}.json`);
      // Once disk publication begins, an error has an uncertain outcome. Keep
      // both the lock and evidence for an operator; never retry automatically.
      retainLock = true;
      const fd = openSync(temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        privateFile(fd);
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      linkSync(temporary, destination);
      this.#syncDirectory();
      unlinkSync(temporary);
      this.#syncDirectory();
      this.#writeHead(record);
      records.push(record);
      const result = snapshot(records);
      retainLock = false;
      return result;
    } catch (error) {
      if (error.message?.startsWith("JOURNAL_REJECTED:")) throw error;
      reject(retainLock ? "write outcome uncertain; operator recovery required" : "append failed", error);
    } finally {
      if (lockBytes !== undefined && !retainLock) this.#release(lockBytes);
    }
  }
}
