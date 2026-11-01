import React, { useState } from "react";
import catalogue from "../data/modelCatalogue.json";
import proof from "../data/firstBenchmark.json";
import smoke from "../data/cheapestSmoke.json";
import study from "../data/deepseekFourRoundProgress.json";

// Public, sanitised history; this component never calls a model or stores keys.
// The catalogue is an observed snapshot, not an API authorisation or credit receipt.
const border = "1px solid #d7ded9";
const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 };
const card = { background: "#fff", border, borderRadius: 12, padding: 22, marginBottom: 18 };
const fmt = (value) => "$" + Number(value).toFixed(4);
const percent = (value) => (100 * Number(value)).toFixed(1) + "%";
const cols = [{ label: "Reviewer", key: "method" }, { label: "Model", key: "model" }];

export default function GateKeeperBenchmark({ section = "Runs" }) {
  const [model, setModel] = useState("");
  const [showLimits, setShowLimits] = useState(section === "Evidence");
  const previous = proof.arms.filter((arm) => arm.model === model);
  return (
    <section aria-label="Recorded Gate Keeper comparison and Stranger Builds model selection">
      <div className="gk-section-heading">
        <div className="gk-eyebrow"><span className="gk-eyebrow-square" />{section === "Runs" ? "RECORDED RUN / PUBLIC RESULTS" : "SOURCE-BOUND EVIDENCE / NOT INDEPENDENTLY QUALIFIED"}</div>
        <h1>{section === "Runs" ? "The benchmark, not the demo." : "Evidence, with its limits."}</h1>
        <p>See recorded model experiments and their evidence. The newest comparison ran in the TrueFoundry Playground; the older study used a separate TrueForge test harness. Neither runs from this website.</p>
      </div>
      <div role="region" aria-label="DeepSeek four-round study progress" style={{ ...card }}>
        <div style={{ ...mono, fontWeight: 800, color: "#596772", letterSpacing: ".08em" }}>
          FOUR-ROUND MODEL STUDY / {study.status}
        </div>
        <h2 style={{ fontSize: 20, margin: "10px 0 8px" }}>DeepSeek v4 Flash — four reviews per method</h2>
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>
          {study.agents.map((arm) => arm.label + ": " + arm.observedRounds + "/" + arm.requiredRounds).join("  ·  ")}.
          Six review calls still need gateway evidence. Separate own-model learning calls have not been observed.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 440, borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>{["Round", "Public fixture", "Plain review", "Gate Keeper"].map((name) =>
                <th key={name} scope="col" style={{ borderBottom: border, textAlign: "left", padding: "10px 7px" }}>{name}</th>)}</tr>
            </thead>
            <tbody>
              {study.rounds.map((round) => <tr key={round.round}>
                <td style={{ borderBottom: border, padding: "11px 7px" }}>{round.round}</td>
                <td style={{ borderBottom: border, padding: "11px 7px" }}>{round.fixtureId}</td>
                <td style={{ borderBottom: border, padding: "11px 7px" }}>
                  {round.baseline.status === "OBSERVED" ?
                    round.baseline.detected + "/" + round.baseline.expected + " known defects" : "Not run"}
                </td>
                <td style={{ borderBottom: border, padding: "11px 7px" }}>
                  {round.gate_keeper.status === "OBSERVED" ?
                    round.gate_keeper.detected + "/" + round.gate_keeper.expected + " known defects" : "Not run"}
                </td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <p style={{ margin: "13px 0 0", fontSize: 12, lineHeight: 1.6, color: "#596772" }}>
          Recorded review turns: {study.totalReviewTurnsObserved}/{study.totalReviewTurnsRequired}.
          This is a Playground prompt comparison, not native TrueForge agent learning.
          Different fixture difficulty prevents claiming improvement from round-to-round recall alone.
          Missing rounds have no scores and are never displayed as failures.
          <a href={study.existingProofUrl} rel="noopener noreferrer" target="_blank" style={{ marginLeft: 8 }}>
            Inspect the completed first round
          </a>
        </p>
      </div>
      <div role="region" aria-label="Newest live Playground method comparison" style={{ ...card, borderColor: "#9cb48c" }}>
        <div style={{ ...mono, fontWeight: 800, color: "#536846", letterSpacing: ".08em" }}>NEW TEST / {smoke.runId.toUpperCase()} / {smoke.result}</div>
        <h2 style={{ fontSize: 21, margin: "10px 0 8px", color: "#142636" }}>Live cheapest-model comparison</h2>
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>
          Two real inference calls on <code>{smoke.model}</code> using identical Python code and temperature 0.
          This is a <strong>one-fixture Playground methodology test</strong>, not a native TrueForge SDK run or independently qualified benchmark.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 580, borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>{["Review method", "Known defects", "Latency", "Tokens (approx.)", "Gateway cost (USD)"].map((h) =>
                <th key={h} scope="col" style={{ textAlign: "left", borderBottom: border, padding: "9px 8px" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {smoke.arms.map((arm) => <tr key={arm.method}>
                <td style={{ borderBottom: border, padding: "11px 8px", fontWeight: 650 }}>{arm.method}</td>
                <td style={{ borderBottom: border, padding: "11px 8px" }}>{arm.knownIssuesDetected}/{arm.expectedIssues}</td>
                <td style={{ borderBottom: border, padding: "11px 8px" }}>{(arm.latencyMs / 1000).toFixed(2)}s</td>
                <td style={{ borderBottom: border, padding: "11px 8px" }}>{arm.reportedTokensApprox.toLocaleString()}</td>
                <td style={{ borderBottom: border, padding: "11px 8px", whiteSpace: "nowrap" }}>${arm.gatewayReportedChargeUsd.toFixed(8)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 13, margin: "13px 0 8px", lineHeight: 1.6 }}>
          <strong>Observed cost for both calls: ${smoke.totalGatewayChargeUsd.toFixed(8)} USD.</strong>
          These charges are shown in TrueFoundry request traces; sponsor-credit deductions remain unverified.
        </p>
        <p style={{ fontSize: 12, color: "#744c19", lineHeight: 1.6 }}>
          <strong>Accuracy caveat:</strong> Gate Keeper found the previously missed swallowed exception,
          but wrongly claimed that a zero step causes an infinite loop. Python's range(step=0) raises ValueError.
          The trial result is INCONCLUSIVE, not an independently certified win.
        </p>
        <p style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, marginBottom: 0 }}>
          <a href={smoke.githubReportUrl} rel="noopener noreferrer" target="_blank">Open smoke-test report</a>
          <a href={smoke.githubSummaryUrl} rel="noopener noreferrer" target="_blank">Inspect recorded results</a>
        </p>
      </div>
      <div role="status" style={{ ...card, background: "#fff9e9", borderColor: "#ecdba5" }}>
        <div style={{ ...mono, fontWeight: 800, letterSpacing: ".08em" }}>RUN {proof.runId.toUpperCase()} / {proof.result}</div>
        <h2 style={{ margin: "9px 0", fontSize: 21, color: "#1c2d38" }}>Model comparison recorded on 1 November 2026</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          Two trials, 12 code-review tasks. Independent qualification: <strong>blocked</strong>.
          Original provider: <code>{proof.modelProviderAtRun}</code>. Sponsor-credit attribution and actual invoiced cost: <strong>unverified</strong>.
        </p>
      </div>
      <div style={card}>
        <div style={{ ...mono, fontWeight: 800, letterSpacing: ".08em", color: "#64717a", marginBottom: 12 }}>HISTORICAL MEASURED QUALITY / ESTIMATED COSTS</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 650, borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>{["Review method", "Model", "Defects", "False positives", "Precision", "Est. USD / review"].map((h) => <th key={h} scope="col" style={{ padding: "11px 10px", borderBottom: border, textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {proof.arms.map((arm) => (
                <tr key={arm.id} style={{ background: arm.method.startsWith("Gate Keeper") ? "#f4f8eb" : "#fff" }}>
                  <td style={{ padding: "12px 10px", borderBottom: border, fontWeight: 650 }}>{arm.method}</td>
                  <td style={{ padding: "12px 10px", borderBottom: border }}>{arm.model}</td>
                  <td style={{ padding: "12px 10px", borderBottom: border, whiteSpace: "nowrap" }}>{arm.detected}/{proof.expectedDefects}</td>
                  <td style={{ padding: "12px 10px", borderBottom: border }}>{arm.falsePositives}</td>
                  <td style={{ padding: "12px 10px", borderBottom: border }}>{percent(arm.precision)}</td>
                  <td style={{ padding: "12px 10px", borderBottom: border, whiteSpace: "nowrap" }}>{fmt(arm.estimatedCostUsdPerReview)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: "#596772", marginTop: 15, lineHeight: 1.6 }}>
          The run used a historical Anthropic provider, <strong>not proven Stranger Builds sponsor credit</strong>.
          Costs are list-price estimates, not paid invoices. This record was classified INCONCLUSIVE.
        </p>
        <p style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 0 }}>
          <a href={proof.reportUrl} target="_blank" rel="noopener noreferrer">Read submitted report</a>
          <a href={proof.summaryUrl} target="_blank" rel="noopener noreferrer">Inspect structured proof summary</a>
        </p>
      </div>
      <div style={card}>
        <div style={{ ...mono, fontWeight: 800, letterSpacing: ".08em", color: "#64717a", marginBottom: 12 }}>NEXT COMPARISON / MODEL CHOICE</div>
        <h2 style={{ fontSize: 20, margin: "0 0 9px" }}>Choose any Stranger Builds chat model</h2>
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>All {catalogue.chatModels.length} chat models observed in the tenant are listed, not just the two original defaults. The {catalogue.embeddingModels.length} embedding models are excluded from code-review generation. Choosing a model here does not initiate inference or prove API access.</p>
        <label htmlFor="gk-model-choice" style={{ display: "block", fontWeight: 700, fontSize: 12, margin: "14px 0 7px" }}>Model for a future fair comparison</label>
        <select id="gk-model-choice" value={model} onChange={(event) => setModel(event.target.value)}
          style={{ width: "100%", maxWidth: 600, padding: 13, border, borderRadius: 7, background: "#fff", color: "#1c2d38", fontSize: 14 }}>
          <option value="">Select one of {catalogue.chatModels.length} eligible model types…</option>
          {catalogue.chatModels.map((name) => <option key={name} value={name}>tfy-managed/{name}</option>)}
        </select>
        <div aria-live="polite" style={{ fontSize: 12, paddingTop: 13, color: "#596772", lineHeight: 1.5 }}>
          {model
            ? <>{model} selected for planning. {previous.length ? "There is a historical comparison for this model family above." : model === "deepseek-v4-flash-0731" ? "A one-fixture Playground method smoke is recorded above; native TrueForge execution remains unverified." : "No historical benchmark is recorded for this exact model."} A sponsored, budget-limited API call must be authorised separately.</>
            : "No model selected. No paid requests will be sent from this page."}
        </div>
        <p style={{ fontSize: 12, color: "#596772", marginBottom: 0 }}>Catalogue observed {catalogue.observedOn}; registered TrueForge access, model-specific charges, free sponsor balance and usage eligibility remain to be verified. No fallback to personal billing.</p>
      </div>
      <div style={card}>
        <div style={{ ...mono, fontWeight: 800, letterSpacing: ".08em", color: "#64717a", marginBottom: 12 }}>CONCLUSIONS AND PROVENANCE</div>
        {proof.conclusions.map((line, idx) => <p key={idx} style={{ lineHeight: 1.6, fontSize: 13, marginBottom: 12 }}><strong>{idx + 1}.</strong> {line}</p>)}
        <button type="button" onClick={() => setShowLimits((v) => !v)} aria-expanded={showLimits}
          style={{ background: "transparent", color: "#183a2d", border, padding: "11px 15px", borderRadius: 7, fontWeight: 700 }}>
          {showLimits ? "Hide" : "Show"} evidence limitations
        </button>
        {showLimits && <div style={{ paddingTop: 12 }}>
          {proof.limitations.map((item, idx) => <p key={idx} style={{ marginBottom: 8, fontSize: 12, lineHeight: 1.6 }}>• {item}</p>)}
          <p style={{ ...mono, overflowWrap: "anywhere", color: "#667784" }}>Source revision: {proof.sourceCommit}</p>
        </div>}
      </div>
    </section>
  );
}
