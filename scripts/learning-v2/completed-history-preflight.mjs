/** Existing-volume checks only. No chmod/chown/mkdir/bootstrap or repair. */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { requireThat } from './contracts.mjs';

export const COMPLETED_MOUNT = '/var/lib/gk-v2-private-journal';
const ALLOWED_GK = new Set(['GK_COMPLETED_HISTORY_ROLE', 'GK_COMPLETED_HISTORY_SOURCE_PROOF_B64',
  'GK_COMPLETED_HISTORY_CAPSULE_SHA256', 'GK_COMPLETED_HISTORY_OWNER_PIN_B64',
  'GK_V2_HOST_BOOTSTRAP', 'GK_V3_HTTP_ROUTER']);
export function assertCompletedRoleEnvironment(env, role) {
  requireThat(['authority-export', 'capture', 'activate', 'serve'].includes(role) &&
    env.GK_COMPLETED_HISTORY_ROLE === role && /^[a-f0-9]{40}$/u.test(env.RAILWAY_GIT_COMMIT_SHA || ''),
  'explicit completed-history role and actual source required');
  for (const name of Object.keys(env)) {
    requireThat(!name.startsWith('GK_') || ALLOWED_GK.has(name), 'learning execution/control variable present in completed profile');
    requireThat(!name.startsWith('GATEKEEPER_LEARNING_') && !name.startsWith('GATEKEEPER_AUTHORITY_'),
      'learning control-plane credential present in completed profile');
  }
  const roleInputs = role === 'authority-export' ? ['GK_COMPLETED_HISTORY_SOURCE_PROOF_B64'] :
    role === 'capture' ? ['GK_COMPLETED_HISTORY_SOURCE_PROOF_B64', 'GK_COMPLETED_HISTORY_CAPSULE_SHA256'] :
      role === 'activate' ? ['GK_COMPLETED_HISTORY_SOURCE_PROOF_B64', 'GK_COMPLETED_HISTORY_OWNER_PIN_B64'] : [];
  for (const name of ['GK_COMPLETED_HISTORY_SOURCE_PROOF_B64', 'GK_COMPLETED_HISTORY_CAPSULE_SHA256', 'GK_COMPLETED_HISTORY_OWNER_PIN_B64'])
    requireThat(roleInputs.includes(name) ? typeof env[name] === 'string' && env[name].length > 0 : !Object.hasOwn(env, name),
      'completed role has missing or unrelated control input');
  if (role !== 'serve') for (const name of ['TRUEFORGE_API_KEY', 'TRUEFOUNDRY_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    'GATEKEEPER_REVIEW_TOKEN', 'GATEKEEPER_REVIEW_TOKEN_SHA256']) requireThat(!Object.hasOwn(env, name),
  'archive-only role must not receive provider/review credentials');
  return role;
}

export function completedChildEnvironment(env) {
  assertCompletedRoleEnvironment(env, 'serve');
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GK_') &&
    !name.startsWith('GATEKEEPER_')));
}

export function verifyCompletedVolume({ env = process.env, currentUid = process.getuid?.(),
  mountinfo, stat = lstatSync, list = readdirSync, read = readFileSync } = {}) {
  const role = assertCompletedRoleEnvironment(env, env.GK_COMPLETED_HISTORY_ROLE);
  requireThat(['capture', 'activate', 'serve'].includes(role) && currentUid === 0 &&
    env.GK_V2_HOST_BOOTSTRAP === 'enabled' && env.GK_V3_HTTP_ROUTER === 'enabled',
  'completed host requires explicit root preflight before UID drop');
  const rows = (mountinfo ?? read('/proc/self/mountinfo', 'utf8')).split('\n').filter(Boolean).filter(line => {
    const fields = line.trim().split(/\s+/u), at = fields.indexOf('-');
    return at >= 6 && fields.length >= at + 4 && fields[4] === COMPLETED_MOUNT;
  });
  requireThat(rows.length === 1, 'exact retained dedicated volume missing or ambiguous');
  let path = dirname(COMPLETED_MOUNT);
  while (true) {
    const item = stat(path);
    requireThat(item.isDirectory() && !item.isSymbolicLink() && item.uid === 0 && !(item.mode & 0o022),
      'completed mount ancestor custody');
    if (path === '/') break; path = dirname(path);
  }
  const leaf = stat(COMPLETED_MOUNT);
  requireThat(leaf.isDirectory() && !leaf.isSymbolicLink() && leaf.uid === 1000 && leaf.gid === 1000 &&
    (leaf.mode & 0o777) === 0o700, 'completed profile refuses fresh/unprepared volume');
  const names = list(COMPLETED_MOUNT);
  for (const required of ['production-config.json', 'status-config.json', 'implementation-qualification.json',
    'baseline-continuation-authorization.json', 'proposal-observation-qualification.json',
    'proposal-observation-preparation.json', 'proposal-observation-authorization.json', 'experiment']) requireThat(names.includes(required), 'retained host evidence absent');
  if (role !== 'capture') requireThat(names.includes('completed-history'), 'create-once closure absent');
  if (names.includes('lost+found')) {
    const found = stat(COMPLETED_MOUNT + '/lost+found');
    requireThat(found.isDirectory() && !found.isSymbolicLink() && found.uid === 0 && found.gid === 0 &&
      (found.mode & 0o777) === 0o700 && list(COMPLETED_MOUNT + '/lost+found').length === 0,
    'unexpected filesystem-managed metadata');
  }
  return { ready: true, prepared: false, path: COMPLETED_MOUNT, role };
}
