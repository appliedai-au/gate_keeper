import React, { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { projectLearningHistoryForDisplay } from "../shared/learning-history-contract.js";
import "./GateKeeperLearningStatus.css";

const FUNCTION = "gatekeeperLearningHistory";
const WAIT_MS = 75_000;
const COUNTS = [["attempted", "Attempted"], ["scored", "Scored"], ["duplicate", "Duplicate"],
  ["unresolved", "Unresolved"], ["invalid", "Invalid"], ["noCoverage", "No coverage"],
  ["rejected", "Rejected"], ["confirmed", "Confirmed"], ["activated", "Activations"]];
const PROBLEMS = {
  unauthorized: ["Sign in to view the pilot archive", "Use the configured owner's administrator account, then refresh."],
  forbidden: ["Pilot archive access is restricted", "This account does not have the configured owner's administrator permission."],
  invalid: ["Pilot archive could not be verified", "The response did not match the completed-history contract. No records are displayed."],
  unavailable: ["Pilot archive is unavailable", "The completed checkpoint or its connection has not been verified. Refresh after the connection has been checked."],
};
const formatTime = value => new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Melbourne", day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
}).format(new Date(value));
const formatUsd = value => new Intl.NumberFormat("en-AU", {
  style: "currency", currency: "USD", currencyDisplay: "code", maximumFractionDigits: 6,
}).format(value / 1_000_000);

function CompletedRecords({ response }) {
  const { status, serving, archive } = response;
  return <>
    <div className="gk-learning-summary">
      <section className="gk-learning-card"><h2>Proposal attempts</h2>
        <p className="gk-learning-value">{status.counts.attempted} of 10 completed</p>
        <p>Each attempt has retained proposal execution and settlement evidence. Negative and unresolved dispositions remain in the record.</p>
      </section>
      <section className="gk-learning-card"><h2>Frozen baseline</h2>
        <p className="gk-learning-value">Complete</p>
        <p>The original baseline and its earlier authorized continuation under B remain linked to their retained evidence.</p>
      </section>
      <section className="gk-learning-card"><h2>Execution checkpoint</h2>
        <p className="gk-learning-value">Closed</p>
        <p>No Learning operation is pending in this archived checkpoint.</p>
        <p className="gk-learning-note">This view reads saved history; it does not start learning or monitor a running pilot.</p>
      </section>
    </div>
    <section className="gk-learning-section" aria-labelledby="gk-history-counts">
      <div className="gk-learning-section-heading"><div><span className="gk-learning-kicker">RETAINED OUTCOMES</span>
        <h2 id="gk-history-counts">Attempts and outcomes</h2></div>
        <p>Scoring overlaps outcomes. Activations count recorded actions.</p></div>
      <dl className="gk-learning-counts">{COUNTS.map(([key, label]) => <div key={key}>
        <dt>{label}</dt><dd>{status.counts[key]}</dd></div>)}</dl>
    </section>
    <section className="gk-learning-section" aria-labelledby="gk-history-pricing">
      <div className="gk-learning-section-heading"><div><span className="gk-learning-kicker">PRICING AT ARCHIVE</span>
        <h2 id="gk-history-pricing">Recorded run balance</h2></div></div>
      <dl className="gk-learning-budget">
        <div><dt>Known charges</dt><dd>{formatUsd(status.budget.observedSpentMicros)}</dd></div>
        <div><dt>Unpriced operations</dt><dd>{status.budget.unknownCostOperations}</dd></div>
        <div><dt>Calls awaiting prices</dt><dd>{status.budget.unknownCostCalls}</dd></div>
        <div><dt>Accounting record</dt><dd>{status.budget.complete ? "Complete" : "Prices remain unknown"}</dd></div>
        <div><dt>Reserved estimate</dt><dd>{formatUsd(status.budget.observedReservedMicros)}</dd></div>
        <div><dt>Programme spending cap</dt><dd>None</dd></div>
      </dl>
      <p className="gk-learning-note">Known charges contain verified prices only. An unpriced operation has an unknown cost, not a zero charge. This immutable checkpoint does not change when later billing information becomes available.</p>
    </section>
    <section className="gk-learning-section" aria-labelledby="gk-history-versions">
      <div className="gk-learning-section-heading"><div><span className="gk-learning-kicker">HISTORY AND SERVING VERSIONS</span>
        <h2 id="gk-history-versions">Experiment and provenance</h2></div></div>
      <dl className="gk-learning-identity">
        <div><dt>Experiment</dt><dd><code>{status.experimentId}</code></dd></div>
        <div><dt>Review scope</dt><dd>{status.scope}</dd></div>
        <div><dt>Frozen experiment source (A)</dt><dd><code>{archive.experimentSourceCommit}</code></dd></div>
        <div><dt>Earlier Learning implementation (B)</dt><dd><code>{archive.originalExecutionSourceCommit}</code></dd></div>
        <div><dt>Recovery and final Learning implementation</dt><dd><code>{archive.finalExecutionSourceCommit}</code></dd></div>
        <div><dt>Current app serving source (C)</dt><dd><code>{serving.sourceCommit}</code></dd></div>
        <div><dt>Owner-pinned checkpoint</dt><dd><code>{archive.closureDigest}</code></dd></div>
        <div><dt>Original version</dt><dd><code>{status.originalVersion}</code></dd></div>
        <div><dt>Final incumbent version</dt><dd><code>{status.incumbentVersion}</code></dd></div>
        <div><dt>Confirmed learned versions</dt><dd>{status.confirmedVersions}</dd></div>
        <div><dt>Archived checkpoint</dt><dd><time dateTime={archive.archivedAt}>{formatTime(archive.archivedAt)}</time></dd></div>
      </dl>
      <p className="gk-learning-note">A and B retain the original baseline and earlier proposal execution. The recovery implementation later verified the already-dispatched fourth proposal's original result, recorded its invalid outcome, and completed the separately authorized remaining original attempts. These source identities do not claim a model improvement.</p>
      <dl className="gk-learning-identity">
        <div><dt>Recovered original attempt</dt><dd>{archive.recovery.attempt}</dd></div>
        <div><dt>Recovery method</dt><dd>Later read of the original invalid proposal</dd></div>
        <div><dt>Additional model calls for recovery</dt><dd>{archive.recovery.additionalModelCalls}</dd></div>
      </dl>
      <p className="gk-learning-note">The original model call is counted once. Zero additional recovery calls does not mean the original call was free; unknown prices remain unknown.</p>
      <p className="gk-learning-note">The frozen pilot's rules are retained here. This archive does not apply them to ordinary private reviews, authorize repairs, or provide learning or promotion controls.</p>
    </section>
  </>;
}

