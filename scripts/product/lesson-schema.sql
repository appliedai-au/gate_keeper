-- Explicit additive migration. No startup DDL or modification of archived learning records.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM g8s_product.comparison_version WHERE singleton=true AND version=1) THEN
    RAISE EXCEPTION 'comparison schema v1 is required';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS g8s_product.lesson_version (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), version integer NOT NULL CHECK(version=1)
);
INSERT INTO g8s_product.lesson_version VALUES(true,1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS g8s_product.learning_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 revision integer NOT NULL CHECK(revision>0),
 require_adversarial boolean NOT NULL DEFAULT true,
 updated_by uuid REFERENCES g8s_product.users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO g8s_product.learning_policy(singleton,revision,require_adversarial)
 VALUES(true,1,true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS g8s_product.banked_lesson_batches (
 id uuid PRIMARY KEY,
 comparison_id uuid NOT NULL,
 snapshot_id uuid NOT NULL,
 owner_user_id uuid NOT NULL,
 org_id uuid NOT NULL,
 subject_hash char(64) NOT NULL CHECK(subject_hash ~ '^[0-9a-f]{64}$'),
 policy_revision integer NOT NULL CHECK(policy_revision>0),
 subject jsonb NOT NULL CHECK(jsonb_typeof(subject)='object' AND octet_length(subject::text)<=131072),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=524288),
 verification jsonb NOT NULL CHECK(jsonb_typeof(verification)='object'),
 confirmed_by uuid NOT NULL REFERENCES g8s_product.users(id),
 confirmation_reason text NOT NULL CHECK(length(confirmation_reason) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_user_id,org_id,subject_hash),
 FOREIGN KEY(snapshot_id,comparison_id,owner_user_id,org_id)
  REFERENCES g8s_product.comparison_snapshots(id,comparison_id,owner_user_id,org_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS banked_lessons_scope ON g8s_product.banked_lesson_batches(owner_user_id,org_id,comparison_id);
REVOKE ALL ON g8s_product.lesson_version,g8s_product.learning_policy,g8s_product.banked_lesson_batches FROM PUBLIC;
COMMIT;
