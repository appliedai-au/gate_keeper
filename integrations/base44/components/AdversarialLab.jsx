import React, { useCallback, useEffect, useRef, useState } from "react";
import "./AdversarialLab.css";
import ControlDeck from "./ControlDeck";
import LearningLab from "./LearningLab";

/**
 * Interactive scripted product walkthrough: no TrueForge API requests.
 * UI never describes sample output as verified live agent activity.
 * The real reviewer remains held behind authenticated per-user admission.
 */
const SCENES = [
  { kicker: "MISSION READY", title: "An ordinary code change.", subtitle: "A simple invoice endpoint. Six lines of logic. One missing boundary.", tag: "READY", accent: "neutral" },
  { kicker: "01 / INSPECT", title: "Read what the code does.", subtitle: "The lookup relies on the record identifier, without proving who owns it.", tag: "INSPECTING", accent: "violet" },
  { kicker: "02 / CHALLENGE", title: "Follow the path nobody tested.", subtitle: "What happens when an authenticated user requests another tenant's invoice?", tag: "BOUNDARY MISSING", accent: "coral" },
  { kicker: "03 / EVIDENCE", title: "Not a guess. A traceable finding.", subtitle: "The handler lacks a tenant-scoped database predicate. The data boundary is not enforced here.", tag: "HIGH SEVERITY", accent: "coral" },
  { kicker: "04 / VERIFY", title: "Close the gap. Prove the rule.", subtitle: "Require the authenticated tenant ID in the database query and test cross-tenant denial.", tag: "PROPOSED CONTROL", accent: "lime" },
];
const ORIGINAL = [
  "export async function viewInvoice(req, db) {",
  "  const invoiceId = req.params.id;",
  "  const invoice = await db.invoice.findUnique({",
  "    where: { id: invoiceId }",
  "  });",
  "  return Response.json(invoice);",
  "}",
];
const PATCH = [
  "export async function viewInvoice(req, db) {",
  "  const invoiceId = req.params.id;",
  "  const tenantId = req.auth.tenantId;",
  "  const invoice = await db.invoice.findFirst({",
  "    where: { id: invoiceId, tenantId }",
  "  });",
  "  if (!invoice) return new Response(null, { status: 404 });",
  "  return Response.json(invoice);",
  "}",
];
const STEPS = [
  { num: "00", title: "Ready" },
  { num: "01", title: "Inspect" },
  { num: "02", title: "Challenge" },
  { num: "03", title: "Evidence" },
  { num: "04", title: "Protect" },
];

function SymbolMark() {
  return (
    <svg viewBox="0 0 48 48" width="42" height="42" fill="none" aria-hidden="true">
      <path d="M24 3 43 14v20L24 45 5 34V14L24 3Z" stroke="currentColor" strokeWidth="1.5"/>
      <path d="m14 25 7 7 14-17" stroke="currentColor" strokeWidth="3.4" strokeLinecap="square" strokeLinejoin="miter"/>
    </svg>
  );
}

