import React, { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { projectLearningStatusResponse } from "../shared/learning-status-contract.js";
import "./GateKeeperLearningStatus.css";

// Only the dedicated read-only function is available in either app convention.
// Authentication and the configured owner binding remain server responsibilities.
const STATUS_FUNCTIONS = new Set(["gatekeeperLearningStatus", "gatekeeper-learning-status"]);
const STATUS_WAIT_MS = 20_000;
const COUNT_FIELDS = [
  ["attempted", "Attempted"], ["scored", "Scored"], ["duplicate", "Duplicate"],
  ["unresolved", "Unresolved"], ["invalid", "Invalid"], ["noCoverage", "No coverage"],
  ["rejected", "Rejected"], ["provisional", "Provisional"], ["confirmed", "Confirmed"],
  ["activated", "Activations"],
];
const PHASE_LABELS = {
  baseline: "Baseline", proposal: "Proposal", screen: "Screening", confirmation: "Confirmation",
};
const DISPATCH_LABELS = {
  "admission-intent": "Admission intent saved",
  "admission-observed": "Admission response observed",
  "settlement-observed": "Settlement response observed",
  "not-admitted-observed": "Non-admission response observed",
};
const BASELINE_LABELS = {
  "not-planned": "Not planned", planned: "Planned", complete: "Complete", failed: "Failed",
};
const PROBLEMS = {
  unavailable: {
    title: "Learning status is unavailable",
    detail: "The configured status connection may not be connected or reachable. Refresh to check again; no learning records are shown until a valid response is available.",
  },
  invalid: {
    title: "Learning status could not be verified",
    detail: "The status source returned a response this view could not verify. No learning records are displayed. Refresh after the status connection has been checked.",
  },
  signedOut: {
    title: "Sign in to view learning status",
    detail: "Use the configured owner's administrator account, then refresh this view. Learning records are not available to anonymous visitors.",
  },
  forbidden: {
    title: "Learning status access is restricted",
    detail: "This account cannot view the configured owner's learning records. Access requires both the configured owner identity and administrator permission.",
  },
};

function formatCheckedAt(value) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  }).format(new Date(value));
}

function formatUsd(micros) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency: "USD", currencyDisplay: "code",
    minimumFractionDigits: 2, maximumFractionDigits: 6,
  }).format(micros / 1_000_000);
}

function BaselineSummary({ baseline }) {
  const descriptions = {
    "not-planned": "No baseline plan has been recorded for this experiment.",
    planned: "A baseline plan is saved. A complete result has not been recorded.",
    complete: "A complete baseline has been recorded for the frozen experiment.",
    failed: baseline.failureCode === "not-admitted" ?
      "The independent gateway confirmed that the baseline request was not admitted." :
      "The baseline is recorded as unresolved. Its private evidence requires operator review.",
  };
  return <section className="gk-learning-card" aria-labelledby="gk-learning-baseline-title">
    <h2 id="gk-learning-baseline-title">Baseline</h2>
    <p className={"gk-learning-value" + (baseline.status === "failed" ? " gk-learning-value-held" : "")}>
      {BASELINE_LABELS[baseline.status]}
    </p>
    <p>{descriptions[baseline.status]}</p>
    {baseline.status === "failed" && <span className="gk-learning-tag gk-learning-tag-held">
      {baseline.failureCode === "not-admitted" ? "Gateway non-admission" : "Unresolved baseline"}
    </span>}
  </section>;
}

