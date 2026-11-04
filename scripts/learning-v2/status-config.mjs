/**
 * Status-only runtime configuration reader. Explicit non-root, private
 * create-once file; never takes config from HTTP or synthesizes trust pins.
 */
import { constants, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { createReadOnlyLearningStatusReader } from './status-reader.mjs';
import { createLoopbackStatusServer, listenReadOnlyStatus } from './status-listener.mjs';

const REQUIRED = ['binding', 'configDigest', 'directory', 'readToken', 'repositoryRoot', 'trust'];
const refuse = reason => { throw new Error('GK_V2_STATUS_CONFIG_REFUSED: ' + reason); };

export function readStatusConfig({ path, uid = process.getuid?.(), open = openSync,
  close = closeSync, stat = fstatSync, read = readFileSync } = {}) {
  if (uid !== 1000) refuse('non-root node identity required');
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    refuse('absolute pinned config path required');
  }
  if (path !== '/var/lib/gk-v2-private-journal/status-config.json') {
    refuse('unexpected config path');
  }
  let fd;
  try {
    fd = open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = stat(fd);
    if (!info.isFile() || info.uid !== uid || (info.mode & 0o777) !== 0o600 ||
        info.nlink !== 1 || info.size <= 0 || info.size > 16384) {
      refuse('private configuration file integrity');
    }
    const value = JSON.parse(read(fd, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== REQUIRED.slice().sort().join(',')) {
      refuse('configuration shape');
    }
    return value;
  } catch {
    refuse('configuration unavailable or invalid');
  } finally {
    if (fd !== undefined) close(fd);
  }
}

/** Never imported by the default TrueForge startup. */
export async function startConfiguredReadOnlyStatus({ path, env = process.env } = {}) {
  if (env.GK_V2_READONLY_STATUS !== 'enabled') refuse('read-only status not enabled');
  const config = readStatusConfig({ path });
  const readStatus = createReadOnlyLearningStatusReader({
    directory: config.directory, repositoryRoot: config.repositoryRoot,
    binding: config.binding, trust: config.trust, configDigest: config.configDigest,
  });
  const server = createLoopbackStatusServer({
    readStatus, binding: config.binding, readToken: config.readToken,
  });
  return listenReadOnlyStatus(server);
}
