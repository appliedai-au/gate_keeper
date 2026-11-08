import { createHash, randomUUID } from 'node:crypto';
import { CONFIGURATION_DEFAULTS, validConfiguration, inReviewScope, GITHUB_ID, riskRank, severityRank } from './contracts.mjs';

export class ProductError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const githubId = value => typeof value === 'string' && GITHUB_ID.test(value);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, allowEmpty = false) => typeof value === 'string' &&
  value.length <= max && (allowEmpty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const fail = (code = 'invalid_request', status = 400) => { throw new ProductError(code, status); };
const num = value => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) fail('product_unavailable', 503);
  return result;
};
const timestamp = value => value === null || value === undefined ? null : new Date(value).toISOString();
const cost = value => {
  if (value === null || value === undefined) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) fail('product_unavailable', 503);
  return result;
};
const percentage = (part, total) => total > 0 ? Math.round(part / total * 1000) / 10 : null;
const json = value => JSON.stringify(value);
const digest = value => createHash('sha256').update(json(value)).digest('hex');
function preserveOrganizationBaseline(row, result) {
  if (row.review_pass !== 'repository') return;
  const baseline = row.baseline_result;
  if (!object(baseline) || !object(result) || result.organizationRisk !== baseline.risk ||
      riskRank(result.risk) < riskRank(baseline.risk) || !Array.isArray(result.findings) ||
      !Array.isArray(result.ruleEvaluations) || !Array.isArray(baseline.findings) || !Array.isArray(baseline.ruleEvaluations))
    fail('runtime_policy_violation', 503);
  for (const finding of baseline.findings) if (!result.findings.some(next => next.file === finding.file &&
    next.line === finding.line && next.category === finding.category && severityRank(next.severity) >= severityRank(finding.severity)))
    fail('runtime_policy_violation', 503);
  for (const evaluation of baseline.ruleEvaluations) if (!result.ruleEvaluations.some(next => next.ruleId === evaluation.ruleId &&
    next.met === evaluation.met && next.evidence === evaluation.evidence)) fail('runtime_policy_violation', 503);
}
const validLogo = value => {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/u.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 12 || bytes.length > 65536 || bytes.toString('base64') !== match[2]) return false;
  if (match[1] === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (match[1] === 'jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
};
const PAGE_SIZE = 20;
const RUN_STATES = ['queued', 'preparing', 'session_dispatch', 'session_created', 'turn_dispatch', 'running',
  'post_dispatch', 'review_posted', 'summary_dispatch', 'complete', 'failed', 'held'];
const ACTIVE_STATES = RUN_STATES.filter(state => !['queued', 'complete', 'failed'].includes(state));
const OUTBOUND_STATES = ['session_dispatch', 'turn_dispatch', 'post_dispatch', 'summary_dispatch'];
const TRANSITIONS = {
  queued: ['preparing', 'failed'], preparing: ['queued', 'session_dispatch', 'post_dispatch', 'failed', 'held'],
  session_dispatch: ['session_created', 'held'], session_created: ['turn_dispatch', 'failed', 'held'],
  turn_dispatch: ['running', 'held'], running: ['session_dispatch', 'post_dispatch', 'failed', 'held'],
  post_dispatch: ['review_posted', 'held'], review_posted: ['summary_dispatch', 'complete', 'held'],
  summary_dispatch: ['complete', 'held'], complete: [], failed: [], held: [],
};
const FILTERED_RUNS_SQL = `WITH selected AS (
  SELECT r.*,p.full_name,p.github_repo_id,q.merged,q.pr_type,q.head_sha AS current_head_sha,
    q.base_sha AS current_base_sha,q.base_branch AS current_base_branch,q.title AS current_title,q.updated_at AS pr_updated_at
  FROM g8s_product.runs r JOIN g8s_product.repositories p ON p.id=r.repository_id
    AND p.owner_user_id=r.owner_user_id AND p.org_id=r.org_id
  LEFT JOIN g8s_product.pull_requests q ON q.owner_user_id=r.owner_user_id
    AND q.org_id=r.org_id AND q.repository_id=r.repository_id AND q.pr_number=r.pr_number
  WHERE r.owner_user_id=$1 AND r.org_id=$2 AND r.created_at>=$3::timestamptz AND r.created_at<$4::timestamptz
    AND ($5::text IS NULL OR p.github_repo_id=$5) AND ($6::boolean IS NULL OR q.merged=$6))`;

export const DEFAULT_CONFIGURATION = CONFIGURATION_DEFAULTS;

export function validateConfiguration(value, partial = false) {
  const result = partial ? { ...value } : { ...DEFAULT_CONFIGURATION, ...value };
  if (!object(value) || !validConfiguration(result, partial)) fail();
  return JSON.parse(json(result));
}

export function projectUser(row) {
  return { id: row.id, githubId: row.github_id, login: row.login, name: row.name ?? null,
    email: row.email ?? null, avatarUrl: row.avatar_url ?? null, disabled: row.disabled === true };
}
const projectOrg = row => ({ id: row.id, slug: row.slug, name: row.name, logoUrl: row.logo_url ?? null,
  role: row.role || 'owner' });
const projectInstallation = row => ({ id: row.github_installation_id, recordId: row.id, githubInstallationId: row.github_installation_id,
  account: { id: row.account_id, login: row.account_login, type: row.account_type },
  repositorySelection: row.repository_selection, disabledReason: row.disabled_reason ?? null,
  repositoryCount: row.repository_count === undefined ? undefined : num(row.repository_count), updatedAt: timestamp(row.updated_at) });
const projectRepository = row => ({ id: row.github_repo_id, recordId: row.id, githubId: row.github_repo_id, installationId: row.github_installation_id || null,
  name: row.name, fullName: row.full_name, private: row.private, defaultBranch: row.default_branch,
  enabled: row.enabled, available: row.available, overrides: row.overrides || {}, updatedAt: timestamp(row.updated_at) });
const projectFinding = row => ({ id: row.id, file: row.file, line: row.line, endLine: row.end_line,
  severity: row.severity, category: row.category, title: row.title, explanation: row.explanation,
  evidence: row.evidence, status: row.status, createdAt: timestamp(row.created_at), closedAt: timestamp(row.closed_at) });
const projectAudit = row => ({ id: row.id, timestamp: timestamp(row.created_at),
  user: row.details?.source === 'github_webhook' ? { id: null, login: 'GitHub', email: null, kind: 'integration' }
    : { id: row.actor_user_id, login: row.actor_login, email: row.actor_email ?? null, kind: 'user' },
  action: row.action, details: row.details });
export function projectRun(row) {
  return { id: row.id, repositoryId: row.github_repo_id || null, repository: row.full_name || null,
    prNumber: row.pr_number, title: row.title, prUrl: row.pr_url, headSha: row.head_sha,
    baseSha: row.base_sha, baseBranch: row.base_branch,
    trigger: row.trigger, status: row.state, failureReason: row.error_code ?? null,
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
    startedAt: timestamp(row.started_at), finishedAt: timestamp(row.finished_at),
    durationMs: row.started_at && row.finished_at ? Math.max(0, new Date(row.finished_at) - new Date(row.started_at)) : null,
    risk: row.risk ?? null, model: row.model ?? null, estimatedCostUsd: cost(row.estimated_cost_usd),
    costSource: row.cost_source ?? null, summary: text(row.result?.summary, 8000) ? row.result.summary : null,
    verdict: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(row.result?.verdict) ? row.result.verdict : null,
    githubReviewId: row.github_review_id ?? null };
}

function privateRun(row) {
  if (!row) return null;
  return { ...row, ownerUserId: row.owner_user_id, orgId: row.org_id, repositoryId: row.repository_id,
    installationId: row.installation_id, githubInstallationId: row.github_installation_id,
    repositoryFullName: row.full_name, repository_full_name: row.full_name,
    githubRepositoryId: row.github_repo_id, github_repository_id: row.github_repo_id,
    prNumber: row.pr_number, headSha: row.head_sha, baseSha: row.base_sha, baseBranch: row.base_branch, prUrl: row.pr_url,
    actorLogin: row.actor_login, actorGithubId: row.actor_github_id, findingId: row.finding_id,
    sessionId: row.session_id, turnId: row.turn_id, githubReviewId: row.github_review_id,
    reviewPass: row.review_pass, baselineResult: row.baseline_result,
    estimatedCostUsd: cost(row.estimated_cost_usd), costSource: row.cost_source,
    organization_configuration: row.configuration ? { ...DEFAULT_CONFIGURATION, ...row.configuration } : undefined,
    configuration: row.configuration ? { ...DEFAULT_CONFIGURATION, ...row.configuration, ...(row.overrides || {}) } : undefined };
}

export function normalizeFilters(filters = {}, now = new Date()) {
  if (!object(filters)) fail('invalid_request');
  const day = date => new Date(date.getTime()).toISOString().slice(0, 10);
  const today = new Date(day(now) + 'T00:00:00.000Z');
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('invalid_request');
    const result = new Date(value + 'T00:00:00.000Z');
    if (!Number.isFinite(result.getTime()) || day(result) !== value) fail('invalid_request');
    return result;
  };
  const from = filters.from ? parse(filters.from) : new Date(today.getTime() - 29 * 86400000);
  const to = filters.to ? parse(filters.to) : today;
  const days = Math.round((to - from) / 86400000) + 1;
  if (days < 1 || days > 366) fail('invalid_request');
  const groupBy = filters.groupBy || 'daily';
  if (!['daily', 'weekly'].includes(groupBy)) fail('invalid_request');
  const repository = filters.repository && filters.repository !== 'all' ? filters.repository : null;
  if (repository !== null && !githubId(repository)) fail('invalid_request');
  const page = filters.page === undefined ? 0 : Number(filters.page);
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) fail('invalid_request');
  if (filters.merged !== undefined && filters.merged !== null && !['true', 'false', true, false].includes(filters.merged)) fail('invalid_request');
  const merged = filters.merged === undefined || filters.merged === null ? null : filters.merged === true || filters.merged === 'true';
  let weekdays = 0;
  for (let n = 0; n < days; n++) {
    const dow = new Date(from.getTime() + n * 86400000).getUTCDay();
    if (dow !== 0 && dow !== 6) weekdays++;
  }
  return { from: day(from), to: day(to), after: from.toISOString(), before: new Date(to.getTime() + 86400000).toISOString(),
    groupBy, bucket: groupBy === 'daily' ? 'day' : 'week', repository, page, weekdays, merged };
}

export class ProductStore {
  constructor(pool, { defaultMonthlyRunLimit = 0, maxConcurrentRuns = 1 } = {}) {
    if (!Number.isSafeInteger(defaultMonthlyRunLimit) || defaultMonthlyRunLimit < 0 || defaultMonthlyRunLimit > 1000000 ||
        !Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns < 1 || maxConcurrentRuns > 16) fail();
    this.pool = pool;
    this.defaultMonthlyRunLimit = defaultMonthlyRunLimit;
    this.defaultMaxConcurrentRuns = maxConcurrentRuns;
  }

