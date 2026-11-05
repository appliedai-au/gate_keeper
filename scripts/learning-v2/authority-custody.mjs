/** Protected volume custody; never imported by the model-facing driver. */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { canonical, copy, digest, requireThat } from './contracts.mjs';

const ROLES = ['evaluation', 'novelty', 'budget', 'activation'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const owned = stat => typeof process.getuid !== 'function' || stat.uid === process.getuid();
const privateFile = stat => stat.isFile() && stat.nlink === 1 && (stat.mode & 0o077) === 0 && owned(stat);

function directory(path, create = false) {
  if (!existsSync(path)) {
    requireThat(create, 'protected custody directory absent');
    mkdirSync(path, { mode: 0o700 });
  }
  const stat = lstatSync(path);
  requireThat(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 &&
    owned(stat) && realpathSync(path) === resolve(path), 'protected custody directory invalid');
}

function read(path, maxBytes = 32 * 1024 * 1024) {
  // Recover only the recognizable extra links of our atomic publication.
  // Any unrelated hard link remains a custody error.
  const named = lstatSync(path);
  if (named.isFile() && named.nlink > 1 && owned(named) && (named.mode & 0o077) === 0) {
    const prefix = basename(path) + '.pending-';
    const candidates = readdirSync(dirname(path)).filter(name => name.startsWith(prefix) &&
      /^[a-f0-9]{32}$/u.test(name.slice(prefix.length))).map(name => join(dirname(path), name));
    const linked = candidates.filter(candidate => {
      const stat = lstatSync(candidate);
      return stat.isFile() && stat.ino === named.ino && stat.dev === named.dev && owned(stat) &&
        (stat.mode & 0o077) === 0;
    });
    requireThat(linked.length === named.nlink - 1, 'unrecognized protected custody hard link');
    for (const candidate of linked) {
      try { unlinkSync(candidate); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    }
    const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    requireThat(privateFile(before) && before.size <= maxBytes, 'protected custody file invalid');
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    requireThat(before.ino === after.ino && before.dev === after.dev && before.size === after.size &&
      before.mtimeMs === after.mtimeMs && bytes.length === after.size, 'protected custody changed during read');
    return bytes;
  } finally { closeSync(fd); }
}

function writeOnce(path, bytes) {
  if (existsSync(path)) {
    requireThat(read(path).equals(bytes), 'protected custody refuses replacement');
    return;
  }
  // A crash/ENOSPC may leave only an uncommitted temporary file. The final name
  // appears only after complete bytes are durable; existing committed evidence
  // is never truncated or replaced. link() is atomic and refuses clobbering.
  const staging = path + '.pending-' + randomBytes(16).toString('hex');
  let fd = openSync(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let linked = false;
  try {
    writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = null;
    try { linkSync(staging, path); linked = true; }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      requireThat(read(path).equals(bytes), 'protected custody publication conflict');
    }
    // Remove the temporary hard link before the private reader checks nlink=1.
    try { unlinkSync(staging); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    const parent = openSync(resolve(path, '..'), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } finally {
    if (fd !== null) closeSync(fd);
    if (!linked) { try { unlinkSync(staging); } catch { /* Own uncommitted staging only. */ } }
  }
}

/** Initialization is a distinct, explicit remote commissioning action. */
export function openAuthorityCustody({ directory: input, repositoryRoot, initialize = false, gatewayId }) {
  requireThat(isAbsolute(input) && isAbsolute(repositoryRoot), 'absolute protected custody paths required');
  const root = resolve(input), repository = resolve(repositoryRoot);
  const overlaps = (left, right) => left === right || right.startsWith(left + sep);
  requireThat(!overlaps(root, repository) && !overlaps(repository, root), 'authority custody must be outside repository');
  // Validate existing ancestors too; a symbolic /data component is not custody.
  let ancestor = root;
  while (ancestor !== resolve(ancestor, '..')) {
    if (existsSync(ancestor)) requireThat(!lstatSync(ancestor).isSymbolicLink() &&
      realpathSync(ancestor) === ancestor, 'authority custody ancestor symlink');
    ancestor = resolve(ancestor, '..');
  }
  directory(root, initialize);
  directory(join(root, 'keys'), initialize);
  directory(join(root, 'artifacts'), initialize);
  const signers = {}, trust = {};
  for (const role of ROLES) {
    const path = join(root, 'keys', role + '.pem');
    if (!existsSync(path)) {
      requireThat(initialize, 'protected authority signing key absent');
      const key = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
      writeOnce(path, Buffer.from(key));
    }
    const key = createPrivateKey(read(path, 16_384));
    requireThat(key.asymmetricKeyType === 'ed25519', 'authority signing algorithm');
    const publicKey = createPublicKey(key);
    trust[role] = { publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      pinnedFingerprint: sha(publicKey.export({ type: 'spki', format: 'der' })) };
    signers[role] = body => {
      canonical(body);
      return { body: JSON.parse(JSON.stringify(body)),
        signature: sign(null, Buffer.from(JSON.stringify(body)), key).toString('base64') };
    };
  }
  requireThat(new Set(ROLES.map(role => trust[role].pinnedFingerprint)).size === ROLES.length,
    'authority roles must have distinct private signing keys');
  trust.budget.gatewayId = gatewayId;
  const identityBytes = Buffer.from(canonical(trust));
  if (initialize) writeOnce(join(root, 'public-identities.json'), identityBytes);
  else requireThat(read(join(root, 'public-identities.json')).equals(identityBytes), 'protected public pins changed');
  const prefixPath = join(root, 'relay-prefix');
  if (!existsSync(prefixPath)) {
    requireThat(initialize, 'stable protected provider route absent');
    writeOnce(prefixPath, Buffer.from(randomBytes(32).toString('hex')));
  }
  const relayPrefix = read(prefixPath, 128).toString('utf8');
  requireThat(/^[a-f0-9]{64}$/u.test(relayPrefix), 'protected relay route malformed');
  const artifactStore = Object.freeze({
    async put(value) {
      const bytes = Buffer.from(canonical(value));
      requireThat(bytes.length <= 32 * 1024 * 1024, 'protected artifact size');
      const key = digest(value);
      writeOnce(join(root, 'artifacts', key + '.json'), bytes);
      return key;
    },
    async get(key) {
      requireThat(/^[a-f0-9]{64}$/u.test(key), 'protected artifact identity');
      const value = JSON.parse(read(join(root, 'artifacts', key + '.json')).toString('utf8'));
      requireThat(digest(value) === key, 'protected artifact integrity');
      return value;
    },
  });
  return Object.freeze({ trust: copy(trust), signers: Object.freeze(signers), artifactStore, relayPrefix,
    writeBundle(bundle) { writeOnce(join(root, 'frozen-bundle.json'), Buffer.from(canonical(bundle))); },
    readBundle() { return JSON.parse(read(join(root, 'frozen-bundle.json')).toString('utf8')); },
    hasBundle: () => existsSync(join(root, 'frozen-bundle.json')),
    ledgerDirectory: join(root, 'ledger'),
  });
}
