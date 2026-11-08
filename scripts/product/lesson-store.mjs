import { randomUUID } from 'node:crypto';
import { ComparisonStore } from './comparison-store.mjs';
import { buildLessonSubject, validateLearningPolicy, verifyLessonAdmission, exact, refuseLesson,
  REQUIRED_CHECKS, lessonHash, LEARNING_POLICY_LABEL } from './lesson-verification.mjs';

const projection = row => ({ revision: row.revision, requireAdversarialVerification: row.require_adversarial,
  updatedAt: new Date(row.updated_at).toISOString(), benchmark: 'gitar_process',
  deterministicChecksRequired: [...REQUIRED_CHECKS], humanConfirmationRequired: true });

export class LessonStore {
  constructor(product, { identity, adminGithubIds = new Set(), trust = {} } = {}) {
    this.product = product; this.pool = product.pool;
    this.comparisons = new ComparisonStore(product, { identity });
    this.adminGithubIds = new Set(adminGithubIds); this.trust = trust;
  }
  async ready() {
    await this.comparisons.ready();
    const rows = (await this.pool.query('SELECT version FROM g8s_product.lesson_version WHERE singleton=true')).rows;
    if (rows.length !== 1 || rows[0].version !== 1) refuseLesson('verification_setup_required', 503);
  }
  async policy(client = this.pool, lock = false) {
    const row = (await client.query('SELECT * FROM g8s_product.learning_policy WHERE singleton=true' + (lock ? ' FOR SHARE' : ''))).rows[0];
    if (!row || !Number.isInteger(row.revision) || typeof row.require_adversarial !== 'boolean') refuseLesson('verification_setup_required', 503);
    return projection(row);
  }
  async admin(principal, client) {
    if (principal?.kind !== 'session') refuseLesson('forbidden', 403);
    const user = await this.comparisons.auth.identity(principal, client, true);
    if (!this.adminGithubIds.has(user.github_id)) refuseLesson('forbidden', 403);
    return user;
  }
  async readPolicy(principal) {
    return this.product.transaction(async client => {
      await this.admin(principal, client);
      const policy = await this.policy(client);
      const roles = new Set(Object.values(this.trust).map(value => value.role));
      return { ...policy, label: LEARNING_POLICY_LABEL, verifierConfigured: roles.has('deterministic') &&
        (!policy.requireAdversarialVerification || roles.has('adversarial')),
        automaticExecutionReady: false, automaticTrainingEnabled: false };
    });
  }
  async savePolicy(principal, input) {
    const body = validateLearningPolicy(input);
    return this.product.transaction(async client => {
      const user = await this.admin(principal, client);
      const row = (await client.query(`UPDATE g8s_product.learning_policy
        SET require_adversarial=$1,revision=revision+1,updated_by=$2,updated_at=clock_timestamp()
        WHERE singleton=true AND revision=$3 RETURNING *`,
      [body.requireAdversarialVerification, user.id, body.expectedRevision])).rows[0];
      if (!row) refuseLesson('revision_conflict', 409);
      await this.product.audit(client, user.id, null, 'learning.policy_changed', {
        revision: row.revision, requireAdversarialVerification: row.require_adversarial, reason: body.reason });
      return { ...projection(row), label: LEARNING_POLICY_LABEL, automaticExecutionReady: false, automaticTrainingEnabled: false };
    });
  }
  async prepare(principal, slug, comparisonId, change = null) {
    const detail = await this.comparisons.detail(principal, slug, comparisonId);
    const policy = await this.policy();
    const bound = buildLessonSubject(detail, policy, change);
    return { ...bound, policy, status: 'verification_required',
      requestedEvidence: policy.requireAdversarialVerification ? ['deterministic', 'adversarial', 'human'] : ['deterministic', 'human'],
      automaticExecutionReady: false, modelCalled: false, lessonsBanked: false };
  }
  /** Recheck under the SAME comparison lock used by capture/feedback/deletion. */
  async bank(principal, slug, comparisonId, input) {
    if (!exact(input, ['expectedSubjectHash', 'change', 'evidence', 'confirmed', 'reason']) ||
        typeof input.expectedSubjectHash !== 'string' || !/^[a-f0-9]{64}$/u.test(input.expectedSubjectHash) ||
        input.confirmed !== true || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500 ||
        Buffer.byteLength(JSON.stringify(input)) > 300 * 1024) refuseLesson();
    const detail = await this.comparisons.detail(principal, slug, comparisonId);
    return this.product.transaction(async client => {
      const auth = await this.comparisons.record(principal, slug, comparisonId, client);
      const latest = (await client.query(`SELECT id,payload_hash FROM g8s_product.comparison_snapshots
        WHERE comparison_id=$1 ORDER BY version DESC LIMIT 1`, [comparisonId])).rows[0];
      if (!latest || latest.id !== detail.snapshotId || latest.payload_hash !== detail.payloadHash) refuseLesson('snapshot_changed', 409);
      const rows = (await client.query(`SELECT DISTINCT ON(item_key) * FROM g8s_product.comparison_feedback
        WHERE snapshot_id=$1 ORDER BY item_key,revision DESC`, [latest.id])).rows;
      const feedback = rows.map(row => ({ id: row.id, itemKey: row.item_key, revision: row.revision,
        verdict: row.verdict, rationale: row.rationale, trainingUse: row.training_use, linkedItemKey: row.linked_item_key }));
      const policy = await this.policy(client, true);
      const bound = buildLessonSubject({ ...detail, feedback }, policy, input.change);
      if (bound.subjectHash !== input.expectedSubjectHash) refuseLesson('verification_stale', 409);
      // Even idempotent readback rechecks current trust, policy, feedback and authorization.
      const verification = verifyLessonAdmission({ ...bound, evidence: input.evidence, trust: this.trust });
      const saved = (await client.query(`INSERT INTO g8s_product.banked_lesson_batches
        (id,comparison_id,snapshot_id,owner_user_id,org_id,subject_hash,policy_revision,subject,evidence,verification,confirmed_by,confirmation_reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$4,$11)
        ON CONFLICT(owner_user_id,org_id,subject_hash) DO NOTHING RETURNING id,created_at`,
      [randomUUID(), comparisonId, latest.id, auth.user.id, auth.org.id, bound.subjectHash, policy.revision,
        JSON.stringify(bound.subject), JSON.stringify(input.evidence), JSON.stringify(verification), input.reason.trim()])).rows[0];
      const existing = saved || (await client.query(`SELECT id,created_at FROM g8s_product.banked_lesson_batches
        WHERE owner_user_id=$1 AND org_id=$2 AND subject_hash=$3`, [auth.user.id, auth.org.id, bound.subjectHash])).rows[0];
      if (!existing) refuseLesson('product_unavailable', 503);
      if (saved) await this.product.audit(client, auth.user.id, auth.org.id, 'learning.lessons_banked', {
        batchId: existing.id, snapshotId: latest.id, policyRevision: policy.revision, subjectHash: bound.subjectHash,
        verificationHash: lessonHash(verification), count: bound.candidates.length });
      return { batchId: existing.id, duplicate: !saved, status: 'banked_verified_examples', count: bound.candidates.length,
        subjectHash: bound.subjectHash, policyRevision: policy.revision, mode: verification.mode,
        trainingStarted: false, reviewerActivated: false, automaticTrainingEligible: false };
    });
  }
  async list(principal, slug, comparisonId) {
    const detail = await this.comparisons.detail(principal, slug, comparisonId);
    return this.product.transaction(async client => {
      const { user, org } = await this.comparisons.record(principal, slug, comparisonId, client);
      const policy = await this.policy(client);
      const rows = (await client.query(`SELECT id,subject_hash,policy_revision,subject,created_at FROM g8s_product.banked_lesson_batches
        WHERE owner_user_id=$1 AND org_id=$2 AND comparison_id=$3 ORDER BY created_at DESC LIMIT 101`,
      [user.id, org.id, comparisonId])).rows;
      return { lessons: rows.slice(0, 100).map(row => {
        let current = false;
        try { current = buildLessonSubject(detail, policy, row.subject.change).subjectHash === row.subject_hash; } catch { /* Retracted or invalid source. */ }
        return { id: row.id, subjectHash: row.subject_hash, policyRevision: row.policy_revision,
          status: current ? 'banked_requires_training_acceptance' : 'stale_requires_reverification',
          createdAt: new Date(row.created_at).toISOString(), automaticTrainingEligible: false };
      }), hasMore: rows.length > 100, trainingStarted: false };
    });
  }
}
