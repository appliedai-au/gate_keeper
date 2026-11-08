-- G8S product data is independent of the learning pilot and its private evidence.
-- Apply explicitly after review/qualification. Runtime startup never runs DDL.
BEGIN;
CREATE SCHEMA IF NOT EXISTS g8s_product;
CREATE TABLE IF NOT EXISTS g8s_product.schema_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL CHECK (version = 1)
);
INSERT INTO g8s_product.schema_version(singleton, version) VALUES (true, 1)
  ON CONFLICT (singleton) DO NOTHING;

-- Retain authenticated revocation events even if the first OAuth callback has
-- not created a user yet. No identity/user is fabricated by this watermark.
CREATE TABLE IF NOT EXISTS g8s_product.github_authorization_revocations (
  github_id text PRIMARY KEY CHECK (github_id ~ '^[0-9]{1,20}$'),
  revoked_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS g8s_product.users (
  id uuid PRIMARY KEY,
  github_id text NOT NULL UNIQUE CHECK (github_id ~ '^[0-9]{1,20}$'),
  login text NOT NULL CHECK (length(login) BETWEEN 1 AND 100),
  name text CHECK (length(name) <= 200),
  email text CHECK (length(email) <= 320),
  avatar_url text CHECK (length(avatar_url) <= 2048),
  disabled boolean NOT NULL DEFAULT false,
  authorization_revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS g8s_product.organizations (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES g8s_product.users(id),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  logo_url text CHECK (length(logo_url) <= 700000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_user_id)
);
CREATE TABLE IF NOT EXISTS g8s_product.memberships (
  org_id uuid NOT NULL REFERENCES g8s_product.organizations(id),
  user_id uuid NOT NULL REFERENCES g8s_product.users(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS g8s_product.invitations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES g8s_product.organizations(id),
  inviter_user_id uuid NOT NULL REFERENCES g8s_product.users(id),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);
CREATE TABLE IF NOT EXISTS g8s_product.oauth_states (
  state_hash char(64) PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  browser_hash char(64) NOT NULL CHECK (browser_hash ~ '^[0-9a-f]{64}$'),
  purpose text NOT NULL CHECK (purpose IN ('signin', 'install', 'complete_install')),
  user_id uuid REFERENCES g8s_product.users(id),
  verifier text,
  return_path text NOT NULL CHECK (length(return_path) <= 512),
  installation_id text CHECK (installation_id ~ '^[0-9]{1,20}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((purpose = 'signin' AND user_id IS NULL AND verifier IS NOT NULL) OR
    (purpose = 'install' AND user_id IS NOT NULL AND verifier IS NULL) OR
    (purpose = 'complete_install' AND user_id IS NOT NULL AND verifier IS NOT NULL AND installation_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS g8s_product.sessions (
  session_hash char(64) PRIMARY KEY CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES g8s_product.users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_sessions_user ON g8s_product.sessions(user_id);
CREATE INDEX IF NOT EXISTS product_sessions_expiry ON g8s_product.sessions(expires_at);
CREATE INDEX IF NOT EXISTS product_oauth_expiry ON g8s_product.oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS g8s_product.installations (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES g8s_product.users(id),
  org_id uuid NOT NULL,
  github_installation_id text NOT NULL UNIQUE CHECK (github_installation_id ~ '^[0-9]{1,20}$'),
  account_id text NOT NULL CHECK (account_id ~ '^[0-9]{1,20}$'),
  account_login text NOT NULL CHECK (length(account_login) BETWEEN 1 AND 100),
  account_type text NOT NULL CHECK (account_type IN ('User', 'Organization')),
  repository_selection text NOT NULL CHECK (repository_selection IN ('selected', 'all')),
  disabled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, owner_user_id) REFERENCES g8s_product.organizations(id, owner_user_id),
  UNIQUE (id, owner_user_id, org_id)
);
CREATE TABLE IF NOT EXISTS g8s_product.repositories (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES g8s_product.users(id),
  org_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  github_repo_id text NOT NULL CHECK (github_repo_id ~ '^[0-9]{1,20}$'),
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 3 AND 250),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  default_branch text NOT NULL CHECK (length(default_branch) BETWEEN 1 AND 250),
  private boolean NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  available boolean NOT NULL DEFAULT true,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(overrides) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (installation_id, owner_user_id, org_id) REFERENCES g8s_product.installations(id, owner_user_id, org_id),
  UNIQUE (owner_user_id, github_repo_id),
  UNIQUE (id, owner_user_id, org_id)
);
CREATE INDEX IF NOT EXISTS product_repositories_org ON g8s_product.repositories(owner_user_id, org_id, full_name);
CREATE TABLE IF NOT EXISTS g8s_product.settings (
  org_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, owner_user_id) REFERENCES g8s_product.organizations(id, owner_user_id)
);
CREATE TABLE IF NOT EXISTS g8s_product.rules (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, owner_user_id) REFERENCES g8s_product.organizations(id, owner_user_id),
  UNIQUE (id, owner_user_id, org_id)
);
CREATE TABLE IF NOT EXISTS g8s_product.user_limits (
  user_id uuid PRIMARY KEY REFERENCES g8s_product.users(id),
  monthly_run_limit integer NOT NULL DEFAULT 0 CHECK (monthly_run_limit BETWEEN 0 AND 1000000),
  max_concurrent_runs integer NOT NULL DEFAULT 1 CHECK (max_concurrent_runs BETWEEN 1 AND 16),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS g8s_product.controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  paused boolean NOT NULL DEFAULT true,
  reason text NOT NULL DEFAULT 'Owner setup is required.' CHECK (length(reason) BETWEEN 1 AND 1000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES g8s_product.users(id)
);
INSERT INTO g8s_product.controls(singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS g8s_product.webhook_deliveries (
  delivery_id text PRIMARY KEY CHECK (length(delivery_id) BETWEEN 1 AND 100),
  event text NOT NULL CHECK (length(event) BETWEEN 1 AND 100),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'ignored', 'failed')),
  error_code text,
  attempts integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz
);
-- A later authorization revocation can have the same body as an earlier one.
-- Preserve every distinct delivery ID for that event; replaying an already
-- committed ID must not revoke a newer authorization a second time.
CREATE UNIQUE INDEX IF NOT EXISTS product_deliveries_unique_body
  ON g8s_product.webhook_deliveries(event, payload_hash) WHERE event <> 'github_app_authorization';
CREATE INDEX IF NOT EXISTS product_deliveries_pending ON g8s_product.webhook_deliveries(received_at) WHERE status IN ('pending', 'processing');
CREATE TABLE IF NOT EXISTS g8s_product.pull_requests (
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  repository_id uuid NOT NULL,
  pr_number integer NOT NULL CHECK (pr_number > 0),
  title text NOT NULL CHECK (length(title) <= 1000),
  pr_url text NOT NULL CHECK (length(pr_url) <= 2048),
  head_sha char(40) NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  base_sha char(40) NOT NULL CHECK (base_sha ~ '^[0-9a-f]{40}$'),
  base_branch text NOT NULL CHECK (length(base_branch) <= 250),
  author_login text NOT NULL CHECK (length(author_login) <= 100),
  draft boolean NOT NULL DEFAULT false,
  merged boolean NOT NULL DEFAULT false,
  pr_type text NOT NULL DEFAULT 'Unclassified' CHECK (length(pr_type) <= 100),
  risk text CHECK (risk IN ('low', 'medium', 'high')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (repository_id, owner_user_id, org_id) REFERENCES g8s_product.repositories(id, owner_user_id, org_id),
  PRIMARY KEY (owner_user_id, repository_id, pr_number)
);
CREATE TABLE IF NOT EXISTS g8s_product.runs (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  repository_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  delivery_id text NOT NULL REFERENCES g8s_product.webhook_deliveries(delivery_id),
  pr_number integer NOT NULL CHECK (pr_number > 0),
  head_sha char(40) NOT NULL CHECK (head_sha ~ '^[0-9a-f]{40}$'),
  base_sha char(40) NOT NULL CHECK (base_sha ~ '^[0-9a-f]{40}$'),
  base_branch text NOT NULL CHECK (length(base_branch) BETWEEN 1 AND 250),
  title text NOT NULL CHECK (length(title) <= 1000),
  pr_url text NOT NULL CHECK (length(pr_url) <= 2048),
  trigger text NOT NULL CHECK (trigger IN ('pull_request', 'review', 'explain', 'help')),
  actor_login text,
  actor_github_id text CHECK (actor_github_id ~ '^[0-9]{1,20}$'),
  finding_id uuid,
  dedup_key text NOT NULL CHECK (length(dedup_key) <= 200),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'preparing', 'session_dispatch', 'session_created', 'turn_dispatch', 'running', 'post_dispatch', 'review_posted', 'summary_dispatch', 'complete', 'failed', 'held')),
  error_code text,
  review_pass text NOT NULL DEFAULT 'organization' CHECK (review_pass IN ('organization', 'repository')),
  baseline_result jsonb,
  input jsonb,
  result jsonb,
  session_id text,
  turn_id text,
  github_review_id text,
  model text,
  estimated_cost_usd double precision CHECK (estimated_cost_usd >= 0 AND estimated_cost_usd < 'Infinity'::float8),
  cost_source text CHECK (cost_source IN ('trueforge_metrics_estimate', 'gateway_receipt')),
  risk text CHECK (risk IN ('low', 'medium', 'high')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  last_polled_at timestamptz,
  finished_at timestamptz,
  FOREIGN KEY (repository_id, owner_user_id, org_id) REFERENCES g8s_product.repositories(id, owner_user_id, org_id),
  FOREIGN KEY (installation_id, owner_user_id, org_id) REFERENCES g8s_product.installations(id, owner_user_id, org_id),
  UNIQUE (owner_user_id, repository_id, pr_number, dedup_key),
  UNIQUE (id, owner_user_id, org_id),
  CHECK ((estimated_cost_usd IS NULL AND cost_source IS NULL) OR (estimated_cost_usd IS NOT NULL AND cost_source IS NOT NULL)),
  CHECK (turn_id IS NULL OR session_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS product_runs_queue ON g8s_product.runs(created_at, id) WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS product_runs_scope ON g8s_product.runs(owner_user_id, org_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS product_runs_usage ON g8s_product.runs(owner_user_id, started_at) WHERE started_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS g8s_product.run_observations (
  run_id uuid NOT NULL REFERENCES g8s_product.runs(id),
  stage text NOT NULL CHECK (length(stage) BETWEEN 1 AND 100),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, stage)
);
CREATE TABLE IF NOT EXISTS g8s_product.findings (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  repository_id uuid NOT NULL,
  pr_number integer NOT NULL CHECK (pr_number > 0),
  file text NOT NULL CHECK (length(file) BETWEEN 1 AND 1000),
  line integer NOT NULL CHECK (line > 0),
  end_line integer NOT NULL CHECK (end_line >= line),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 100),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  explanation text NOT NULL CHECK (length(explanation) BETWEEN 1 AND 8000),
  evidence text NOT NULL CHECK (length(evidence) BETWEEN 1 AND 8000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  FOREIGN KEY (run_id, owner_user_id, org_id) REFERENCES g8s_product.runs(id, owner_user_id, org_id),
  FOREIGN KEY (repository_id, owner_user_id, org_id) REFERENCES g8s_product.repositories(id, owner_user_id, org_id),
  CHECK ((status = 'open' AND closed_at IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS product_findings_scope ON g8s_product.findings(owner_user_id, org_id, created_at DESC);
CREATE TABLE IF NOT EXISTS g8s_product.rule_evaluations (
  run_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  met boolean NOT NULL,
  evidence text NOT NULL CHECK (length(evidence) BETWEEN 1 AND 8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, owner_user_id, org_id) REFERENCES g8s_product.runs(id, owner_user_id, org_id),
  FOREIGN KEY (rule_id, owner_user_id, org_id) REFERENCES g8s_product.rules(id, owner_user_id, org_id),
  PRIMARY KEY (run_id, rule_id)
);
CREATE TABLE IF NOT EXISTS g8s_product.audit_log (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES g8s_product.users(id),
  org_id uuid REFERENCES g8s_product.organizations(id),
  scope text NOT NULL CHECK (scope IN ('org', 'admin')),
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'org' AND org_id IS NOT NULL) OR (scope = 'admin' AND org_id IS NULL))
);
CREATE INDEX IF NOT EXISTS product_audit_scope ON g8s_product.audit_log(org_id, actor_user_id, created_at DESC);
REVOKE ALL ON SCHEMA g8s_product FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA g8s_product FROM PUBLIC;
COMMIT;
