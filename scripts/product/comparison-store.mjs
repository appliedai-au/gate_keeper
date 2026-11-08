import { randomUUID } from 'node:crypto';
import { ClientApiStore, validateIdempotency } from './client-api-store.mjs';
import { ProductError } from './store.mjs';
import { UUID, SHA } from './contracts.mjs';
import { normalizeComparator, comparatorIdentity, validateFeedback, comparisonDigest, comparisonSummary, COMPARISON_LIMITS } from './comparison-contract.mjs';

const fail = (code = 'invalid_request', status = 400) => { throw new ProductError(code, status); };
const uuid = value => typeof value === 'string' && UUID.test(value);
const iso = value => value == null ? null : new Date(value).toISOString();
const projectFeedback = row => ({ id: row.id, snapshotId: row.snapshot_id, itemKey: row.item_key, revision: row.revision,
  verdict: row.verdict, rationale: row.rationale, trainingUse: row.training_use, linkedItemKey: row.linked_item_key,
  actorUserId: row.owner_user_id, createdAt: iso(row.created_at), promoted: false });

export class ComparisonStore {
  constructor(product, { identity, maxComparisons = 200, maxSnapshots = 10 } = {}) {
    this.identity = comparatorIdentity(identity || {});
    if (!Number.isInteger(maxComparisons) || maxComparisons < 1 || maxComparisons > 1000 ||
        !Number.isInteger(maxSnapshots) || maxSnapshots < 1 || maxSnapshots > 20) fail('setup_required', 503);
    this.product = product; this.pool = product.pool; this.auth = new ClientApiStore(product);
    this.maxComparisons = maxComparisons; this.maxSnapshots = maxSnapshots;
  }
  async ready() {
    const rows = (await this.pool.query('SELECT version FROM g8s_product.comparison_version WHERE singleton=true')).rows;
    if (rows.length !== 1 || rows[0].version !== 1) fail('setup_required', 503);
  }
  async scope(principal, slug, client) {
    // A review API key grants no training-data or comparison-management permission.
    if (principal?.kind !== 'session') fail('forbidden', 403);
    return this.auth.authority(principal, slug, 'reviews:read', null, client, true);
  }
  async rate(principal, heavy = false) {
    if (principal?.kind !== 'session') fail('forbidden', 403);
    const user = await this.auth.identity(principal);
    const cost = heavy ? 10 : 1;
    const result = await this.pool.query(`INSERT INTO g8s_product.comparison_rate_windows(owner_user_id,window_start,requests)
      VALUES($1,date_trunc('minute',clock_timestamp()),$2) ON CONFLICT(owner_user_id,window_start)
      DO UPDATE SET requests=g8s_product.comparison_rate_windows.requests+$2
      WHERE g8s_product.comparison_rate_windows.requests+$2<=120 RETURNING requests`, [user.id, cost]);
    if (!result.rows.length) fail('rate_limited', 429);
    if (result.rows[0].requests === cost) await this.pool.query(`DELETE FROM g8s_product.comparison_rate_windows
      WHERE owner_user_id=$1 AND window_start<clock_timestamp()-interval '1 day'`, [user.id]);
  }
  async runContext(principal, slug, runId, client) {
    if (!uuid(runId)) fail();
    const auth = await this.scope(principal, slug, client);
    const run = (await client.query(`SELECT r.* FROM g8s_product.runs r
      WHERE r.id=$1 AND r.owner_user_id=$2 AND r.org_id=$3`, [runId, auth.user.id, auth.org.id])).rows[0];
    if (!run) fail('not_found', 404);
    // Use installation -> repository order, retaining locks until this transaction ends.
    const installation = (await client.query(`SELECT * FROM g8s_product.installations
      WHERE id=$1 AND owner_user_id=$2 AND org_id=$3 AND disabled_reason IS NULL FOR SHARE`,
    [run.installation_id, auth.user.id, auth.org.id])).rows[0];
    const repository = installation && (await client.query(`SELECT * FROM g8s_product.repositories
      WHERE id=$1 AND installation_id=$2 AND owner_user_id=$3 AND org_id=$4 AND enabled=true AND available=true FOR SHARE`,
    [run.repository_id, installation.id, auth.user.id, auth.org.id])).rows[0];
    if (!repository) fail('not_found', 404);
    if (run.state !== 'complete' || !run.finished_at || !['pull_request', 'review'].includes(run.trigger))
      fail('review_not_complete', 409);
    const findings = (await client.query(`SELECT id,file,line,end_line,severity,category,title,explanation,evidence
      FROM g8s_product.findings WHERE run_id=$1 AND owner_user_id=$2 AND org_id=$3 ORDER BY id LIMIT 101`,
    [run.id, auth.user.id, auth.org.id])).rows;
    if (findings.length > 100) fail('comparison_too_large', 413);
    const g8s = { runId: run.id, sourceCommit: run.input?.sourceCommit ?? null, model: run.model ?? null,
      headSha: run.head_sha, baseSha: run.base_sha, baseBranch: run.base_branch, finishedAt: iso(run.finished_at),
      summary: run.result, estimatedCostUsd: run.estimated_cost_usd ?? null, costSource: run.cost_source ?? null,
      findings: findings.map(row => ({ key: 'g8s:' + row.id, source: 'g8s', kind: 'finding',
        id: row.id, file: row.file, line: row.line, endLine: row.end_line, severity: row.severity,
        category: row.category, title: row.title, explanation: row.explanation, evidence: row.evidence })) };
    return { ...auth, run, repository, installation, g8s, g8sDigest: comparisonDigest(g8s) };
  }
  async context(principal, slug, runId) {
    return this.product.transaction(client => this.runContext(principal, slug, runId, client));
  }
  async capture(principal, slug, runId, { evidence, observedRevision, expectedG8sDigest }) {
    if (!observedRevision || typeof observedRevision !== 'object' || Array.isArray(observedRevision) ||
        Object.keys(observedRevision).sort().join(',') !== 'baseBranch,baseSha,headSha,prNumber,repositoryId' ||
        typeof observedRevision.repositoryId !== 'string' || !Number.isSafeInteger(observedRevision.prNumber) ||
        typeof observedRevision.headSha !== 'string' || !SHA.test(observedRevision.headSha) ||
        typeof observedRevision.baseSha !== 'string' || !SHA.test(observedRevision.baseSha) ||
        typeof observedRevision.baseBranch !== 'string' || observedRevision.baseBranch.length < 1 || observedRevision.baseBranch.length > 250) fail();
    return this.product.transaction(async client => {
      const ctx = await this.runContext(principal, slug, runId, client);
      if (ctx.g8sDigest !== expectedG8sDigest || observedRevision.repositoryId !== ctx.repository.github_repo_id ||
          observedRevision.prNumber !== ctx.run.pr_number || observedRevision.headSha !== ctx.run.head_sha ||
          observedRevision.baseSha !== ctx.run.base_sha || observedRevision.baseBranch !== ctx.run.base_branch)
        fail('revision_changed', 409);
      const artifacts = normalizeComparator(evidence, { fullName: ctx.repository.full_name, prNumber: ctx.run.pr_number,
        headSha: ctx.run.head_sha, identity: this.identity });
      const payload = { schemaVersion: 1, repositoryId: ctx.repository.github_repo_id, repository: ctx.repository.full_name,
        prNumber: ctx.run.pr_number, observedRevision: { ...observedRevision }, g8s: ctx.g8s,
        gitar: { identity: this.identity, artifacts, collection: 'bounded_github_rest_lists',
          model: null, costUsd: null, baseBinding: 'not_provided_by_github_review' },
        independence: 'not_verified', trainingPromoted: false };
      if (Buffer.byteLength(JSON.stringify(payload)) > COMPARISON_LIMITS.snapshotBytes) fail('comparison_too_large', 413);
      const hash = comparisonDigest(payload);
      // Per-owner quota and per-run snapshots serialize without a read-before-insert race.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['g8s-comparison:' + ctx.user.id]);
      let record = (await client.query(`SELECT * FROM g8s_product.comparisons
        WHERE owner_user_id=$1 AND org_id=$2 AND run_id=$3 FOR UPDATE`, [ctx.user.id, ctx.org.id, runId])).rows[0];
      if (record?.deleted_at) fail('comparison_deleted', 410);
      if (!record) {
        const count = (await client.query(`SELECT count(*)::int AS count FROM g8s_product.comparisons
          WHERE owner_user_id=$1`, [ctx.user.id])).rows[0].count;
        if (count >= this.maxComparisons) fail('comparison_limit', 409);
        record = (await client.query(`INSERT INTO g8s_product.comparisons(id,owner_user_id,org_id,run_id)
          VALUES($1,$2,$3,$4) RETURNING *`, [randomUUID(), ctx.user.id, ctx.org.id, runId])).rows[0];
      }
      const latest = (await client.query(`SELECT * FROM g8s_product.comparison_snapshots
        WHERE comparison_id=$1 ORDER BY version DESC LIMIT 1`, [record.id])).rows[0];
      if (latest?.payload_hash === hash) return { comparisonId: record.id, snapshotId: latest.id, version: latest.version, duplicate: true };
      const version = (latest?.version ?? 0) + 1;
      if (version > this.maxSnapshots) fail('comparison_limit', 409);
      const snapshotId = randomUUID();
      await client.query(`INSERT INTO g8s_product.comparison_snapshots
        (id,comparison_id,owner_user_id,org_id,version,payload_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [snapshotId, record.id, ctx.user.id, ctx.org.id, version, hash, JSON.stringify(payload)]);
      await this.product.audit(client, ctx.user.id, ctx.org.id, 'comparison.captured',
        { comparisonId: record.id, snapshotId, version, artifactCount: artifacts.length });
      return { comparisonId: record.id, snapshotId, version, duplicate: false };
    });
  }
  async record(principal, slug, id, client, { active = true } = {}) {
    if (!uuid(id)) fail();
    const auth = await this.scope(principal, slug, client);
    const row = (await client.query(`SELECT * FROM g8s_product.comparisons
      WHERE id=$1 AND owner_user_id=$2 AND org_id=$3 FOR UPDATE`, [id, auth.user.id, auth.org.id])).rows[0];
    if (!row) fail('not_found', 404);
    if (row.deleted_at) fail('comparison_deleted', 410);
    if (active) await this.runContext(principal, slug, row.run_id, client);
    return { ...auth, row };
  }
  async list(principal, slug, page = 0) {
    if (!Number.isInteger(page) || page < 0 || page > 10000) fail();
    return this.product.transaction(async client => {
      const { user, org } = await this.scope(principal, slug, client);
      const rows = (await client.query(`SELECT c.id,c.run_id,c.created_at,r.pr_number,r.head_sha,r.base_sha,p.full_name,
        (SELECT max(version) FROM g8s_product.comparison_snapshots s WHERE s.comparison_id=c.id) AS snapshot_version
        FROM g8s_product.comparisons c JOIN g8s_product.runs r ON r.id=c.run_id
        JOIN g8s_product.repositories p ON p.id=r.repository_id AND p.owner_user_id=c.owner_user_id AND p.org_id=c.org_id
        JOIN g8s_product.installations i ON i.id=p.installation_id AND i.owner_user_id=c.owner_user_id AND i.org_id=c.org_id
        WHERE c.owner_user_id=$1 AND c.org_id=$2 AND c.deleted_at IS NULL AND p.enabled=true AND p.available=true
          AND i.disabled_reason IS NULL ORDER BY c.created_at DESC,c.id LIMIT 21 OFFSET $3`, [user.id, org.id, page * 20])).rows;
      return { comparisons: rows.slice(0, 20).map(row => ({ id: row.id, runId: row.run_id,
        prNumber: row.pr_number, headSha: row.head_sha, baseSha: row.base_sha, repository: row.full_name,
        version: row.snapshot_version, createdAt: iso(row.created_at) })), page: { index: page, hasNext: rows.length > 20 } };
    });
  }
  async detail(principal, slug, id, version = null) {
    if (version !== null && (!Number.isInteger(version) || version < 1 || version > this.maxSnapshots)) fail();
    return this.product.transaction(async client => {
      const { row } = await this.record(principal, slug, id, client);
      const snapshot = (await client.query(`SELECT * FROM g8s_product.comparison_snapshots
        WHERE comparison_id=$1 AND ($2::int IS NULL OR version=$2) ORDER BY version DESC LIMIT 1`, [id, version])).rows[0];
      if (!snapshot) fail('not_found', 404);
      const events = (await client.query(`SELECT * FROM g8s_product.comparison_feedback WHERE snapshot_id=$1
        ORDER BY created_at,id LIMIT $2`, [snapshot.id, COMPARISON_LIMITS.feedbackEvents + 1])).rows;
      if (events.length > COMPARISON_LIMITS.feedbackEvents) fail('comparison_limit', 409);
      const latest = new Map();
      for (const event of events) if ((latest.get(event.item_key)?.revision ?? 0) < event.revision) latest.set(event.item_key, event);
      const labels = [...latest.values()].map(projectFeedback);
      return { comparisonId: row.id, runId: row.run_id, snapshotId: snapshot.id, version: snapshot.version,
        payloadHash: snapshot.payload_hash, capturedAt: iso(snapshot.created_at), ...snapshot.payload,
        feedback: labels, feedbackHistory: events.map(projectFeedback), metrics: comparisonSummary(snapshot.payload, labels) };
    });
  }
  async feedback(principal, slug, id, input, idempotencyKey) {
    const body = validateFeedback(input), idem = validateIdempotency(idempotencyKey);
    const requestHash = comparisonDigest({ comparisonId: id, ...body });
    return this.product.transaction(async client => {
      const auth = await this.scope(principal, slug, client);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['g8s-comparison-feedback:' + auth.user.id + ':' + idem]);
      const { row } = await this.record(principal, slug, id, client);
      const prior = (await client.query(`SELECT * FROM g8s_product.comparison_feedback
        WHERE owner_user_id=$1 AND org_id=$2 AND idempotency_hash=$3`, [auth.user.id, auth.org.id, idem])).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash) fail('idempotency_conflict', 409);
        return { ...projectFeedback(prior), duplicate: true };
      }
      const snapshot = (await client.query(`SELECT * FROM g8s_product.comparison_snapshots
        WHERE comparison_id=$1 ORDER BY version DESC LIMIT 1`, [row.id])).rows[0];
      if (!snapshot || snapshot.id !== body.snapshotId) fail('snapshot_changed', 409);
      const items = [...snapshot.payload.g8s.findings, ...snapshot.payload.gitar.artifacts];
      if (!items.some(item => item.key === body.itemKey) || body.linkedItemKey !== null && !items.some(item => item.key === body.linkedItemKey)) fail();
      const events = (await client.query(`SELECT count(*)::int AS count,COALESCE(max(revision) FILTER(WHERE item_key=$2),0)::int AS revision
        FROM g8s_product.comparison_feedback WHERE snapshot_id=$1`, [snapshot.id, body.itemKey])).rows[0];
      if (events.count >= COMPARISON_LIMITS.feedbackEvents) fail('comparison_limit', 409);
      if (events.revision !== body.expectedRevision) fail('revision_conflict', 409);
      const saved = (await client.query(`INSERT INTO g8s_product.comparison_feedback
        (id,comparison_id,snapshot_id,owner_user_id,org_id,item_key,revision,verdict,rationale,training_use,linked_item_key,idempotency_hash,request_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [randomUUID(), row.id, snapshot.id, auth.user.id, auth.org.id, body.itemKey, events.revision + 1,
        body.verdict, body.rationale, body.trainingUse, body.linkedItemKey, idem, requestHash])).rows[0];
      await this.product.audit(client, auth.user.id, auth.org.id, 'comparison.feedback_recorded',
        { comparisonId: row.id, snapshotId: snapshot.id, feedbackId: saved.id, revision: saved.revision });
      return { ...projectFeedback(saved), duplicate: false };
    });
  }
  async remove(principal, slug, id) {
    return this.product.transaction(async client => {
      // Owners can erase imported content even after a repository is disabled.
      const { user, org, row } = await this.record(principal, slug, id, client, { active: false });
      await client.query('DELETE FROM g8s_product.comparison_feedback WHERE comparison_id=$1', [row.id]);
      await client.query('DELETE FROM g8s_product.comparison_snapshots WHERE comparison_id=$1', [row.id]);
      await client.query('UPDATE g8s_product.comparisons SET deleted_at=clock_timestamp() WHERE id=$1', [row.id]);
      await this.product.audit(client, user.id, org.id, 'comparison.deleted', { comparisonId: row.id });
      return { deleted: true, comparisonId: row.id, retained: 'content_free_run_tombstone_and_audit' };
    });
  }
}
