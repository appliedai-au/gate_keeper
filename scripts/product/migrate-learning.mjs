import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openReviewPool } from '../reviews/runtime.mjs';

export async function applyLearningSchemas(pool) {
  const client = await pool.connect(); let locked = false;
  try {
    const result = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', ['g8s-comparison-lesson-schema-v1']);
    if (result.rows[0]?.acquired !== true) throw Error('setup_busy'); locked = true;
    if ((await client.query('SELECT version FROM g8s_product.schema_version WHERE singleton=true')).rows[0]?.version !== 1)
      throw Error('product_schema_required');
    const applied = [];
    for (const [name, file] of [['comparison_version', 'comparison-schema.sql'], ['lesson_version', 'lesson-schema.sql']]) {
      const present = (await client.query('SELECT to_regclass($1) IS NOT NULL AS present', ['g8s_product.' + name])).rows[0]?.present;
      if (present === false) { await client.query(readFileSync(new URL('./' + file, import.meta.url), 'utf8')); applied.push(file); }
      else if (present !== true) throw Error('unknown_schema_state');
      if ((await client.query('SELECT version FROM g8s_product.' + name + ' WHERE singleton=true')).rows[0]?.version !== 1)
        throw Error('schema_version_mismatch');
      const source = readFileSync(new URL('./' + file, import.meta.url), 'utf8');
      const tables = [...source.matchAll(/CREATE TABLE IF NOT EXISTS g8s_product\.([a-z_]+)/gu)].map(match => 'g8s_product.' + match[1]);
      for (const table of tables) if (!(await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [table])).rows[0]?.present)
        throw Error('partial_schema');
    }
    const policy = (await client.query('SELECT revision,require_adversarial FROM g8s_product.learning_policy WHERE singleton=true')).rows[0];
    if (!policy || !Number.isInteger(policy.revision) || typeof policy.require_adversarial !== 'boolean') throw Error('policy_missing');
    return { applied, comparisonVersion: 1, lessonVersion: 1, policyRevision: policy.revision,
      requireAdversarialVerification: policy.require_adversarial, workersEnabled: false };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['g8s-comparison-lesson-schema-v1']).catch(() => {});
    client.release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let pool;
  const deadline = setTimeout(() => process.exit(1), 60000); deadline.unref();
  try {
    if (process.env.G8S_APPLY_LEARNING_SCHEMA !== 'apply-v1' || !/^[a-f0-9]{40}$/u.test(process.env.G8S_PRODUCT_SOURCE_COMMIT || '') ||
        process.env.G8S_PRODUCT_SOURCE_COMMIT !== process.env.RAILWAY_GIT_COMMIT_SHA) throw Error('explicit_source_required');
    pool = openReviewPool();
    const result = await applyLearningSchemas(pool);
    console.log('G8S_LEARNING_SCHEMA_READBACK ' + JSON.stringify({ ...result, sourceCommit: process.env.RAILWAY_GIT_COMMIT_SHA,
      at: new Date().toISOString() }));
  } catch { console.error('G8S_LEARNING_SCHEMA_REFUSED: inspect privately; no blind retry'); process.exitCode = 1; }
  finally { await pool?.end().catch(() => {}); clearTimeout(deadline); }
  await new Promise(resolve => setTimeout(resolve, 1500));
}