function RecordedStatus({ response }) {
  const status = response.status;
  const pending = status.dispatch.pending;
  const sourceQualified = status.qualification === "managed-source-gate-passed";
  return <>
    <div className="gk-learning-summary">
      <BaselineSummary baseline={status.baseline} />
      <section className="gk-learning-card" aria-labelledby="gk-learning-qualification-title">
        <h2 id="gk-learning-qualification-title">Source qualification</h2>
        <p className="gk-learning-value">{sourceQualified ? "Source gate recorded" : "Source only · unqualified"}</p>
        <p>{sourceQualified ? "The managed source gate is recorded as passed." :
          "A matching managed source gate has not been recorded."}</p>
        <p className="gk-learning-note">Source qualification does not measure review accuracy or establish learning improvement.</p>
      </section>
      <section className="gk-learning-card" aria-labelledby="gk-learning-pending-title">
        <h2 id="gk-learning-pending-title">Pending operation</h2>
        <p className="gk-learning-value">{pending ? PHASE_LABELS[pending.kind] :
          status.pendingOperation ? "Reconciliation pending" : "None recorded"}</p>
        <p>{pending ? DISPATCH_LABELS[pending.stage] : status.pendingOperation ?
          "A controller operation remains unsettled." : "No pending dispatch or unsettled operation is recorded."}</p>
        {status.pendingOperation && <code className="gk-learning-id">{status.pendingOperation}</code>}
        <p className="gk-learning-note">Saved dispatch observations are shown here. This view does not monitor remote provider activity.</p>
        <p className="gk-learning-detail">Closed dispatch records: <strong>{status.dispatch.completed}</strong></p>
      </section>
    </div>

    <section className="gk-learning-section" aria-labelledby="gk-learning-counts-title">
      <div className="gk-learning-section-heading">
        <div><span className="gk-learning-kicker">RECORDED PROGRESS</span><h2 id="gk-learning-counts-title">Attempts and outcomes</h2></div>
        <p>Scoring and outcomes can overlap. Activations count recorded activation actions.</p>
      </div>
      <dl className="gk-learning-counts">
        {COUNT_FIELDS.map(([key, label]) => <div key={key}>
          <dt>{label}</dt><dd>{status.counts[key]}</dd>
        </div>)}
      </dl>
    </section>

    <section className="gk-learning-section" aria-labelledby="gk-learning-budget-title">
      <div className="gk-learning-section-heading">
        <div><span className="gk-learning-kicker">PER-RUN USAGE RECORD</span><h2 id="gk-learning-budget-title">Recorded run balance</h2></div>
      </div>
      <dl className="gk-learning-budget">
        <div><dt>Known charges</dt><dd>{formatUsd(status.budget.observedSpentMicros)}</dd></div>
        <div><dt>Reserved estimate</dt><dd>{formatUsd(status.budget.observedReservedMicros)}</dd></div>
        <div><dt>Unpriced operations</dt><dd>{status.budget.unknownCostOperations}</dd></div>
        <div><dt>Calls awaiting prices</dt><dd>{status.budget.unknownCostCalls}</dd></div>
        <div><dt>Accounting record</dt><dd>{status.budget.complete ? "Complete" : "Pending"}</dd></div>
        <div><dt>Spending gate</dt><dd>None — usage only</dd></div>
      </dl>
      <p className="gk-learning-note">Known charges include only verified prices for this run. Unpriced operations remain unknown, including any operation with zero model calls. Delayed prices can be recorded later without repeating calls or holding up learning.</p>
    </section>

    <section className="gk-learning-section" aria-labelledby="gk-learning-identity-title">
      <div className="gk-learning-section-heading">
        <div><span className="gk-learning-kicker">CONFIGURED OWNER SCOPE</span><h2 id="gk-learning-identity-title">Experiment and versions</h2></div>
      </div>
      <dl className="gk-learning-identity">
        <div><dt>Experiment</dt><dd><code>{status.experimentId}</code></dd></div>
        <div><dt>Frozen source commit</dt><dd><code>{status.sourceCommit}</code></dd></div>
        <div><dt>Review scope</dt><dd>{status.scope}</dd></div>
        <div><dt>Confirmed candidate versions</dt><dd>{status.confirmedVersions}</dd></div>
        <div><dt>Original version</dt><dd><code>{status.originalVersion}</code></dd></div>
        <div><dt>Incumbent version</dt><dd><code>{status.incumbentVersion}</code></dd></div>
      </dl>
      <p className="gk-learning-note">Deployment is not managed by the learning core. Learning and promotion actions remain outside this read-only view.</p>
    </section>
  </>;
}

