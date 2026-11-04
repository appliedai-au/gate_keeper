import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareEmptyJournalMount, JOURNAL_MOUNT } from '../scripts/learning-v2/volume-bootstrap.mjs';

test('volume bootstrap requires a real exact mount even with root caller', () => {
  assert.throws(() => prepareEmptyJournalMount({ currentUid: 0, mountinfo: '' }),
    /GK_V2_VOLUME_REFUSED: expected exactly one dedicated mount/);
});

test('volume bootstrap refuses non-root caller before any mutation', () => {
  assert.throws(() => prepareEmptyJournalMount({ currentUid: 1000, mountinfo: '' }),
    /GK_V2_VOLUME_REFUSED: operator preparation requires root/);
});

test('volume bootstrap refuses any path substitution', () => {
  assert.throws(() => prepareEmptyJournalMount({ path: '/tmp', currentUid: 0 }),
    /GK_V2_VOLUME_REFUSED: mount path not pinned/);
});

test('volume bootstrap pins node identity', () => {
  assert.throws(() => prepareEmptyJournalMount({ currentUid: 0, identityUid: 2000, mountinfo: '' }),
    /GK_V2_VOLUME_REFUSED: unqualified node identity/);
});

test('ordinary TrueForge production Dockerfile remains non-root and does not run bootstrap', () => {
  const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /^USER node$/m);
  assert.match(docker, /^CMD \["node", "node_modules\/\@truefoundry\/trueforge\/dist\/main\.js"\]$/m);
  assert.doesNotMatch(docker, /volume-bootstrap|GK_V2_VOLUME_PREPARE/);
});
