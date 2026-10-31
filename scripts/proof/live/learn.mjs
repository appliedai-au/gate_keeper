// Learning run: review errors become lessons, lessons are selected into general
// rules, rules are qualified on the development set, and only qualified rules
// are tested on an unseen holdout the learning steps never saw.
//
//   dev review -> blinded adjudication -> error capture (false alarms + misses)
//   -> rule selection (+ mechanical generality filter) -> qualification on dev
//   -> unseen proof (baseline vs adversarial vs adversarial + learned rules)
//
// Pass criteria are fixed here, before any run:
//   qualification: dev false positives fall AND no dev key issue is lost.
//   unseen proof:  false positives fall AND no key issue is lost, vs the
//                  same adversarial reviewer without the rules.
import { assessLessonForCore } from "../../execution/policy.mjs";
import { RUNTIME_CONFIG, armInstructions, learnedRulesSection, sha256 } from "./config.mjs";
import { aggregateArm } from "./metrics.mjs";
import { adjudicateTasks, decodeHoldout, numbered, reviewErrors, reviewTasks } from "./review.mjs";

export const LEARN_PHASE_SHARE = { dev: 0.25, learn: 0.08, qualify: 0.25, prove: 0.42 };
export const MAX_RULES = 6;

export const LEARN_CAPTURE = `You are Gate Keeper's learning step. An independent adjudicator graded a code review you produced against an answer key.
You are shown the code and your errors on it: false alarms (findings the adjudicator judged not to be real defects) and misses (answer-key defects you did not report).
For each error write one candidate lesson: a general review rule that would have prevented this error on OTHER code as well, without making you skip real defects.
- A false-alarm rule must say what evidence shows the concern is already handled or not reachable, so real instances are still reported.
- A miss rule must say what to look for.
- Never mention this file, its names, identifiers, line numbers or code.
Return exactly one fenced JSON block:
\`\`\`json
{"lessons": [{"error": "false_alarm", "rule": "one sentence", "applies_when": "short condition"}]}
\`\`\``;

export const LEARN_SELECT = `You are selecting review rules from candidate lessons gathered across many reviewed files.
Merge duplicates and near-duplicates. Drop any rule that is specific to one file, and any rule that would make a reviewer skip a real class of defect (an unconditional "don't flag X").
Keep at most ${MAX_RULES} rules, most useful first. Each rule is one self-contained sentence that states its condition. No code, identifiers or backticks.
Return exactly one fenced JSON block:
\`\`\`json
{"rules": [{"rule": "one sentence", "sources": 3}]}
\`\`\`
where sources is how many candidate lessons the rule generalises.`;

export function parseJsonBlock(text) {
  const blocks = [...String(text || "").matchAll(/```json\s*\n?([\s\S]*?)```/g)].map((m) => m[1]);
  try { return JSON.parse((blocks.length ? blocks[blocks.length - 1] : String(text || "")).trim()); } catch { return null; }
}

