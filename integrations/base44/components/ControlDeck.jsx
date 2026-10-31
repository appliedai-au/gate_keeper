import React,{useEffect,useMemo,useRef,useState} from "react";
import "./ControlDeck.css";

// Product controls exercise deterministic examples only. The actual repair
// implementation lives separately in scripts/execution/isolated-runner.mjs.
const CASES={
 security:{title:"Tenant isolation",risk:"Invoice query is not tenant-scoped",extra:"Negative cross-tenant test is missing",patch:"Add tenantId to query predicate",check:"Cross-tenant access is denied"},
 privacy:{title:"Data privacy",risk:"Customer email written into logs",extra:"Redaction regression is missing",patch:"Replace PII log with trace ID",check:"Logs contain no customer identifiers"},
 reliability:{title:"Reliability",risk:"Missing invoice triggers an exception",extra:"Database outage lacks bounded handling",patch:"Return explicit 404 on missing record",check:"Missing-record contract succeeds"}
};
const DEPTHS=["Quick","Standard","Deep"], COSTS=[.4,1.25,4.5];
const V=[
 ["Requirements","Acceptance","Does the public behavior satisfy requirements?"],
 ["Threat model","Adversarial","Can hostile inputs cross a trust boundary?"],
 ["Architecture","Integration","Do components enforce the boundary together?"],
 ["Implementation","Unit tests","Does the smallest patch pass local tests?"]
];
const dollars=x=>"$"+Number(x).toFixed(2);
export default function ControlDeck(){
 const [focus,setFocus]=useState("security"),[depth,setDepth]=useState(1);
 const [totalBudget,setTotalBudget]=useState(10),[perRun,setPerRun]=useState(3);
 const [noHuman,setNoHuman]=useState(false),[fail,setFail]=useState(false),[vStage,setVStage]=useState(1);
 const [status,setStatus]=useState("idle"),[poll,setPoll]=useState(0);
 const cycle=useRef(0),ref=useRef(null);
 const scenario=CASES[focus],estimate=COSTS[depth];
 const admitted=estimate<=totalBudget&&estimate<=perRun;
 const changes=useMemo(()=>depth===2?[scenario.risk,scenario.extra]:[scenario.risk],[depth,scenario]);
 function reset(next="idle"){cycle.current++;setStatus(next);setPoll(0);}
 function begin(){reset(admitted?"reviewing":"held");ref.current?.scrollIntoView({behavior:"smooth",block:"start"});}
 function advance(){
   if(status==="approval"){setStatus("patching");return;}
   const next={reviewing:noHuman?"patching":"approval",patching:"testing",testing:"polling"}[status];
   if(next)setStatus(next);
 }
 useEffect(()=>{
  if(!["reviewing","patching","testing","polling"].includes(status))return;
  const token=cycle.current;
  const id=setTimeout(()=>{
    if(token!==cycle.current)return;
    if(status==="polling"){
      if(poll<2){setPoll(p=>p+1);return;}
      setStatus(fail?"reverted":"kept");return;
    }
    setStatus(status==="reviewing"?(noHuman?"patching":"approval"):status==="patching"?"testing":"polling");
  },1150);
  return ()=>clearTimeout(id);
 },[status,poll,fail,noHuman]);
 const copy={
 idle:"Select the controls and start a run.",held:"Budget gate held the job. Increase the cap or reduce depth.",
 reviewing:"Reading the selected case…",approval:"Waiting for the human approval checkpoint.",
 patching:"Applying an illustrative fix in an isolated workspace…",
 testing:"Checking the illustrative patch against the V-model…",
 polling:"Polling validation checkpoint "+(poll+1)+" of 3…",
 kept:"Simulation: patch kept after all checks.",
 reverted:"Simulation: validation failed; patch automatically reverted."
 };
 return <section className="cd-shell" ref={ref} aria-label="Gate Keeper executor and validation controls">
  <header className="cd-intro"><span className="cd-kicker">EXECUTION CONTROL / INTERACTIVE DEMONSTRATION</span>
   <h2>Change the settings.<br/><em>Change the outcome.</em></h2>
   <p>Configure review depth, spending limits, approval and validation. The sample review and simulated executor respond to every setting. No model calls or production changes occur here.</p>
  </header>
  <div className="cd-grid">
   <div className="cd-card">
    <h3><span>01</span> Adversarial review</h3>
    <fieldset><legend>Review focus</legend>
     <div className="cd-choices">{Object.entries(CASES).map(([key,val])=><button key={key} type="button" className={focus===key?"selected":""} aria-pressed={focus===key} onClick={()=>{setFocus(key);reset();}}>{val.title}</button>)}</div>
    </fieldset>
    <fieldset><legend>Review depth</legend><div className="cd-choices">{DEPTHS.map((d,i)=><button key={d} type="button" className={depth===i?"selected":""} aria-pressed={depth===i} onClick={()=>{setDepth(i);reset();}}>{d}</button>)}</div></fieldset>
    <div className="cd-findings" aria-live="polite"><span>ILLUSTRATIVE FINDINGS / {changes.length}</span>
     {changes.map((finding,i)=><div className="cd-finding" key={finding}><strong>{i===0?"PRIMARY":"FOLLOW-UP"}</strong><p>{finding}</p></div>)}
     <p className="cd-finding-note">{depth===0?"Quick review does not rule out additional risks.":depth===2?"Deep mode expands review coverage, not proof of safety.":"Standard mode shows the main relevant issue."}</p>
    </div>
   </div>
   <div className="cd-card">
    <h3><span>02</span> Spending and autonomy</h3>
    <label className="cd-range" htmlFor="cd-total-cap"><span>Total demo budget</span><strong>{dollars(totalBudget)}</strong></label>
    <input id="cd-total-cap" type="range" min="1" max="25" step="1" value={totalBudget} onChange={e=>{setTotalBudget(Number(e.target.value));reset();}}/>
    <label className="cd-range" htmlFor="cd-run-cap"><span>Per-run cap</span><strong>{dollars(perRun)}</strong></label>
    <input id="cd-run-cap" type="range" min="0.5" max="5" step="0.5" value={perRun} onChange={e=>{setPerRun(Number(e.target.value));reset();}}/>
    <div className={"cd-admit "+(admitted?"ok":"held")} aria-live="polite">
      <span>{admitted?"DEMO ESTIMATE WITHIN LIMITS":"DEMO BUDGET HELD"}</span>
      <strong>{dollars(estimate)} estimated</strong>
    </div>
    <label className="cd-check"><input type="checkbox" checked={noHuman} onChange={e=>{setNoHuman(e.target.checked);reset();}}/>
     <span><strong>No human in the loop</strong><small>When checked, the simulated executor skips the approval checkpoint. Live unattended execution still requires independently authorised scope.</small></span>
    </label>
    <label className="cd-check"><input type="checkbox" checked={fail} onChange={e=>{setFail(e.target.checked);reset();}}/>
     <span><strong>Inject validation failure</strong><small>See the automatic revert path and the failed verification result.</small></span>
    </label>
   </div>
   <div className="cd-card cd-v-card">
    <h3><span>03</span> V-shaped validation</h3>
    <div className="cd-v-diagram">
      <svg viewBox="0 0 560 285" role="img" aria-label="V model with development stages matched to validation stages">
       <path d="M84 35L230 233H330L476 35" stroke="#76909c" strokeWidth="2" fill="none"/>
       {V.map(([left,right],i)=>{
         const y=35+i*65,l=84+i*48.6,r=476-i*48.6;
         return <g key={i}><path d={"M"+l+" "+y+"H"+r} stroke={i===vStage?"#d9ff86":"#405867"} strokeDasharray="6 8" />
         <circle cx={l} cy={y} r={i===vStage?7:4.5} fill={i===vStage?"#d9ff86":"#69808f"}/>
         <circle cx={r} cy={y} r={i===vStage?7:4.5} fill={i===vStage?"#d9ff86":"#69808f"}/>
         <text x={l-10} y={y-11} textAnchor="end" className={i===vStage?"cd-v-active":"cd-v-text"}>{left}</text>
         <text x={r+10} y={y-11} textAnchor="start" className={i===vStage?"cd-v-active":"cd-v-text"}>{right}</text>
         </g>;
       })}
      </svg>
    </div>
    <label className="cd-range" htmlFor="cd-v-stage"><span>Inspect V-model pairing</span><strong>{vStage+1} of 4</strong></label>
    <input id="cd-v-stage" type="range" min="0" max="3" step="1" value={vStage} onChange={e=>setVStage(Number(e.target.value))} aria-valuetext={V[vStage][0]+" to "+V[vStage][1]}/>
    <div className="cd-v-detail"><strong>{V[vStage][0]} ↔ {V[vStage][1]}</strong><p>{V[vStage][2]} This remains unverified until independently run.</p></div>
   </div>
   <div className="cd-card cd-exec-card">
    <h3><span>04</span> Built-in executor</h3>
    <div className="cd-exec-belt"><span>REVIEW</span><span>FIX</span><span>TEST</span><span>POLL</span><span>KEEP / REVERT</span></div>
    <p className="cd-exec-desc">Isolated repair code is implemented in the repository. This control room visualises its lifecycle; it does not connect to the live worker.</p>
    <div className="cd-exec-result" aria-live="polite"><span className={"cd-status-lamp "+status}/><strong>{copy[status]}</strong></div>
    {status==="approval"&&<button type="button" className="cd-approve" onClick={advance}>Approve simulated fix →</button>}
    <div className="cd-run-actions"><button type="button" className="cd-run" onClick={begin}>Run configured example ↗</button><button type="button" className="cd-reset" onClick={()=>reset()}>Reset</button></div>
    <div className="cd-exec-foot">PATCH / {scenario.patch}<br/>VALIDATION / {scenario.check}<br/>WORKER / NOT YET DEPLOYED</div>
   </div>
  </div>
  <div className="cd-footnote">All outcomes on this page are deterministic demonstration fixtures. A production job needs a signed budget lease, tenant-scoped authorization, an isolated runner, a verified test result and independent evidence before a patch may be retained.</div>
 </section>;
}
