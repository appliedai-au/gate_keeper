// Public data contracts only. No SDK clients, credentials or network access.
export const REVIEW_APP_ID = "6ae577c8f34f21f5eebe75d9";
export const REVIEW_PATH = "/gatekeeper/reviews-v1";
export const REVIEW_PUBLIC_URL = "https://proxy-production-9553.up.railway.app" + REVIEW_PATH;
export const REVIEW_MAX_BODY_BYTES = 48 * 1024;
export const REVIEW_MAX_RESPONSE_BYTES = 96 * 1024;
export const REVIEW_STATES = Object.freeze([
  "queued", "session_dispatch", "session_created", "turn_dispatch", "running",
  "complete", "failed", "held",
]);
export const REVIEW_CODES = Object.freeze([
  "dispatch_uncertain", "result_unavailable", "invalid_result", "runtime_policy_violation",
  "upstream_failed", "runtime_changed", "storage_unavailable", "request_rejected",
]);
export const REVIEW_ERRORS = Object.freeze([
  "unauthorized", "forbidden", "invalid_request", "method_not_allowed", "not_found",
  "review_unavailable", "source_mismatch", "idempotency_conflict", "review_in_progress",
  "dispatch_uncertain", "rate_limited",
]);
export const record = x => x !== null && typeof x === "object" && !Array.isArray(x);
export const keysAre = (x, fields) => record(x) &&
  Object.keys(x).sort().join(",") === [...fields].sort().join(",");
export const validId = x => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(x);
export const validOwner = x => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u.test(x);
export const validSource = x => typeof x === "string" && /^[0-9a-f]{40}$/u.test(x);
const bounded = (x, max) => typeof x === "string" && x.length > 0 && x.length <= max;
const plainText = (x, max) => bounded(x, max) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(x);

export function validReviewInput(x) {
  return keysAre(x, ["file", "language", "context", "code"]) &&
    bounded(x.file, 160) && !/[\u0000-\u001f\u007f]/u.test(x.file) &&
    ["javascript", "typescript", "python", "go", "rust", "java", "sql", "text"].includes(x.language) &&
    plainText(x.context, 4000) && plainText(x.code, 32768) && x.code.trim().length > 0 &&
    new TextEncoder().encode(x.code).length <= 32768 && x.code.replace(/\r\n?/gu, "\n").split("\n").length <= 1000;
}

export function validCommand(x) {
  if (keysAre(x, ["action"]) && ["info", "list"].includes(x.action)) return true;
  if (keysAre(x, ["action", "jobId"]) && ["get", "start"].includes(x.action)) return validId(x.jobId);
  return keysAre(x, ["action", "idempotencyKey", "input"]) && x.action === "submit" &&
    validId(x.idempotencyKey) && validReviewInput(x.input);
}

export function validFindings(value, lineCount) {
  return Array.isArray(value) && value.length <= 50 && value.every(x =>
    keysAre(x, ["line", "category", "severity", "comment"]) &&
    Number.isSafeInteger(x.line) && x.line >= 1 && x.line <= lineCount &&
    ["bug", "security", "resource-leak", "error-handling", "performance"].includes(x.category) &&
    ["critical", "high", "medium", "low"].includes(x.severity) && plainText(x.comment, 1000) &&
    new TextEncoder().encode(x.comment).length <= 1000);
}

const SUMMARY_FIELDS = ["id", "file", "language", "lineCount", "state", "code", "sourceCommit",
  "createdAt", "updatedAt", "estimatedCostUsd", "billingStatus"];
const timestamp = x => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/u.test(x) &&
  Number.isFinite(Date.parse(x));
export function validJob(x, detail = true) {
  return keysAre(x, detail ? [...SUMMARY_FIELDS, "findings"] : SUMMARY_FIELDS) &&
    validId(x.id) && bounded(x.file, 160) && bounded(x.language, 20) &&
    Number.isSafeInteger(x.lineCount) && x.lineCount >= 1 && x.lineCount <= 1000 &&
    REVIEW_STATES.includes(x.state) && (x.code === null || REVIEW_CODES.includes(x.code)) &&
    validSource(x.sourceCommit) && timestamp(x.createdAt) && timestamp(x.updatedAt) &&
    (x.estimatedCostUsd === null || (typeof x.estimatedCostUsd === "number" &&
      Number.isFinite(x.estimatedCostUsd) && x.estimatedCostUsd >= 0)) && x.billingStatus === "unsettled" &&
    (!detail || (x.state === "complete" ? validFindings(x.findings, x.lineCount) : x.findings === null));
}

export function validReviewReply(x, expectedSource) {
  return keysAre(x, ["version", "sourceCommit", "scope", "enabled", "job", "jobs"]) &&
    x.version === 1 && x.sourceCommit === expectedSource && x.scope === "configured_admin_owner" &&
    x.enabled === true && (x.job === null || validJob(x.job)) &&
    Array.isArray(x.jobs) && x.jobs.length <= 20 && x.jobs.every(job => validJob(job, false));
}

export async function readBoundedJson(body, maxBytes) {
  const reader = body?.getReader();
  if (!reader) throw new Error("invalid_request");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("invalid_request");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