function EvidencePath({ phase }) {
  const danger = phase >= 2 && phase < 4;
  const secured = phase === 4;
  return (
    <div className={"al-graph al-graph-" + (secured ? "safe" : danger ? "danger" : "idle")} aria-label="Illustrative code trust boundary trace">
      <div className="al-graph-heading"><span>TRUST-BOUNDARY MAP</span><span>TRACE / SIMULATED</span></div>
      <svg viewBox="0 0 660 266" role="img" aria-label={
        secured ? "Suggested rule: identity scopes the database query, blocking cross-tenant access" :
        danger ? "Risk: a database lookup by ID lacks a tenant ownership condition" :
        "Request flows through identity and a database query"
      }>
        <defs>
          <linearGradient id="al-line" x1="0" x2="1"><stop stopColor="#b9a9ff"/><stop offset="1" stopColor="#90c8c7"/></linearGradient>
          <filter id="al-glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <g fill="none" strokeWidth="2.2" strokeLinecap="round">
          <path d="M126 98H220" stroke="#53717e" />
          <path d="M312 98H407" stroke={secured ? "#c8fd8b" : danger ? "#ff876d" : "#53717e"} strokeDasharray={danger?"6 7":"0"}/>
          <path d="M495 98H584" stroke={secured ? "#c8fd8b" : danger ? "#ff876d" : "#53717e"}/>
          <path className="al-branch" d="M451 128 V198 H548" stroke={secured ? "#c8fd8b" : danger ? "#ff876d" : "#405569"} strokeDasharray="5 7"/>
          {danger && <path className="al-graph-flow" d="M312 98 H407 M495 98 H584 M451 128V198H548" stroke="#ff7d62" filter="url(#al-glow)"/>}
          {secured && <path className="al-graph-flow" d="M126 98H220 M312 98H407" stroke="#cefc85" filter="url(#al-glow)"/>}
        </g>
        <g>
          <rect x="20" y="64" width="106" height="68" rx="12" className="al-node"/>
          <text x="73" y="93" textAnchor="middle" className="al-svg-label">REQUEST</text>
          <text x="73" y="111" textAnchor="middle" className="al-svg-sub">invoice / id</text>
          <rect x="220" y="64" width="92" height="68" rx="12" className="al-node"/>
          <text x="266" y="93" textAnchor="middle" className="al-svg-label">IDENTITY</text>
          <text x="266" y="111" textAnchor="middle" className="al-svg-sub">tenant A</text>
          <rect x="407" y="64" width="88" height="68" rx="12" className={secured ? "al-node al-node-safe" : danger ? "al-node al-node-risk" : "al-node"}/>
          <text x="451" y="93" textAnchor="middle" className="al-svg-label">QUERY</text>
          <text x="451" y="111" textAnchor="middle" className="al-svg-sub">{secured?"scoped":"by ID only"}</text>
          <rect x="558" y="64" width="85" height="68" rx="12" className="al-node"/>
          <text x="600" y="93" textAnchor="middle" className="al-svg-label">DATA</text>
          <text x="600" y="111" textAnchor="middle" className="al-svg-sub">invoices</text>
          <rect x="548" y="177" width="96" height="45" rx="10" className={secured ? "al-node al-node-safe" : danger ? "al-node al-node-risk" : "al-node"}/>
          <text x="596" y="204" textAnchor="middle" className="al-svg-label">{secured?"BLOCKED": "TENANT B"}</text>
          <circle cx="451" cy="199" r="15" fill={secured?"#cbfd8b":danger?"#ff8168":"#314454"}/>
          <text x="451" y="204" textAnchor="middle" fill="#09131b" fontSize="17" fontWeight="800">{secured?"✓":danger?"!":"?"}</text>
        </g>
        <text x="20" y="30" className="al-svg-small">SIGNED-IN USER</text>
        <text x="550" y="250" className="al-svg-small">{secured?"DENY CROSS-TENANT ACCESS":"UNAUTHORISED RECORD"}</text>
      </svg>
      <div className="al-graph-caption"><span className="al-led" />{secured?"PROPOSED DENIAL PATH":danger?"CROSS-TENANT PATH IDENTIFIED":"WAITING FOR TRACE"}<span className="al-graph-reference">CASE / INVOICE-001</span></div>
    </div>
  );
}

function CodePanel({ phase }) {
  const fixed = phase === 4;
  const lines = fixed ? PATCH : ORIGINAL;
  return (
    <div className="al-code-panel">
      <div className="al-panel-head">
        <span className="al-light-array"><i/><i/><i/></span>
        <span>api / invoices.ts</span>
        <span className="al-file-pill">TSX</span>
      </div>
      <div className="al-code-inner">
        {lines.map((line,index)=>{
          const keyLine = fixed ? (index===2||index===4||index===6) : index===3;
          const highlight = (fixed || phase >= 1) && keyLine;
          return <div className={"al-code-row"+(highlight?(fixed?" al-highlight-safe":" al-highlight-risk"):"")} key={index}>
            <span className="al-code-index">{String(index+1).padStart(2,"0")}</span>
            <code>{line}</code>
            {highlight && <span className="al-code-marker">{fixed?"✓":"●"}</span>}
          </div>;
        })}
      </div>
      <div className="al-code-foot"><span className="al-code-foot-dot"/> {fixed?"PROPOSED PATTERN — NOT EXECUTED":"SAMPLE CODE — NO REPOSITORY CONNECTED"}<span>READ ONLY</span></div>
    </div>
  );
}

