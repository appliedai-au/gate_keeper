import React, { useState } from "react";
import GateKeeperConnectionPanel from "../components/GateKeeperConnectionPanel";
import AdversarialLab from "../components/AdversarialLab";
import "./GateKeeper.css";

// A product walkthrough fixture, not output from TrueForge. Never display it
// as a live result or use these sample findings as verification evidence.
const SAMPLE_CODE = [
  { number: 1, text: "export async function getInvoice(request, db) {" },
  { number: 2, text: "  const invoiceId = request.params.invoiceId;" },
  { number: 3, text: "  const invoice = await db.invoice.findUnique({" },
  { number: 4, text: "    where: { id: invoiceId }" },
  { number: 5, text: "  });" },
  { number: 6, text: '  console.log("invoice contact", invoice?.customerEmail);' },
  { number: 7, text: "  return Response.json(invoice);" },
  { number: 8, text: "}" },
];

const SAMPLE_FINDINGS = [
  {
    id: "GK-001",
    level: "HIGH",
    type: "Tenant isolation",
    title: "Invoice lookup is not scoped to the current tenant",
    explanation: "The query fetches by invoice ID alone. A caller with another tenant's invoice ID could access its record if the route lacks a separate ownership check.",
    action: "Filter by the authenticated tenant and verify the invoice belongs to it before returning any fields.",
    lines: [3, 4, 7],
  },
  {
    id: "GK-002",
    level: "MEDIUM",
    type: "Sensitive logging",
    title: "Customer email address appears in application logs",
    explanation: "The handler logs a customer's email address. This can widen access to personal information through log aggregation and support tooling.",
    action: "Remove this log or replace it with a non-sensitive trace identifier.",
    lines: [6],
  },
];

const NAV = [
  ["Overview", "◫"],
  ["Review", "⌁"],
  ["Runs", "◷"],
  ["Evidence", "◇"],
  ["Settings", "⚙"],
];

function Mark() {
  return (
    <div className="gk-logo" aria-hidden="true">
      <span className="gk-logo-line gk-logo-line-a" />
      <span className="gk-logo-line gk-logo-line-b" />
      <span className="gk-logo-dot" />
    </div>
  );
}

function Eyebrow({ children }) {
  return <div className="gk-eyebrow"><span className="gk-eyebrow-square" />{children}</div>;
}

function MiniCode({ expanded = false, activeLines = [] }) {
  return (
    <div className="gk-code-window" aria-label="Illustrative TypeScript code review fixture">
      <div className="gk-code-header">
        <div className="gk-code-window-dots"><i /><i /><i /></div>
        <span>src / api / invoices.ts</span>
        <span className="gk-file-type">TS</span>
      </div>
      <div className="gk-code-lines">
        {SAMPLE_CODE.slice(0, expanded ? undefined : 7).map((line) => (
          <div
            key={line.number}
            className={"gk-code-line" + (activeLines.includes(line.number) ? " gk-code-line-selected" : "")}
          >
            <span className="gk-line-number">{String(line.number).padStart(2, "0")}</span>
            <code>{line.text}</code>
            {activeLines.includes(line.number) && <span className="gk-line-flag" aria-label="Flagged line">●</span>}
          </div>
        ))}
      </div>
      {!expanded && <div className="gk-code-foot"><span className="gk-pulse" /> ANALYSIS PREVIEW <span>READ ONLY</span></div>}
    </div>
  );
}

function Finding({ item, index, active, onChoose }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onChoose(index)}
      className={"gk-finding" + (active ? " gk-finding-active" : "")}
    >
      <span className="gk-finding-top">
        <span className={"gk-severity " + (item.level === "HIGH" ? "gk-severity-high" : "gk-severity-medium")}>
          <span className="gk-severity-dot" />{item.level}
        </span>
        <span className="gk-finding-code">{item.id}</span>
        <span className="gk-finding-arrow">↗</span>
      </span>
      <span className="gk-finding-title">{item.title}</span>
      <span className="gk-finding-type">{item.type} · lines {item.lines.join(", ")}</span>
    </button>
  );
}

