-- Additive G8S client API. Apply explicitly after schema.sql; startup never runs DDL.
-- No historical learning table, journal, receipt or existing schema version changes.
BEGIN;
CREATE TABLE IF NOT EXISTS g8s_product.client_api_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL CHECK (version=1)
);
CREATE TABLE IF NOT EXISTS g8s_product.client_keys (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 2 AND scopes <@ ARRAY['reviews:read','reviews:write']::text[]),
  repository_ids text[] NOT NULL CHECK (cardinality(repository_ids) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (org_id, owner_user_id) REFERENCES g8s_product.organizations(id, owner_user_id),
  CHECK (expires_at>created_at),
  UNIQUE(id,owner_user_id,org_id)
);
CREATE INDEX IF NOT EXISTS client_keys_owner ON g8s_product.client_keys(owner_user_id,org_id);
CREATE TABLE IF NOT EXISTS g8s_product.client_requests (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  repository_id uuid NOT NULL,
  key_id uuid,
  idempotency_hash char(64) NOT NULL CHECK (idempotency_hash ~ '^[0-9a-f]{64}$'),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  run_id uuid NOT NULL REFERENCES g8s_product.runs(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (repository_id,owner_user_id,org_id) REFERENCES g8s_product.repositories(id,owner_user_id,org_id),
  FOREIGN KEY (key_id,owner_user_id,org_id) REFERENCES g8s_product.client_keys(id,owner_user_id,org_id),
  UNIQUE(owner_user_id,org_id,idempotency_hash)
);
CREATE TABLE IF NOT EXISTS g8s_product.client_rate_windows (
  owner_user_id uuid NOT NULL REFERENCES g8s_product.users(id),
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK (requests>0),
  PRIMARY KEY(owner_user_id,window_start)
);
INSERT INTO g8s_product.client_api_version(singleton,version) VALUES(true,1) ON CONFLICT DO NOTHING;
COMMIT;
