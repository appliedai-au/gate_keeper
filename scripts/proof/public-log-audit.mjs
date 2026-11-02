// A read-only, non-disclosing proof-log observer. It accepts log text already
// retrieved by an authorised operator; never fetches logs or opens credentials.
// Inspect Base64 payloads, not merely the human-visible raw lines: the earlier
// sensitive-log incident was hidden inside encoded PUBLIC_DATA chunks.
const CHUNK = /^GK_PROOF_(PUBLIC_SUMMARY|PUBLIC_DATA)_B64\[(\d+)\/(\d+)\]=([A-Za-z0-9+/=]+)$/;
const JSON_LINE = /^GK_PROOF_(PREFLIGHT|COMPARISON|DRILL|DONE|BLOCKED|INVENTORY)=(\{.*\})$/;
const ID_KEYS = new Set([
  "session_id", "sessionId", "turn_id", "turnId", "task_id",
  "private_evidence_paths", "evidence_items", "evidence_inventory",
  "blinding_key", "unblinding_key", "raw_session", "private_session",
  "private_holdout", "holdout_tasks", "raw_historical_sessions",
]);
const SENSITIVE_FIXTURE = /SECRET_HOLDOUT|SECRET_UNSEEN|h-secret-01|u-secret-0[12]/;
const MAX_INPUT_LINES = 1500, MAX_CHUNKS = 300, MAX_B64_BYTES = 1024 * 1024;
const own = (v, key) => Object.prototype.hasOwnProperty.call(v, key);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function auditProofPublicLogs(lines, { requireSummary = true } = {}) {
  const failures = new Set();
  const chunks = new Map(), payloads = [];
  let totalBytes = 0;
  if (!Array.isArray(lines) || lines.length > MAX_INPUT_LINES ||
      lines.some((x) => typeof x !== "string" || x.length > 10000)) {
    return { status: "FAIL", codes: ["LOG_INPUT_OUT_OF_BOUNDS"], decodedPublicRecords: 0 };
  }
  for (const original of lines) {
    // Railway's log API separates one event per message; do not accept embedded
    // multiline records that could hide a second uninspected payload.
    for (const line of original.split("\n").filter(Boolean)) {
      if (SENSITIVE_FIXTURE.test(line)) failures.add("PRIVATE_CANARY_SENTINEL");
      const m = CHUNK.exec(line);
      if (m) {
        const [ , kind, idx, count, piece ] = m;
        const index = Number(idx), limit = Number(count);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CHUNKS ||
            index < 1 || index > limit) { failures.add("PUBLIC_CHUNK_INVALID"); continue; }
        const slot = chunks.get(kind) || { total: limit, pieces: new Map() };
        if (slot.total !== limit || slot.pieces.has(index)) failures.add("PUBLIC_CHUNK_INCONSISTENT");
        slot.pieces.set(index, piece);
        chunks.set(kind, slot);
        totalBytes += piece.length;
        if (totalBytes > MAX_B64_BYTES) failures.add("PUBLIC_CHUNK_TOO_LARGE");
        continue;
      }
      const direct = JSON_LINE.exec(line);
      if (direct) {
        try { payloads.push({ kind: direct[1], value: JSON.parse(direct[2]) }); }
        catch { failures.add("PUBLIC_JSON_UNPARSABLE"); }
      }
      if (/^GK_PROOF_(PUBLIC_SUMMARY|PUBLIC_DATA)_B64/.test(line) && !m)
        failures.add("PUBLIC_CHUNK_INVALID");
    }
  }
  for (const [kind, slot] of chunks) {
    if (slot.pieces.size !== slot.total || [...Array(slot.total).keys()].some((i) => !slot.pieces.has(i + 1))) {
      failures.add("PUBLIC_CHUNK_INCOMPLETE"); continue;
    }
    if (totalBytes > MAX_B64_BYTES) continue;
    const b64 = [...Array(slot.total).keys()].map(i => slot.pieces.get(i+1)).join("");
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      if (SENSITIVE_FIXTURE.test(decoded)) failures.add("PRIVATE_CANARY_SENTINEL");
      payloads.push({ kind, value: JSON.parse(decoded) });
    } catch { failures.add("PUBLIC_JSON_UNPARSABLE"); }
  }
  const summary = payloads.filter((p) => p.kind === "PUBLIC_SUMMARY");
  const data = payloads.filter((p) => p.kind === "PUBLIC_DATA");
  if (requireSummary && (summary.length !== 1 || data.length !== 1))
    failures.add("PUBLIC_PROOF_RECORDS_MISSING");
  if (summary.some((s) => s.value?.result === "PASS" && s.value?.environment?.adjudicator_calibration !== "calibrated"))
    failures.add("UNVERIFIED_PASS");
  for (const { kind, value } of payloads) {
    const seen = new Set();
    function visit(v) {
      if (!v || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      if (Array.isArray(v)) { for (const item of v) visit(item); return; }
      for (const [key, child] of Object.entries(v)) {
        if (ID_KEYS.has(key)) failures.add("PRIVATE_METADATA_FIELD");
        if (key === "path" && typeof child === "string" &&
            (child.includes("/private/") || child.startsWith("private/")))
          failures.add("PRIVATE_EVIDENCE_PATH");
        visit(child);
      }
    }
    visit(value);
    const arms = value?.arms;
    if (isObj(arms)) {
      for (const a of Object.values(arms)) {
        if (isObj(a) && (own(a, "holdout") || own(a, "all")))
          failures.add("HOLDOUT_COMPOSITION_LEAK");
      }
    }
    if (kind === "PUBLIC_DATA") {
      if (!Array.isArray(value?.sessions) || value.sessions.some(s => !isObj(s) ||
          Object.keys(s).some(k => !["phase","arm","trial","role"].includes(k))))
        failures.add("PRIVATE_SESSION_METADATA");
      if (own(value, "evidence_items") || own(value, "private_evidence_paths"))
        failures.add("PRIVATE_EVIDENCE_INVENTORY");
    }
    if (kind === "PUBLIC_SUMMARY" && isObj(value?.arms) &&
        Object.values(value.arms).some(a => isObj(a) && a.actual_cost_usd !== null))
      failures.add("UNVERIFIED_ACTUAL_COST");
  }
  const codes = [...failures].sort();
  return Object.freeze({ status: codes.length ? "FAIL" : "PASS",
    codes, decodedPublicRecords: payloads.length,
    // Never return decoded payload, session identifier, path or log contents.
    summaryPresent: summary.length === 1, publicDataPresent: data.length === 1 });
}
