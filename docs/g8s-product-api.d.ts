/** Public JSON contract for /gatekeeper/product-v1. No example records or credentials. */
export type UUID = string;
export type GitHubId = string;
export type ISODateTime = string;
export type Risk = 'low' | 'medium' | 'high';
export type Severity = Risk | 'critical';
export type Role = 'owner' | 'admin' | 'member';
export type Envelope<T> = { data: T };
export type ErrorEnvelope = { error: { code: string; message: string } };
export interface Page { index: number; hasNext: boolean }
export interface User {
  id: UUID; githubId: GitHubId; login: string; name: string | null;
  email: string | null; avatarUrl: string | null; disabled: boolean;
}
export interface Organization { id: UUID; slug: string; name: string; logoUrl: string | null; role: Role }
export interface Session {
  user: User; organizations: Organization[]; isAdmin: boolean;
  commands: { command: string; description: string }[];
}
export interface Configuration {
  skipDraftPRs: boolean; autoFillSummaries: boolean; blockMergeSeverity: 'off' | Severity;
  autoApprove: boolean; autoApproveMaxRisk: Risk;
  allowedAuthors: string[]; excludedAuthors: string[]; allowedBots: string[];
  allowedBranches: string[]; excludedBranches: string[];
  customInstructions: string; summaryInstructions: string; riskInstructions: string;
}
export interface Repository {
  /** Use id, the numeric GitHub ID serialized as a string, in repository endpoint URLs. */
  id: GitHubId; recordId: UUID; githubId: GitHubId; installationId: GitHubId | null;
  name: string; fullName: string; private: boolean; defaultBranch: string;
  enabled: boolean; available: boolean; overrides: Partial<Configuration>; updatedAt: ISODateTime;
}
export interface Installation {
  id: GitHubId; recordId: UUID; githubInstallationId: GitHubId;
  account: { id: GitHubId; login: string; type: 'User' | 'Organization' };
  repositorySelection: 'all' | 'selected'; disabledReason: string | null;
  repositoryCount?: number; updatedAt: ISODateTime;
}
export interface ConfigurationSettings {
  configuration: Configuration; revision: number; repositories: Repository[]; connections: Installation[];
  capabilities: { github: true; gitlab: false; azureDevOps: false; bitbucket: false;
    autoFillSummaries: false; invitationsEmail: false; findingsResolution: true; billing: false };
}
export interface RuleActivity { id: UUID; name: string; evaluations: number; met: number; metPercentage: number | null }
export interface Rule extends RuleActivity { description: string; severity: Severity; enabled: boolean }
export interface AuditEntry {
  id: UUID; timestamp: ISODateTime;
  user: { id: UUID | null; login: string; email: string | null; kind: 'user' | 'integration' };
  action: string; details: Record<string, unknown>;
}
export interface Audit { entries: AuditEntry[]; page: Page }
export interface Usage {
  runs: number; prsReviewed: number; monthlyRuns: number; monthlyRunLimit: number; maxConcurrentRuns: number;
  /** Reconciled spend only; current metrics-only adapter does not supply gateway receipts. */
  modelSpendUsd: number | null;
  /** Total estimate only when every started model run has an observed cost. */
  estimatedModelCostUsd: number | null;
  /** Partial observed subtotal. Never display as the complete total unless costComplete. */
  knownEstimatedModelCostUsd: number | null;
  costedRuns: number; modelRuns: number; costComplete: boolean;
}
export interface Billing {
  plan: { name: 'G8S access'; paid: false; featuresUnlocked: true; seats: number };
  seatAssignments: { userId: UUID; login: string; email: string | null; role: Role }[];
  usage: Usage;
}
export type RunStatus = 'queued' | 'preparing' | 'session_dispatch' | 'session_created' | 'turn_dispatch'
  | 'running' | 'post_dispatch' | 'review_posted' | 'summary_dispatch' | 'complete' | 'failed' | 'held';
