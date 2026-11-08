-- Explicit additive migration only; never run at HTTP startup.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM g8s_product.schema_version WHERE singleton=true AND version=1) THEN
    RAISE EXCEPTION 'product schema v1 is required';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS g8s_product.comparison_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), version integer NOT NULL CHECK(version=1)
);
INSERT INTO g8s_product.comparison_version(singleton,version) VALUES(true,1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS g8s_product.comparisons (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  run_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  UNIQUE(owner_user_id,org_id,run_id),
  UNIQUE(id,owner_user_id,org_id),
  FOREIGN KEY(run_id,owner_user_id,org_id) REFERENCES g8s_product.runs(id,owner_user_id,org_id)
);
CREATE TABLE IF NOT EXISTS g8s_product.comparison_snapshots (
  id uuid PRIMARY KEY,
  comparison_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0),
  payload_hash char(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=2097152),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(comparison_id,version),
  UNIQUE(id,comparison_id,owner_user_id,org_id),
  FOREIGN KEY(comparison_id,owner_user_id,org_id) REFERENCES g8s_product.comparisons(id,owner_user_id,org_id)
);
CREATE TABLE IF NOT EXISTS g8s_product.comparison_feedback (
  id uuid PRIMARY KEY,
  comparison_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  item_key text NOT NULL CHECK(length(item_key) BETWEEN 1 AND 100),
  revision integer NOT NULL CHECK(revision>0),
  verdict text NOT NULL CHECK(verdict IN ('valid_defect','false_positive','intentional','duplicate','already_fixed','insufficient_context','severity_correction','retracted')),
  rationale text NOT NULL CHECK(length(rationale) BETWEEN 1 AND 4000),
  training_use text NOT NULL CHECK(training_use IN ('excluded','candidate')),
  linked_item_key text CHECK(length(linked_item_key) BETWEEN 1 AND 100),
  idempotency_hash char(64) NOT NULL CHECK(idempotency_hash ~ '^[0-9a-f]{64}$'),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(snapshot_id,item_key,revision),
  UNIQUE(owner_user_id,org_id,idempotency_hash),
  FOREIGN KEY(snapshot_id,comparison_id,owner_user_id,org_id)
    REFERENCES g8s_product.comparison_snapshots(id,comparison_id,owner_user_id,org_id),
  CHECK(verdict<>'retracted' OR training_use='excluded')
);
CREATE TABLE IF NOT EXISTS g8s_product.comparison_rate_windows (
  owner_user_id uuid NOT NULL REFERENCES g8s_product.users(id),
  window_start timestamptz NOT NULL,
  requests integer NOT NULL CHECK(requests>0),
  PRIMARY KEY(owner_user_id,window_start)
);
CREATE INDEX IF NOT EXISTS comparison_owner_created ON g8s_product.comparisons(owner_user_id,org_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS comparison_feedback_latest ON g8s_product.comparison_feedback(snapshot_id,item_key,revision DESC);
REVOKE ALL ON g8s_product.comparison_version,g8s_product.comparisons,g8s_product.comparison_snapshots,
  g8s_product.comparison_feedback,g8s_product.comparison_rate_windows FROM PUBLIC;
COMMIT;