export default function GateKeeperLearningHistory() {
  const [state, setState] = useState({ phase: "loading", response: null, problem: null });
  const mounted = useRef(false), version = useRef(0), pendingTimer = useRef(null);
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    if (pendingTimer.current) clearTimeout(pendingTimer.current.handle);
    const currentVersion = ++version.current;
    const current = () => mounted.current && version.current === currentVersion;
    setState({ phase: "loading", response: null, problem: null });
    const timer = { handle: null };
    timer.handle = setTimeout(() => {
      if (!current()) return;
      version.current++;
      if (pendingTimer.current === timer) pendingTimer.current = null;
      setState({ phase: "unavailable", response: null, problem: "unavailable" });
    }, WAIT_MS);
    pendingTimer.current = timer;
    try {
      const result = await base44.functions.invoke(FUNCTION, {});
      if (!current()) return;
      const error = result?.data?.error;
      if (error) {
        setState({ phase: "unavailable", response: null,
          problem: ["unauthorized", "forbidden"].includes(error) ? error : "unavailable" });
        return;
      }
      let response;
      // The fixed owner-only backend checks trusted pins and freshness. A skewed
      // device clock must not reject that response during display projection.
      try { response = projectLearningHistoryForDisplay(result?.data); }
      catch { setState({ phase: "unavailable", response: null, problem: "invalid" }); return; }
      setState({ phase: "ready", response, problem: null });
    } catch (error) {
      if (!current()) return;
      const status = error?.response?.status;
      setState({ phase: "unavailable", response: null,
        problem: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "unavailable" });
    } finally {
      if (pendingTimer.current === timer) { clearTimeout(timer.handle); pendingTimer.current = null; }
    }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    return () => {
      mounted.current = false; version.current++;
      if (pendingTimer.current) clearTimeout(pendingTimer.current.handle);
      pendingTimer.current = null;
    };
  }, [refresh]);
  const loading = state.phase === "loading";
  const response = state.phase === "ready" ? state.response : null;
  const problem = PROBLEMS[state.problem] || PROBLEMS.unavailable;
  return <section className="gk-learning-page" aria-labelledby="gk-history-title" aria-busy={loading}>
    <header className="gk-learning-header"><div><span className="gk-learning-kicker">CONFIGURED OWNER · READ ONLY</span>
      <h1 id="gk-history-title">{response ? "Completed pilot" : "Learning archive"}</h1>
      <p>View the verified final checkpoint of the frozen ten-attempt pilot, including its outcomes, recorded prices and source versions.</p></div>
      <button type="button" className="gk-learning-refresh" onClick={() => void refresh()} disabled={loading}>
        {loading ? "Refreshing…" : "Refresh archive"}</button></header>
    <div className={"gk-learning-connection" + (!loading && !response ? " gk-learning-connection-held" : "")}
      role="status" aria-live="polite" aria-atomic="true">
      {loading ? <p>Verifying the completed checkpoint…</p> : response ? <>
        <strong>Completed checkpoint verified</strong>
        <span>Last read: <time dateTime={response.checkedAt}>{formatTime(response.checkedAt)}</time></span>
        <span className="gk-learning-read-note">Archive captured: {formatTime(response.archive.archivedAt)}. A fresh read verifies these saved records; it does not represent new pilot activity.</span>
      </> : <><strong>{problem[0]}</strong><p>{problem[1]}</p></>}
    </div>
    {response ? <CompletedRecords response={response} /> : <div className="gk-learning-empty">
      <span className="gk-learning-kicker">AWAITING VERIFIED HISTORY</span>
      <h2>{loading ? "Checking the configured archive" : "No verified archive to display"}</h2>
      <p>Counts and outcomes appear only after the completed-history response has been authenticated and validated.</p>
    </div>}
  </section>;
}
