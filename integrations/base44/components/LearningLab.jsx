import React,{useMemo,useState} from "react";
import "./LearningLab.css";

// This screen demonstrates a rule-selection algorithm; never stores, shares,
// trains on or uploads a user's real data.
const EXAMPLES=[
 {id:"U-101",name:"Always verify tenant ownership before a record lookup",source:"Tenant A",success:5,tenants:3,consented:true,private:false,holdout:true,security:true},
 {id:"U-102",name:"Add a retry for this customer's internal payment gateway",source:"Tenant B",success:4,tenants:1,consented:false,private:true,holdout:false,security:false},
 {id:"U-103",name:"Detect missing null guards at external data boundaries",source:"Tenant C",success:7,tenants:4,consented:true,private:false,holdout:true,security:true},
];
function inspect(record, coreEnabled){
 const failures=[];
 if(!record.consented)failures.push("Owner consent missing");
 if(record.private)failures.push("Tenant-private material");
 if(record.tenants<2)failures.push("Not generalized across tenants");
 if(record.success<3)failures.push("Insufficient independent success evidence");
 if(!record.holdout)failures.push("Private holdout not passed");
 if(!record.security)failures.push("Adversarial security test not passed");
 if(!coreEnabled)failures.push("Core candidate selection disabled");
 return failures;
}
export default function LearningLab(){
 const [selected,setSelected]=useState("U-101"),[coreEnabled,setCoreEnabled]=useState(true),[consent,setConsent]=useState(true);
 const rows=useMemo(()=>EXAMPLES.map(x=>({...x,consented:x.id==="U-101"?consent:x.consented})),[consent]);
 const active=rows.find(r=>r.id===selected)||rows[0];
 const reasons=inspect(active,coreEnabled);
 const qualifying=rows.filter(x=>inspect(x,coreEnabled).length===0);
 return <section className="ll-shell" aria-label="Core and user lesson selection demonstration">
  <header className="ll-head"><span className="ll-kicker">THE LEARNING SYSTEM / EXPLAINABLE SELECTION</span>
    <h2>Learn locally.<br/><em>Improve globally—only with proof.</em></h2>
    <p>Gate Keeper separates tenant-private user lessons from versioned core lessons. Generalizable lessons can be automatically selected for an independent core qualification pipeline without exposing private customer data.</p>
  </header>
  <div className="ll-board">
   <div className="ll-column">
    <div className="ll-label">01 / USER LESSONS <span>TENANT ISOLATED</span></div>
    {rows.map(r=><button key={r.id} type="button" className={"ll-item"+(selected===r.id?" active":"")} aria-pressed={selected===r.id} onClick={()=>setSelected(r.id)}>
      <span className="ll-id">{r.id} · {r.source}</span><strong>{r.name}</strong><small>{r.success} example successes · {r.tenants} tenant contexts</small></button>)}
   </div>
   <div className="ll-column">
    <div className="ll-label">02 / SELECTION ENGINE <span>DETERMINISTIC</span></div>
    <div className="ll-gate"><span>GENERALISATION CHECK</span>
      <h3>{reasons.length===0?"Qualified for core candidate review":"Held in user scope"}</h3>
      <p>{reasons.length===0?"The sample satisfies the illustrated selection gates. It is not part of the actual core.":"This sample cannot be selected for shared core qualification."}</p>
      <ul>{(reasons.length?reasons:["Consent present","No private data","Multiple independent tenant contexts","Holdout and security evidence present"]).map(x=><li key={x}><span>{reasons.length?"×":"✓"}</span>{x}</li>)}</ul>
    </div>
    <label className="ll-toggle"><input type="checkbox" checked={coreEnabled} onChange={e=>setCoreEnabled(e.target.checked)}/><span>Enable automated core candidate selection <small>Selection does not publish a core lesson.</small></span></label>
    {selected==="U-101"&&<label className="ll-toggle"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>Example owner sharing consent <small>Turn off to see the candidate held.</small></span></label>}
   </div>
   <div className="ll-column">
    <div className="ll-label">03 / CORE LESSONS <span>VERSIONED GLOBAL RULES</span></div>
    <div className="ll-core"><div className="ll-core-badge">CORE / STABLE</div><strong>Least-privilege access must be verified at the data boundary</strong><p>Shared generalized rule, applicable across tenants. No user transcript or private code is included.</p></div>
    <div className="ll-core ll-candidate"><div className="ll-core-badge">CORE CANDIDATES / {qualifying.length}</div><strong>{qualifying.length?qualifying.map(x=>x.id).join(" · "):"No candidate meets selection rules"}</strong><p>{qualifying.length?"Automatically shortlisted examples—none is promoted without signed independent qualification and a reviewed core release.":"All example user lessons remain private or held."}</p></div>
   </div>
  </div>
  <div className="ll-path"><span>USER LESSON</span><b>→</b><span>CONSENT + SANITIZE</span><b>→</b><span>INDEPENDENT PROOF</span><b>→</b><span>CORE CANDIDATE</span><b>→</b><span>REVIEWED CORE RELEASE</span></div>
  <p className="ll-disclaimer">Interactive sample records only. The actual selection policy exists in <code>scripts/execution/policy.mjs</code>; it fails closed without user consent, cross-tenant generality, sealed evidence and independent verifier signatures. Real automatic promotion is not enabled.</p>
 </section>;
}