function Receipt({ phase }) {
  const risk = phase>=3&&phase<4;
  const secured=phase===4;
  return (
    <div className={"al-receipt"+(risk?" al-receipt-risk":"")+(secured?" al-receipt-safe":"")}>
      <div className="al-receipt-kicker"><span>INVESTIGATION RECEIPT</span><span>GK / SAMPLE 001</span></div>
      <div className="al-receipt-icon" aria-hidden="true">{secured?"✓":risk?"!":"⌁"}</div>
      <div className="al-receipt-eyebrow">{secured?"CONTROL PROPOSED":risk?"HIGH SEVERITY / GK-001":"AWAITING FINDINGS"}</div>
      <h3>{secured?"Make ownership a query invariant.":risk?"A valid ID is not permission.":"The evidence comes first."}</h3>
      <p>{secured?
        "Scope the lookup to the authenticated tenant. Then require an independent cross-tenant denial test before accepting the change.":
        risk?"The endpoint uses an invoice ID alone. Without an ownership check, a cross-tenant record could be returned. This is a code-level risk, not a verified exploit.":"Step through the sample investigation to see how a code-level hypothesis becomes an actionable finding."}</p>
      <div className="al-receipt-rule"><span>{secured?"NEXT VALIDATION":risk?"SOURCE": "CURRENT STATUS"}</span><strong>{secured?"Cross-tenant denial test":risk?"invoices.ts · line 4":"No live model call"}</strong></div>
    </div>
  );
}

