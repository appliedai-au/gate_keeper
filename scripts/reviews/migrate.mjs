// Explicit operator step after independent review and remote source qualification.
// This file has not been executed locally. It does not register providers or call models.
import { readFileSync } from 'node:fs';
import { openReviewPool } from './runtime.mjs';

if (process.argv.slice(2).join(' ') !== '--apply-reviewed-schema-v1')
  throw new Error('Pass --apply-reviewed-schema-v1 only on the qualified deployment.');
const pool = openReviewPool();
try { await pool.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')); }
finally { await pool.end(); }
