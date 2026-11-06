/** Strict existing-file reads and bounded private transport. No repair/writer. */
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { canonical, copy, hash, integer, record, requireThat } from './contracts.mjs';

export const HISTORY_MAX_BYTES = 32 * 1024 * 1024;
export const HISTORY_CHUNK_BYTES = 8192;
export const bytesSha = value => createHash('sha256').update(value).digest('hex');
export const same = (a, b, why) => requireThat(canonical(a) === canonical(b), why);
export function isoTime(value, label) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, label);
  return value;
}

export function privateDirectory(path, uid = process.getuid?.()) {
  requireThat(Number.isInteger(uid) && typeof path === 'string' && isAbsolute(path) && resolve(path) === path,
    'archive requires an absolute existing POSIX path');
  let current = path;
  while (true) {
    const stat = lstatSync(current);
    requireThat(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(current) === current &&
      (stat.uid === uid || stat.uid === 0) && (!(stat.mode & 0o022) || !!(stat.mode & 0o1000)),
    'archive directory custody changed');
    if (current === path) requireThat(stat.uid === uid && (stat.mode & 0o777) === 0o700,
      'archive leaf requires retained owner and mode 0700');
    if (dirname(current) === current) break;
    current = dirname(current);
  }
}

export function readArchiveFile(path, { uid = process.getuid?.(), maximum = HISTORY_MAX_BYTES } = {}) {
  privateDirectory(dirname(path), uid);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    requireThat(before.isFile() && before.uid === uid && (before.mode & 0o777) === 0o600 &&
      before.nlink === 1 && before.size > 0 && before.size <= maximum, 'archive file custody or bound');
    const bytes = readFileSync(fd), after = fstatSync(fd), named = lstatSync(path);
    requireThat(before.ino === after.ino && before.dev === after.dev && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs && bytes.length === after.size &&
      named.ino === after.ino && named.dev === after.dev && !named.isSymbolicLink() && named.nlink === 1,
    'archive file changed during read');
    return bytes;
  } finally { closeSync(fd); }
}

export function readArchiveJson(path, options) {
  const bytes = readArchiveFile(path, options), value = JSON.parse(bytes.toString('utf8'));
  canonical(value);
  return { bytes, value };
}

export function exactDirectory(path, expected, uid = process.getuid?.()) {
  privateDirectory(path, uid);
  const names = readdirSync(path).sort();
  same(names, [...expected].sort(), 'archive has missing, extra or pending entries');
  return names;
}

/** Immutable files only. Content, path and custody are checked on every call.
 * Journal lock/pending files and unknown subtrees are rejected by the caller's
 * exact grammar, never omitted from an apparently successful inventory. */
export function inventoryTree(root, { uid = process.getuid?.(), allow, maximumFiles = 100_000,
  maximumBytes = 4 * 1024 * 1024 * 1024 } = {}) {
  requireThat(typeof allow === 'function', 'archive inventory grammar required');
  const output = []; let total = 0;
  const walk = (path, relative) => {
    privateDirectory(path, uid);
    const before = readdirSync(path).sort();
    for (const name of before) {
      const next = relative ? relative + '/' + name : name;
      const full = join(path, name), stat = lstatSync(full);
      requireThat(!stat.isSymbolicLink() && allow(next, stat.isDirectory()), 'unexpected archive entry');
      if (stat.isDirectory()) walk(full, next);
      else {
        requireThat(output.length < maximumFiles, 'archive inventory file bound');
        const bytes = readArchiveFile(full, { uid }); total += bytes.length;
        requireThat(total <= maximumBytes, 'archive inventory byte bound');
        output.push({ path: next, bytes: bytes.length, sha256: bytesSha(bytes) });
      }
    }
    same(readdirSync(path).sort(), before, 'archive directory changed during inventory');
  };
  walk(root, '');
  return output;
}

/** A successful export is one ordered capture, including a mandatory end.
 * Encoded output is private control-plane evidence, never an HTTP endpoint. */
export function encodeHistoryChunks(value) {
  const bytes = Buffer.from(canonical(value));
  requireThat(bytes.length > 0 && bytes.length <= HISTORY_MAX_BYTES, 'capsule output bound');
  const sha256 = bytesSha(bytes), count = Math.ceil(bytes.length / HISTORY_CHUNK_BYTES);
  const captureId = 'capture-' + sha256;
  return [
    { schema: 'gk-completed-history-transfer-v1', kind: 'begin', captureId, bytes: bytes.length, sha256, chunks: count },
    ...Array.from({ length: count }, (_, index) => ({ schema: 'gk-completed-history-transfer-v1', kind: 'chunk',
      captureId, index, data: bytes.subarray(index * HISTORY_CHUNK_BYTES, (index + 1) * HISTORY_CHUNK_BYTES).toString('base64') })),
    { schema: 'gk-completed-history-transfer-v1', kind: 'end', captureId, bytes: bytes.length, sha256, chunks: count },
  ];
}

export function decodeHistoryChunks(lines, expectedSha256) {
  hash(expectedSha256, 'externally pinned capsule bytes');
  requireThat(Array.isArray(lines) && lines.length >= 3 && lines.length <= HISTORY_MAX_BYTES / HISTORY_CHUNK_BYTES + 2,
    'capsule transfer count');
  const first = lines[0], last = lines.at(-1);
  for (const item of [first, last]) {
    record(item, ['schema', 'kind', 'captureId', 'bytes', 'sha256', 'chunks'], 'capsule transfer boundary');
    requireThat(item.schema === 'gk-completed-history-transfer-v1', 'capsule transfer schema');
    integer(item.bytes, 'capsule transfer bytes', 1, HISTORY_MAX_BYTES);
    integer(item.chunks, 'capsule transfer chunks', 1, HISTORY_MAX_BYTES / HISTORY_CHUNK_BYTES);
    requireThat(item.sha256 === expectedSha256 && item.captureId === 'capture-' + expectedSha256 &&
      item.chunks === Math.ceil(item.bytes / HISTORY_CHUNK_BYTES), 'capsule transfer identity');
  }
  requireThat(first.kind === 'begin' && last.kind === 'end' && lines.length === first.chunks + 2,
    'capsule missing start, chunk or terminal marker');
  same({ ...first, kind: 'end' }, last, 'capsule terminal marker differs');
  const chunks = lines.slice(1, -1).map((item, index) => {
    record(item, ['schema', 'kind', 'captureId', 'index', 'data'], 'capsule chunk');
    requireThat(item.schema === first.schema && item.kind === 'chunk' && item.captureId === first.captureId &&
      item.index === index && typeof item.data === 'string' && item.data.length <= 10924 &&
      /^[A-Za-z0-9+/]*={0,2}$/u.test(item.data), 'capsule chunk order, identity or encoding');
    const bytes = Buffer.from(item.data, 'base64');
    requireThat(bytes.toString('base64') === item.data && bytes.length === Math.min(HISTORY_CHUNK_BYTES,
      first.bytes - index * HISTORY_CHUNK_BYTES), 'capsule chunk is partial or noncanonical');
    return bytes;
  });
  const bytes = Buffer.concat(chunks);
  requireThat(bytes.length === first.bytes && bytesSha(bytes) === expectedSha256, 'capsule transfer digest');
  const value = JSON.parse(bytes.toString('utf8'));
  requireThat(canonical(value) === bytes.toString('utf8'), 'capsule serialization');
  return { bytes, value: copy(value) };
}