export default function AdversarialLab({ onReview, onControls }) {
  const [phase,setPhase]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const missionRef=useRef(null);
  const step=SCENES[phase];

  useEffect(()=>{
    if(!playing) return;
    if(phase>=4) {setPlaying(false);return;}
    const id=setTimeout(()=>setPhase(p=>Math.min(4,p+1)),phase===1?1850:2100);
    return ()=>clearTimeout(id);
  },[phase,playing]);

  const start=useCallback(()=>{
    setExpanded(true);setPhase(1);setPlaying(true);
    missionRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
  },[]);
  const jump=useCallback((index)=>{setExpanded(true);setPlaying(false);setPhase(index);},[]);
  const advance=useCallback(()=>{setExpanded(true);setPlaying(false);setPhase(p=>Math.min(4,p+1));},[]);

  return (
    <div className="al-shell">
      <div className="al-topline">
        <span><SymbolMark/> <strong>THE ADVERSARIAL LAB</strong></span>
        <span className="al-topline-right"><span className="al-dot"/>INTERACTIVE SAMPLE <span className="al-topline-divider">/</span> TRUEFORGE IS THE REAL ENGINE</span>
      </div>
      <section className="al-hero">
        <div className="al-index"><span>GATE KEEPER</span><span>EXPERIENCE / 001</span></div>
        <div className="al-hero-grid">
          <div className="al-hero-text">
            <span className="al-eyebrow"><span className="al-slash"/> WATCH THE ADVERSARIAL THINKING</span>
            <h1>The dangerous bug<br/>is <em>the one you</em><br/><em>can't see.</em></h1>
            <p>Most tools tell you what changed. Gate Keeper asks what that change could allow. Follow one flaw from an innocent line of code to a missing trust boundary—and see the evidence.</p>
            <div className="al-actions">
              <button className="al-start" type="button" onClick={start} aria-label={phase>0?"Replay scripted investigation":"Start scripted investigation"}>
                <span className="al-start-disc">{phase>0?"↻":"▶"}</span>{phase>0?"Replay investigation":"Run the investigation"}<span className="al-action-arrow">↗</span>
              </button>
              <button className="al-secondary" type="button" onClick={()=>{setExpanded(true);setPhase(3);setPlaying(false);missionRef.current?.scrollIntoView({behavior:"smooth",block:"start"});}}>Jump to the evidence ↗</button>
              <button className="al-secondary" type="button" onClick={()=>document.getElementById("gatekeeper-control-deck")?.scrollIntoView({behavior:"smooth",block:"start"})}>Configure executor ↗</button>
            </div>
            <p className="al-disclosure"><strong>DEMONSTRATION MODE.</strong> This is a scripted educational scenario, not a live TrueForge inference, penetration test or verified learning result.</p>
          </div>
          <div className="al-hero-visual" aria-hidden="true">
            <div className="al-orbit al-orbit-outer"/><div className="al-orbit al-orbit-mid"/><div className="al-orbit al-orbit-inner"/>
            <div className="al-prism"><SymbolMark/></div>
            <span className="al-floating al-float-a">INPUT / CHANGE</span>
            <span className="al-floating al-float-b">ADVERSARIAL TRACE</span>
            <span className="al-floating al-float-c">EVIDENCE / VERDICT</span>
            <div className="al-axis al-axis-h"/><div className="al-axis al-axis-v"/>
          </div>
        </div>
        <div className="al-hero-foot"><span>01 &nbsp; / &nbsp; OBSERVE THE FAILURE PATH</span><span>SCROLL TO EXPLORE <b>↓</b></span></div>
      </section>
      <section ref={missionRef} className={"al-mission"+(expanded?" al-mission-active":"")} aria-label="Interactive sample adversarial investigation">
        <div className="al-mission-title">
          <div><span className="al-overline">MISSION CONTROL / SIMULATED WALKTHROUGH</span><h2>One line. <em>One broken boundary.</em></h2></div>
          <div className="al-mission-id"><span>SPECIMEN</span><strong>INV-001 / INVOICE ACCESS</strong></div>
        </div>
        <nav className="al-timeline" aria-label="Investigation steps">
          {STEPS.map((s,index)=><button key={index} type="button"
            onClick={()=>jump(index)} aria-current={phase===index?"step":undefined}
            className={"al-timestep"+(index===phase?" al-timestep-current":"")+(index<phase?" al-timestep-past":"")}>
            <span className="al-step-number">{s.num}</span><span className="al-step-title">{s.title}</span>
            <span className="al-step-marker" />
          </button>)}
        </nav>
        <div className="al-scene-intro">
          <div><span className={"al-state al-state-"+step.accent}><span className="al-state-light"/>{step.tag}</span>
          <span className="al-scene-kicker">{step.kicker}</span></div>
          <h3>{step.title}</h3>
          <p>{step.subtitle}</p>
        </div>
        <div className="al-stage-grid">
          <div className="al-stage-left">
            <div className="al-panel-label"><span>01 / SOURCE</span><span>PROPOSED CODE</span></div>
            <CodePanel phase={phase}/>
          </div>
          <div className="al-stage-right">
            <div className="al-panel-label"><span>02 / REASONING PATH</span><span>SAMPLE TRACE</span></div>
            <EvidencePath phase={phase}/>
            <Receipt phase={phase}/>
          </div>
        </div>
        <div className="al-stage-bottom">
          <div><strong>Nothing here modifies code.</strong><span>Gate Keeper's real runtime remains a read-only reviewer. This animated example does not execute an agent.</span></div>
          <div className="al-stage-buttons">
            <button type="button" onClick={start} className="al-step-replay">↻ &nbsp; Replay</button>
            <button type="button" onClick={advance} disabled={phase===4} className="al-step-next">Next step <span>→</span></button>
          </div>
        </div>
      </section>
      <div id="gatekeeper-control-deck"><ControlDeck /></div>
      <LearningLab />
      <section className="al-manifesto">
        <div className="al-manifesto-label"><span>OUR PRINCIPLE</span><span>PROOF / BEFORE / PROMOTION</span></div>
        <p>A finding isn't intelligence <em>until you can inspect the evidence.</em></p>
        <div className="al-manifesto-foot">
          <span>REAL ENGINE · TRUEFORGE ON RAILWAY<br/>INTERFACE · BASE44</span>
          <div><button type="button" onClick={onReview}>Explore findings ↗</button><button type="button" onClick={onControls}>See operating safeguards ↗</button></div>
        </div>
      </section>
    </div>
  );
}