/** Mechanical generality filter: a rule may not quote code or name a development task's file or identifiers. */
export function ruleRejection(rule, devTasks) {
  if (typeof rule !== "string") return "NOT_TEXT";
  const r = rule.trim();
  if (r.length < 20 || r.length > 320) return "LENGTH";
  if (/[`{}]|\bline\s*\d+/i.test(r)) return "CODE_OR_LINE_REFERENCE";
  for (const t of devTasks) {
    if (t.filename && r.toLowerCase().includes(String(t.filename).toLowerCase())) return "NAMES_A_TASK_FILE";
    const idents = new Set(t.code.join("\n").match(/\b[A-Za-z]\w*(?:_\w+|[a-z][A-Z]\w*)\b/g) || []);
    for (const id of idents) if (id.length >= 5 && new RegExp(`\\b${id}\\b`).test(r)) return "NAMES_A_TASK_IDENTIFIER";
  }
  return null;
}

const pick = (a) => a && ({ turns: a.turns, expected_issues: a.expected_issues, matched_issues: a.matched_issues, false_positives: a.false_positives,
  true_positives: a.true_positives, unlisted_real_defects: a.unlisted_real_defects, duplicates: a.duplicates, defect_recall: a.defect_recall,
  precision: a.precision, severity_accuracy: a.severity_accuracy, explanation_correctness: a.explanation_correctness, total_tokens: a.total_tokens,
  unjudged_findings: a.unjudged_findings, unparseable_replies: a.unparseable_replies });

export async function runLearning({ env, model, publicTasks, budget, callTurn, newSession, ev, emit, limitations }) {
  const dev = decodeHoldout(env.GK_DEV_HOLDOUT_B64);
  const unseen = decodeHoldout(env.GK_PRIVATE_HOLDOUT_B64);
  if (!unseen.tasks.length) throw new Error("UNSEEN_HOLDOUT_REQUIRED");
  const devTasks = [...publicTasks, ...dev.tasks];
  const devIds = new Set(devTasks.map((t) => t.id)), devCode = new Set(devTasks.map((t) => t.code.join("\n")));
  if (unseen.tasks.some((t) => devIds.has(t.id) || devCode.has(t.code.join("\n")))) throw new Error("HOLDOUT_OVERLAP");
  ev.put("private/learn/dev-tasks.json", dev.tasks, "private_dev_set");
  ev.put("private/learn/unseen-tasks.json", unseen.tasks, "private_holdout");

  const common = { model, callTurn, newSession, limitations };
  const stages = { dev_review: "NOT_RUN", error_capture: "NOT_RUN", rule_selection: "NOT_RUN", qualification: "NOT_RUN", unseen_proof: "NOT_RUN" };
  const pub = { stages, criteria: {
    qualification: "dev false_positives(learned) < false_positives(current) AND matched_issues(learned) >= matched_issues(current)",
    unseen_proof: "unseen false_positives(learned) < false_positives(current) AND matched_issues(learned) >= matched_issues(current)" },
    dev_set: { public_tasks: publicTasks.length, private_tasks: dev.tasks.length }, unseen_set: { private_tasks: unseen.tasks.length, clean_tasks: unseen.tasks.filter((t) => !t.expected.length).length } };
  const hashes = { dev_holdout_sha256: dev.sha256, unseen_holdout_sha256: unseen.sha256 };
  const done = () => ({ public: pub, hashes });

  // A. Development review with the current adversarial reviewer.
  const a = await reviewTasks({ tasks: devTasks, arms: ["gate_keeper"], instructionsFor: (arm) => armInstructions(arm), phase: "dev", tag: "dev/", ...common });
  if (!a.completeTrials.length) { stages.dev_review = "INCOMPLETE"; return done(); }
  const aAdj = await adjudicateTasks({ tasks: devTasks, scored: a.results, phase: "dev", ev, evPrefix: "private/learn/dev-adjudication", ...common });
  const before = aggregateArm("gate_keeper", a.results, aAdj.judgements, aAdj.blindKey);
  ev.put("private/learn/dev-replies.json", a.results.map(({ task, ...r }) => ({ ...r, task_id: task.id })), "candidate_replies");
  stages.dev_review = before.unjudged_findings ? "INCOMPLETE" : "PASS";
  pub.dev_before = pick(before);
  emit("GK_LEARN_DEV", pub.dev_before);
  if (stages.dev_review !== "PASS") return done();

  // B. Error capture: each adjudicated error becomes candidate lessons.
  const captureInstr = LEARN_CAPTURE;
  let captureSession = null;
  const candidates = [];
  let falseAlarms = 0, misses = 0;
  for (const r of a.results) {
    const err = reviewErrors(r, aAdj.judgements, aAdj.blindKey);
    falseAlarms += err.falseAlarms.length; misses += err.misses.length;
    if (!err.falseAlarms.length && !err.misses.length) continue;
    captureSession ||= await newSession({ model: { name: model, params: { temperature: 0, maxTokens: 900 } }, instructions: captureInstr, config: RUNTIME_CONFIG }, { phase: "learn", role: "capture" });
    const prompt = [`Context: ${r.task.context}`, "```" + r.task.language, numbered(r.task.code), "```", "",
      "False alarms (judged not real):", "```json", JSON.stringify(err.falseAlarms.map(({ line, category, comment }) => ({ line, category, comment })), null, 1), "```", "",
      "Missed answer-key defects:", "```json", JSON.stringify(err.misses.map(({ line, categories, why }) => ({ line, categories, why })), null, 1), "```"].join("\n");
    const out = await callTurn("learn", `capture/${r.task.id}`, captureSession, prompt, captureInstr.length, 900);
    if (out.refused) break;
    const lessons = parseJsonBlock(out.text)?.lessons;
    ev.put(`private/learn/capture/${r.task.id}.json`, { reply: out.text, turn_id: out.turnId }, "lesson_capture");
    for (const l of Array.isArray(lessons) ? lessons : []) {
      if (!l || typeof l.rule !== "string") continue;
      candidates.push({ task_id: r.task.id, error: l.error === "miss" ? "miss" : "false_alarm", rule: l.rule.slice(0, 400), applies_when: String(l.applies_when || "").slice(0, 200), turn_id: out.turnId });
    }
  }
  pub.errors = { false_alarms: falseAlarms, misses };
  pub.candidates = { total: candidates.length, from_false_alarms: candidates.filter((c) => c.error === "false_alarm").length, from_misses: candidates.filter((c) => c.error === "miss").length,
    source_tasks: new Set(candidates.map((c) => c.task_id)).size };
  ev.put("private/learn/candidates.json", candidates, "lesson_candidates");
  stages.error_capture = falseAlarms + misses === 0 ? "NO_ERRORS" : candidates.length ? "PASS" : "FAIL";
  if (stages.error_capture !== "PASS") return done();

  // C. Selection into general rules, then the mechanical generality filter.
  const selectSession = await newSession({ model: { name: model, params: { temperature: 0, maxTokens: 1200 } }, instructions: LEARN_SELECT, config: RUNTIME_CONFIG }, { phase: "learn", role: "select" });
  const selOut = await callTurn("learn", "select", selectSession, "Candidate lessons:\n```json\n" + JSON.stringify(candidates.map(({ error, rule, applies_when }) => ({ error, rule, applies_when })), null, 1) + "\n```", LEARN_SELECT.length, 1200);
  ev.put("private/learn/selection.json", { reply: selOut.text, turn_id: selOut.turnId }, "lesson_selection");
  const proposed = (parseJsonBlock(selOut.text)?.rules || []).filter((r) => r && typeof r.rule === "string").slice(0, MAX_RULES * 2);
  const screened = proposed.map((r) => ({ text: r.rule.trim(), sources: Number.isInteger(r.sources) ? r.sources : null, rejection: ruleRejection(r.rule, devTasks) }));
  const accepted = screened.filter((r) => !r.rejection).slice(0, MAX_RULES);
  pub.rules = screened.map((r) => ({ text: r.text, sources: r.sources, rejection: r.rejection, accepted: accepted.includes(r) }));
  stages.rule_selection = accepted.length ? "PASS" : "FAIL";
  emit("GK_LEARN_RULES", pub.rules);
  if (!accepted.length) return done();
  const learnedRules = accepted.map((r) => r.text);
  hashes.learned_rules_sha256 = sha256(learnedRulesSection(learnedRules));
  hashes.gate_keeper_learned_instructions_sha256 = sha256(armInstructions("gate_keeper_learned", { learnedRules }));

  // D. Qualification: the improved reviewer on the same development set, adjudicated afresh.
  const learnedFor = (arm) => armInstructions(arm, arm === "gate_keeper_learned" ? { learnedRules } : {});
  const q = await reviewTasks({ tasks: devTasks, arms: ["gate_keeper_learned"], instructionsFor: learnedFor, phase: "qualify", tag: "qualify/", ...common });
  if (!q.completeTrials.length) { stages.qualification = "INCOMPLETE"; return done(); }
  const qAdj = await adjudicateTasks({ tasks: devTasks, scored: q.results, phase: "qualify", ev, evPrefix: "private/learn/qualify-adjudication", ...common });
  const after = aggregateArm("gate_keeper_learned", q.results, qAdj.judgements, qAdj.blindKey);
  ev.put("private/learn/qualify-replies.json", q.results.map(({ task, ...r }) => ({ ...r, task_id: task.id })), "candidate_replies");
  pub.dev_after = pick(after);
  const qualified = !after.unjudged_findings && after.false_positives < before.false_positives && after.matched_issues >= before.matched_issues;
  stages.qualification = after.unjudged_findings ? "INCOMPLETE" : qualified ? "PASS" : "FAIL";
  emit("GK_LEARN_QUALIFY", { qualified, before: pub.dev_before, after: pub.dev_after });

  // E. Unseen proof, only for qualified rules: three arms, identical inputs, blinded adjudication.
  let proved = null;
  if (qualified) {
    const arms = ["baseline", "gate_keeper", "gate_keeper_learned"];
    const p = await reviewTasks({ tasks: unseen.tasks, arms, instructionsFor: learnedFor, phase: "prove", tag: "prove/", ...common });
    if (!p.completeTrials.length) stages.unseen_proof = "INCOMPLETE";
    else {
      const pAdj = await adjudicateTasks({ tasks: unseen.tasks, scored: p.results, phase: "prove", ev, evPrefix: "private/learn/prove-adjudication", ...common });
      ev.put("private/learn/prove-replies.json", p.results.map(({ task, ...r }) => ({ ...r, task_id: task.id })), "candidate_replies");
      const agg = Object.fromEntries(arms.map((arm) => [arm, aggregateArm(arm, p.results, pAdj.judgements, pAdj.blindKey)]));
      const cleanIds = new Set(unseen.tasks.filter((t) => !t.expected.length).map((t) => t.id));
      pub.unseen = Object.fromEntries(arms.map((arm) => [arm, { ...pick(agg[arm]),
        findings_on_clean_tasks: p.results.filter((r) => r.arm === arm && cleanIds.has(r.task.id)).reduce((n, r) => n + (r.findings || []).length, 0) }]));
      const L = agg.gate_keeper_learned, G = agg.gate_keeper;
      const unjudged = arms.some((arm) => agg[arm].unjudged_findings);
      proved = !unjudged && L.false_positives < G.false_positives && L.matched_issues >= G.matched_issues;
      stages.unseen_proof = unjudged ? "INCOMPLETE" : proved ? "PASS" : "FAIL";
      emit("GK_LEARN_PROVE", { proved, arms: pub.unseen });
    }
  }

  // Core-candidate selection, recorded exactly as Gate Keeper's policy answers.
  pub.core_selection = learnedRules.map((text) => {
    const lesson = { scope: "user", tenantId: "benchmark-dev", text, evidenceIds: candidates.map((c) => c.turn_id).filter(Boolean),
      verifiedSuccesses: qualified ? Math.max(0, before.false_positives - after.false_positives) : 0, independentTenants: 0,
      regressions: qualified ? 0 : null, userConsent: false, anonymized: true, containsSecrets: false, containsPersonalData: false,
      containsProprietaryCode: false, independentHoldoutPassed: proved === true, adversarialSecurityPassed: false, signedVerifierPassed: false, expectedSourceBound: true };
    const sel = assessLessonForCore(lesson);
    return { text_sha256: sha256(text), selected: sel.selected, reasons: sel.reasons };
  });
  ev.put("private/learn/learned-rules.json", { learnedRules, qualified, proved }, "learned_rules");
  return done();
}