  async ready() {
    const rows = (await this.pool.query('SELECT version FROM g8s_product.schema_version WHERE singleton=true')).rows;
    if (rows.length !== 1 || rows[0].version !== 1) fail('product_unavailable', 503);
  }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure; never log private database errors. */ }
      throw error;
    } finally { client.release(); }
  }

  async organizations(userId, client = this.pool) {
    if (!uuid(userId)) fail('unauthenticated', 401);
    return (await client.query(`SELECT o.*, m.role FROM g8s_product.organizations o
      JOIN g8s_product.memberships m ON m.org_id=o.id AND m.user_id=o.owner_user_id
      WHERE o.owner_user_id=$1 ORDER BY o.created_at,o.id`, [userId])).rows.map(projectOrg);
  }

  async membership(userId, slug, client = this.pool) {
    if (!uuid(userId) || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(slug)) fail('not_found', 404);
    // Membership in someone else's organisation is not permission to see that
    // owner's repositories, runs, exports or settings in this v1 release.
    const row = (await client.query(`SELECT o.*, m.role FROM g8s_product.organizations o
      JOIN g8s_product.memberships m ON m.org_id=o.id AND m.user_id=$1
      JOIN g8s_product.users u ON u.id=$1 AND u.disabled=false
      WHERE o.owner_user_id=$1 AND o.slug=$2`, [userId, slug])).rows[0];
    if (!row || row.role !== 'owner') fail('not_found', 404);
    return row;
  }

  async upsertIdentity(identity) {
    if (!keys(identity, ['githubId', 'login', 'name', 'email', 'avatarUrl']) || !githubId(identity.githubId) ||
        !text(identity.login, 100) || !/^[A-Za-z0-9-]+$/u.test(identity.login) ||
        (identity.name != null && !text(identity.name, 200, true)) ||
        (identity.email != null && !text(identity.email, 320)) ||
        (identity.avatarUrl != null && (!text(identity.avatarUrl, 2048) || !identity.avatarUrl.startsWith('https://')))) fail();
    return this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['g8s-user:' + identity.githubId]);
      const row = (await client.query(`INSERT INTO g8s_product.users(id,github_id,login,name,email,avatar_url,authorization_revoked_at)
        VALUES ($1,$2,$3,$4,$5,$6,(SELECT revoked_at FROM g8s_product.github_authorization_revocations WHERE github_id=$2))
        ON CONFLICT(github_id) DO UPDATE SET login=EXCLUDED.login,
        name=EXCLUDED.name,email=EXCLUDED.email,avatar_url=EXCLUDED.avatar_url,updated_at=now() RETURNING *`,
      [randomUUID(), identity.githubId, identity.login, identity.name ?? null, identity.email ?? null, identity.avatarUrl ?? null])).rows[0];
      if (row.disabled) fail('forbidden', 403);
      let orgs = await this.organizations(row.id, client);
      if (orgs.length === 0) {
        const orgId = randomUUID();
        const base = identity.login.toLowerCase().slice(0, 58).replace(/^-+|-+$/gu, '') || 'account';
        // The immutable GitHub id disambiguates a re-used or renamed login. The
        // readable login remains the initial organisation name, as requested.
        const slug = base + '-' + identity.githubId;
        await client.query(`INSERT INTO g8s_product.organizations(id,owner_user_id,slug,name)
          VALUES ($1,$2,$3,$4)`, [orgId, row.id, slug, identity.login]);
        await client.query(`INSERT INTO g8s_product.memberships(org_id,user_id,role) VALUES ($1,$2,'owner')`, [orgId, row.id]);
        await client.query(`INSERT INTO g8s_product.settings(org_id,owner_user_id,configuration) VALUES ($1,$2,$3)`,
          [orgId, row.id, json(DEFAULT_CONFIGURATION)]);
        await this.audit(client, row.id, orgId, 'organization.created', {});
        orgs = await this.organizations(row.id, client);
      }
      await client.query(`INSERT INTO g8s_product.user_limits(user_id,monthly_run_limit,max_concurrent_runs)
        VALUES ($1,$2,$3) ON CONFLICT(user_id) DO NOTHING`, [row.id, this.defaultMonthlyRunLimit, this.defaultMaxConcurrentRuns]);
      return { user: projectUser(row), organizations: orgs };
    });
  }

  async createOAuth({ stateHash, browserHash, purpose = 'signin', userId = null, verifier, expiresAt,
    returnPath = '/', installationId = null }) {
    if (purpose === 'signin' && returnPath === null) returnPath = '/';
    const expiry = new Date(expiresAt), remaining = expiry - Date.now();
    if (!hash(stateHash) || !hash(browserHash) || !['signin', 'install', 'complete_install'].includes(purpose) ||
        !Number.isFinite(remaining) || remaining <= 0 || remaining > 10 * 60 * 1000 + 1000 ||
        !text(returnPath, 512) || !returnPath.startsWith('/') || returnPath.startsWith('//') || /[\\\r\n]/u.test(returnPath) ||
        (installationId !== null && !githubId(installationId)) ||
        (purpose === 'signin' ? userId !== null : !uuid(userId)) ||
        (purpose === 'install' ? verifier !== null : typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/u.test(verifier)) ||
        (purpose === 'complete_install' && installationId === null)) fail();
    const admitted = await this.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['g8s-oauth-state-admission']);
      await client.query('DELETE FROM g8s_product.oauth_states WHERE expires_at<=now()');
      const count = num((await client.query('SELECT count(*) AS count FROM g8s_product.oauth_states')).rows[0].count);
      if (count >= 10000) {
        await client.query('DELETE FROM g8s_product.sessions WHERE expires_at<=now()');
        return false;
      }
      await client.query(`INSERT INTO g8s_product.oauth_states
        (state_hash,browser_hash,purpose,user_id,verifier,return_path,installation_id,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [stateHash, browserHash, purpose, userId, verifier, returnPath, installationId, expiry]);
      // Any user FK lock is acquired before session cleanup. No later lock can
      // invert the user→session order used by issuance and revocation.
      await client.query('DELETE FROM g8s_product.sessions WHERE expires_at<=now()');
      return true;
    });
    if (!admitted) fail('rate_limited', 429);
  }

  async consumeOAuth(stateHash, browserHash) {
    if (!hash(stateHash) || !hash(browserHash)) fail('invalid_oauth_callback', 401);
    const row = (await this.pool.query(`DELETE FROM g8s_product.oauth_states
      WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *`, [stateHash, browserHash])).rows[0];
    if (!row) fail('invalid_oauth_callback', 401);
    return { purpose: row.purpose, userId: row.user_id, verifier: row.verifier,
      returnPath: row.return_path, installationId: row.installation_id, expiresAt: timestamp(row.expires_at),
      createdAt: timestamp(row.created_at) };
  }

  async lockFreshAuthorization(client, userId, oauthStartedAt) {
    const flowStart = oauthStartedAt == null ? null : new Date(oauthStartedAt);
    if (!uuid(userId) || (flowStart !== null && (!Number.isFinite(flowStart.getTime()) || flowStart.getTime() > Date.now() + 1000))) fail();
    // The non-key row lock serializes issuance/reinstallation with ingress
    // revocation and outbound FOR SHARE checks. User identity keys never change;
    // allowing child FK KEY SHARE avoids a user→installation→repository cycle
    // with refresh/admission/audit writes that reference this same owner.
    // A predicate-only INSERT ... SELECT would allow a new session to appear
    // immediately after a concurrent revocation deleted the previous sessions.
    const user = (await client.query(`SELECT id,
      (authorization_revoked_at IS NULL OR ($2::timestamptz IS NOT NULL AND authorization_revoked_at<$2)) AS authorization_fresh
      FROM g8s_product.users WHERE id=$1 AND disabled=false FOR NO KEY UPDATE`, [userId, flowStart])).rows[0];
    if (!user) fail('unauthenticated', 401);
    if (!user.authorization_fresh) fail('invalid_oauth_callback', 401);
  }

  async createSession({ sessionHash, userId, expiresAt, oauthStartedAt = null }) {
    const expiry = new Date(expiresAt), remaining = expiry - Date.now();
    if (!hash(sessionHash) || !uuid(userId) || !Number.isFinite(remaining) || remaining <= 0 || remaining > 31 * 86400000) fail();
    await this.transaction(async client => {
      await this.lockFreshAuthorization(client, userId, oauthStartedAt);
      await client.query('DELETE FROM g8s_product.sessions WHERE user_id=$1 AND expires_at<=now()', [userId]);
      await client.query(`DELETE FROM g8s_product.sessions WHERE session_hash IN (
        SELECT session_hash FROM g8s_product.sessions WHERE user_id=$1 ORDER BY created_at DESC,session_hash DESC OFFSET 15)`, [userId]);
      await client.query(`INSERT INTO g8s_product.sessions(session_hash,user_id,expires_at)
        VALUES ($1,$2,$3)`, [sessionHash, userId, expiry]);
    });
  }

  async getSession(sessionHash) {
    if (!hash(sessionHash)) return null;
    const row = (await this.pool.query(`SELECT u.* FROM g8s_product.sessions s JOIN g8s_product.users u ON u.id=s.user_id
      WHERE s.session_hash=$1 AND s.expires_at>now() AND u.disabled=false
        AND (u.authorization_revoked_at IS NULL OR s.created_at>u.authorization_revoked_at)`, [sessionHash])).rows[0];
    return row ? { user: projectUser(row), organizations: await this.organizations(row.id) } : null;
  }
  async deleteSession(sessionHash) {
    if (!hash(sessionHash)) return;
    await this.pool.query('DELETE FROM g8s_product.sessions WHERE session_hash=$1', [sessionHash]);
  }

  async audit(client, actorUserId, orgId, action, details = {}, scope = 'org') {
    // Callers provide only small, purpose-selected facts, never entire request
    // objects, source, instruction text, model responses or credentials.
    if (!uuid(actorUserId) || (scope === 'org' && !uuid(orgId)) || !text(action, 100) ||
        !object(details) || Buffer.byteLength(json(details)) > 8000) fail();
    await client.query(`INSERT INTO g8s_product.audit_log(id,actor_user_id,org_id,scope,action,details)
      VALUES ($1,$2,$3,$4,$5,$6)`, [randomUUID(), actorUserId, orgId, scope, action, json(details)]);
  }

  async saveInstallation({ userId, orgId = null, installation, repositories, oauthStartedAt = null }) {
    if (!uuid(userId) || !object(installation) || !githubId(String(installation.id)) ||
        !githubId(String(installation.account?.id)) || !text(installation.account?.login, 100) ||
        !['User', 'Organization'].includes(installation.account?.type) ||
        !['selected', 'all'].includes(installation.repositorySelection || installation.repository_selection) || !Array.isArray(repositories)) fail();
    return this.transaction(async client => {
      await this.lockFreshAuthorization(client, userId, oauthStartedAt);
      const orgs = await this.organizations(userId, client);
      const org = orgId ? orgs.find(item => item.id === orgId) : orgs[0];
      if (!org) fail('not_found', 404);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['g8s-install:' + installation.id]);
      const old = (await client.query('SELECT * FROM g8s_product.installations WHERE github_installation_id=$1 FOR NO KEY UPDATE', [String(installation.id)])).rows[0];
      if (old && (old.owner_user_id !== userId || old.org_id !== org.id)) fail('installation_already_claimed', 409);
      const result = await client.query(`INSERT INTO g8s_product.installations
        (id,owner_user_id,org_id,github_installation_id,account_id,account_login,account_type,repository_selection)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(github_installation_id) DO UPDATE SET
        account_id=EXCLUDED.account_id,account_login=EXCLUDED.account_login,account_type=EXCLUDED.account_type,
        repository_selection=EXCLUDED.repository_selection,disabled_reason=NULL,updated_at=now()
        WHERE g8s_product.installations.owner_user_id=$2 AND g8s_product.installations.org_id=$3 RETURNING *`,
      [old?.id || randomUUID(), userId, org.id, String(installation.id), String(installation.account.id),
        installation.account.login, installation.account.type, installation.repositorySelection || installation.repository_selection]);
      const row = result.rows[0];
      if (!row) fail('installation_already_claimed', 409);
      await this.syncRepositories(client, row, repositories);
      await this.audit(client, userId, org.id, 'github.installation_connected', { installationId: row.id, repositoryCount: repositories.length });
      const repos = (await client.query(`SELECT * FROM g8s_product.repositories
        WHERE owner_user_id=$1 AND org_id=$2 AND installation_id=$3 ORDER BY full_name`, [userId, org.id, row.id])).rows;
      return { installation: projectInstallation(row), repositories: repos.map(projectRepository) };
    });
  }

  async syncRepositories(client, installation, repositories) {
    if (!Array.isArray(repositories) || repositories.length > 10000) fail();
    const ids = new Set();
    for (const repo of repositories) {
      const gid = String(repo.id), fullName = repo.fullName || repo.full_name, branch = repo.defaultBranch || repo.default_branch;
      if (!githubId(gid) || ids.has(gid) || !text(fullName, 250) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(fullName) ||
          !text(repo.name, 100) || !text(branch, 250) || typeof repo.private !== 'boolean') fail();
      ids.add(gid);
      const saved = await client.query(`INSERT INTO g8s_product.repositories
        (id,owner_user_id,org_id,installation_id,github_repo_id,full_name,name,default_branch,private)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(owner_user_id,github_repo_id) DO UPDATE SET
        full_name=EXCLUDED.full_name,name=EXCLUDED.name,default_branch=EXCLUDED.default_branch,
        private=EXCLUDED.private,available=true,updated_at=now()
        WHERE g8s_product.repositories.org_id=$3 AND g8s_product.repositories.installation_id=$4 RETURNING id`,
      [randomUUID(), installation.owner_user_id, installation.org_id, installation.id, gid, fullName, repo.name, branch, repo.private]);
      if (saved.rows.length !== 1) fail('conflict', 409);
    }
    // De-selected repositories are disabled. A later re-selection never silently
    // restores the previous enabled flag; the owner explicitly opts in again.
    await client.query(`UPDATE g8s_product.repositories SET available=false,enabled=false,updated_at=now()
      WHERE owner_user_id=$1 AND org_id=$2 AND installation_id=$3 AND NOT(github_repo_id=ANY($4::text[]))`,
    [installation.owner_user_id, installation.org_id, installation.id, [...ids]]);
  }

  async getInstallation(installationId) {
    if (!githubId(String(installationId))) fail('not_found', 404);
    const row = (await this.pool.query(`SELECT i.*,u.login AS owner_github_login,u.github_id AS owner_github_id
      FROM g8s_product.installations i JOIN g8s_product.users u ON u.id=i.owner_user_id
      WHERE i.github_installation_id=$1`, [String(installationId)])).rows[0];
    return row ? { ...row, ownerUserId: row.owner_user_id, orgId: row.org_id,
      githubInstallationId: row.github_installation_id, disabledReason: row.disabled_reason } : null;
  }

  async syncInstallationRepositories(installationId, repositories) {
    return this.transaction(async client => {
      const row = (await client.query(`SELECT * FROM g8s_product.installations WHERE github_installation_id=$1 FOR NO KEY UPDATE`, [String(installationId)])).rows[0];
      if (!row) fail('not_found', 404);
      if (row.disabled_reason) fail('installation_disabled', 409);
      await this.syncRepositories(client, row, repositories);
      return { repositoryCount: repositories.length };
    });
  }

  async disableInstallation(installationId, reason = 'installation_removed') {
    if (!githubId(String(installationId)) || !/^[a-z][a-z0-9_]{0,99}$/u.test(reason)) fail();
    return this.transaction(async client => {
      const row = (await client.query(`UPDATE g8s_product.installations SET disabled_reason=$2,updated_at=now()
        WHERE github_installation_id=$1 RETURNING *`, [String(installationId), reason])).rows[0];
      if (!row) return false;
      await client.query(`UPDATE g8s_product.repositories SET enabled=false,available=false,updated_at=now()
        WHERE owner_user_id=$1 AND org_id=$2 AND installation_id=$3`, [row.owner_user_id, row.org_id, row.id]);
      await this.audit(client, row.owner_user_id, row.org_id, 'github.installation_disabled', { installationId: row.id, reason, source: 'github_webhook' });
      return true;
    });
  }

  async listRepositories(userId, slug, options = {}) {
    const org = await this.membership(userId, slug);
    const search = options.search || '';
    if (options.enabled !== undefined && !['all', 'true', 'false', true, false].includes(options.enabled)) fail('invalid_request');
    const enabled = options.enabled === undefined || options.enabled === 'all' ? null : options.enabled === true || options.enabled === 'true';
    const page = options.page === undefined ? 0 : Number(options.page);
    if (!text(search, 250, true) || !Number.isSafeInteger(page) || page < 0 || page > 10000) fail('invalid_request');
    const rows = (await this.pool.query(`SELECT * FROM g8s_product.repositories
      WHERE owner_user_id=$1 AND org_id=$2 AND ($3='' OR position(lower($3) in lower(full_name))>0)
      AND ($4::boolean IS NULL OR enabled=$4) ORDER BY full_name,id LIMIT $5 OFFSET $6`,
    [userId, org.id, search, enabled, PAGE_SIZE + 1, page * PAGE_SIZE])).rows;
    return { repositories: rows.slice(0, PAGE_SIZE).map(projectRepository), page: { index: page, hasNext: rows.length > PAGE_SIZE } };
  }

  async updateRepository(userId, slug, repositoryId, patch) {
    if (!githubId(repositoryId) || !keys(patch, ['enabled', 'overrides']) || Object.keys(patch).length === 0 ||
        (patch.enabled !== undefined && typeof patch.enabled !== 'boolean')) fail();
    const overrides = patch.overrides === undefined ? null : validateConfiguration(patch.overrides, true);
    return this.transaction(async client => {
      const org = await this.membership(userId, slug, client);
      const row = (await client.query(`UPDATE g8s_product.repositories r SET
        enabled=COALESCE($4,enabled),overrides=COALESCE($5::jsonb,overrides),updated_at=now()
        WHERE r.owner_user_id=$1 AND r.org_id=$2 AND r.github_repo_id=$3
        AND ($4 IS DISTINCT FROM true OR (r.available=true AND EXISTS(SELECT 1 FROM g8s_product.installations i
          WHERE i.id=r.installation_id AND i.owner_user_id=$1 AND i.org_id=$2 AND i.disabled_reason IS NULL))) RETURNING r.*`,
      [userId, org.id, repositoryId, patch.enabled ?? null, overrides === null ? null : json(overrides)])).rows[0];
      if (!row) fail('not_found', 404);
      await this.audit(client, userId, org.id, 'repository.updated', { repositoryId, changedFields: Object.keys(patch) });
      return projectRepository(row);
    });
  }

  async disableAllRepositories(userId, slug) {
    return this.transaction(async client => {
      const org = await this.membership(userId, slug, client);
      const rows = (await client.query(`UPDATE g8s_product.repositories SET enabled=false,updated_at=now()
        WHERE owner_user_id=$1 AND org_id=$2 AND enabled=true RETURNING id`, [userId, org.id])).rows;
      await this.audit(client, userId, org.id, 'repositories.disabled_all', { count: rows.length });
      return { disabledCount: rows.length };
    });
  }

  async settings(userId, slug, section) {
    const org = await this.membership(userId, slug);
    if (section === 'configuration') {
      const row = (await this.pool.query(`SELECT configuration,revision FROM g8s_product.settings
        WHERE owner_user_id=$1 AND org_id=$2`, [userId, org.id])).rows[0];
      if (!row) fail('product_unavailable', 503);
      const connections = (await this.pool.query(`SELECT i.*,count(r.id)::int AS repository_count FROM g8s_product.installations i
        LEFT JOIN g8s_product.repositories r ON r.installation_id=i.id AND r.owner_user_id=$1 AND r.org_id=$2 AND r.available=true
        WHERE i.owner_user_id=$1 AND i.org_id=$2 GROUP BY i.id ORDER BY i.created_at`, [userId, org.id])).rows.map(projectInstallation);
      return { configuration: validateConfiguration(row.configuration), revision: row.revision,
        repositories: (await this.listRepositories(userId, slug)).repositories, connections,
        capabilities: { github: true, gitlab: false, azureDevOps: false, bitbucket: false,
          autoFillSummaries: false, invitationsEmail: false, findingsResolution: true, billing: false } };
    }
    if (section === 'organization') {
      const members = (await this.pool.query(`SELECT u.*,m.role,m.created_at AS joined_at FROM g8s_product.memberships m
        JOIN g8s_product.users u ON u.id=m.user_id JOIN g8s_product.organizations o ON o.id=m.org_id
        WHERE o.owner_user_id=$1 AND o.id=$2 ORDER BY m.created_at,u.id`, [userId, org.id])).rows
        .map(row => ({ ...projectUser(row), role: row.role, joinedAt: timestamp(row.joined_at) }));
      const invitations = (await this.pool.query(`SELECT id,email,role,status,created_at FROM g8s_product.invitations
        WHERE inviter_user_id=$1 AND org_id=$2 AND status='pending' ORDER BY created_at DESC`, [userId, org.id])).rows
        .map(row => ({ id: row.id, email: row.email, role: row.role, status: row.status, createdAt: timestamp(row.created_at), delivery: 'not_sent' }));
      return { organization: projectOrg(org), members, invitations };
    }
    if (section === 'rules') {
      const rules = (await this.pool.query(`SELECT r.*,count(e.rule_id)::int AS evaluations,
        count(e.rule_id) FILTER(WHERE e.met)::int AS met FROM g8s_product.rules r
        LEFT JOIN g8s_product.rule_evaluations e ON e.rule_id=r.id AND e.owner_user_id=$1 AND e.org_id=$2
        WHERE r.owner_user_id=$1 AND r.org_id=$2 AND r.archived=false GROUP BY r.id ORDER BY r.created_at,r.id`, [userId, org.id])).rows;
      return { rules: rules.map(row => ({ id: row.id, name: row.name, description: row.description,
        severity: row.severity, enabled: row.enabled, evaluations: num(row.evaluations), met: num(row.met),
        metPercentage: percentage(num(row.met), num(row.evaluations)) })) };
    }
    if (section === 'integrations') {
      const rows = (await this.pool.query(`SELECT * FROM g8s_product.installations WHERE owner_user_id=$1 AND org_id=$2 ORDER BY created_at`, [userId, org.id])).rows;
      return { github: { available: true, installations: rows.map(projectInstallation) },
        integrations: ['GitLab', 'Azure DevOps', 'Bitbucket', 'CI platforms', 'Linear', 'Jira', 'Slack', 'Custom MCP servers']
          .map(name => ({ name, status: 'coming_soon' })) };
    }
    if (section === 'audit') return this.auditLog(userId, slug);
    if (section === 'billing') {
      const members = (await this.settings(userId, slug, 'organization')).members;
      const usage = await this.usage(userId, org.id);
      return { plan: { name: 'G8S access', paid: false, featuresUnlocked: true, seats: members.length },
        seatAssignments: members.map(member => ({ userId: member.id, login: member.login, email: member.email, role: member.role })), usage };
    }
    fail('not_found', 404);
  }

  async saveSettings(userId, slug, section, body) {
    if (!object(body)) fail();
    await this.transaction(async client => {
      const org = await this.membership(userId, slug, client);
      if (section === 'configuration') {
        if (!keys(body, ['configuration', 'revision']) || !object(body.configuration) ||
            (body.revision !== undefined && (!Number.isSafeInteger(body.revision) || body.revision < 1))) fail();
        const config = validateConfiguration(body.configuration);
        const result = await client.query(`UPDATE g8s_product.settings SET configuration=$3,revision=revision+1,updated_at=now()
          WHERE owner_user_id=$1 AND org_id=$2 AND ($4::int IS NULL OR revision=$4) RETURNING revision`,
        [userId, org.id, json(config), body.revision ?? null]);
        if (result.rows.length !== 1) fail('revision_conflict', 409);
        await this.audit(client, userId, org.id, 'configuration.updated', { revision: result.rows[0].revision });
      } else if (section === 'organization') {
        if (!keys(body, ['name', 'slug', 'logoUrl']) || !text(body.name, 200) ||
            (body.slug !== undefined && (typeof body.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(body.slug))) ||
            (body.logoUrl !== undefined && !validLogo(body.logoUrl))) fail();
        // Accept a bounded raster upload encoded by the browser; never SVG or an
        // arbitrary remote URL that could become an authenticated fetch target.
        try {
          await client.query(`UPDATE g8s_product.organizations SET name=$3,slug=COALESCE($4,slug),
            logo_url=CASE WHEN $5 THEN $6 ELSE logo_url END,updated_at=now() WHERE owner_user_id=$1 AND id=$2`,
          [userId, org.id, body.name.trim(), body.slug ?? null, Object.hasOwn(body, 'logoUrl'), body.logoUrl ?? null]);
        } catch (error) { if (error.code === '23505') fail('conflict', 409); throw error; }
        await this.audit(client, userId, org.id, 'organization.updated', { changedFields: Object.keys(body) });
      } else if (section === 'rules') {
        if (!keys(body, ['rules']) || !Array.isArray(body.rules) || body.rules.length > 100) fail();
        const ids = new Set();
        const existing = (await client.query(`SELECT id FROM g8s_product.rules WHERE owner_user_id=$1 AND org_id=$2 FOR UPDATE`, [userId, org.id])).rows;
        const ownedIds = new Set(existing.map(row => row.id));
        for (const rule of body.rules) {
          if (!keys(rule, ['id', 'name', 'description', 'severity', 'enabled']) || !text(rule.name, 120) ||
              !text(rule.description, 4000) || !['low', 'medium', 'high', 'critical'].includes(rule.severity) ||
              typeof rule.enabled !== 'boolean' || (rule.id !== undefined && (!uuid(rule.id) || !ownedIds.has(rule.id)))) fail();
          const id = rule.id || randomUUID();
          if (ids.has(id)) fail();
          ids.add(id);
          await client.query(`INSERT INTO g8s_product.rules(id,owner_user_id,org_id,name,description,severity,enabled)
            VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,
            description=EXCLUDED.description,severity=EXCLUDED.severity,enabled=EXCLUDED.enabled,archived=false,updated_at=now()
            WHERE g8s_product.rules.owner_user_id=$2 AND g8s_product.rules.org_id=$3`,
          [id, userId, org.id, rule.name.trim(), rule.description, rule.severity, rule.enabled]);
        }
        await client.query(`UPDATE g8s_product.rules SET archived=true,enabled=false,updated_at=now()
          WHERE owner_user_id=$1 AND org_id=$2 AND NOT(id=ANY($3::uuid[]))`, [userId, org.id, [...ids]]);
        await this.audit(client, userId, org.id, 'rules.updated', { ruleCount: ids.size });
      } else fail('not_found', 404);
    });
    return this.settings(userId, section === 'organization' && body.slug ? body.slug : slug, section);
  }

  async inviteMember(userId, slug, body) {
    if (!keys(body, ['email', 'role']) || !text(body.email, 320) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(body.email) || !['admin', 'member'].includes(body.role)) fail();
    return this.transaction(async client => {
      const org = await this.membership(userId, slug, client);
      const row = (await client.query(`INSERT INTO g8s_product.invitations(id,org_id,inviter_user_id,email,role)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT(org_id,email) DO UPDATE SET role=EXCLUDED.role,status='pending'
        WHERE g8s_product.invitations.inviter_user_id=$3 RETURNING id,email,role,status,created_at`,
      [randomUUID(), org.id, userId, body.email.trim().toLowerCase(), body.role])).rows[0];
      if (!row) fail('invitation_unavailable', 409);
      await this.audit(client, userId, org.id, 'member.invitation_saved', { invitationId: row.id, role: row.role });
      // No email is sent and no additional access is granted by saving a request.
      return { id: row.id, email: row.email, role: row.role, status: row.status, delivery: 'not_sent' };
    });
  }

  async updateMember(userId, slug, memberId, body) {
    if (!uuid(memberId) || !keys(body, ['role']) || !['admin', 'member'].includes(body.role)) fail();
    return this.transaction(async client => {
      const org = await this.membership(userId, slug, client);
      const row = (await client.query(`UPDATE g8s_product.memberships SET role=$3
        WHERE org_id=$1 AND user_id=$2 AND role<>'owner' RETURNING user_id,role`, [org.id, memberId, body.role])).rows[0];
      if (!row) fail('not_found', 404);
      await this.audit(client, userId, org.id, 'member.role_updated', { memberId, role: body.role });
      return { userId: row.user_id, role: row.role };
    });
  }

  async removeMember(userId, slug, memberId) {
    if (!uuid(memberId)) fail();
    return this.transaction(async client => {
      const org = await this.membership(userId, slug, client);
      const rows = (await client.query(`DELETE FROM g8s_product.memberships WHERE org_id=$1 AND user_id=$2 AND role<>'owner' RETURNING user_id`, [org.id, memberId])).rows;
      if (rows.length !== 1) fail('not_found', 404);
      await this.audit(client, userId, org.id, 'member.removed', { memberId });
      return { removed: true };
    });
  }

  async auditLog(userId, slug, options = {}) {
    const org = await this.membership(userId, slug);
    const page = options.page === undefined ? 0 : Number(options.page);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000) fail('invalid_request');
    const limit = options.export === true ? 10001 : PAGE_SIZE + 1;
    const rows = (await this.pool.query(`SELECT a.*,u.login AS actor_login,u.email AS actor_email FROM g8s_product.audit_log a
      JOIN g8s_product.users u ON u.id=a.actor_user_id WHERE a.org_id=$1 AND a.actor_user_id=$2 AND a.scope='org'
      ORDER BY a.created_at DESC,a.id DESC LIMIT $3 OFFSET $4`, [org.id, userId, limit, options.export ? 0 : page * PAGE_SIZE])).rows;
    if (options.export && rows.length > 10000) fail('export_too_large', 413);
    return { entries: (options.export ? rows : rows.slice(0, PAGE_SIZE)).map(projectAudit),
      page: { index: page, hasNext: !options.export && rows.length > PAGE_SIZE } };
  }

  async exportAudit(userId, slug) { return this.auditLog(userId, slug, { export: true }); }

  async receiveDelivery({ deliveryId, event, payload }) {
    if (!uuid(deliveryId) || !['installation', 'installation_repositories', 'pull_request', 'issue_comment',
      'pull_request_review_comment', 'github_app_authorization', 'ping'].includes(event) || !object(payload) || Buffer.byteLength(json(payload)) > 2 * 1024 * 1024) fail();
    const revocation = event === 'github_app_authorization';
    if (revocation && (payload.action !== 'revoked' || !githubId(String(payload.sender?.id)))) fail();
    const payloadHash = digest(payload);
    return this.transaction(async client => {
      const result = await client.query(`INSERT INTO g8s_product.webhook_deliveries(delivery_id,event,payload,payload_hash)
        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING delivery_id`, [deliveryId, event, json(payload), payloadHash]);
      const response = { deliveryId, duplicate: false };
      if (!result.rows.length) {
        const old = (await client.query(`SELECT delivery_id,event,payload_hash FROM g8s_product.webhook_deliveries
          WHERE delivery_id=$1 OR (event=$2 AND payload_hash=$3 AND event<>'github_app_authorization')`, [deliveryId, event, payloadHash])).rows;
        const sameId = old.find(row => row.delivery_id === deliveryId);
        if (sameId && (sameId.event !== event || sameId.payload_hash !== payloadHash)) fail('conflict', 409);
        if (!old.length) fail('product_unavailable', 503);
        // Inbox insertion and revocation effects commit together. A conflict
        // means this delivery has already applied its effects; replay must not
        // advance its watermark or invalidate a later successful sign-in.
        return { deliveryId: (sameId ?? old[0]).delivery_id, duplicate: true };
      }
      if (revocation) {
        // Signature verification happens before this method is called. Every
        // new revocation delivery takes effect immediately, including a new ID
        // whose body matches an older event; workers cannot postpone revocation.
        const revokedGithubId = String(payload.sender.id);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['g8s-user:' + revokedGithubId]);
        const revoked = (await client.query(`INSERT INTO g8s_product.github_authorization_revocations(github_id,revoked_at)
          VALUES ($1,clock_timestamp()) ON CONFLICT(github_id) DO UPDATE SET revoked_at=clock_timestamp() RETURNING revoked_at`, [revokedGithubId])).rows[0];
        const user = (await client.query(`UPDATE g8s_product.users SET authorization_revoked_at=$2,updated_at=now()
          WHERE github_id=$1 RETURNING id`, [revokedGithubId, revoked.revoked_at])).rows[0];
        if (user) {
          await client.query('DELETE FROM g8s_product.sessions WHERE user_id=$1', [user.id]);
          await client.query(`UPDATE g8s_product.installations SET disabled_reason='authorization_revoked',updated_at=now()
            WHERE owner_user_id=$1`, [user.id]);
          await client.query(`UPDATE g8s_product.repositories SET enabled=false,updated_at=now() WHERE owner_user_id=$1`, [user.id]);
          const orgs = (await client.query('SELECT id FROM g8s_product.organizations WHERE owner_user_id=$1', [user.id])).rows;
          for (const org of orgs) await this.audit(client, user.id, org.id, 'github.authorization_revoked', { source: 'github_webhook' });
        }
        await client.query(`UPDATE g8s_product.webhook_deliveries SET status='processed',completed_at=now()
          WHERE delivery_id=$1`, [response.deliveryId]);
      }
      return response;
    });
  }

  async claimDelivery() {
    const row = (await this.pool.query(`WITH candidate AS (
      SELECT delivery_id FROM g8s_product.webhook_deliveries
      WHERE status='pending' OR (status='processing' AND claimed_at<now()-interval '5 minutes')
      ORDER BY received_at,delivery_id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE g8s_product.webhook_deliveries d SET status='processing',claimed_at=now(),attempts=attempts+1
      FROM candidate c WHERE d.delivery_id=c.delivery_id RETURNING d.*`)).rows[0];
    return row ? { ...row, deliveryId: row.delivery_id } : null;
  }

  async finishDelivery(deliveryId, { status = 'processed', code = null } = {}) {
    if (!uuid(deliveryId) || !['processed', 'ignored', 'failed'].includes(status) ||
        (code !== null && !/^[a-z][a-z0-9_]{0,99}$/u.test(code))) fail();
    await this.pool.query(`UPDATE g8s_product.webhook_deliveries SET status=$2,error_code=$3,completed_at=now()
      WHERE delivery_id=$1 AND status='processing'`, [deliveryId, status, code]);
  }

  async markPullRequest({ installationId, repositoryId, prNumber, merged, title, prUrl, headSha, baseSha, baseBranch }) {
    const hasRevision = headSha !== undefined || baseSha !== undefined || baseBranch !== undefined;
    if (!githubId(String(installationId)) || !githubId(String(repositoryId)) || !Number.isSafeInteger(prNumber) || prNumber < 1 ||
        typeof merged !== 'boolean' || !text(title, 1000, true) || !text(prUrl, 2048) ||
        (hasRevision && (!sha(headSha) || !sha(baseSha) || !text(baseBranch, 200)))) fail();
    await this.pool.query(`UPDATE g8s_product.pull_requests p SET merged=$4,title=$5,pr_url=$6,
        head_sha=COALESCE($7::text,p.head_sha),base_sha=COALESCE($8::text,p.base_sha),base_branch=COALESCE($9::text,p.base_branch),
        risk=CASE WHEN $7::text IS NOT NULL AND (p.head_sha<>$7 OR p.base_sha<>$8 OR p.base_branch<>$9) THEN NULL ELSE p.risk END,updated_at=now()
      FROM g8s_product.repositories r JOIN g8s_product.installations i ON i.id=r.installation_id
        AND i.owner_user_id=r.owner_user_id AND i.org_id=r.org_id
      WHERE i.github_installation_id=$1 AND r.github_repo_id=$2 AND p.pr_number=$3
        AND p.repository_id=r.id AND p.owner_user_id=r.owner_user_id AND p.org_id=r.org_id`,
    [String(installationId), String(repositoryId), prNumber, merged, title, prUrl, headSha ?? null, baseSha ?? null, baseBranch ?? null]);
  }

  async enqueueRun(envelope) {
    const e = envelope;
    if (!object(e) || !uuid(e.deliveryId) || !githubId(String(e.installationId)) || !githubId(String(e.repositoryId)) ||
        !Number.isSafeInteger(e.prNumber) || e.prNumber < 1 || !sha(e.headSha) || !sha(e.baseSha) || !text(e.title, 1000, true) ||
        !text(e.prUrl, 2048) || !text(e.authorLogin, 100) || !['User', 'Bot'].includes(e.authorType) ||
        !text(e.baseBranch, 200) || typeof e.draft !== 'boolean' || typeof e.merged !== 'boolean' ||
        !['pull_request', 'review', 'explain', 'help'].includes(e.trigger) ||
        (e.actorGithubId != null && !githubId(String(e.actorGithubId))) ||
        (e.actorLogin != null && !text(e.actorLogin, 100)) ||
        (e.prType !== undefined && !text(e.prType, 100)) ||
        (e.trigger !== 'pull_request' && !['User', 'Bot'].includes(e.actorType)) ||
        (e.trigger === 'explain' && !uuid(e.findingId))) fail();
    return this.transaction(async client => {
      const delivery = (await client.query(`SELECT * FROM g8s_product.webhook_deliveries WHERE delivery_id=$1`, [e.deliveryId])).rows[0];
      if (!delivery) fail('not_found', 404);
      // Admission follows the installation→repository order used by refresh
      // and installation save. These immutable keys need NO KEY UPDATE:
      // state changes still exclude each other while child FK KEY SHARE checks
      // cannot invert this order during a concurrent refresh or finalization.
      const installation = (await client.query(`SELECT id FROM g8s_product.installations
        WHERE github_installation_id=$1 AND disabled_reason IS NULL FOR NO KEY UPDATE`, [String(e.installationId)])).rows[0];
      if (!installation) return [];
      const repositories = (await client.query(`SELECT r.*,i.github_installation_id,s.configuration
        FROM g8s_product.repositories r JOIN g8s_product.installations i ON i.id=r.installation_id
          AND i.owner_user_id=r.owner_user_id AND i.org_id=r.org_id
        JOIN g8s_product.settings s ON s.owner_user_id=r.owner_user_id AND s.org_id=r.org_id
        JOIN g8s_product.users u ON u.id=r.owner_user_id
        WHERE i.id=$1 AND r.github_repo_id=$2 AND i.disabled_reason IS NULL
          AND r.enabled=true AND r.available=true AND u.disabled=false FOR NO KEY UPDATE OF r`,
      [installation.id, String(e.repositoryId)])).rows;
      const rows = [];
      for (const repo of repositories) {
        const configuration = validateConfiguration({ ...repo.configuration, ...repo.overrides });
        if (e.trigger !== 'pull_request' && e.actorType === 'Bot' &&
            !configuration.allowedBots.some(name => name.toLowerCase() === e.actorLogin?.toLowerCase())) continue;
        const pr = { user: { login: e.authorLogin, type: e.authorType }, base: { ref: e.baseBranch },
          draft: e.draft, state: e.merged || e.state === 'closed' ? 'closed' : 'open' };
        await client.query(`INSERT INTO g8s_product.pull_requests
          (owner_user_id,org_id,repository_id,pr_number,title,pr_url,head_sha,base_sha,base_branch,author_login,draft,merged,pr_type)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT(owner_user_id,repository_id,pr_number) DO UPDATE SET
            title=EXCLUDED.title,pr_url=EXCLUDED.pr_url,head_sha=EXCLUDED.head_sha,base_sha=EXCLUDED.base_sha,base_branch=EXCLUDED.base_branch,
            author_login=EXCLUDED.author_login,draft=EXCLUDED.draft,merged=EXCLUDED.merged,pr_type=EXCLUDED.pr_type,
            risk=CASE WHEN g8s_product.pull_requests.head_sha=EXCLUDED.head_sha
              AND g8s_product.pull_requests.base_sha=EXCLUDED.base_sha AND g8s_product.pull_requests.base_branch=EXCLUDED.base_branch
              THEN g8s_product.pull_requests.risk ELSE NULL END,updated_at=now()`,
        [repo.owner_user_id, repo.org_id, repo.id, e.prNumber, e.title, e.prUrl, e.headSha, e.baseSha, e.baseBranch, e.authorLogin, e.draft, e.merged, e.prType || 'Unclassified']);
        if (['pull_request', 'review'].includes(e.trigger) && !inReviewScope(pr, configuration)) continue;
        const commentId = delivery.payload.comment?.id;
        const eventIdentity = (typeof commentId === 'string' || Number.isSafeInteger(commentId)) && githubId(String(commentId))
          ? 'comment:' + String(commentId) : 'event:' + delivery.payload_hash;
        const dedupKey = e.trigger === 'pull_request' ? 'revision:' + digest([e.headSha, e.baseSha, e.baseBranch]) : e.trigger + ':' + eventIdentity;
        const inserted = await client.query(`INSERT INTO g8s_product.runs
          (id,owner_user_id,org_id,repository_id,installation_id,delivery_id,pr_number,head_sha,base_sha,base_branch,title,pr_url,
            trigger,actor_login,actor_github_id,finding_id,dedup_key)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT(owner_user_id,repository_id,pr_number,dedup_key) DO NOTHING RETURNING *`,
        [randomUUID(), repo.owner_user_id, repo.org_id, repo.id, repo.installation_id, e.deliveryId, e.prNumber,
          e.headSha, e.baseSha, e.baseBranch, e.title, e.prUrl, e.trigger, e.actorLogin ?? null,
          e.actorGithubId == null ? null : String(e.actorGithubId), e.findingId ?? null, dedupKey]);
        for (const row of inserted.rows) rows.push(privateRun({ ...row, full_name: repo.full_name,
          github_repo_id: repo.github_repo_id, github_installation_id: repo.github_installation_id,
          configuration: repo.configuration, overrides: repo.overrides }));
      }
      return rows;
    });
  }

  async claimRun() {
    return this.transaction(async client => {
      // A single PostgreSQL control lock serializes admission against pause. It
      // is never a process-local promise or an unprotected read-before-write.
      const controls = (await client.query('SELECT * FROM g8s_product.controls WHERE singleton=true FOR UPDATE')).rows[0];
      if (!controls || controls.paused) return null;
      const candidates = (await client.query(`SELECT r.* FROM g8s_product.runs r
        JOIN g8s_product.repositories p ON p.id=r.repository_id AND p.owner_user_id=r.owner_user_id AND p.org_id=r.org_id
        JOIN g8s_product.installations i ON i.id=r.installation_id AND i.owner_user_id=r.owner_user_id AND i.org_id=r.org_id
        JOIN g8s_product.users u ON u.id=r.owner_user_id
        JOIN g8s_product.user_limits l ON l.user_id=r.owner_user_id
        WHERE r.state='queued' AND u.disabled=false AND p.enabled=true AND p.available=true AND i.disabled_reason IS NULL
          AND l.monthly_run_limit>0
          AND (SELECT count(*) FROM g8s_product.runs used WHERE used.owner_user_id=r.owner_user_id AND used.id<>r.id
            AND used.started_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')<l.monthly_run_limit
          AND (SELECT count(*) FROM g8s_product.runs active WHERE active.owner_user_id=r.owner_user_id
            AND active.state=ANY($1::text[]))<l.max_concurrent_runs
        ORDER BY r.created_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 100`, [ACTIVE_STATES])).rows;
      for (const row of candidates) {
        const limits = (await client.query(`SELECT * FROM g8s_product.user_limits WHERE user_id=$1 FOR UPDATE`, [row.owner_user_id])).rows[0];
        if (!limits || limits.monthly_run_limit === 0) continue;
        const usage = (await client.query(`SELECT
          count(*) FILTER(WHERE id<>$3 AND started_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS monthly,
          count(*) FILTER(WHERE state=ANY($2::text[])) AS active
          FROM g8s_product.runs WHERE owner_user_id=$1`, [row.owner_user_id, ACTIVE_STATES, row.id])).rows[0];
        if (num(usage.monthly) >= limits.monthly_run_limit || num(usage.active) >= limits.max_concurrent_runs) continue;
        const changed = (await client.query(`UPDATE g8s_product.runs SET state='preparing',started_at=COALESCE(started_at,now()),updated_at=now()
          WHERE id=$1 AND owner_user_id=$2 AND org_id=$3 AND state='queued' RETURNING *`, [row.id, row.owner_user_id, row.org_id])).rows[0];
        if (changed) return this.privateRunById(changed.id, client);
      }
      return null;
    });
  }

  async privateRunById(id, client = this.pool) {
    if (!uuid(id)) fail('not_found', 404);
    const row = (await client.query(`SELECT r.*,p.full_name,p.github_repo_id,p.overrides,s.configuration,i.github_installation_id,
        u.login AS owner_github_login,u.github_id AS owner_github_id,o.slug AS org_slug
      FROM g8s_product.runs r JOIN g8s_product.repositories p ON p.id=r.repository_id
        AND p.owner_user_id=r.owner_user_id AND p.org_id=r.org_id
      JOIN g8s_product.settings s ON s.owner_user_id=r.owner_user_id AND s.org_id=r.org_id
      JOIN g8s_product.installations i ON i.id=r.installation_id AND i.owner_user_id=r.owner_user_id AND i.org_id=r.org_id
      JOIN g8s_product.users u ON u.id=r.owner_user_id
      JOIN g8s_product.organizations o ON o.id=r.org_id AND o.owner_user_id=r.owner_user_id
      WHERE r.id=$1`, [id])).rows[0];
    if (!row) fail('not_found', 404);
    const rules = (await client.query(`SELECT id,name,description,severity,enabled FROM g8s_product.rules
      WHERE owner_user_id=$1 AND org_id=$2 AND enabled=true AND archived=false ORDER BY created_at,id`, [row.owner_user_id, row.org_id])).rows;
    return privateRun({ ...row, rules });
  }

  async recoverableRuns() {
    // Timestamp only observation scheduling, not run progress. An unchanged
    // long-running job cannot monopolize the oldest twenty recovery positions.
    const rows = (await this.pool.query(`WITH candidates AS (SELECT id FROM g8s_product.runs
      WHERE state IN ('session_created','running','review_posted')
      ORDER BY COALESCE(last_polled_at,created_at),created_at,id FOR UPDATE SKIP LOCKED LIMIT 20)
      UPDATE g8s_product.runs r SET last_polled_at=clock_timestamp() FROM candidates c WHERE r.id=c.id RETURNING r.id`)).rows;
    const runs = [];
    for (const row of rows) runs.push(await this.privateRunById(row.id));
    return runs;
  }

  async expireAbandoned() {
    return this.transaction(async client => {
      const queued = await client.query(`UPDATE g8s_product.runs r SET state='queued',error_code=NULL,updated_at=now()
        WHERE r.state='preparing' AND r.updated_at<now()-interval '10 minutes'
          AND NOT EXISTS(SELECT 1 FROM g8s_product.run_observations o WHERE o.run_id=r.id) RETURNING id`);
      const held = await client.query(`UPDATE g8s_product.runs SET state='held',error_code='dispatch_uncertain',updated_at=now()
        WHERE state IN ('preparing','session_dispatch','turn_dispatch','post_dispatch','summary_dispatch')
          AND updated_at<now()-interval '10 minutes' RETURNING id`);
      const timedOut = await client.query(`UPDATE g8s_product.runs SET state='held',error_code='observation_timeout',updated_at=now()
        WHERE state='running' AND started_at<now()-interval '1 hour' RETURNING id`);
      return { heldCount: held.rows.length + timedOut.rows.length, requeuedCount: queued.rows.length,
        observationTimeoutCount: timedOut.rows.length };
    });
  }

  async transitionRun(id, from, to, patch = {}) {
    const repositoryPass = from === 'running' && to === 'session_dispatch' && patch.reviewPass === 'repository';
    if (!uuid(id) || !RUN_STATES.includes(from) || !TRANSITIONS[from].includes(to) || to === 'complete' ||
        !keys(patch, ['input', 'result', 'sessionId', 'turnId', 'githubReviewId', 'model', 'errorCode',
          'estimatedCostUsd', 'costSource', 'risk', 'observation', 'reviewPass', 'baselineResult'])) fail();
    if ((from === 'running' && to === 'session_dispatch' && !repositoryPass) ||
        ((patch.reviewPass !== undefined || patch.baselineResult !== undefined) && !repositoryPass)) fail();
    if (repositoryPass && (!object(patch.baselineResult) || Buffer.byteLength(json(patch.baselineResult)) > 1024 * 1024 ||
        !['low', 'medium', 'high'].includes(patch.baselineResult.risk) || !text(patch.baselineResult.summary, 8000, true) ||
        !Array.isArray(patch.baselineResult.findings) || patch.baselineResult.findings.length > 100 ||
        !Array.isArray(patch.baselineResult.ruleEvaluations) || patch.baselineResult.ruleEvaluations.length > 100 ||
        (patch.sessionId !== undefined && patch.sessionId !== null) || (patch.turnId !== undefined && patch.turnId !== null))) fail();
    for (const field of ['sessionId', 'turnId', 'githubReviewId', 'model'])
      if (patch[field] !== undefined && !(repositoryPass && ['sessionId', 'turnId'].includes(field) && patch[field] === null) && !text(patch[field], 300)) fail();
    if (patch.errorCode !== undefined && patch.errorCode !== null && !/^[a-z][a-z0-9_]{0,99}$/u.test(patch.errorCode)) fail();
    if (patch.risk !== undefined && !['low', 'medium', 'high'].includes(patch.risk)) fail();
    if ((patch.input !== undefined && (!object(patch.input) || Buffer.byteLength(json(patch.input)) > 4 * 1024 * 1024)) ||
        (patch.result !== undefined && (!object(patch.result) || Buffer.byteLength(json(patch.result)) > 1024 * 1024))) fail();
    if (patch.estimatedCostUsd !== undefined && patch.estimatedCostUsd !== null &&
        (typeof patch.estimatedCostUsd !== 'number' || !Number.isFinite(patch.estimatedCostUsd) || patch.estimatedCostUsd < 0 ||
          !['trueforge_metrics_estimate', 'gateway_receipt'].includes(patch.costSource))) fail();
    if (patch.observation !== undefined && (!keys(patch.observation, ['stage', 'payload']) ||
        !text(patch.observation.stage, 100) || Buffer.byteLength(json(patch.observation.payload)) > 4 * 1024 * 1024)) fail();
    return this.transaction(async client => {
      // Lock ordering is identical to claimRun / setPause, so a kill switch wins
      // before the next committed external-write intent. In-flight requests are
      // never described as cancelled solely because this flag was changed.
      let controls;
      if (OUTBOUND_STATES.includes(to))
        controls = (await client.query('SELECT * FROM g8s_product.controls WHERE singleton=true FOR UPDATE')).rows[0];
      const row = (await client.query('SELECT * FROM g8s_product.runs WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row || row.state !== from) return null;
      if (repositoryPass && (row.review_pass !== 'organization' || row.baseline_result !== null)) fail('conflict', 409);
      if (to === 'post_dispatch') preserveOrganizationBaseline(row, patch.result);
      if (to === 'queued') {
        const observations = (await client.query('SELECT stage FROM g8s_product.run_observations WHERE run_id=$1 LIMIT 1', [id])).rows;
        if (observations.length !== 0 || row.session_id || row.turn_id) fail('conflict', 409);
      }
      if (row.input && patch.input !== undefined && digest(row.input) !== digest(patch.input)) fail('conflict', 409);
      if (OUTBOUND_STATES.includes(to)) {
        if (!controls || controls.paused) fail('runs_paused', 409);
        await client.query('SELECT id FROM g8s_product.users WHERE id=$1 FOR SHARE', [row.owner_user_id]);
        const allowed = (await client.query(`SELECT p.id FROM g8s_product.repositories p
          JOIN g8s_product.installations i ON i.id=p.installation_id AND i.owner_user_id=p.owner_user_id AND i.org_id=p.org_id
          JOIN g8s_product.users u ON u.id=p.owner_user_id WHERE p.id=$1 AND p.owner_user_id=$2 AND p.org_id=$3
          AND p.enabled=true AND p.available=true AND i.disabled_reason IS NULL AND u.disabled=false`,
        [row.repository_id, row.owner_user_id, row.org_id])).rows;
        if (allowed.length !== 1) fail('runs_paused', 409);
        if (!patch.observation || !patch.observation.stage.endsWith('_intent')) fail();
      }
      if (patch.observation) {
        await client.query(`INSERT INTO g8s_product.run_observations(run_id,stage,payload) VALUES ($1,$2,$3)`,
          [id, patch.observation.stage, json(patch.observation.payload)]);
      }
      const assignments = ['state=$2', 'updated_at=now()'];
      const values = [id, to, from];
      const fields = { input: 'input', result: 'result', sessionId: 'session_id', turnId: 'turn_id',
        githubReviewId: 'github_review_id', model: 'model', errorCode: 'error_code', estimatedCostUsd: 'estimated_cost_usd',
        costSource: 'cost_source', risk: 'risk', reviewPass: 'review_pass', baselineResult: 'baseline_result' };
      const actualPatch = repositoryPass ? { ...patch, sessionId: null, turnId: null } : patch;
      for (const [key, column] of Object.entries(fields)) {
        if (!Object.hasOwn(actualPatch, key)) continue;
        values.push(['input', 'result', 'baselineResult'].includes(key) ? json(actualPatch[key]) : actualPatch[key]);
        assignments.push(`${column}=$${values.length}`);
      }
      if (['complete', 'failed'].includes(to)) assignments.push('finished_at=now()');
      const changed = await client.query(`UPDATE g8s_product.runs SET ${assignments.join(',')}
        WHERE id=$1 AND state=$3 RETURNING id`, values);
      return changed.rows.length ? this.privateRunById(id, client) : null;
    });
  }

  async getFindingForRun(run, findingId) {
    const owner = run.owner_user_id || run.ownerUserId, org = run.org_id || run.orgId,
      repo = run.repository_id || run.repositoryId, number = run.pr_number || run.prNumber;
    if (!uuid(owner) || !uuid(org) || !uuid(repo) || !uuid(findingId) || !Number.isSafeInteger(number)) fail('not_found', 404);
    const row = (await this.pool.query(`SELECT * FROM g8s_product.findings WHERE id=$1
      AND owner_user_id=$2 AND org_id=$3 AND repository_id=$4 AND pr_number=$5`, [findingId, owner, org, repo, number])).rows[0];
    if (!row) fail('not_found', 404);
    return projectFinding(row);
  }

  async finishRun(id, result) {
    if (!uuid(id) || !object(result) || !Array.isArray(result.findings) || result.findings.length > 100 ||
        (result.risk !== null && !['low', 'medium', 'high'].includes(result.risk)) || !text(result.summary, 8000, true) ||
        (result.ruleEvaluations !== undefined && (!Array.isArray(result.ruleEvaluations) || result.ruleEvaluations.length > 100))) fail();
    const findings = result.findings.map(finding => {
      if (!object(finding) || (finding.id !== undefined && !uuid(finding.id)) || !text(finding.file, 1000) ||
          !Number.isSafeInteger(finding.line) || finding.line < 1 ||
          (finding.endLine !== undefined && (!Number.isSafeInteger(finding.endLine) || finding.endLine < finding.line)) ||
          !['low', 'medium', 'high', 'critical'].includes(finding.severity) || !text(finding.category, 100) ||
          !text(finding.title, 300) || !text(finding.explanation, 8000) || !text(finding.evidence, 8000)) fail();
      return { ...finding, id: finding.id || randomUUID(), endLine: finding.endLine || finding.line };
    });
    if (new Set(findings.map(f => f.id)).size !== findings.length) fail();
    if (result.estimatedCostUsd != null && (typeof result.estimatedCostUsd !== 'number' ||
        !Number.isFinite(result.estimatedCostUsd) || result.estimatedCostUsd < 0 ||
        !['trueforge_metrics_estimate', 'gateway_receipt'].includes(result.costSource))) fail();
    return this.transaction(async client => {
      const row = (await client.query('SELECT * FROM g8s_product.runs WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) fail('not_found', 404);
      if (['pull_request', 'review'].includes(row.trigger) && result.risk === null) fail();
      preserveOrganizationBaseline(row, result);
      if (row.state === 'complete') return this.privateRunById(id, client);
      if (!['review_posted', 'summary_dispatch'].includes(row.state)) fail('conflict', 409);
      // A completed GitHub write must have a separately recorded receipt. A lost
      // acknowledgement can never be promoted to a fabricated successful run.
      const expectedReceipt = row.state === 'summary_dispatch' ? 'summary_receipt' : 'post_receipt';
      const receipt = (await client.query(`SELECT stage FROM g8s_product.run_observations WHERE run_id=$1 AND stage=$2`, [id, expectedReceipt])).rows;
      if (receipt.length !== 1) fail('conflict', 409);
      const intent = (await client.query(`SELECT payload FROM g8s_product.run_observations
        WHERE run_id=$1 AND stage='post_intent'`, [id])).rows[0]?.payload;
      if (!intent || intent.commit_id !== row.head_sha || !['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(intent.event)) fail('conflict', 409);
      for (const finding of findings) {
        await client.query(`INSERT INTO g8s_product.findings(id,run_id,owner_user_id,org_id,repository_id,pr_number,
          file,line,end_line,severity,category,title,explanation,evidence)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [finding.id, id, row.owner_user_id, row.org_id, row.repository_id, row.pr_number, finding.file,
          finding.line, finding.endLine, finding.severity, finding.category, finding.title, finding.explanation, finding.evidence]);
      }
      for (const evaluation of result.ruleEvaluations || []) {
        if (!object(evaluation) || !uuid(evaluation.ruleId) || typeof evaluation.met !== 'boolean' || !text(evaluation.evidence, 8000)) fail();
        const rule = (await client.query(`SELECT id FROM g8s_product.rules
          WHERE id=$1 AND owner_user_id=$2 AND org_id=$3`, [evaluation.ruleId, row.owner_user_id, row.org_id])).rows;
        if (rule.length !== 1) fail();
        await client.query(`INSERT INTO g8s_product.rule_evaluations(run_id,rule_id,owner_user_id,org_id,met,evidence)
          VALUES ($1,$2,$3,$4,$5,$6)`, [id, evaluation.ruleId, row.owner_user_id, row.org_id, evaluation.met, evaluation.evidence]);
      }
      const saved = { summary: result.summary, risk: result.risk, verdict: intent.event,
        organizationRisk: result.organizationRisk ?? null, repositoryRisk: result.repositoryRisk ?? null };
      await client.query(`UPDATE g8s_product.runs SET state='complete',finished_at=now(),updated_at=now(),error_code=NULL,
        risk=$2,result=$3,estimated_cost_usd=$4,cost_source=$5,github_review_id=COALESCE($6,github_review_id) WHERE id=$1`,
      [id, result.risk, json(saved), result.estimatedCostUsd ?? row.estimated_cost_usd,
        result.estimatedCostUsd == null ? row.cost_source : result.costSource, result.githubReviewId ?? null]);
      if (['pull_request', 'review'].includes(row.trigger)) {
        await client.query(`UPDATE g8s_product.pull_requests SET risk=$4,updated_at=now()
          WHERE owner_user_id=$1 AND repository_id=$2 AND pr_number=$3 AND head_sha=$5 AND base_sha=$6 AND base_branch=$7`,
        [row.owner_user_id, row.repository_id, row.pr_number, result.risk, row.head_sha, row.base_sha, row.base_branch]);
      }
      return this.privateRunById(id, client);
    });
  }

  async recordObservation(id, stage, payload) {
    if (!uuid(id) || !text(stage, 100) || Buffer.byteLength(json(payload)) > 4 * 1024 * 1024) fail();
    // Receipt insertion also locks the run; terminal writes and receipt-store
    // failures cannot race around each other's durable state boundary.
    return this.transaction(async client => {
      const row = (await client.query('SELECT id FROM g8s_product.runs WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) fail('not_found', 404);
      await client.query(`INSERT INTO g8s_product.run_observations(run_id,stage,payload) VALUES ($1,$2,$3)`, [id, stage, json(payload)]);
    });
  }

  async runDetail(userId, slug, runId) {
    const org = await this.membership(userId, slug);
    if (!uuid(runId)) fail('not_found', 404);
    const row = (await this.pool.query(`SELECT r.*,p.full_name,p.github_repo_id FROM g8s_product.runs r
      JOIN g8s_product.repositories p ON p.id=r.repository_id AND p.owner_user_id=$1 AND p.org_id=$2
      WHERE r.owner_user_id=$1 AND r.org_id=$2 AND r.id=$3`, [userId, org.id, runId])).rows[0];
    if (!row) fail('not_found', 404);
    const findings = (await this.pool.query(`SELECT * FROM g8s_product.findings
      WHERE owner_user_id=$1 AND org_id=$2 AND run_id=$3 ORDER BY file,line,id`, [userId, org.id, runId])).rows.map(projectFinding);
    const evaluations = (await this.pool.query(`SELECT e.rule_id,e.met,e.evidence,r.name FROM g8s_product.rule_evaluations e
      JOIN g8s_product.rules r ON r.id=e.rule_id AND r.owner_user_id=$1 AND r.org_id=$2
      WHERE e.owner_user_id=$1 AND e.org_id=$2 AND e.run_id=$3 ORDER BY r.name`, [userId, org.id, runId])).rows
      .map(item => ({ ruleId: item.rule_id, name: item.name, met: item.met, evidence: item.evidence }));
    return { run: projectRun(row), findings, ruleEvaluations: evaluations };
  }

  async resolveFinding(userId, slug, findingId, body) {
    if (!uuid(findingId) || !keys(body, ['status']) || !['open', 'closed'].includes(body.status)) fail();
    return this.transaction(async client => {
      const org = await this.membership(userId, slug, client);
      const row = (await client.query(`UPDATE g8s_product.findings SET status=$4,
        closed_at=CASE WHEN $4='closed' THEN COALESCE(closed_at,now()) ELSE NULL END
        WHERE owner_user_id=$1 AND org_id=$2 AND id=$3 RETURNING *`, [userId, org.id, findingId, body.status])).rows[0];
      if (!row) fail('not_found', 404);
      await this.audit(client, userId, org.id, 'finding.resolution_recorded', { findingId, status: body.status, source: 'user_confirmed' });
      return projectFinding(row);
    });
  }

  async reportingScope(userId, slug, filters) {
    const org = await this.membership(userId, slug);
    const range = normalizeFilters(filters);
    if (range.repository) {
      const found = (await this.pool.query(`SELECT id FROM g8s_product.repositories
        WHERE owner_user_id=$1 AND org_id=$2 AND github_repo_id=$3`, [userId, org.id, range.repository])).rows;
      if (found.length !== 1) fail('not_found', 404);
    }
    return { org, range, params: [userId, org.id, range.after, range.before, range.repository, range.merged] };
  }

  async overview(userId, slug, filters = {}) {
    const { range, params } = await this.reportingScope(userId, slug, filters);
    const replies = await Promise.all([
      this.pool.query(`${FILTERED_RUNS_SQL} SELECT count(*) AS runs,
        count(DISTINCT (repository_id,pr_number)) FILTER(WHERE state='complete' AND trigger IN ('pull_request','review')) AS prs_reviewed,
        count(*) FILTER(WHERE state='complete' AND trigger IN ('pull_request','review')) AS total_reviews,
        count(*) FILTER(WHERE state IN ('failed','held')) AS failed_runs,
        count(*) FILTER(WHERE state='complete' AND trigger<>'pull_request') AS user_requests,
        (SELECT count(*) FROM g8s_product.findings f JOIN selected s ON s.id=f.run_id
          AND s.owner_user_id=f.owner_user_id AND s.org_id=f.org_id) AS findings FROM selected`, params),
      this.pool.query(`${FILTERED_RUNS_SQL} SELECT to_char(date_trunc($7,created_at AT TIME ZONE 'UTC'),'YYYY-MM-DD') AS date,
        count(DISTINCT (repository_id,pr_number)) FILTER(WHERE state='complete' AND trigger IN ('pull_request','review')) AS prs_reviewed,
        count(*) FILTER(WHERE state IN ('failed','held')) AS failed_runs,
        count(*) FILTER(WHERE state='complete' AND trigger<>'pull_request') AS user_requests,
        sum((SELECT count(*) FROM g8s_product.findings f WHERE f.run_id=selected.id
          AND f.owner_user_id=selected.owner_user_id AND f.org_id=selected.org_id)) AS findings
        FROM selected GROUP BY date ORDER BY date`, [...params, range.bucket]),
      this.pool.query(`${FILTERED_RUNS_SQL}, latest AS (SELECT DISTINCT ON(repository_id,pr_number) * FROM selected
        WHERE trigger IN ('pull_request','review') ORDER BY repository_id,pr_number,created_at DESC,id DESC)
        SELECT COALESCE(pr_type,'Unclassified') AS type,
          CASE WHEN head_sha=current_head_sha AND base_sha=current_base_sha AND base_branch=current_base_branch
            THEN risk ELSE NULL END AS current_risk,count(*) AS count
        FROM latest GROUP BY type,current_risk ORDER BY type,current_risk`, params),
      this.pool.query(`${FILTERED_RUNS_SQL}, latest AS (SELECT DISTINCT ON(repository_id,pr_number) * FROM selected
          ORDER BY repository_id,pr_number,created_at DESC,id DESC),
        last_review AS (SELECT DISTINCT ON(repository_id,pr_number) * FROM selected
          WHERE trigger IN ('pull_request','review') ORDER BY repository_id,pr_number,created_at DESC,id DESC)
        SELECT l.*,v.id AS review_id,v.state AS review_state,v.risk AS review_risk,v.result->>'verdict' AS review_verdict,
          (v.head_sha=l.current_head_sha AND v.base_sha=l.current_base_sha AND v.base_branch=l.current_base_branch) AS review_is_current,
          (SELECT count(*) FROM g8s_product.findings f WHERE f.run_id=v.id AND f.owner_user_id=$1 AND f.org_id=$2) AS reported,
          (SELECT count(*) FROM g8s_product.findings f WHERE f.run_id=v.id AND f.owner_user_id=$1 AND f.org_id=$2 AND f.status='closed') AS closed
        FROM latest l LEFT JOIN last_review v ON v.repository_id=l.repository_id AND v.pr_number=l.pr_number
        ORDER BY greatest(l.updated_at,l.pr_updated_at) DESC,l.id DESC LIMIT $7 OFFSET $8`, [...params, PAGE_SIZE + 1, range.page * PAGE_SIZE]),
      this.pool.query(`${FILTERED_RUNS_SQL} SELECT r.id,r.name,count(e.rule_id) AS evaluations,
          count(e.rule_id) FILTER(WHERE e.met=true) AS met FROM g8s_product.rules r
        LEFT JOIN (g8s_product.rule_evaluations e JOIN selected s ON s.id=e.run_id
          AND s.owner_user_id=e.owner_user_id AND s.org_id=e.org_id)
          ON e.rule_id=r.id AND e.owner_user_id=$1 AND e.org_id=$2
        WHERE r.owner_user_id=$1 AND r.org_id=$2 AND r.archived=false GROUP BY r.id ORDER BY evaluations DESC,r.name`, params),
    ]);
    const totals = replies[0].rows[0];
    const tile = value => ({ value: num(value), perWeekday: range.weekdays ? Math.round(num(value) / range.weekdays * 100) / 100 : null });
    const types = new Map(), risks = new Map();
    for (const row of replies[2].rows) {
      types.set(row.type, (types.get(row.type) || 0) + num(row.count));
      risks.set(row.current_risk || 'unclassified', (risks.get(row.current_risk || 'unclassified') || 0) + num(row.count));
    }
    const prTotal = [...types.values()].reduce((a, b) => a + b, 0);
    const recent = replies[3].rows;
    return { hasData: num(totals.runs) > 0, filters: { repository: range.repository || 'all', from: range.from,
      to: range.to, groupBy: range.groupBy }, stats: { prsReviewed: tile(totals.prs_reviewed), findings: tile(totals.findings),
      failedRuns: tile(totals.failed_runs), userRequests: tile(totals.user_requests) },
      series: replies[1].rows.map(row => ({ date: row.date, prsReviewed: num(row.prs_reviewed), findings: num(row.findings),
        failedRuns: num(row.failed_runs), userRequests: num(row.user_requests) })),
      prTypes: [...types].map(([type, count]) => ({ type, count, percentage: percentage(count, prTotal) })),
      riskSplit: ['low', 'medium', 'high'].map(risk => ({ risk, count: risks.get(risk) || 0,
        percentage: percentage(risks.get(risk) || 0, prTotal) })), unclassifiedRiskCount: risks.get('unclassified') || 0,
      totalReviews: num(totals.total_reviews),
      ruleActivity: replies[4].rows.map(row => ({ id: row.id, name: row.name, evaluations: num(row.evaluations), met: num(row.met),
        metPercentage: percentage(num(row.met), num(row.evaluations)) })),
      recentPrs: recent.slice(0, PAGE_SIZE).map(row => ({ repositoryId: row.github_repo_id, repository: row.full_name,
        number: row.pr_number, title: row.current_title ?? row.title, url: row.pr_url,
        updatedAt: timestamp(new Date(row.updated_at) > new Date(row.pr_updated_at) ? row.updated_at : row.pr_updated_at),
        risk: row.review_is_current ? row.review_risk ?? null : null,
        status: row.review_is_current ? row.review_state || row.state : 'awaiting_review', reviewIsCurrent: row.review_is_current === true,
        findingsCount: row.review_is_current && row.review_state === 'complete' ? num(row.reported) : null,
        resolvedCount: row.review_is_current && row.review_state === 'complete' ? num(row.closed) : null,
        approved: row.review_is_current && row.review_state === 'complete' && row.review_verdict === 'APPROVE',
        lastRunId: row.id, reviewRunId: row.review_id ?? null })), page: { index: range.page, hasNext: recent.length > PAGE_SIZE } };
  }

  async reviews(userId, slug, filters = {}) {
    const { range, params } = await this.reportingScope(userId, slug, filters);
    const replies = await Promise.all([
      this.pool.query(`${FILTERED_RUNS_SQL} SELECT count(*) AS reported,
        count(*) FILTER(WHERE f.status='closed') AS closed,
        count(*) FILTER(WHERE s.merged=true) AS on_merged_prs
        FROM g8s_product.findings f JOIN selected s ON s.id=f.run_id AND s.owner_user_id=f.owner_user_id AND s.org_id=f.org_id`, params),
      this.pool.query(`${FILTERED_RUNS_SQL} SELECT f.category,count(*) AS reported,
        count(*) FILTER(WHERE f.status='closed') AS closed FROM g8s_product.findings f
        JOIN selected s ON s.id=f.run_id AND s.owner_user_id=f.owner_user_id AND s.org_id=f.org_id
        GROUP BY f.category ORDER BY reported DESC,f.category`, params),
      this.pool.query(`${FILTERED_RUNS_SQL} SELECT s.github_repo_id,s.full_name,
        count(DISTINCT s.pr_number) AS prs,count(f.id) AS reported,count(f.id) FILTER(WHERE f.status='closed') AS closed
        FROM selected s LEFT JOIN g8s_product.findings f ON f.run_id=s.id
          AND f.owner_user_id=s.owner_user_id AND f.org_id=s.org_id
        GROUP BY s.github_repo_id,s.full_name ORDER BY s.full_name`, params),
      this.pool.query(`${FILTERED_RUNS_SQL} SELECT to_char(date_trunc($7,f.created_at AT TIME ZONE 'UTC'),'YYYY-MM-DD') AS date,
        count(*) AS reported,count(*) FILTER(WHERE f.status='closed') AS closed FROM g8s_product.findings f
        JOIN selected s ON s.id=f.run_id AND s.owner_user_id=f.owner_user_id AND s.org_id=f.org_id
        GROUP BY date ORDER BY date`, [...params, range.bucket]),
      this.pool.query(`${FILTERED_RUNS_SQL} SELECT f.*,s.full_name,s.github_repo_id,s.pr_url,s.title AS pr_title
        FROM g8s_product.findings f JOIN selected s ON s.id=f.run_id AND s.owner_user_id=f.owner_user_id AND s.org_id=f.org_id
        WHERE f.status='open' AND f.created_at>=$7::timestamptz
        ORDER BY CASE f.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
          f.created_at,f.id LIMIT 50`, [...params, new Date(Date.parse(range.before) - (filters.window === 7 ? 7 : 30) * 86400000).toISOString()]),
    ]);
    const totals = replies[0].rows[0];
    return { hasData: num(totals.reported) > 0, filters: { repository: range.repository || 'all', from: range.from,
      to: range.to, groupBy: range.groupBy, merged: range.merged, window: filters.window === 7 ? 7 : 30 },
      reported: num(totals.reported), closed: num(totals.closed), findingsOnMergedPrs: num(totals.on_merged_prs),
      closureRate: percentage(num(totals.closed), num(totals.reported)), resolutionSource: 'user_confirmed',
      resolutionByCategory: replies[1].rows.map(row => ({ category: row.category, reported: num(row.reported),
        closed: num(row.closed), rate: percentage(num(row.closed), num(row.reported)) })),
      closureByRepository: replies[2].rows.map(row => ({ repositoryId: row.github_repo_id, repository: row.full_name,
        prs: num(row.prs), reported: num(row.reported), closed: num(row.closed), rate: percentage(num(row.closed), num(row.reported)) })),
      series: replies[3].rows.map(row => ({ date: row.date, reported: num(row.reported), closed: num(row.closed) })),
      unresolved: replies[4].rows.map(row => ({ ...projectFinding(row), runId: row.run_id, repositoryId: row.github_repo_id,
        repository: row.full_name, prNumber: row.pr_number, prUrl: row.pr_url, prTitle: row.pr_title })) };
  }

  async usage(userId, orgId = null) {
    if (!uuid(userId) || (orgId !== null && !uuid(orgId))) fail('not_found', 404);
    const row = (await this.pool.query(`SELECT count(*) AS runs,
      count(DISTINCT(repository_id,pr_number)) FILTER(WHERE state='complete' AND trigger IN ('pull_request','review')) AS prs,
      count(*) FILTER(WHERE started_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS monthly_runs,
      count(*) FILTER(WHERE trigger IN ('pull_request','review') AND started_at IS NOT NULL) AS model_runs,
      count(*) FILTER(WHERE trigger IN ('pull_request','review') AND estimated_cost_usd IS NOT NULL) AS costed_runs,
      count(*) FILTER(WHERE trigger IN ('pull_request','review') AND cost_source='gateway_receipt') AS receipted_runs,
      sum(estimated_cost_usd) FILTER(WHERE trigger IN ('pull_request','review')) AS known_cost
      FROM g8s_product.runs WHERE owner_user_id=$1 AND ($2::uuid IS NULL OR org_id=$2)`, [userId, orgId])).rows[0];
    const limits = (await this.pool.query(`SELECT * FROM g8s_product.user_limits WHERE user_id=$1`, [userId])).rows[0];
    const modelRuns = num(row.model_runs), costed = num(row.costed_runs), receipted = num(row.receipted_runs), known = cost(row.known_cost);
    return { runs: num(row.runs), prsReviewed: num(row.prs), monthlyRuns: num(row.monthly_runs),
      monthlyRunLimit: limits?.monthly_run_limit ?? 0, maxConcurrentRuns: limits?.max_concurrent_runs ?? 1,
      modelSpendUsd: modelRuns > 0 && receipted === modelRuns ? known : null,
      estimatedModelCostUsd: modelRuns > 0 && costed === modelRuns ? known : null,
      knownEstimatedModelCostUsd: known, costedRuns: costed, modelRuns, costComplete: modelRuns > 0 && costed === modelRuns };
  }

  async setPause(actorUserId, { paused, reason }) {
    if (!uuid(actorUserId) || typeof paused !== 'boolean' || !text(reason, 500)) fail();
    return this.transaction(async client => {
      await client.query('SELECT singleton FROM g8s_product.controls WHERE singleton=true FOR UPDATE');
      const row = (await client.query(`UPDATE g8s_product.controls SET paused=$1,reason=$2,revision=revision+1,
        updated_by=$3,updated_at=now() WHERE singleton=true RETURNING *`, [paused, reason.trim(), actorUserId])).rows[0];
      if (!row) fail('product_unavailable', 503);
      if (paused) {
        // Preparation consists only of GitHub GETs. Requeue only if no durable
        // outbound intent or upstream id exists; all uncertain writes stay held.
        await client.query(`UPDATE g8s_product.runs r SET state='queued',updated_at=now()
          WHERE r.state='preparing' AND r.session_id IS NULL AND r.turn_id IS NULL
            AND NOT EXISTS(SELECT 1 FROM g8s_product.run_observations o WHERE o.run_id=r.id)`);
      }
      await this.audit(client, actorUserId, null, paused ? 'admin.runs_paused' : 'admin.runs_resumed', { reason: reason.trim() }, 'admin');
      const active = (await client.query(`SELECT count(*) AS count FROM g8s_product.runs
        WHERE state IN ('session_dispatch','session_created','turn_dispatch','running','post_dispatch','review_posted','summary_dispatch')`)).rows[0];
      return { paused: row.paused, reason: row.reason, revision: row.revision, updatedAt: timestamp(row.updated_at),
        inFlightRuns: num(active.count), inFlightCancellation: false };
    });
  }

  async setLimits(actorUserId, userId, { monthlyRunLimit, maxConcurrentRuns, disabled }) {
    if (!uuid(actorUserId) || !uuid(userId) || !Number.isSafeInteger(monthlyRunLimit) || monthlyRunLimit < 0 || monthlyRunLimit > 1000000 ||
        !Number.isSafeInteger(maxConcurrentRuns) || maxConcurrentRuns < 1 || maxConcurrentRuns > 16 ||
        (disabled !== undefined && typeof disabled !== 'boolean')) fail();
    return this.transaction(async client => {
      const user = (await client.query('SELECT id FROM g8s_product.users WHERE id=$1 FOR NO KEY UPDATE', [userId])).rows[0];
      if (!user) fail('not_found', 404);
      await client.query(`INSERT INTO g8s_product.user_limits(user_id,monthly_run_limit,max_concurrent_runs)
        VALUES ($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET monthly_run_limit=$2,max_concurrent_runs=$3,updated_at=now()`,
      [userId, monthlyRunLimit, maxConcurrentRuns]);
      if (disabled !== undefined) await client.query('UPDATE g8s_product.users SET disabled=$2,updated_at=now() WHERE id=$1', [userId, disabled]);
      if (disabled === true) await client.query('DELETE FROM g8s_product.sessions WHERE user_id=$1', [userId]);
      await this.audit(client, actorUserId, null, 'admin.user_limits_updated',
        { userId, monthlyRunLimit, maxConcurrentRuns, ...(disabled === undefined ? {} : { disabled }) }, 'admin');
      return { userId, monthlyRunLimit, maxConcurrentRuns, ...(disabled === undefined ? {} : { disabled }) };
    });
  }

  async adminList(section, options = {}) {
    // This method is deliberately a private administrative capability. The HTTP
    // service checks the immutable GitHub-id allowlist before invoking it.
    const range = normalizeFilters(options), page = range.page;
    if (section === 'overview') {
      const control = (await this.pool.query('SELECT * FROM g8s_product.controls WHERE singleton=true')).rows[0];
      if (!control) fail('product_unavailable', 503);
      const row = (await this.pool.query(`SELECT
        (SELECT count(*) FROM g8s_product.users) AS users,
        (SELECT count(*) FROM g8s_product.installations) AS installations,
        (SELECT count(*) FROM g8s_product.repositories) AS repositories,
        (SELECT count(*) FROM g8s_product.runs) AS runs,
        (SELECT count(*) FROM g8s_product.runs WHERE state='queued') AS queued,
        (SELECT count(*) FROM g8s_product.runs WHERE state IN ('failed','held')) AS failed`)).rows[0];
      return { controls: { paused: control.paused, reason: control.reason, revision: control.revision, updatedAt: timestamp(control.updated_at) },
        paused: control.paused, reason: control.reason, counts: { users: num(row.users), installations: num(row.installations),
          repositories: num(row.repositories), runs: num(row.runs), queued: num(row.queued), failed: num(row.failed) } };
    }
    let rows;
    if (section === 'users') {
      rows = (await this.pool.query(`SELECT u.*,l.monthly_run_limit,l.max_concurrent_runs,
        (SELECT count(*) FROM g8s_product.runs r WHERE r.owner_user_id=u.id) AS runs,
        (SELECT count(*) FROM g8s_product.runs r WHERE r.owner_user_id=u.id AND r.started_at>=
          date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS monthly_runs
        FROM g8s_product.users u JOIN g8s_product.user_limits l ON l.user_id=u.id
        ORDER BY u.created_at DESC,u.id LIMIT $1 OFFSET $2`, [PAGE_SIZE + 1, page * PAGE_SIZE])).rows;
      const users = [];
      for (const row of rows.slice(0, PAGE_SIZE)) users.push({ ...projectUser(row), createdAt: timestamp(row.created_at),
        monthlyRunLimit: row.monthly_run_limit, maxConcurrentRuns: row.max_concurrent_runs, runs: num(row.runs), monthlyRuns: num(row.monthly_runs),
        usage: await this.usage(row.id) });
      return { users, page: { index: page, hasNext: rows.length > PAGE_SIZE } };
    }
    if (section === 'installations') {
      rows = (await this.pool.query(`SELECT i.*,u.login AS owner_login FROM g8s_product.installations i
        JOIN g8s_product.users u ON u.id=i.owner_user_id ORDER BY i.created_at DESC,i.id LIMIT $1 OFFSET $2`, [PAGE_SIZE + 1, page * PAGE_SIZE])).rows;
      return { installations: rows.slice(0, PAGE_SIZE).map(row => ({ ...projectInstallation(row), ownerUserId: row.owner_user_id, ownerLogin: row.owner_login })),
        page: { index: page, hasNext: rows.length > PAGE_SIZE } };
    }
    if (section === 'repositories') {
      rows = (await this.pool.query(`SELECT r.*,u.login AS owner_login,i.github_installation_id FROM g8s_product.repositories r
        JOIN g8s_product.users u ON u.id=r.owner_user_id JOIN g8s_product.installations i ON i.id=r.installation_id
        ORDER BY r.full_name,r.id LIMIT $1 OFFSET $2`, [PAGE_SIZE + 1, page * PAGE_SIZE])).rows;
      return { repositories: rows.slice(0, PAGE_SIZE).map(row => ({ ...projectRepository(row), ownerUserId: row.owner_user_id, ownerLogin: row.owner_login })),
        page: { index: page, hasNext: rows.length > PAGE_SIZE } };
    }
    if (section === 'runs') {
      rows = (await this.pool.query(`SELECT r.*,p.full_name,p.github_repo_id,u.login AS owner_login FROM g8s_product.runs r
        JOIN g8s_product.repositories p ON p.id=r.repository_id AND p.owner_user_id=r.owner_user_id AND p.org_id=r.org_id
        JOIN g8s_product.users u ON u.id=r.owner_user_id WHERE r.created_at>=$1::timestamptz AND r.created_at<$2::timestamptz
        ORDER BY r.created_at DESC,r.id DESC LIMIT $3 OFFSET $4`, [range.after, range.before, PAGE_SIZE + 1, page * PAGE_SIZE])).rows;
      return { runs: rows.slice(0, PAGE_SIZE).map(row => ({ ...projectRun(row), ownerUserId: row.owner_user_id, ownerLogin: row.owner_login })),
        page: { index: page, hasNext: rows.length > PAGE_SIZE } };
    }
    if (section === 'audit') {
      rows = (await this.pool.query(`SELECT a.*,u.login AS actor_login,u.email AS actor_email FROM g8s_product.audit_log a
        JOIN g8s_product.users u ON u.id=a.actor_user_id WHERE a.scope='admin'
          AND a.created_at>=$1::timestamptz AND a.created_at<$2::timestamptz
        ORDER BY a.created_at DESC,a.id DESC LIMIT $3 OFFSET $4`, [range.after, range.before, PAGE_SIZE + 1, page * PAGE_SIZE])).rows;
      return { entries: rows.slice(0, PAGE_SIZE).map(projectAudit), page: { index: page, hasNext: rows.length > PAGE_SIZE } };
    }
    fail('not_found', 404);
  }
}
