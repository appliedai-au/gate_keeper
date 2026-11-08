import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ProductStore, ProductError } from './store.mjs';
import { UUID, GITHUB_ID, SHA, SLUG, inReviewScope } from './contracts.mjs';

export const CLIENT_SCOPES = Object.freeze(['reviews:read', 'reviews:write']);
export const tokenHash = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const fail = (code = 'invalid_request', status = 400) => { throw new ProductError(code, status); };
const iso = value => new Date(value).toISOString();
const keyProjection = row => ({ id: row.id, name: row.name, scopes: row.scopes,
  repositoryIds: row.repository_ids, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at),
  revokedAt: row.revoked_at ? iso(row.revoked_at) : null });

export function validateReviewRequest(body) {
  if (!exact(body, ['repositoryId', 'prNumber', 'headSha', 'baseSha']) || typeof body.repositoryId !== 'string' ||
      !GITHUB_ID.test(body.repositoryId) || !Number.isSafeInteger(body.prNumber) || body.prNumber < 1 || body.prNumber > 2147483647 ||
      typeof body.headSha !== 'string' || !SHA.test(body.headSha) || typeof body.baseSha !== 'string' || !SHA.test(body.baseSha)) fail();
  return { repositoryId: body.repositoryId, prNumber: body.prNumber, headSha: body.headSha, baseSha: body.baseSha };
}
export function validateKeyRequest(body) {
  if (!exact(body, ['name', 'repositoryIds', 'scopes', 'expiresInDays']) || typeof body.name !== 'string' ||
      body.name.trim().length < 1 || body.name.length > 100 || /[\u0000-\u001f\u007f]/u.test(body.name) ||
      !Array.isArray(body.repositoryIds) || body.repositoryIds.length < 1 || body.repositoryIds.length > 100 ||
      body.repositoryIds.some(id => typeof id !== 'string' || !GITHUB_ID.test(id)) ||
      new Set(body.repositoryIds).size !== body.repositoryIds.length || !Array.isArray(body.scopes) ||
      body.scopes.length < 1 || body.scopes.some(scope => !CLIENT_SCOPES.includes(scope)) ||
      new Set(body.scopes).size !== body.scopes.length || !Number.isInteger(body.expiresInDays) ||
      body.expiresInDays < 1 || body.expiresInDays > 90) fail();
  return { ...body, name: body.name.trim(), repositoryIds: [...body.repositoryIds].sort(), scopes: [...body.scopes].sort() };
}
export function validateIdempotency(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{16,128}$/u.test(value)) fail();
  return tokenHash(value);
}

// Reuse the accepted admission implementation inside the caller's transaction.
// No nested BEGIN/COMMIT, no changed ProductStore or qualification recipe.
class TransactionProductStore extends ProductStore {
  constructor(product, transaction) {
    super(product.pool, { defaultMonthlyRunLimit: product.defaultMonthlyRunLimit,
      maxConcurrentRuns: product.defaultMaxConcurrentRuns });
    this.transactionClient = transaction;
  }
  async transaction(work) { return work(this.transactionClient); }
}

