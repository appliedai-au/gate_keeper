/** Atomic, no-clobber publication of the two private commissioning files.
 * Staging files are not journals. A crash before publication leaves only an
 * unreferenced private staging file; a crash after link publication is repaired
 * by removing only matching staging hard links, never by rewriting the final. */
import * as nodeFs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { canonical, requireThat } from './contracts.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
const FILES = new Set(['production-config.json', 'status-config.json',
  'implementation-qualification.json', 'baseline-continuation-authorization.json']);

function context(path, { directory, uid = 1000, fs = nodeFs } = {}) {
  requireThat(typeof directory === 'string' && resolve(directory) === directory &&
    dirname(path) === directory && FILES.has(basename(path)), 'private publication path');
  const parent = fs.lstatSync(directory);
  requireThat(parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === uid &&
    (parent.mode & 0o777) === 0o700 && fs.realpathSync(directory) === directory,
  'private publication directory integrity');
  return { directory, uid, fs, prefix: `.gk-publish-${basename(path)}-` };
}

function syncDirectory({ directory, fs }) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function unlinkOwned(path, fs) {
  try { fs.unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export function readPrivatePublishedJson(path, options) {
  const ctx = context(path, options), { fs, uid, directory, prefix } = ctx;
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    requireThat(before.isFile() && before.uid === uid && (before.mode & 0o777) === 0o600 &&
      before.nlink >= 1 && before.nlink <= 2 && before.size > 0 && before.size <= MAX_BYTES,
    'private publication file integrity');
    const bytes = fs.readFileSync(fd, 'utf8'), value = JSON.parse(bytes);
    canonical(value);
    const after = fs.fstatSync(fd);
    requireThat(before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
      before.mtimeMs === after.mtimeMs, 'private publication changed during read');
    if (after.nlink > 1) {
      const candidates = fs.readdirSync(directory).filter(name => name.startsWith(prefix));
      requireThat(candidates.length <= 256, 'private publication staging inventory');
      const links = [];
      for (const name of candidates) {
        requireThat(/^[0-9a-f-]{36}$/u.test(name.slice(prefix.length)), 'unknown private publication staging name');
        const staged = join(directory, name);
        let info;
        try { info = fs.lstatSync(staged); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        if (info.dev !== after.dev || info.ino !== after.ino) continue;
        requireThat(info.isFile() && !info.isSymbolicLink() && info.uid === uid &&
          (info.mode & 0o777) === 0o600, 'private publication staging integrity');
        links.push(staged);
      }
      const current = fs.fstatSync(fd);
      requireThat(current.nlink === 1 || links.length === current.nlink - 1, 'unknown hard link on private publication');
      for (const staged of links) unlinkOwned(staged, fs);
      requireThat(fs.fstatSync(fd).nlink === 1, 'private publication staging cleanup incomplete');
      syncDirectory(ctx);
    }
    return value;
  } finally { fs.closeSync(fd); }
}

export function publishPrivateJsonOnce(path, value, options) {
  const ctx = context(path, options), { fs, directory, prefix } = ctx;
  const expected = canonical(value), serialized = JSON.stringify(value) + '\n';
  requireThat(Buffer.byteLength(serialized) <= MAX_BYTES, 'private publication size');
  try {
    const existing = readPrivatePublishedJson(path, options);
    requireThat(canonical(existing) === expected, 'existing private publication differs; replacement forbidden');
    return;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const staged = join(directory, prefix + randomUUID());
  const fd = fs.openSync(staged, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, serialized, 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { fs.linkSync(staged, path); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error; // Ambiguous publication is inspected on the next explicit open.
    requireThat(canonical(readPrivatePublishedJson(path, options)) === expected,
      'existing private publication differs; replacement forbidden');
  }
  syncDirectory(ctx);
  unlinkOwned(staged, fs);
  syncDirectory(ctx);
}