export interface Run {
  id: UUID; repositoryId: GitHubId | null; repository: string | null; prNumber: number;
  title: string; prUrl: string; headSha: string; baseSha: string; baseBranch: string;
  trigger: 'pull_request' | 'review' | 'explain' | 'help'; status: RunStatus; failureReason: string | null;
  createdAt: ISODateTime; updatedAt: ISODateTime; startedAt: ISODateTime | null; finishedAt: ISODateTime | null;
  durationMs: number | null; risk: Risk | null; model: string | null;
  estimatedCostUsd: number | null; costSource: 'trueforge_metrics_estimate' | 'gateway_receipt' | null;
  summary: string | null; verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | null;
  githubReviewId: GitHubId | null;
}
export interface Finding {
  id: UUID; file: string; line: number; endLine: number; severity: Severity; category: string;
  title: string; explanation: string; evidence: string; status: 'open' | 'closed';
  createdAt: ISODateTime; closedAt: ISODateTime | null;
}
export interface RunDetail {
  run: Run; findings: Finding[];
  ruleEvaluations: { ruleId: UUID; name: string; met: boolean; evidence: string }[];
}
export interface RecentPR {
  repositoryId: GitHubId; repository: string; number: number; title: string; url: string;
  updatedAt: ISODateTime; risk: Risk | null; status: RunStatus | 'awaiting_review'; reviewIsCurrent: boolean;
  findingsCount: number | null; resolvedCount: number | null;
  /** True only for an actual current APPROVE publication; a clean COMMENT is not an approval. */
  approved: boolean; lastRunId: UUID; reviewRunId: UUID | null;
}
export interface Filters { repository: GitHubId | 'all'; from: string; to: string; groupBy: 'daily' | 'weekly' }
export interface ActivityValues { prsReviewed: number; findings: number; failedRuns: number; userRequests: number }
export interface Overview {
  hasData: boolean; filters: Filters;
  stats: Record<keyof ActivityValues, { value: number; perWeekday: number | null }>;
  series: (ActivityValues & { date: string })[];
  prTypes: { type: string; count: number; percentage: number | null }[];
  riskSplit: { risk: Risk; count: number; percentage: number | null }[];
  unclassifiedRiskCount: number; totalReviews: number; ruleActivity: RuleActivity[]; recentPrs: RecentPR[]; page: Page;
}
export interface Reviews {
  hasData: boolean; filters: Filters & { merged: boolean | null; window: 7 | 30 };
  reported: number; closed: number; findingsOnMergedPrs: number; closureRate: number | null;
  resolutionSource: 'user_confirmed';
  resolutionByCategory: { category: string; reported: number; closed: number; rate: number | null }[];
  closureByRepository: { repositoryId: GitHubId; repository: string; prs: number;
    reported: number; closed: number; rate: number | null }[];
  series: { date: string; reported: number; closed: number }[];
  unresolved: (Finding & { runId: UUID; repositoryId: GitHubId; repository: string;
    prNumber: number; prUrl: string; prTitle: string })[];
}
export interface OrganizationSettings {
  organization: Organization; members: (User & { role: Role; joinedAt: ISODateTime })[];
  invitations: { id: UUID; email: string; role: Exclude<Role, 'owner'>;
    status: 'pending'; createdAt: ISODateTime; delivery: 'not_sent' }[];
}
export interface AdminOverview {
  controls: { paused: boolean; reason: string; revision: number; updatedAt: ISODateTime };
  paused: boolean; reason: string;
  counts: { users: number; installations: number; repositories: number; runs: number; queued: number; failed: number };
}
export interface AdminUser extends User {
  createdAt: ISODateTime; monthlyRunLimit: number; maxConcurrentRuns: number;
  runs: number; monthlyRuns: number; usage: Usage;
}
export interface OwnerProjection { ownerUserId: UUID; ownerLogin: string }
export type AdminUsers = { users: AdminUser[]; page: Page };
export type AdminRuns = { runs: (Run & OwnerProjection)[]; page: Page };
export type AdminInstallations = { installations: (Installation & OwnerProjection)[]; page: Page };
export type AdminRepositories = { repositories: (Repository & OwnerProjection)[]; page: Page };
export type RepositoryList = { repositories: Repository[]; page: Page };
export type SaveConfiguration = { configuration: Configuration; revision?: number };
export type SaveOrganization = { name: string; slug?: string; logoUrl?: string | null };
export type SaveRules = { rules: { id?: UUID; name: string; description: string; severity: Severity; enabled: boolean }[] };
export type SaveRepository = { enabled?: boolean; overrides?: Partial<Configuration> };
export type SaveUserLimits = { monthlyRunLimit: number; maxConcurrentRuns: number; disabled?: boolean };
export type SavePause = { paused: boolean; reason: string };