export default function GateKeeperLearningStatus({ functionName = "gatekeeperLearningStatus" }) {
  const [state, setState] = useState({ source: functionName, phase: "loading", response: null, problem: null });
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const requestTimer = useRef(null);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    if (requestTimer.current !== null) {
      clearTimeout(requestTimer.current.handle);
      requestTimer.current = null;
    }
    const version = ++requestVersion.current;
    const current = () => mounted.current && requestVersion.current === version;
    // Clear the entire prior snapshot before any request. Old records are never
    // relabelled as a fresh check while refresh or authentication is unresolved.
    setState({ source: functionName, phase: "loading", response: null, problem: null });
    if (!STATUS_FUNCTIONS.has(functionName)) {
      setState({ source: functionName, phase: "unavailable", response: null, problem: "unavailable" });
      return;
    }
    const timer = { handle: null };
    timer.handle = setTimeout(() => {
      if (!current()) return;
      // This ends the UI wait, not the underlying Base44 request. A late result
      // cannot restore the expired snapshot or overwrite a later manual refresh.
      requestVersion.current++;
      if (requestTimer.current === timer) requestTimer.current = null;
      setState({ source: functionName, phase: "unavailable", response: null, problem: "unavailable" });
    }, STATUS_WAIT_MS);
    requestTimer.current = timer;
    try {
      const result = await base44.functions.invoke(functionName, {});
      if (!current()) return;
      let response;
      try {
        response = projectLearningStatusResponse(result?.data);
      } catch {
        setState({ source: functionName, phase: "unavailable", response: null, problem: "invalid" });
        return;
      }
      setState({ source: functionName, phase: "ready", response, problem: null });
    } catch (error) {
      if (!current()) return;
      const code = error?.response?.status;
      const problem = code === 401 ? "signedOut" : code === 403 ? "forbidden" : "unavailable";
      setState({ source: functionName, phase: "unavailable", response: null, problem });
    } finally {
      if (requestTimer.current === timer) {
        clearTimeout(timer.handle);
        requestTimer.current = null;
      }
    }
  }, [functionName]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      // The Base44 invocation has no cancellation option used by this adapter.
      // Invalidate all outstanding results on unmount or function-name change.
      mounted.current = false;
      requestVersion.current++;
      if (requestTimer.current !== null) {
        clearTimeout(requestTimer.current.handle);
        requestTimer.current = null;
      }
    };
  }, [refresh]);

  const loading = state.source !== functionName || state.phase === "loading";
  const response = !loading && state.phase === "ready" ? state.response : null;
  const problem = !loading && !response ? PROBLEMS[state.problem] || PROBLEMS.unavailable : null;

  return <section className="gk-learning-page" aria-labelledby="gk-learning-title" aria-busy={loading}>
    <header className="gk-learning-header">
      <div>
        <span className="gk-learning-kicker">CONFIGURED OWNER · READ ONLY</span>
        <h1 id="gk-learning-title">Learning status</h1>
        <p>Inspect the experiment's recorded progress, source qualification and observed budget. This view cannot start, change or promote a learning run.</p>
      </div>
      <button type="button" className="gk-learning-refresh" onClick={() => void refresh()} disabled={loading}>
        {loading ? "Refreshing…" : "Refresh status"}
      </button>
    </header>

    <div className={"gk-learning-connection" + (problem ? " gk-learning-connection-held" : "")}
      role="status" aria-live="polite" aria-atomic="true">
      {loading ? <p>Reading recorded status…</p> : response ? <>
        <strong>Recorded status loaded</strong>
        <span>Last checked: <time dateTime={response.checkedAt}>{formatCheckedAt(response.checkedAt)}</time> · Australia/Melbourne</span>
        <span className="gk-learning-read-note">Checked time records when the saved state was read. Learning progress may be older.</span>
      </> : <><strong>{problem.title}</strong><p>{problem.detail}</p></>}
    </div>

    {response ? <RecordedStatus response={response} /> : <div className="gk-learning-empty">
      <span className="gk-learning-kicker">AWAITING VERIFIED RECORDS</span>
      <h2>{loading ? "Checking the configured status source" : "No verified status to display"}</h2>
      <p>{loading ? "Progress and budget figures appear only after the status response has been validated." :
        "Learning figures will appear when this owner has a connected, authenticated status source. Demonstration lessons and historical benchmarks do not populate this view."}</p>
    </div>}
  </section>;
}
