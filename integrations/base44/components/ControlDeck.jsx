import React,{useEffect,useMemo,useRef,useState} from "react";
import "./ControlDeck.css";
import controlProfiles from "../data/controlProfiles.json";

// Product controls exercise deterministic examples only. The actual repair
// Execution is delegated to TrueForge native sandbox/subagents; no parallel runner.
const CASES={
 security:{title:"Tenant isolation",risk:"Invoice query is not tenant-scoped",extra:"Negative cross-tenant test is missing",patch:"Add tenantId to query predicate",check:"Cross-tenant access is denied"},
 privacy:{title:"Data privacy",risk:"Customer email written into logs",extra:"Redaction regression is missing",patch:"Replace PII log with trace ID",check:"Logs contain no customer identifiers"},
 reliability:{title:"Reliability",risk:"Missing invoice triggers an exception",extra:"Database outage lacks bounded handling",patch:"Return explicit 404 on missing record",check:"Missing-record contract succeeds"}
};
const DEPTHS=["Quick","Standard","Deep"], COSTS=[.4,1.25,4.5];
const VALIDATION_LEVELS=controlProfiles.levels;
const CURRENT=controlProfiles.defaults;
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
 const [adversarialReview,setAdversarialReview]=useState(CURRENT.adversarialReview);
 const [validationLevel,setValidationLevel]=useState(CURRENT.vModelLevel);
 const [gateEnabled,setGateEnabled]=useState(CURRENT.gateEnabled);
 const [status,setStatus]=useState("idle"),[poll,setPoll]=useState(0);
 const cycle=useRef(0),ref=useRef(null);
 const scenario=CASES[focus],estimate=COSTS[depth],validationProfile=VALIDATION_LEVELS[validationLevel];
 const admitted=estimate<=totalBudget&&estimate<=perRun;
 const changes=useMemo(()=>depth===2&&adversarialReview?[scenario.risk,scenario.extra]:[scenario.risk],[depth,scenario,adversarialReview]);
 function reset(next="idle"){cycle.current++;setStatus(next);setPoll(0);}
 function begin(){reset(!gateEnabled?"opted_out":admitted?"reviewing":"held");ref.current?.scrollIntoView({behavior:"smooth",block:"start"});}
 function advance(){if(status==="approval")setStatus("patching");}
 useEffect(()=>{
  if(!["reviewing","evidence","patching","testing","polling"].includes(status))return;
  const token=cycle.current;
  const id=setTimeout(()=>{
    if(token!==cycle.current)return;
    if(status==="reviewing"){
      setStatus(validationLevel===0?"reviewed":validationLevel===1?"evidence":noHuman?"patching":"approval");return;
    }
    if(status==="evidence"){setStatus("reviewed");return;}
    if(status==="patching"){setStatus("testing");return;}
    if(status==="testing"){setStatus("polling");return;}
    if(status==="polling"){
      if(poll<2){setPoll(p=>p+1);return;}
      setStatus(fail?"reverted":validationLevel===3?"qualification_held":"candidate");
    }
  },1150);
  return ()=>clearTimeout(id);
 },[status,poll,fail,noHuman,validationLevel]);
 const copy={
 idle:"Choose controls and run a simulated example.",
 held:"Demo budget gate held this example. No credits were spent.",
 opted_out:"The optional advisory gate is disabled for this sample tenant. No code was changed.",
 reviewing:"Simulating "+(adversarialReview?"adversarial":"plain / lean")+" review…",
 evidence:"Simulating requirements and threat-evidence mapping…",
 reviewed:"Review-only demonstration complete. No fix, tests, or model request occurred.",
 approval:"Simulated fix awaits an illustrative human approval.",
 patching:"Simulating an isolated candidate fix (not executing code)…",
 testing:"Simulating named acceptance, adversarial, integration, unit and static checks…",
 polling:"Simulating verification checkpoint "+(poll+1)+" of 3…",
 candidate:"Illustrative sandbox candidate only. No production merge or deployment.",
 qualification_held:"Full V-model qualification HELD: no independent signer or sealed holdout was invoked.",
 reverted:"Simulated validation failed; illustrative candidate discarded."
 };
 return <section className="cd-shell" ref={ref} aria-label="Gate Keeper executor and validation controls">
  <header className="cd-intro"><span className="cd-kicker">EXECUTION CONTROL / INTERACTIVE DEMONSTRATION</span>
   <h2>Change the settings.<br/><em>Change the outcome.</em></h2>
   <p>Configure review depth, spending limits, approval and validation. The sample review and simulated executor respond to every setting. No model calls or production changes occur here.</p>
  </header>
  <div className="cd-grid">
   <div className="cd-card">
    <h3><span>01</span> Review method</h3>
    <label className="cd-check cd-check-first"><input id="cd-adversarial" type="checkbox" checked={adversarialReview} onChange={e=>{setAdversarialReview(e.target.checked);reset();}} />
     <span><strong>Adversarial review · {adversarialReview?"ON":"OFF"}</strong><small>ON is the current Gatekeeper default. OFF selects a plain / lean reviewer, not permission to skip mandatory security checks.</small></span>
    </label>
    <div className="cd-mode" aria-live="polite">Reviewer method: <strong>{adversarialReview?"adversarial (current default)":"plain / lean"}</strong></div>
    <fieldset><legend>Review focus</legend>
     <div className="cd-choices">{Object.entries(CASES).map(([key,val])=><button key={key} type="button" className={focus===key?"selected":""} aria-pressed={focus===key} onClick={()=>{setFocus(key);reset();}}>{val.title}</button>)}</div>
    </fieldset>
    <fieldset><legend>Review depth</legend><div className="cd-choices">{DEPTHS.map((d,i)=><button key={d} type="button" className={depth===i?"selected":""} aria-pressed={depth===i} onClick={()=>{setDepth(i);reset();}}>{d}</button>)}</div></fieldset>
    <div className="cd-findings" aria-live="polite"><span>ILLUSTRATIVE FINDINGS / {changes.length}</span>
     {changes.map((finding,i)=><div className="cd-finding" key={finding}><strong>{i===0?"PRIMARY":"FOLLOW-UP"}</strong><p>{finding}</p></div>)}
     <p className="cd-finding-note">{!adversarialReview?"Plain / lean mode still requires evidence and does not authorise unsafe code.":depth===0?"Quick review does not rule out additional risks.":depth===2?"Deep mode expands review coverage, not proof of safety.":"Standard mode shows the main relevant issue."}</p>
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
    <label className="cd-check"><input type="checkbox" checked={noHuman} disabled={validationLevel<2} onChange={e=>{setNoHuman(e.target.checked);reset();}}/>
     <span><strong>No human in the loop</strong><small>When checked, the simulated executor skips the approval checkpoint. Live unattended execution still requires independently authorised scope.</small></span>
    </label>
    <label className="cd-check"><input type="checkbox" checked={fail} disabled={validationLevel<2} onChange={e=>{setFail(e.target.checked);reset();}}/>
     <span><strong>Inject validation failure</strong><small>See the automatic revert path and the failed verification result.</small></span>
    </label>
   </div>
   <div className="cd-card cd-v-card">
    <h3><span>03</span> V-model validation strength</h3>
    <label className="cd-range" htmlFor="cd-v-level"><span>Validation profile</span><strong>{validationLevel} of 3</strong></label>
    <input id="cd-v-level" type="range" min="0" max="3" step="1" value={validationLevel}
      onChange={e=>{const next=Number(e.target.value);setValidationLevel(next);setNoHuman(false);setFail(false);reset();}}
      aria-valuetext={validationProfile.label} />
    <div className="cd-profile" aria-live="polite"><strong>{validationProfile.label}{validationLevel===0?" · DEFAULT":""}</strong>
     <p>{validationProfile.summary}</p><small>Required evidence: {validationProfile.requires.join(" · ").replaceAll("_"," ")}</small>
     <small>Policy preview only — stronger levels do not activate native tools, spending or merges.</small>
    </div>
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
    <label className="cd-range" htmlFor="cd-v-stage"><span>Diagram inspector (separate)</span><strong>{vStage+1} of 4</strong></label>
    <input id="cd-v-stage" type="range" min="0" max="3" step="1" value={vStage} onChange={e=>setVStage(Number(e.target.value))} aria-valuetext={V[vStage][0]+" to "+V[vStage][1]}/>
    <div className="cd-v-detail"><strong>{V[vStage][0]} ↔ {V[vStage][1]}</strong><p>{V[vStage][2]} This remains unverified until independently run.</p></div>
   </div>
   <div className="cd-card cd-exec-card">
    <h3><span>04</span> Built-in executor</h3>
    <div className="cd-exec-belt"><span>REVIEW</span><span>FIX</span><span>TEST</span><span>POLL</span><span>KEEP / REVERT</span></div>
    <p className="cd-exec-desc">Level 0 preserves today's read-only Gatekeeper reviewer. Levels 1–3 illustrate progressively stronger checks; the native sandbox and budgeted execution are not connected here.</p>
    <label className="cd-check"><input type="checkbox" checked={gateEnabled} onChange={e=>{setGateEnabled(e.target.checked);reset();}}/>
     <span><strong>Advisory gate · {gateEnabled?"ENABLED":"TENANT OPT-OUT DEMO"}</strong><small>Tenant opt-out changes only this simulation. It never bypasses funding, repository permissions or protected releases. Administrative settings must be saved through the authenticated backend.</small></span>
    </label>
    <div className="cd-exec-result" aria-live="polite"><span className={"cd-status-lamp "+status}/><strong>{copy[status]}</strong></div>
    {status==="approval"&&<button type="button" className="cd-approve" onClick={advance}>Approve simulated fix →</button>}
    <div className="cd-run-actions"><button type="button" className="cd-run" onClick={begin}>Run configured example ↗</button><button type="button" className="cd-reset" onClick={()=>reset()}>Reset</button></div>
    <div className="cd-exec-foot">REVIEW METHOD / {adversarialReview?"ADVERSARIAL":"PLAIN"}<br/>V PROFILE / {validationProfile.label.toUpperCase()}<br/>PATCH / {validationLevel>=2?scenario.patch:"NOT AUTHORISED AT THIS LEVEL"}<br/>VALIDATION / {validationLevel>=2?scenario.check:"REVIEW ONLY"}<br/>NATIVE TRUEFORGE EXECUTION / NOT YET QUALIFIED</div>
   </div>
  </div>
  <div className="cd-footnote">DEMONSTRATION ONLY. Default = adversarial review ON + Current Gatekeeper (level 0). The V-model strength slider changes the sample plan; the separate diagram slider inspects the four V pairings. A production job still requires authenticated per-tenant saved settings, independent spending admission, approved sandbox and signed evidence. No button here changes the live TrueForge agent.</div>
 </section>;
}
