/**
 * One-time, operator-invoked preparation of an EMPTY dedicated Railway volume.
 * This is NOT a TrueForge entrypoint. No model, SDK, keys or journal writes.
 * The production Dockerfile and service are unchanged by this module.
 *
 * Must run as root in a separately qualified isolated startup environment,
 * with the exact volume mounted at the fixed path. Never recursively chown,
 * never repair an existing journal and never treat an ordinary image directory
 * as a mounted volume.
 */
import { chownSync, chmodSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export const JOURNAL_MOUNT = '/var/lib/gk-v2-private-journal';
const OCTAL_OWNER_ONLY = 0o700;

function deny(reason) { throw new Error('GK_V2_VOLUME_REFUSED: ' + reason); }

function verifiedAncestor(path) {
  let current = path;
  for (;;) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 ||
        ((stat.mode & 0o022) !== 0)) deny('untrusted mount ancestor');
    if (current === '/') break;
    current = dirname(current);
  }
}

// Linux mountinfo escapes whitespace in paths; do not accept those in our
// fixed path. Require exactly one mount at the leaf, not a parent-only mount.
function exactMount(path, mountinfo) {
  const entries = mountinfo.split('\n').filter(Boolean).filter(line => {
    const words = line.split(' ');
    return words.length >= 10 && words[4] === path && words.includes('-');
  });
  if (entries.length !== 1) deny('expected exactly one dedicated mount');
}

/**
 * Refuse every ambiguous filesystem or identity. This code must never be
 * invoked on an established journal; existing evidence needs owner review.
 * identityUid/Gid are the pinned non-root UID/GID from the qualified image.
 */
export function prepareEmptyJournalMount({
  path = JOURNAL_MOUNT,
  identityUid = 1000,
  identityGid = 1000,
  currentUid = process.getuid?.(),
  mountinfo = readFileSync('/proc/self/mountinfo', 'utf8'),
} = {}) {
  if (path !== JOURNAL_MOUNT || !isAbsolute(path) || resolve(path) !== path) deny('mount path not pinned');
  if (currentUid !== 0) deny('operator preparation requires root');
  if (identityUid !== 1000 || identityGid !== 1000) deny('unqualified node identity');
  verifiedAncestor(dirname(path));
  exactMount(path, mountinfo);
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 ||
      stat.gid !== 0 || ((stat.mode & 0o022) !== 0)) {
    deny('volume is not an untouched root-owned directory');
  }
  if (readdirSync(path).length !== 0) deny('existing data must never be changed');
  // Only the mount root is changed, never its contents or a parent.
  chownSync(path, identityUid, identityGid);
  chmodSync(path, OCTAL_OWNER_ONLY);
  const after = lstatSync(path);
  if (!after.isDirectory() || after.isSymbolicLink() ||
      after.uid !== identityUid || after.gid !== identityGid ||
      (after.mode & 0o777) !== OCTAL_OWNER_ONLY) deny('postcondition mismatch');
  return Object.freeze({ prepared: true, path, uid: identityUid, gid: identityGid, mode: '0700' });
}
