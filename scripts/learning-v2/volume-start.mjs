/**
 * Root-only bootstrap preflight for an opt-in, isolated v2 TrueForge host.
 * Never starts a model or creates journal records. May prepare only a pristine
 * dedicated volume or verify a previously prepared mount without mutation.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { JOURNAL_MOUNT, prepareEmptyJournalMount } from './volume-bootstrap.mjs';

const uid = 1000, gid = 1000, mode = 0o700;
function refuse(message) { throw new Error('GK_V2_STARTUP_REFUSED: ' + message); }

export function createVolumeStartup({ stat = lstatSync, list = readdirSync,
  read = readFileSync, prepare = prepareEmptyJournalMount } = {}) {
  return function verify({ currentUid = process.getuid?.(),
    mountinfo, environment = process.env } = {}) {
    if (environment?.GK_V2_HOST_BOOTSTRAP !== 'enabled') refuse('explicit isolated host flag absent');
    if (currentUid !== 0) refuse('root startup identity required');
    const data = mountinfo ?? read('/proc/self/mountinfo', 'utf8');
    if (typeof data !== 'string') refuse('mount inventory absent');
    const mountLines = data.split('\n').filter(Boolean).filter(line => {
      const fields = line.trim().split(/\s+/);
      const at = fields.indexOf('-');
      return at >= 6 && fields.length >= at + 4 && fields[4] === JOURNAL_MOUNT;
    });
    if (mountLines.length !== 1) refuse('exact dedicated leaf mount missing or ambiguous');
    let ancestor = dirname(JOURNAL_MOUNT);
    while (true) {
      const a = stat(ancestor);
      if (!a.isDirectory() || a.isSymbolicLink() || a.uid !== 0 || (a.mode & 0o022)) {
        refuse('untrusted ancestor');
      }
      if (ancestor === '/') break;
      ancestor = dirname(ancestor);
    }
    const leaf = stat(JOURNAL_MOUNT);
    if (!leaf.isDirectory() || leaf.isSymbolicLink()) refuse('leaf is not a directory');
    if (leaf.uid === uid && leaf.gid === gid && (leaf.mode & 0o777) === mode) {
      // Do not touch or enumerate previously initialized private journal data.
      return Object.freeze({ ready: true, prepared: false, path: JOURNAL_MOUNT });
    }
    if (leaf.uid !== 0 || leaf.gid !== 0 || (leaf.mode & 0o022)) refuse('unknown mount owner or permissions');
    if (list(JOURNAL_MOUNT).length !== 0) refuse('root-owned volume contains existing evidence');
    prepare({ currentUid: 0, path: JOURNAL_MOUNT, identityUid: uid, identityGid: gid, mountinfo: data });
    const after = stat(JOURNAL_MOUNT);
    if (!after.isDirectory() || after.isSymbolicLink() || after.uid !== uid ||
        after.gid !== gid || (after.mode & 0o777) !== mode) refuse('volume preparation incomplete');
    return Object.freeze({ ready: true, prepared: true, path: JOURNAL_MOUNT });
  };
}

export const verifyVolumeStartup = createVolumeStartup();
