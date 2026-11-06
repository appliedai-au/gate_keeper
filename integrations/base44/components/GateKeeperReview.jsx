import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { validCommand, validReviewReply } from "../shared/review-contract.js";
import "./GateKeeperReview.css";

const COPY = {
  queued: ["Saved", "Your request is saved. It has not been sent to the review engine yet."],
  session_dispatch: ["Starting", "The session dispatch is claimed and may have been sent. Its acknowledgement is unresolved. Check this saved request; do not submit a replacement."],
  session_created: ["Ready to continue", "The private engine session is saved. Continue to send the review turn."],
  turn_dispatch: ["Starting review", "The review turn dispatch is claimed and may have been sent. Its acknowledgement is unresolved."],
  running: ["Review in progress", "The saved review turn is running. Checking status does not start another review."],
  complete: ["Review complete", "These findings come from your saved review. Human review is still needed before changing or shipping code."],
  failed: ["Review did not complete", "The saved engine response could not produce a valid review. No findings have been substituted."],
  held: ["Review needs reconciliation", "The request or its result is uncertain. An operator must reconcile the saved record before another review can start."],
};
const PROBLEMS = {
  unauthorized: "Sign in with the configured owner's account to use private reviews.",
  forbidden: "Private reviews require the configured owner's administrator account.",
  review_unavailable: "Private reviews are not available. The connection may be unconfigured or temporarily unreachable. Check recent reviews before submitting again.",
  source_mismatch: "The app and review engine use different qualified versions. The connection needs an operator update.",
  idempotency_conflict: "This saved submission key belongs to different code. Open recent reviews to check the original request.",
  review_in_progress: "A previous review is still unresolved. Open recent reviews and check that request first.",
  dispatch_uncertain: "The start acknowledgement was not received. The review may have started. Check the saved request; do not submit a replacement.",
  invalid_request: "Enter a filename, change description and up to 1,000 lines / 32 KiB of code.",
  not_found: "This review is not available to your account.",
};
const PENDING_KEY = "gatekeeper-review-pending-v1";
const terminal = job => ["complete", "failed"].includes(job?.state);
function readPending() {
  try { return JSON.parse(sessionStorage.getItem(PENDING_KEY)) || null; } catch { return null; }
}
function savePending(value) {
  try { if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value)); else sessionStorage.removeItem(PENDING_KEY); }
  catch { /* Server idempotency remains authoritative if browser storage is unavailable. */ }
}

