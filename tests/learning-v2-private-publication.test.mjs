import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishPrivateJsonOnce, readPrivatePublishedJson } from '../scripts/learning-v2/private-publication.mjs';

// Filesystem crash-window regressions for the isolated remote qualification.
// Values and directories below are synthetic and contain no live credentials.
function fixture(t) {
  const directory = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'gk-private-publication-'));
  fs.chmodSync(directory, 0o700); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'status-config.json'), options = { directory, uid: process.getuid() };
  const journal = join(directory, 'existing-journal-canary'); fs.writeFileSync(journal, 'IMMUTABLE_OLD_JOURNAL', { mode: 0o600 });
  return { directory, path, options, journal, value: { schema: 'fixture-config', binding: 'fixture-source', token: 'fixture-only' } };
}

test('a partial staging write never exposes a final config and an explicit restart publishes clean bytes', t => {
  const f = fixture(t);
  const injected = { ...fs, writeFileSync(fd) {
    fs.writeFileSync(fd, '{"partial":', 'utf8');
    throw Object.assign(new Error('fixture volume full'), { code: 'ENOSPC' });
  } };
  assert.throws(() => publishPrivateJsonOnce(f.path, f.value, { ...f.options, fs: injected }), /fixture volume full/);
  assert.equal(fs.existsSync(f.path), false);
  assert.equal(fs.readdirSync(f.directory).filter(name => name.startsWith('.gk-publish-')).length, 1);
  publishPrivateJsonOnce(f.path, f.value, f.options);
  assert.deepEqual(readPrivatePublishedJson(f.path, f.options), f.value);
  assert.equal(fs.lstatSync(f.path).nlink, 1);
  assert.equal(fs.readFileSync(f.journal, 'utf8'), 'IMMUTABLE_OLD_JOURNAL');
});

test('a lost acknowledgement after hard-link publication is recovered without replacing final bytes or the journal', t => {
  const f = fixture(t);
  const injected = { ...fs, linkSync(from, to) {
    fs.linkSync(from, to); throw Object.assign(new Error('fixture process terminated after link'), { code: 'EIO' });
  } };
  assert.throws(() => publishPrivateJsonOnce(f.path, f.value, { ...f.options, fs: injected }), /terminated after link/);
  const before = fs.lstatSync(f.path), bytes = fs.readFileSync(f.path, 'utf8');
  assert.equal(before.nlink, 2);
  publishPrivateJsonOnce(f.path, f.value, f.options);
  const after = fs.lstatSync(f.path);
  assert.equal(after.ino, before.ino); assert.equal(after.nlink, 1);
  assert.equal(fs.readFileSync(f.path, 'utf8'), bytes);
  assert.equal(fs.readFileSync(f.journal, 'utf8'), 'IMMUTABLE_OLD_JOURNAL');
  assert.equal(fs.readdirSync(f.directory).filter(name => name.startsWith('.gk-publish-')).length, 0);
});

test('different existing configuration and foreign hard links are refused without mutation', t => {
  const f = fixture(t); publishPrivateJsonOnce(f.path, f.value, f.options);
  const bytes = fs.readFileSync(f.path, 'utf8');
  assert.throws(() => publishPrivateJsonOnce(f.path, { ...f.value, binding: 'different' }, f.options), /replacement forbidden/);
  assert.equal(fs.readFileSync(f.path, 'utf8'), bytes);
  const foreign = join(f.directory, 'unrelated-private-link'); fs.linkSync(f.path, foreign);
  assert.throws(() => readPrivatePublishedJson(f.path, f.options), /unknown hard link/);
  assert.equal(fs.existsSync(foreign), true); assert.equal(fs.readFileSync(f.path, 'utf8'), bytes);
  assert.equal(fs.readFileSync(f.journal, 'utf8'), 'IMMUTABLE_OLD_JOURNAL');
});
