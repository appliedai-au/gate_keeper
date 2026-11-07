import { createHash, randomUUID } from 'node:crypto';
import { validFindings, validJob } from '../../integrations/base44/shared/review-contract.js';

export class ReviewError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scoped = scope => [scope.appId, scope.ownerId];
const normalizeInput = input => ({ file: input.file, language: input.language,
  context: input.context, code: input.code.replace(/\r\n?/gu, '\n') });

export function projectJob(row, detail = true) {
  const job = {
    id: row.id, requestKey: row.idempotency_key, file: row.input.file, language: row.input.language,
    lineCount: row.input.code.split('\n').length, state: row.state, code: row.code,
    sourceCommit: row.source_commit, createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    estimatedCostUsd: row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd),
    billingStatus: 'unsettled',
    ...(detail ? { findings: row.findings } : {}),
  };
  if (!validJob(job, detail)) throw new ReviewError('review_unavailable');
  return job;
}

export class ReviewStore {
  constructor(pool) { this.pool = pool; }
  async ready() {
    const result = await this.pool.query('SELECT version FROM gatekeeper_reviews.schema_version WHERE singleton = true');
    if (result.rows.length !== 1 || result.rows[0].version !== 1) throw new ReviewError('review_unavailable');
  }
  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Connection may already be gone. */ }
      throw error;
    } finally { client.release(); }
  }
  async admit(scope, key, rawInput, binding) {
    const input = normalizeInput(rawInput), inputDigest = digest(input);
    return this.transaction(async client => {
      // PostgreSQL transaction lock serializes same-owner admission. The unique
      // indexes remain the durable backstop; an in-process lock is never authority.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', scoped(scope));
      const old = await client.query(`SELECT * FROM gatekeeper_reviews.jobs
        WHERE app_id=$1 AND owner_id=$2 AND idempotency_key=$3`, [...scoped(scope), key]);
      if (old.rows.length) {
        if (old.rows[0].input_digest !== inputDigest) throw new ReviewError('idempotency_conflict', 409);
        return old.rows[0];
      }
      const active = await client.query(`SELECT id FROM gatekeeper_reviews.jobs
        WHERE app_id=$1 AND owner_id=$2 AND state NOT IN ('complete','failed') LIMIT 1`, scoped(scope));
      if (active.rows.length) throw new ReviewError('review_in_progress', 409);
      const result = await client.query(`INSERT INTO gatekeeper_reviews.jobs
        (id,app_id,owner_id,idempotency_key,input_digest,input,source_commit,runtime_digest,state)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued') RETURNING *`,
      [randomUUID(), ...scoped(scope), key, inputDigest, input, binding.sourceCommit, binding.runtimeDigest]);
      return result.rows[0];
    });
  }
  async get(scope, id, client = this.pool) {
    const result = await client.query(`SELECT * FROM gatekeeper_reviews.jobs
      WHERE app_id=$1 AND owner_id=$2 AND id=$3`, [...scoped(scope), id]);
    if (result.rows.length !== 1) throw new ReviewError('not_found', 404);
    return result.rows[0];
  }
  async list(scope) {
    return (await this.pool.query(`SELECT * FROM gatekeeper_reviews.jobs
      WHERE app_id=$1 AND owner_id=$2 ORDER BY created_at DESC,id DESC LIMIT 20`, scoped(scope))).rows;
  }
  async claim(scope, id, binding, makeRequest) {
    return this.transaction(async client => {
      const result = await client.query(`SELECT * FROM gatekeeper_reviews.jobs
        WHERE app_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`, [...scoped(scope), id]);
      const row = result.rows[0];
      if (!row) throw new ReviewError('not_found', 404);
      const drift = row.source_commit !== binding.sourceCommit || row.runtime_digest !== binding.runtimeDigest;
      if (drift && !['complete', 'failed', 'held'].includes(row.state)) {
        let nextState = 'held';
        // A queued label alone is insufficient. Under the same row lock, prove
        // there are neither upstream IDs nor any durable intent/receipt before
        // releasing the owner's slot. Every application observation writer takes
        // this row lock, so a concurrent claim cannot appear between these steps.
        if (row.state === 'queued' && row.session_id === null && row.turn_id === null) {
          const evidence = await client.query(`SELECT stage FROM gatekeeper_reviews.observations
            WHERE job_id=$1 LIMIT 1`, [id]);
          if (evidence.rows.length === 0) nextState = 'failed';
        }
        const changed = await client.query(`UPDATE gatekeeper_reviews.jobs SET state=$4,
          code='runtime_changed', updated_at=now() WHERE app_id=$1 AND owner_id=$2 AND id=$3
          AND state=$5 RETURNING *`, [...scoped(scope), id, nextState, row.state]);
        if (changed.rows.length !== 1) throw new ReviewError('review_unavailable');
        return { row: changed.rows[0], claim: null };
      }
      if (!['queued', 'session_created'].includes(row.state)) return { row, claim: null };
      const phase = row.state === 'queued' ? 'session' : 'turn';
      const request = makeRequest(row, phase);
      await client.query(`INSERT INTO gatekeeper_reviews.observations(job_id,stage,payload)
        VALUES ($1,$2,$3)`, [id, phase + '_intent', request]);
      const updated = await client.query(`UPDATE gatekeeper_reviews.jobs
        SET state=$4,code=NULL,updated_at=now() WHERE app_id=$1 AND owner_id=$2 AND id=$3
        AND state=$5 RETURNING *`, [...scoped(scope), id, phase + '_dispatch', row.state]);
      if (updated.rows.length !== 1) throw new ReviewError('review_unavailable');
      return { row: updated.rows[0], claim: { phase, request } };
    });
  }
  async receipt(scope, id, phase, response, upstreamId) {
    return this.transaction(async client => {
      await client.query(`SELECT id FROM gatekeeper_reviews.jobs
        WHERE app_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`, [...scoped(scope), id]);
      const row = await this.get(scope, id, client);
      // Archive a late receipt even if the job was already held. It must remain
      // available for reconciliation, but never reopen the job automatically.
      await client.query(`INSERT INTO gatekeeper_reviews.observations(job_id,stage,payload)
        VALUES ($1,$2,$3)`, [id, phase + '_receipt', response]);
      if (row.state !== phase + '_dispatch') return row;
      if (upstreamId === null) {
        const held = await client.query(`UPDATE gatekeeper_reviews.jobs SET state='held',
          code='dispatch_uncertain',updated_at=now() WHERE app_id=$1 AND owner_id=$2 AND id=$3
          RETURNING *`, [...scoped(scope), id]);
        return held.rows[0];
      }
      const next = phase === 'session' ? 'session_created' : 'running';
      const result = await client.query(`UPDATE gatekeeper_reviews.jobs SET state=$4,
        session_id=CASE WHEN $5='session' THEN $6 ELSE session_id END,
        turn_id=CASE WHEN $5='turn' THEN $6 ELSE turn_id END,updated_at=now()
        WHERE app_id=$1 AND owner_id=$2 AND id=$3 AND state=$7 RETURNING *`,
      [...scoped(scope), id, next, phase, upstreamId, phase + '_dispatch']);
      return result.rows[0] ?? row;
    });
  }
  async hold(scope, id, expectedState, code) {
    await this.pool.query(`UPDATE gatekeeper_reviews.jobs SET state='held',code=$5,updated_at=now()
      WHERE app_id=$1 AND owner_id=$2 AND id=$3 AND state=$4`, [...scoped(scope), id, expectedState, code]);
    return this.get(scope, id);
  }
  async expireDispatch(scope, id) {
    await this.pool.query(`UPDATE gatekeeper_reviews.jobs SET state='held',code='dispatch_uncertain',updated_at=now()
      WHERE app_id=$1 AND owner_id=$2 AND id=$3 AND state IN ('session_dispatch','turn_dispatch')
      AND updated_at < now() - interval '2 minutes'`, [...scoped(scope), id]);
    return this.get(scope, id);
  }
  async finish(scope, id, result) {
    return this.transaction(async client => {
      await client.query(`SELECT id FROM gatekeeper_reviews.jobs
        WHERE app_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE`, [...scoped(scope), id]);
      const row = await this.get(scope, id, client);
      if (row.state !== 'running') return row;
      if (!['complete', 'failed', 'held'].includes(result.state) ||
          (result.state === 'complete' && !validFindings(result.findings, row.input.code.split('\n').length)))
        throw new ReviewError('review_unavailable');
      await client.query(`INSERT INTO gatekeeper_reviews.observations(job_id,stage,payload)
        VALUES ($1,'terminal',$2)`, [id, result.observation]);
      const updated = await client.query(`UPDATE gatekeeper_reviews.jobs
        SET state=$4,code=$5,findings=$6,estimated_cost_usd=$7,updated_at=now()
        WHERE app_id=$1 AND owner_id=$2 AND id=$3 AND state='running' RETURNING *`,
      [...scoped(scope), id, result.state, result.code,
        result.state === 'complete' ? JSON.stringify(result.findings) : null, result.estimatedCostUsd]);
      return updated.rows[0] ?? row;
    });
  }
}