export default function GateKeeperReview() {
  const [input, setInput] = useState({ file: "", language: "typescript", context: "", code: "" });
  const [source, setSource] = useState(null);
  const [job, setJob] = useState(null);
  const [history, setHistory] = useState([]);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(readPending);
  const mounted = useRef(false);
  const lock = useRef(false);
  const requestVersion = useRef(0);
  const sourceRef = useRef(null);
  const pendingRef = useRef(pending);
  const remember = value => { pendingRef.current = value; savePending(value); if (mounted.current) setPending(value); };

  async function call(command, expectedSource = sourceRef.current) {
    const result = await base44.functions.invoke("gatekeeperReview", command);
    const body = result?.data;
    if (body?.error) throw new Error(PROBLEMS[body.error] ? body.error : "review_unavailable");
    if (!validReviewReply(body, expectedSource || body?.sourceCommit)) throw new Error("review_unavailable");
    return body;
  }
  async function action(work) {
    if (lock.current) return;
    lock.current = true;
    const version = ++requestVersion.current;
    setBusy(true); setProblem(null); setJob(null);
    let expired = false;
    const active = () => mounted.current && requestVersion.current === version;
    const current = () => active() && !expired;
    let timer;
    try {
      const body = await Promise.race([work(current), new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error("review_unavailable")); }, 25000);
      })]);
      if (!current()) return;
      sourceRef.current = body.sourceCommit; setSource(body.sourceCommit);
      setJob(body.job); setHistory(body.jobs);
      if (body.job && !terminal(body.job)) remember({ key: pendingRef.current?.key ?? null, jobId: body.job.id });
      else if (body.job && pendingRef.current?.jobId === body.job.id) remember(null);
    } catch (error) {
      if (!active()) return;
      const code = error?.response?.data?.error || error?.message;
      setProblem(PROBLEMS[code] || PROBLEMS.review_unavailable);
      setJob(null); setHistory([]);
      if (["unauthorized", "forbidden"].includes(code)) { sourceRef.current = null; setSource(null); }
    } finally {
      clearTimeout(timer);
      if (active()) { lock.current = false; setBusy(false); }
    }
  }
  useEffect(() => {
    mounted.current = true;
    void action(() => call({ action: "info" }, null));
    return () => { mounted.current = false; requestVersion.current++; lock.current = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!consent || !source || busy || lock.current || pendingRef.current?.jobId) return;
    const key = pendingRef.current?.key || crypto.randomUUID();
    const command = { action: "submit", idempotencyKey: key, input };
    if (!validCommand(command)) { setProblem(PROBLEMS.invalid_request); return; }
    // Only opaque identifiers are kept across page refresh. Code and findings
    // remain in the authenticated server store, never browser persistence.
    remember({ key, jobId: null });
    await action(async current => {
      const saved = await call(command);
      if (!current()) return saved;
      remember({ key, jobId: saved.job.id });
      if (["queued", "session_created"].includes(saved.job.state))
        return call({ action: "start", jobId: saved.job.id });
      return saved;
    });
  }

  return <section className="gk-review" aria-labelledby="gk-review-heading">
    <div className="gk-section-heading"><div className="gk-review-kicker">PRIVATE CODE REVIEW</div>
      <h1 id="gk-review-heading">Review your change.</h1>
      <p>Submit one small file and its intended behavior. Review results and request history are restricted to the configured owner's administrator account.</p>
    </div>
    <div className="gk-review-toolbar">
      <span>{source ? "Review connection available" : "Review connection not confirmed"}</span>
      <button type="button" disabled={busy} onClick={() => action(() => call({ action: "info" }, null))}>Check connection</button>
      <button type="button" disabled={busy} onClick={() => action(() => call({ action: "list" }, null))}>Recent reviews</button>
      {pending?.jobId && <button type="button" disabled={busy} onClick={() => action(() => call({ action: "get", jobId: pending.jobId }, null))}>Check saved request</button>}
    </div>
    {problem && <p className="gk-review-alert" role="alert">{problem}</p>}
    {busy && <p role="status">Checking the saved review service…</p>}
    {pending && !job && <p className="gk-review-note">A submission may already be saved. Use recent reviews or check its saved request before starting another.</p>}

    <form onSubmit={submit} className="gk-review-form">
      <label>Filename<input value={input.file} maxLength={160} required placeholder="src/api/invoices.ts"
        onChange={event => setInput({ ...input, file: event.target.value })} /></label>
      <label>Language<select value={input.language} onChange={event => setInput({ ...input, language: event.target.value })}>
        {["typescript", "javascript", "python", "go", "rust", "java", "sql", "text"].map(language => <option key={language}>{language}</option>)}
      </select></label>
      <label className="gk-review-wide">What should this change do?<textarea value={input.context} maxLength={4000} required rows={3}
        placeholder="Describe the intended behavior and any relevant caller assumptions."
        onChange={event => setInput({ ...input, context: event.target.value })} /></label>
      <label className="gk-review-wide">Code<textarea className="gk-review-code" value={input.code} maxLength={32768} required rows={16} spellCheck={false}
        onChange={event => setInput({ ...input, code: event.target.value })} /></label>
      <label className="gk-review-consent gk-review-wide"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
        Send this code to the configured model for one read-only review. This uses inference and may incur a charge.</label>
      <div className="gk-review-wide"><button type="submit" disabled={!source || busy || !consent || Boolean(pending?.jobId)}>{pending ? "Recover submission" : "Start review"}</button>
        <p className="gk-review-note">No repository access or code execution is included. Findings do not authorize repairs, merges or deployments.</p></div>
    </form>

    {history.length > 0 && <section className="gk-review-card" aria-label="Recent private reviews"><h2>Recent reviews</h2>
      <ul>{history.map(item => <li key={item.id}><button disabled={busy} onClick={() => action(() => call({ action: "get", jobId: item.id }, null))}>
        {item.file} · {COPY[item.state][0]} · {new Date(item.createdAt).toLocaleString()}</button></li>)}</ul>
    </section>}
    {job && <section className="gk-review-card" aria-labelledby="gk-review-result-heading">
      <div className="gk-review-kicker">{job.file} · {job.lineCount} lines</div><h2 id="gk-review-result-heading">{COPY[job.state][0]}</h2>
      <p>{COPY[job.state][1]}</p>
      <p className="gk-review-note">Saved request: <code>{job.id}</code></p>
      <div className="gk-review-toolbar">
        <button disabled={busy} onClick={() => action(() => call({ action: "get", jobId: job.id }, null))}>Check status</button>
        {["queued", "session_created"].includes(job.state) && <button disabled={busy || !consent}
          onClick={() => action(() => call({ action: "start", jobId: job.id }, null))}>Continue saved review</button>}
      </div>
      {job.state === "complete" && (job.findings.length === 0 ?
        <p>No findings were reported for this submission. This does not establish that the code is defect-free.</p> :
        <ol className="gk-review-findings">{job.findings.map((finding, index) => <li key={index}>
          <div><strong>{finding.severity.toUpperCase()}</strong> · {finding.category} · line {finding.line}</div><p>{finding.comment}</p>
        </li>)}</ol>)}
      <p className="gk-review-note">{job.estimatedCostUsd === null ? "Cost is not available." :
        `Engine cost estimate: USD ${job.estimatedCostUsd.toFixed(6)}.`} Billing remains unsettled.</p>
      <p className="gk-review-note">Source version: <code>{job.sourceCommit}</code></p>
    </section>}
  </section>;
}
