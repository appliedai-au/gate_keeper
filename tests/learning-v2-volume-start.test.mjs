import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVolumeStartup } from '../scripts/learning-v2/volume-start.mjs';

const mount = '/var/lib/gk-v2-private-journal';
const mounted = '40 30 0:2 / ' + mount + ' rw - ext4 /dev/x rw';
const root = { uid: 0, gid: 0, mode: 0o40755, isDirectory: () => true, isSymbolicLink: () => false };
const ready = { ...root, uid: 1000, gid: 1000, mode: 0o40700 };
const badLink = { ...root, isDirectory: () => false, isSymbolicLink: () => true };
function fixture({ leaf = root, contents = [], mountinfo = mounted, ancestor = root } = {}) {
  const calls = [];
  let current = leaf;
  const startup = createVolumeStartup({
    stat: path => path === mount ? current : ancestor,
    list: () => contents,
    read: () => mountinfo,
    prepare: () => { calls.push('prepare'); current = ready; },
  });
  const invoke = (overrides = {}) => startup({
    currentUid: 0,
    environment: { GK_V2_HOST_BOOTSTRAP: 'enabled' },
    ...overrides,
  });
  return { invoke, calls };
}
test('empty root-owned exact mount prepares once', () => {
  const f = fixture();
  assert.equal(f.invoke().prepared, true);
  assert.deepEqual(f.calls, ['prepare']);
});
test('already prepared node-owned private mount needs no mutation', () => {
  const f = fixture({ leaf: ready, contents: ['controller', 'dispatch'] });
  assert.equal(f.invoke().prepared, false);
  assert.deepEqual(f.calls, []);
});
test('no flag, wrong UID, missing or duplicate mount refuse before mutation', () => {
  const cases = [
    { environment: {} }, { currentUid: 1000 }, { mountinfo: '' },
    { mountinfo: mounted + '\n' + mounted },
  ];
  for (const args of cases) {
    const f = fixture();
    assert.throws(() => f.invoke(args), /GK_V2_STARTUP_REFUSED/);
    assert.deepEqual(f.calls, []);
  }
});
test('unsafe leaf, ancestor, and root-owned nonempty evidence refuse', () => {
  for (const opt of [{ leaf: badLink }, { ancestor: badLink },
    { contents: ['controller'] }, { leaf: { ...root, uid: 2000 } }]) {
    const f = fixture(opt);
    assert.throws(() => f.invoke(), /GK_V2_STARTUP_REFUSED/);
    assert.deepEqual(f.calls, []);
  }
});
test('opt-in image leaves normal production startup unchanged', () => {
  const ordinary = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  const host = readFileSync(new URL('../Dockerfile.v2-host', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../scripts/learning-v2/start-v2-host.sh', import.meta.url), 'utf8');
  assert.match(ordinary, /^USER node$/m);
  assert.doesNotMatch(ordinary, /volume-start|start-v2-host/);
  assert.match(host, /^USER root$/m);
  assert.match(host, /start-v2-host\.sh/);
  assert.match(shell, /exec setpriv --reuid=1000 --regid=1000 --clear-groups/);
});