function Review({ onControls }) {
  const [selected, setSelected] = useState(0);
  const [showDetail, setShowDetail] = useState(true);
  const finding = SAMPLE_FINDINGS[selected];
  return (
    <>
      <div className="gk-section-heading">
        <Eyebrow>INTERACTIVE WALKTHROUGH / SAMPLE DATA</Eyebrow>
        <h1>See what gets missed.</h1>
        <p>Select a finding to highlight its source lines and inspect the rationale. This is a static demonstration fixture, <strong>not a live TrueForge review.</strong></p>
      </div>
      <div className="gk-sample-alert" role="note"><span className="gk-sample-alert-icon">ⓘ</span> SAMPLE WALKTHROUGH <span>Illustrative findings only · no AI request, repository access or billing</span></div>
      <div className="gk-review-grid">
        <div className="gk-review-code-col">
          <div className="gk-pane-title"><span>01 / PROPOSED CODE</span><span>EXAMPLE INPUT</span></div>
          <MiniCode expanded activeLines={finding.lines} />
          <div className="gk-code-caption">Explore the issue on the right. Highlighted lines correspond to the selected illustrative finding.</div>
        </div>
        <div className="gk-review-findings-col">
          <div className="gk-pane-title"><span>02 / FINDINGS</span><span>2 SAMPLE ISSUES</span></div>
          <div className="gk-findings-list">
            {SAMPLE_FINDINGS.map((item, index) => <Finding key={item.id} item={item} index={index} active={selected === index} onChoose={(next) => { setSelected(next); setShowDetail(true); }} />)}
          </div>
          <div className="gk-explanation">
            <button type="button" aria-expanded={showDetail} className="gk-explanation-toggle" onClick={() => setShowDetail((v) => !v)}>
              FINDING DETAILS <span>{showDetail ? "−" : "+"}</span>
            </button>
            {showDetail && (
              <>
                <h3>{finding.title}</h3>
                <p>{finding.explanation}</p>
                <div className="gk-remediation"><span>RECOMMENDED REVIEW ACTION</span><p>{finding.action}</p></div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="gk-review-footer">
        <div><strong>Human judgment stays in control.</strong><span>Gate Keeper reports; people decide whether to change and merge code.</span></div>
        <button className="gk-button gk-button-quiet" type="button" onClick={onControls}>See safety controls <span>↗</span></button>
      </div>
    </>
  );
}

function EmptyView({ kind, onDemo }) {
  const isRuns = kind === "Runs";
  return (
    <>
      <div className="gk-section-heading">
        <Eyebrow>{isRuns ? "REAL RUN HISTORY" : "VERIFIED EVIDENCE"}</Eyebrow>
        <h1>{isRuns ? "Every run should tell a story." : "Trust requires proof."}</h1>
        <p>{isRuns ? "A real run will show its status, inputs, findings and traceable outcome here." : "Evidence must come from independently qualified runs—not from a polished user interface."}</p>
      </div>
      <div className="gk-empty">
        <div className="gk-empty-glyph">{isRuns ? "◷" : "◇"}</div>
        <h2>{isRuns ? "No verified live runs shown" : "No independently qualified evidence shown"}</h2>
        <p>{isRuns ? "Live session history has not yet been connected to this Base44 application." : "Private evidence and independently signed qualification are not connected to this interface."}</p>
        <button type="button" className="gk-button gk-button-primary" onClick={onDemo}>Explore sample review <span>↗</span></button>
      </div>
    </>
  );
}

function Settings() {
  return (
    <>
      <div className="gk-section-heading">
        <Eyebrow>OPERATING BOUNDARIES</Eyebrow>
        <h1>Power, with restraint.</h1>
        <p>Gate Keeper is a read-only reviewer. Improving its own instructions or performing paid evaluations requires independent qualification and human authorisation.</p>
      </div>
      <div className="gk-settings-grid">
        <div className="gk-setting-card"><span>01 / ENGINE</span><h3>TrueForge, not a duplicate agent</h3><p>The AI runtime stays on Railway. Base44 provides the product interface and authenticated server-side integration.</p></div>
        <div className="gk-setting-card"><span>02 / REVIEW SCOPE</span><h3>No code execution or repair</h3><p>Code reviews are advisory. Gate Keeper cannot independently merge, deploy or alter a user's application.</p></div>
        <div className="gk-setting-card"><span>03 / LEARNING</span><h3>Promotion disabled</h3><p>Autonomous learning, paid evaluations and self-promotion remain held until budget, verifier and evidence requirements are met.</p></div>
        <div className="gk-setting-card"><span>04 / PRIVACY</span><h3>Secrets stay on the server</h3><p>Base44 backend functions must enforce permissions and never return private TrueForge credentials or unscoped session data.</p></div>
      </div>
      <div className="gk-setting-connection">
        <div><span className="gk-label-small">ADMINISTRATOR PROBE</span><p>Checks only the TrueForge runtime's health, not model readiness or a successful agent review.</p></div>
        <GateKeeperConnectionPanel />
      </div>
    </>
  );
}

export default function GateKeeper() {
  const [page, setPage] = useState("Overview");
  const navigate = (next) => {
    setPage(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <div className="gk-app">
      <div className="gk-topbar">
        <button type="button" className="gk-topbrand" onClick={() => navigate("Overview")} aria-label="Gate Keeper home">
          <Mark /><span>GATE<span className="gk-brand-slashed">/</span>KEEPER</span>
        </button>
        <div className="gk-top-center"><span className="gk-online-dot" /> TRUEFORGE ENGINE <span className="gk-top-center-divider">/</span> RAILWAY HOSTED</div>
        <button type="button" className="gk-top-cta" onClick={() => navigate("Review")}>Try the walkthrough <span>↗</span></button>
      </div>
      <div className="gk-layout">
        <aside className="gk-sidebar">
          <div className="gk-sidebar-group">
            <span className="gk-sidebar-label">WORKSPACE</span>
            <nav aria-label="Gate Keeper sections">
              {NAV.map(([item, icon]) => (
                <button type="button" key={item} className={"gk-nav-item" + (page === item ? " gk-nav-item-selected" : "")} onClick={() => navigate(item)} aria-current={page === item ? "page" : undefined}>
                  <span aria-hidden="true" className="gk-nav-icon">{icon}</span>{item}{page === item && <span className="gk-nav-arrow">↗</span>}
                </button>
              ))}
            </nav>
          </div>
          <div className="gk-sidebar-bottom">
            <span className="gk-label-small">RELEASE MODE</span>
            <div className="gk-mode"><span className="gk-mode-dot" /> DEMONSTRATION</div>
            <p>Live reviews and paid learning are not enabled in this interface.</p>
          </div>
        </aside>
        <main id="gk-main-content" className="gk-content">
          {page === "Overview" && <AdversarialLab onReview={() => navigate("Review")} onControls={() => navigate("Settings")} />}
          {page === "Review" && <Review onControls={() => navigate("Settings")} />}
          {(page === "Runs" || page === "Evidence") && <EmptyView kind={page} onDemo={() => navigate("Review")} />}
          {page === "Settings" && <Settings />}
          <footer className="gk-footer"><span>GATE / KEEPER</span><span>REVIEW WITH EVIDENCE. SHIP WITH INTENT.</span><span>SAMPLE UI · NOT LIVE AI OUTPUT</span></footer>
        </main>
      </div>
    </div>
  );
}
