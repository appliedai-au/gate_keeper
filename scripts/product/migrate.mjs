// Explicit owner-run migration, never imported by the HTTP server or worker.
import { readFileSync } from 'node:fs';
import { openReviewPool } from '../reviews/runtime.mjs';

if (process.env.G8S_APPLY_PRODUCT_SCHEMA !== 'apply-v1') {
  process.stderr.write('Product schema migration requires explicit owner activation.\n');
  process.exitCode = 1;
} else {
  let pool;
  try {
    pool = openReviewPool();
    await pool.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    process.stdout.write('G8S product schema v1 applied. New runs remain paused.\n');
  } catch {
    process.stderr.write('Product schema migration did not complete. Review the database state privately.\n');
    process.exitCode = 1;
  } finally { await pool?.end().catch(() => {}); }
}
