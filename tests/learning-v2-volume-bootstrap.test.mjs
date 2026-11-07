import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVolumePreparer, JOURNAL_MOUNT } from '../scripts/learning-v2/volume-bootstrap.mjs';

const leaf = '41 30 0:34 / ' + JOURNAL_MOUNT + ' rw,relatime - ext4 /dev/volume rw';
const parentOnly = '42 30 0:35 / /var/lib rw,relatime - ext4 /dev/volume rw';
const stat = (uid = 0, gid = 0, mode = 0o40755, directory = true, symlink = false) =>
  ({ uid, gid, mode, isDirectory: () => directory, isSymbolicLink: () => symlink });

function fixture({ names = [], ancestor = stat(), initial = stat(), after = stat(1000, 1000, 0o40700),
    mount = leaf, postcondition = true, lostFound = stat(0, 0, 0o40700), lostContents = [] } = {}) {
  const writes = [];
  let changed = false;
  const fs = {
    readFileSync: () => mount,
    lstatSync: path => path.endsWith('/lost+found') ? lostFound :
      path === JOURNAL_MOUNT ? (changed && postcondition ? after : initial) : ancestor,
    readdirSync: path => path.endsWith('/lost+found') ? lostContents : names,
    chownSync: (...args) => { writes.push(['chown', ...args]); changed = true; },
    chmodSync: (...args) => writes.push(['chmod', ...args]),
  };
  return { prepare: createVolumePreparer(fs), writes };
}

const run = (prepare, args = {}) => prepare({ currentUid: 0, ...args });

test('exact leaf mount succeeds and changes only empty mount root', () => {
  const { prepare, writes } = fixture();
  assert.deepEqual(run(prepare), {
    prepared: true, path: JOURNAL_MOUNT, uid: 1000, gid: 1000, mode: '0700',
  });
  assert.deepEqual(writes, [['chown', JOURNAL_MOUNT, 1000, 1000],
    ['chmod', JOURNAL_MOUNT, 0o700]]);
});

test('parent-only, absent, incomplete or duplicate mount fails without writes', () => {
  for (const mount of ['', parentOnly, leaf + '\n' + leaf, '40 29 0:34 / ' + JOURNAL_MOUNT]) {
    const { prepare, writes } = fixture({ mount });
    assert.throws(() => run(prepare), /expected exactly one dedicated mount/);
    assert.deepEqual(writes, []);
  }
});

test('volume root must be a safe root-owned directory', () => {
  for (const initial of [stat(1000), stat(0, 12), stat(0, 0, 0o40777),
    stat(0, 0, 0o100644, false), stat(0, 0, 0o120777, false, true)]) {
    const { prepare, writes } = fixture({ initial });
    assert.throws(() => run(prepare), /untouched root-owned directory/);
    assert.deepEqual(writes, []);
  }
});

test('ancestor must be trusted and existing data is never reowned', () => {
  for (const opts of [{ ancestor: stat(2000) }, { ancestor: stat(0, 0, 0o40777) },
    { ancestor: stat(0, 0, 0o120777, false, true) }, { names: ['controller'] }]) {
    const { prepare, writes } = fixture(opts);
    assert.throws(() => run(prepare), /untrusted mount ancestor|existing data/);
    assert.deepEqual(writes, []);
  }
});


test('pristine ext4 lost+found is accepted but is never modified', () => {
  const { prepare, writes } = fixture({ names: ['lost+found'] });
  assert.equal(run(prepare).prepared, true);
  assert.deepEqual(writes, [['chown', JOURNAL_MOUNT, 1000, 1000],
    ['chmod', JOURNAL_MOUNT, 0o700]]);
});

test('only exact empty, root-owned 0700 lost+found is admissible', () => {
  const cases = [
    { names: ['lost+found', 'controller'] },
    { names: ['lost+found'], lostFound: stat(0, 0, 0o40755) },
    { names: ['lost+found'], lostFound: stat(1000, 1000, 0o40700) },
    { names: ['lost+found'], lostFound: stat(0, 0, 0o120777, false, true) },
    { names: ['lost+found'], lostContents: ['old-data'] },
  ];
  for (const opts of cases) {
    const { prepare, writes } = fixture(opts);
    assert.throws(() => run(prepare), /JOURNAL|VOLUME_REFUSED/);
    assert.deepEqual(writes, []);
  }
});

test('unexpected postcondition refuses completion', () => {
  const { prepare, writes } = fixture({ postcondition: false });
  assert.throws(() => run(prepare), /postcondition mismatch/);
  assert.equal(writes.length, 2);
});

test('argument refusals never access real host filesystem', () => {
  const { prepare, writes } = fixture();
  assert.throws(() => prepare({ path: '/tmp', currentUid: 0 }), /mount path not pinned/);
  assert.throws(() => prepare({ currentUid: 1000 }), /requires root/);
  assert.throws(() => prepare({ currentUid: 0, identityUid: 2000 }), /unqualified node identity/);
  assert.deepEqual(writes, []);
});

test('production Dockerfile remains inert and non-root', () => {
  const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /^USER node$/m);
  assert.match(docker, /^CMD \["node", "node_modules\/\@truefoundry\/trueforge\/dist\/main\.js"\]$/m);
  assert.doesNotMatch(docker, /volume-bootstrap|GK_V2_VOLUME_PREPARE/);
});