export class ClientApiStore {
  constructor(product, { requestsPerMinute = 120 } = {}) {
    if (!Number.isSafeInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 10000) fail();
    this.product = product; this.pool = product.pool; this.requestsPerMinute = requestsPerMinute;
  }
  async ready() {
    const rows = (await this.pool.query('SELECT version FROM g8s_product.client_api_version WHERE singleton=true')).rows;
    if (rows.length !== 1 || rows[0].version !== 1) fail('setup_required', 503);
  }
  async identity(principal, client = this.pool, lock = false) {
    if (!object(principal) || !['session', 'key'].includes(principal.kind) || typeof principal.hash !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(principal.hash)) fail('unauthenticated', 401);
    const session = principal.kind === 'session';
    const query = session
      ? `SELECT u.*,NULL::uuid AS key_id,NULL::uuid AS key_org,NULL::text[] AS repository_ids,NULL::text[] AS scopes
         FROM g8s_product.sessions s JOIN g8s_product.users u ON u.id=s.user_id
         WHERE s.session_hash=$1 AND s.expires_at>clock_timestamp() AND u.disabled=false
         AND (u.authorization_revoked_at IS NULL OR s.created_at>u.authorization_revoked_at)`
      : `SELECT u.*,k.id AS key_id,k.org_id AS key_org,k.repository_ids,k.scopes
         FROM g8s_product.client_keys k JOIN g8s_product.users u ON u.id=k.owner_user_id
         WHERE k.token_hash=$1 AND k.revoked_at IS NULL AND k.expires_at>clock_timestamp() AND u.disabled=false
         AND (u.authorization_revoked_at IS NULL OR k.created_at>u.authorization_revoked_at)`;
    const row = (await client.query(query + (lock ? session ? ' FOR SHARE OF u,s' : ' FOR SHARE OF u,k' : ''), [principal.hash])).rows[0];
    if (!row) fail('unauthenticated', 401);
    return row;
  }
  async authority(principal, slug, scope, repositoryId = null, client = this.pool, lock = false) {
    if (typeof slug !== 'string' || !SLUG.test(slug)) fail('not_found', 404);
    const user = await this.identity(principal, client, lock);
    const org = await this.product.membership(user.id, slug, client);
    if (principal.kind === 'key' && (user.key_org !== org.id || !user.scopes.includes(scope) ||
        repositoryId !== null && !user.repository_ids.includes(repositoryId))) fail('forbidden', 403);
    return { user, org };
  }
  async rate(principal) {
    const user = await this.identity(principal);
    const result = await this.pool.query(`INSERT INTO g8s_product.client_rate_windows(owner_user_id,window_start,requests)
      VALUES($1,date_trunc('minute',clock_timestamp()),1)
      ON CONFLICT(owner_user_id,window_start) DO UPDATE SET requests=g8s_product.client_rate_windows.requests+1
      WHERE g8s_product.client_rate_windows.requests<$2 RETURNING requests`, [user.id, this.requestsPerMinute]);
    if (!result.rows.length) fail('rate_limited', 429);
    // Only an insert returns one; all updates increment an existing positive
    // count. Concurrent callers therefore prune at most once per owner/minute.
    // Do not cache authority across this check, GitHub I/O and final admission.
    if (result.rows[0].requests === 1) await this.pool.query(`DELETE FROM g8s_product.client_rate_windows WHERE owner_user_id=$1
      AND window_start<clock_timestamp()-interval '1 day'`, [user.id]);
  }
  async repository(principal, slug, repositoryId, scope, client = this.pool, lock = false) {
    if (typeof repositoryId !== 'string' || !GITHUB_ID.test(repositoryId)) fail();
    const auth = await this.authority(principal, slug, scope, repositoryId, client, lock);
    const row = (await client.query(`SELECT r.*,i.github_installation_id,s.configuration
      FROM g8s_product.repositories r JOIN g8s_product.installations i ON i.id=r.installation_id
        AND i.owner_user_id=r.owner_user_id AND i.org_id=r.org_id
      JOIN g8s_product.settings s ON s.owner_user_id=r.owner_user_id AND s.org_id=r.org_id
      WHERE r.owner_user_id=$1 AND r.org_id=$2 AND r.github_repo_id=$3
        AND r.enabled=true AND r.available=true AND i.disabled_reason IS NULL`, [auth.user.id, auth.org.id, repositoryId])).rows[0];
    if (!row) fail('not_found', 404);
    return { ...auth, repository: row };
  }
  async issueKey(principal, slug, input) {
    if (principal.kind !== 'session') fail('forbidden', 403);
    const body = validateKeyRequest(input);
    return this.product.transaction(async client => {
      const { user, org } = await this.authority(principal, slug, 'reviews:write', null, client, true);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['g8s-api-keys:' + user.id]);
      const count = (await client.query(`SELECT count(*)::int AS count FROM g8s_product.client_keys
        WHERE owner_user_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [user.id])).rows[0].count;
      if (count >= 20) fail('key_limit_reached', 409);
      for (const id of body.repositoryIds) await this.repository(principal, slug, id, 'reviews:write', client);
      const secret = 'g8s_v1_' + randomBytes(32).toString('base64url');
      const row = (await client.query(`INSERT INTO g8s_product.client_keys
        (id,owner_user_id,org_id,name,token_hash,scopes,repository_ids,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+$8*interval '1 day') RETURNING *`,
      [randomUUID(), user.id, org.id, body.name, tokenHash(secret), body.scopes, body.repositoryIds, body.expiresInDays])).rows[0];
      await this.product.audit(client, user.id, org.id, 'client.key_created', { keyId: row.id, scopes: body.scopes,
        repositoryIds: body.repositoryIds, expiresAt: iso(row.expires_at) });
      return { key: keyProjection(row), token: secret, shownOnce: true };
    });
  }
  async listKeys(principal, slug) {
    if (principal.kind !== 'session') fail('forbidden', 403);
    const { user, org } = await this.authority(principal, slug, 'reviews:read');
    const rows = (await this.pool.query(`SELECT * FROM g8s_product.client_keys
      WHERE owner_user_id=$1 AND org_id=$2
      ORDER BY (revoked_at IS NULL AND expires_at>clock_timestamp()) DESC,created_at DESC,id DESC LIMIT 101`, [user.id, org.id])).rows;
    return { keys: rows.slice(0, 100).map(keyProjection), hasMoreHistory: rows.length > 100 };
  }
  async revokeKey(principal, slug, id) {
    if (principal.kind !== 'session') fail('forbidden', 403);
    if (typeof id !== 'string' || !UUID.test(id)) fail();
    return this.product.transaction(async client => {
      const { user, org } = await this.authority(principal, slug, 'reviews:write', null, client, true);
      const row = (await client.query(`UPDATE g8s_product.client_keys SET revoked_at=COALESCE(revoked_at,clock_timestamp())
        WHERE id=$1 AND owner_user_id=$2 AND org_id=$3 RETURNING id`, [id, user.id, org.id])).rows[0];
      if (!row) fail('not_found', 404);
      await this.product.audit(client, user.id, org.id, 'client.key_revoked', { keyId: id });
      return { revoked: true, id };
    });
  }
  async existingRequest(principal, slug, input, idempotencyKey, client = this.pool) {
    const body = validateReviewRequest(input), idem = validateIdempotency(idempotencyKey);
    const { user, org } = await this.repository(principal, slug, body.repositoryId, 'reviews:write', client);
    const row = (await client.query(`SELECT run_id,request_hash FROM g8s_product.client_requests
      WHERE owner_user_id=$1 AND org_id=$2 AND idempotency_hash=$3`, [user.id, org.id, idem])).rows[0];
    if (!row) return null;
    if (row.request_hash !== tokenHash(JSON.stringify(body))) fail('idempotency_conflict', 409);
    return { runId: row.run_id, duplicate: true };
  }
  async submit(principal, slug, input, idempotencyKey, pr) {
    const body = validateReviewRequest(input), idem = validateIdempotency(idempotencyKey);
    if (!object(pr) || pr.number !== body.prNumber || pr.head?.sha !== body.headSha || pr.base?.sha !== body.baseSha ||
        typeof pr.base?.ref !== 'string' || pr.base.ref.length > 200 || typeof pr.title !== 'string' || pr.title.length > 1000 ||
        !['User', 'Bot'].includes(pr.user?.type) || typeof pr.user?.login !== 'string') fail('revision_changed', 409);
    return this.product.transaction(async client => {
      // Serialize only this caller's request identity. All admission writes,
      // including its provenance record and request receipt, commit together.
      const auth = await this.repository(principal, slug, body.repositoryId, 'reviews:write', client, true);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['g8s-api-request:' + auth.user.id + ':' + auth.org.id + ':' + idem]);
      const old = await this.existingRequest(principal, slug, body, idempotencyKey, client);
      if (old) return old;
      const configuration = { ...auth.repository.configuration, ...auth.repository.overrides };
      if (!inReviewScope(pr, configuration)) fail('review_out_of_scope', 409);
      const requestId = randomUUID(), deliveryId = randomUUID();
      // The existing delivery table is also the FK provenance table for runs.
      // This is explicitly an authenticated API event, NEVER a signed GitHub webhook.
      // Mark it processed so the webhook worker cannot interpret it as GitHub input.
      const payload = { source: 'g8s_client_api', requestId, userId: auth.user.id, orgId: auth.org.id,
        repositoryId: body.repositoryId, prNumber: body.prNumber, headSha: body.headSha, baseSha: body.baseSha };
      await client.query(`INSERT INTO g8s_product.webhook_deliveries(delivery_id,event,payload,payload_hash,status,completed_at)
        VALUES($1,'g8s_client_api',$2,$3,'processed',clock_timestamp())`, [deliveryId, JSON.stringify(payload), tokenHash(JSON.stringify(payload))]);
      const admission = new TransactionProductStore(this.product, client);
      const rows = await admission.enqueueRun({ deliveryId, installationId: auth.repository.github_installation_id,
        repositoryId: body.repositoryId, prNumber: body.prNumber, headSha: body.headSha, baseSha: body.baseSha,
        title: pr.title, prUrl: `https://github.com/${auth.repository.full_name}/pull/${body.prNumber}`,
        authorLogin: pr.user.login, authorType: pr.user.type, baseBranch: pr.base.ref,
        draft: pr.draft === true, merged: pr.merged === true, state: pr.state, trigger: 'review',
        actorLogin: auth.user.login, actorGithubId: auth.user.github_id, actorType: 'User', findingId: null });
      if (rows.length !== 1 || rows[0].ownerUserId !== auth.user.id || rows[0].orgId !== auth.org.id) fail('review_out_of_scope', 409);
      await client.query(`INSERT INTO g8s_product.client_requests
        (id,owner_user_id,org_id,repository_id,key_id,idempotency_hash,request_hash,run_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [requestId, auth.user.id, auth.org.id, auth.repository.id,
        auth.user.key_id, idem, tokenHash(JSON.stringify(body)), rows[0].id]);
      await this.product.audit(client, auth.user.id, auth.org.id, 'client.review_requested',
        { requestId, runId: rows[0].id, keyId: auth.user.key_id, repositoryId: body.repositoryId,
          headSha: body.headSha, baseSha: body.baseSha });
      return { runId: rows[0].id, duplicate: false };
    });
  }
  async run(principal, slug, id) {
    if (typeof id !== 'string' || !UUID.test(id)) fail('not_found', 404);
    const auth = await this.authority(principal, slug, 'reviews:read');
    const row = (await this.pool.query(`SELECT p.github_repo_id FROM g8s_product.runs r
      JOIN g8s_product.repositories p ON p.id=r.repository_id AND p.owner_user_id=r.owner_user_id AND p.org_id=r.org_id
      WHERE r.id=$1 AND r.owner_user_id=$2 AND r.org_id=$3`, [id, auth.user.id, auth.org.id])).rows[0];
    if (!row) fail('not_found', 404);
    await this.repository(principal, slug, row.github_repo_id, 'reviews:read');
    return this.product.runDetail(auth.user.id, slug, id);
  }
}
