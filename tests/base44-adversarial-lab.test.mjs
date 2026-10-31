import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const lab=readFileSync(new URL("../integrations/base44/components/AdversarialLab.jsx",import.meta.url),"utf8");
const styles=readFileSync(new URL("../integrations/base44/components/AdversarialLab.css",import.meta.url),"utf8");
const page=readFileSync(new URL("../integrations/base44/pages/GateKeeper.jsx",import.meta.url),"utf8");

test("showcase routes the existing Overview to the new Adversarial Lab",()=>{
 assert.match(page,/import AdversarialLab from "..\/components\/AdversarialLab"/);
 assert.match(page,/page === "Overview" && <AdversarialLab/);
 assert.match(lab,/export default function AdversarialLab/);
});

test("showcase discloses simulation and never pretends live inference",()=>{
 assert.match(lab,/DEMONSTRATION MODE/);
 assert.match(lab,/scripted educational scenario/);
 assert.match(lab,/not a live TrueForge inference/);
 assert.match(lab,/SAMPLE CODE — NO REPOSITORY CONNECTED/);
 assert.match(lab,/PROPOSED PATTERN — NOT EXECUTED/);
 assert.match(lab,/not a verified exploit/);
 assert.doesNotMatch(lab,/fetch\s*\(/);
 assert.doesNotMatch(lab,/\.functions\.invoke\(/);
});

test("five-phase walkthrough connects source, path, finding and proposed control",()=>{
 for(const key of ["MISSION READY","INSPECT","CHALLENGE","EVIDENCE","VERIFY"])assert.ok(lab.includes(key));
 assert.match(lab,/viewInvoice/);
 assert.match(lab,/tenantId: req\.auth\.tenantId/);
 assert.match(lab,/where: \{ id: invoiceId, tenantId \}/);
 assert.match(lab,/Cross-tenant denial test/);
 assert.match(lab,/onClick=\{start\}/);
 assert.match(lab,/onClick=\{advance\}/);
 assert.match(lab,/aria-current=\{phase===index\?"step":undefined\}/);
});

test("responsive contrast and reduced motion support",()=>{
 assert.match(styles,/@media\(max-width:560px\)/);
 assert.match(styles,/@media\(prefers-reduced-motion: reduce\)/);
 assert.match(styles,/:focus-visible/);
 assert.match(styles,/\.al-graph-danger/);
 assert.match(styles,/\.al-graph-safe/);
});
