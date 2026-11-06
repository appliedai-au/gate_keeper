-- Explicit post-qualification migration on the existing PostgreSQL database.
-- Never run this during the frozen learning pilot. No TrueForge/learning tables change.
BEGIN;
CREATE SCHEMA IF NOT EXISTS gatekeeper_reviews;
CREATE TABLE IF NOT EXISTS gatekeeper_reviews.schema_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL CHECK (version = 1)
);
INSERT INTO gatekeeper_reviews.schema_version(singleton, version) VALUES (true, 1)
  ON CONFLICT (singleton) DO NOTHING;
CREATE TABLE IF NOT EXISTS gatekeeper_reviews.jobs (
  id uuid PRIMARY KEY,
  app_id text NOT NULL,
  owner_id text NOT NULL,
  idempotency_key uuid NOT NULL,
  input_digest char(64) NOT NULL,
  input jsonb NOT NULL,
  source_commit char(40) NOT NULL,
  runtime_digest char(64) NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'session_dispatch', 'session_created',
    'turn_dispatch', 'running', 'complete', 'failed', 'held')),
  code text,
  session_id text,
  turn_id text,
  findings jsonb,
  estimated_cost_usd double precision CHECK (estimated_cost_usd >= 0 AND estimated_cost_usd < 'Infinity'::float8),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, owner_id, idempotency_key),
  CHECK ((state = 'complete' AND findings IS NOT NULL AND jsonb_typeof(findings) = 'array') OR
         (state <> 'complete' AND findings IS NULL)),
  CHECK (turn_id IS NULL OR session_id IS NOT NULL)
);
-- Uncertain operations keep this slot. A new browser UUID cannot bypass a hold.
CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved_review_per_owner
  ON gatekeeper_reviews.jobs(app_id, owner_id)
  WHERE state NOT IN ('complete', 'failed');
CREATE INDEX IF NOT EXISTS reviews_owner_history
  ON gatekeeper_reviews.jobs(app_id, owner_id, created_at DESC, id);
CREATE TABLE IF NOT EXISTS gatekeeper_reviews.observations (
  job_id uuid NOT NULL REFERENCES gatekeeper_reviews.jobs(id),
  stage text NOT NULL CHECK (stage IN ('session_intent', 'session_receipt', 'turn_intent', 'turn_receipt', 'terminal')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, stage)
);
REVOKE ALL ON SCHEMA gatekeeper_reviews FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA gatekeeper_reviews FROM PUBLIC;
COMMIT;
