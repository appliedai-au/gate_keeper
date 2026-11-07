/**
 * Operator-invoked, one-time preparation of an EMPTY dedicated Railway volume.
 * No automatic invocation, TrueForge launch, inference, credentials, or journal
 * creation. The live production Dockerfile is unchanged.
 *
 * This is a narrow ownership transition, NOT evidence that the mounted device
 * belongs to a particular Railway volume ID. The operator must verify that
 * binding separately before running this function.
 */
import { chownSync, chmodSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const JOURNAL_MOUNT = '/var/lib/gk-v2-private-journal';
const OWNER_ONLY = 0o700;
const fsNative = Object.freeze({ chownSync, chmodSync, lstatSync, readFileSync, readdirSync });

function deny(reason) { throw new Error('GK_V2_VOLUME_REFUSED: ' + reason); }

function verifiedAncestor(path, fs) {
  let current = path;
  for (;;) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 ||
        ((stat.mode & 0o022) !== 0)) deny('untrusted mount ancestor');
    if (current === '/') return;
    current = dirname(current);
  }
}

/**
 * A fresh ext4 Railway volume may contain one filesystem-managed lost+found
 * directory. Do not delete or re-own it. It is admissible ONLY when root:root,
 * mode 0700, a true directory (not symlink), and completely empty.
 */
export function assertFreshVolumeRoot(path, fs) {
  if (typeof fs?.lstatSync !== 'function' || typeof fs?.readdirSync !== 'function') {
    deny('invalid volume inventory adapter');
  }
  const entries = fs.readdirSync(path);
  if (!Array.isArray(entries)) deny('invalid mount entries');
  if (entries.length === 0) return;
  if (entries.length !== 1 || entries[0] !== 'lost+found') deny('existing data must never be changed');
  const child = join(path, 'lost+found');
  const item = fs.lstatSync(child);
  if (!item.isDirectory() || item.isSymbolicLink() || item.uid !== 0 ||
      item.gid !== 0 || (item.mode & 0o777) !== 0o700 ||
      fs.readdirSync(child).length !== 0) {
    deny('lost+found is not pristine root-owned filesystem metadata');
  }
}

// Mountpoint is field 5 in Linux /proc/self/mountinfo. Require a complete
// record with its required "-" separator, and EXACTLY one leaf mount.
function exactMount(path, mountinfo) {
  if (typeof mountinfo !== 'string') deny('mount inventory unavailable');
  const entries = mountinfo.split('\n').filter(Boolean).filter(line => {
    const fields = line.trim().split(/\s+/);
    const separator = fields.indexOf('-');
    return separator >= 6 && fields.length >= separator + 4 &&
      fields[4] === path && fields[0] !== '' && fields[3] !== '';
  });
  if (entries.length !== 1) deny('expected exactly one dedicated mount');
}

/**
 * Filesystem injection is only for deterministic, credential-free unit tests.
 * Runtime callers use the exported prepareEmptyJournalMount below, which binds
 * the real Node filesystem functions and reads real Linux mountinfo.
 */
export function createVolumePreparer(fs) {
  for (const name of ['chownSync', 'chmodSync', 'lstatSync', 'readFileSync', 'readdirSync']) {
    if (typeof fs?.[name] !== 'function') deny('invalid filesystem adapter');
  }
  return function prepare({
    path = JOURNAL_MOUNT,
    identityUid = 1000,
    identityGid = 1000,
    currentUid = process.getuid?.(),
    mountinfo,
  } = {}) {
    if (path !== JOURNAL_MOUNT || !isAbsolute(path) || resolve(path) !== path) deny('mount path not pinned');
    if (currentUid !== 0) deny('operator preparation requires root');
    if (identityUid !== 1000 || identityGid !== 1000) deny('unqualified node identity');
    // Do not read /proc or inspect host directories before cheap denials.
    mountinfo ??= fs.readFileSync('/proc/self/mountinfo', 'utf8');
    exactMount(path, mountinfo);
    verifiedAncestor(dirname(path), fs);
    const stat = fs.lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 ||
        stat.gid !== 0 || ((stat.mode & 0o022) !== 0)) {
      deny('volume is not an untouched root-owned directory');
    }
    assertFreshVolumeRoot(path, fs);
    // Only the mount root changes, never its children or parents.
    fs.chownSync(path, identityUid, identityGid);
    fs.chmodSync(path, OWNER_ONLY);
    const after = fs.lstatSync(path);
    if (!after.isDirectory() || after.isSymbolicLink() ||
        after.uid !== identityUid || after.gid !== identityGid ||
        (after.mode & 0o777) !== OWNER_ONLY) deny('postcondition mismatch');
    return Object.freeze({ prepared: true, path, uid: identityUid, gid: identityGid, mode: '0700' });
  };
}

export const prepareEmptyJournalMount = createVolumePreparer(fsNative);
