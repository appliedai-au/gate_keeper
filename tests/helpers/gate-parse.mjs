import { parseGateJudgements as p } from "../../scripts/proof/live/run.mjs";
const j = (o) => "```json\n" + JSON.stringify({ judgements: o }) + "\n```";
const out = {
  ok: p(j([{ index: 0, real: false }, { index: 1, real: true }]), 2),
  partial: p(j([{ index: 0, real: false }]), 2),
  dup: p(j([{ index: 0, real: false }, { index: 0, real: true }]), 2),
  range: p(j([{ index: 5, real: false }]), 1),
  last: p("```json\n{\"judgements\":[]}\n```\n" + j([{ index: 0, real: true }]), 1),
};
console.log(JSON.stringify(out));
