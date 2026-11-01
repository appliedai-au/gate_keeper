// Population learning run: many tenants' review errors feed one shared rule set
// (the core knowledge tree), and a NEW tenant who contributed nothing is the test.
//
//   per-tenant dev review -> blinded adjudication -> per-tenant error capture
//   (tenant-private lessons, isolated sessions) -> population ingestion (only
//   consenting tenants, anonymised, a rule needs >= POPULATION_MIN_TENANTS
//   independent tenants) -> qualification on every contributing tenant
//   -> unseen proof on a new tenant -> core-candidate selection by policy.
//
// Pass criteria are fixed here, before any run:
//   qualification: total dev false positives fall, NO tenant loses a key issue,
//                  and no security key issue is lost anywhere.
//   unseen proof:  the new tenant's false positives fall and no key issue is
//                  lost, vs the same adversarial reviewer without the rules.
// Selection is not promotion: a shared rule enters the core baseline only
// through a reviewed release with an independent signed verifier.
import { assessLessonForCore } from "../../execution/policy.mjs";
import { RUNTIME_CONFIG, armInstructions, learnedRulesSection, sha256 } from "./config.mjs";
import { aggregateArm, answerKey } from "./metrics.mjs";
import { adjudicateTasks, decodeHoldout, numbered, reviewErrors, reviewTasks } from "./review.mjs";

// Each review phase pays for its own reviews AND their adjudication (adjudication costs about as much as the reviews).
export const LEARN_PHASE_SHARE = { dev: 0.27, learn: 0.10, qualify: 0.27, prove: 0.36 };
export const MAX_RULES = 6;
export const POPULATION_MIN_TENANTS = 2;
export const TENANT_SIZE = 2;
export const NEW_TENANT = "tenant-new";

export const LEARN_CAPTURE = `You are Gate Keeper's learning step for one tenant. An independent adjudicator graded a code review you produced for this tenant against an answer key.
You are shown the code and your errors on it: false alarms (findings the adjudicator judged not to be real defects) and misses (answer-key defects you did not report).
For each error write one candidate lesson: a general review rule that would have prevented this error on OTHER code as well, without making you skip real defects.
- A false-alarm rule must say what evidence shows the concern is already handled or not reachable, so real instances are still reported.
- A miss rule must say what to look for.
- Never mention this file, its names, identifiers, line numbers or code.
Return exactly one fenced JSON block:
\`\`\`json
{"lessons": [{"error": "false_alarm", "rule": "one sentence", "applies_when": "short condition"}]}
\`\`\``;

export const LEARN_SELECT = `You are curating Gate Keeper's shared review knowledge from lessons contributed by many independent tenants (labelled T1, T2, ...).
Merge duplicates and near-duplicates across tenants. Keep a rule only when it generalises lessons from at least ${POPULATION_MIN_TENANTS} different tenants.
Drop any rule that is specific to one codebase, and any rule that would make a reviewer skip a real class of defect (an unconditional "don't flag X"); a single tenant must not be able to weaken security review for everyone.
Keep at most ${MAX_RULES} rules, most useful first. Each rule is one self-contained sentence that states its condition. No code, identifiers or backticks.
Return exactly one fenced JSON block:
\`\`\`json
{"rules": [{"rule": "one sentence", "tenants": ["T1", "T4"]}]}
\`\`\`
where tenants lists every tenant label whose lessons the rule generalises.`;

export function parseJsonBlock(text) {
  const blocks = [...String(text || "").matchAll(/```json\s*\n?([\s\S]*?)```/g)].map((m) => m[1]);
  try { return JSON.parse((blocks.length ? blocks[blocks.length - 1] : String(text || "")).trim()); } catch { return null; }
}

/** Anonymisation filter: a shared rule may not quote code or name any contributor's file or identifiers. */
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

/** Deterministic tenancy for the development set: consecutive pairs of tasks per tenant. */
export function assignTenants(tasks, size = TENANT_SIZE) {
  return tasks.map((t, i) => ({ ...t, tenant: t.tenant || `tenant-${String.fromCharCode(97 + Math.floor(i / size))}` }));
}

/** Support check: only labels that map to a consenting tenant that actually contributed a lesson count. */
export function verifiedSupport(claimed, labelToTenant, contributors) {
  const out = new Set();
  for (const label of Array.isArray(claimed) ? claimed : []) {
    const t = labelToTenant.get(String(label));
    if (t && contributors.has(t)) out.add(t);
  }
  return [...out];
}

const pick = (a) => a && ({ turns: a.turns, expected_issues: a.expected_issues, matched_issues: a.matched_issues, false_positives: a.false_positives,
  true_positives: a.true_positives, unlisted_real_defects: a.unlisted_real_defects, duplicates: a.duplicates, defect_recall: a.defect_recall,
  precision: a.precision, severity_accuracy: a.severity_accuracy, explanation_correctness: a.explanation_correctness, total_tokens: a.total_tokens,
  unjudged_findings: a.unjudged_findings, unparseable_replies: a.unparseable_replies });

/** Per-tenant counts plus the exact key issues matched (task:expected_id), so swaps are visible. */
export function perTenant(arm, results, adj) {
  const out = {};
  for (const r of results.filter((x) => x.arm === arm)) {
    const t = (out[r.task.tenant] ||= { matched: 0, false_positives: 0, expected: 0, matchedIds: new Set(), securityIds: new Set() });
    const { falseAlarms, misses } = reviewErrors(r, adj.judgements, adj.blindKey);
    const key = answerKey(r.task), missed = new Set(misses.map((m) => m.expected_id));
    t.expected += key.length; t.false_positives += falseAlarms.length;
    for (const e of key) if (!missed.has(e.expected_id)) {
      t.matched++; t.matchedIds.add(`${r.task.id}:${e.expected_id}`);
      if (e.categories.includes("security")) t.securityIds.add(`${r.task.id}:${e.expected_id}`);
    }
  }
  return out;
}

/** Key issues matched before and missing after, per tenant (identity, not counts). */
export function lostIssues(before, after, tenants, field) {
  return Object.fromEntries(tenants.map((t) => [t, [...(before[t]?.[field] || [])].filter((id) => !after[t]?.[field]?.has(id))]));
}
const countsOnly = (x) => x && { matched: x.matched, false_positives: x.false_positives, expected: x.expected, security_matched: x.securityIds.size };

export async function runLearning({ env, model, publicTasks, budget, callTurn, newSession, ev, emit, limitations }) {
  const dev = decodeHoldout(env.GK_DEV_HOLDOUT_B64);
  const unseen = decodeHoldout(env.GK_PRIVATE_HOLDOUT_B64);
  if (!unseen.tasks.length) throw new Error("UNSEEN_HOLDOUT_REQUIRED");
  // GK_LEARN_DEV_PUBLIC=0 uses only the private development tasks (smaller, cheaper run).
  const devTasks = assignTenants([...(env.GK_LEARN_DEV_PUBLIC === "0" ? [] : publicTasks), ...dev.tasks]);
  const newTenantTasks = unseen.tasks.map((t) => ({ ...t, tenant: NEW_TENANT }));
  const devIds = new Set(devTasks.map((t) => t.id)), devCode = new Set(devTasks.map((t) => t.code.join("\n")));
  if (newTenantTasks.some((t) => devIds.has(t.id) || devCode.has(t.code.join("\n")))) throw new Error("HOLDOUT_OVERLAP");
  const tenants = [...new Set(devTasks.map((t) => t.tenant))];
  // Consent is a tenant setting. GK_LEARN_NON_CONSENTING lists tenants whose lessons must stay private.
  const nonConsenting = new Set(String(env.GK_LEARN_NON_CONSENTING || "").split(",").map((s) => s.trim()).filter(Boolean));
  if ([...nonConsenting].some((t) => !tenants.includes(t))) throw new Error("UNKNOWN_TENANT_IN_CONSENT_SETTING");
  ev.put("private/learn/dev-tasks.json", dev.tasks, "private_dev_set");
  ev.put("private/learn/unseen-tasks.json", unseen.tasks, "private_holdout");

  const common = { model, callTurn, newSession, limitations };
  const stages = { dev_review: "NOT_RUN", tenant_lesson_capture: "NOT_RUN", population_ingestion: "NOT_RUN", qualification: "NOT_RUN", new_tenant_proof: "NOT_RUN" };
  const pub = { stages, criteria: {
    population_ingestion: `rule supported by >= ${POPULATION_MIN_TENANTS} consenting tenants and passes the anonymisation filter`,
    qualification: "total dev false_positives fall AND no contributing tenant loses a key issue AND no security key issue is lost",
    new_tenant_proof: "new tenant false_positives(shared rules) < false_positives(current) AND matched_issues(shared rules) >= matched_issues(current)" },
    tenants: { contributing: tenants.length, non_consenting: nonConsenting.size, tasks_per_tenant: TENANT_SIZE, new_tenant_tasks: newTenantTasks.length,
      new_tenant_clean_tasks: newTenantTasks.filter((t) => !t.expected.length).length },
    dev_set: { public_tasks: env.GK_LEARN_DEV_PUBLIC === "0" ? 0 : publicTasks.length, private_tasks: dev.tasks.length } };
  const hashes = { dev_holdout_sha256: dev.sha256, unseen_holdout_sha256: unseen.sha256 };
  const done = () => ({ public: pub, hashes });

  // A. Every tenant's code reviewed by the current adversarial reviewer, then blindly adjudicated.
  const a = await reviewTasks({ tasks: devTasks, arms: ["gate_keeper"], instructionsFor: (arm) => armInstructions(arm), phase: "dev", tag: "dev/", ...common });
  if (!a.completeTrials.length) { stages.dev_review = "INCOMPLETE"; return done(); }
  const aAdj = await adjudicateTasks({ tasks: devTasks, scored: a.results, phase: "dev", ev, evPrefix: "private/learn/dev-adjudication", ...common });
  const before = aggregateArm("gate_keeper", a.results, aAdj.judgements, aAdj.blindKey);
  ev.put("private/learn/dev-replies.json", a.results.map(({ task, ...r }) => ({ ...r, task_id: task.id, tenant: task.tenant })), "candidate_replies");
  stages.dev_review = before.unjudged_findings ? "INCOMPLETE" : "PASS";
  pub.dev_before = pick(before);
  emit("GK_LEARN_DEV", pub.dev_before);
  if (stages.dev_review !== "PASS") return done();

  // B. Tenant-private lesson capture: one isolated session per tenant; each sees only its own code and errors.
  const lessonsByTenant = Object.fromEntries(tenants.map((t) => [t, []]));
  const captureSession = {};
  let falseAlarms = 0, misses = 0, captureRefused = false;
  for (const r of a.results) {
    const err = reviewErrors(r, aAdj.judgements, aAdj.blindKey);
    falseAlarms += err.falseAlarms.length; misses += err.misses.length;
    if (!err.falseAlarms.length && !err.misses.length) continue;
    const tenant = r.task.tenant;
    captureSession[tenant] ||= await newSession({ model: { name: model, params: { temperature: 0, maxTokens: 900 } }, instructions: LEARN_CAPTURE, config: RUNTIME_CONFIG }, { phase: "learn", role: "capture", tenant });
    const prompt = [`Context: ${r.task.context}`, "```" + r.task.language, numbered(r.task.code), "```", "",
      "False alarms (judged not real):", "```json", JSON.stringify(err.falseAlarms.map(({ line, category, comment }) => ({ line, category, comment })), null, 1), "```", "",
      "Missed answer-key defects:", "```json", JSON.stringify(err.misses.map(({ line, categories, why }) => ({ line, categories, why })), null, 1), "```"].join("\n");
    const out = await callTurn("learn", `capture/${tenant}/${r.task.id}`, captureSession[tenant], prompt, LEARN_CAPTURE.length, 900);
    if (out.refused) { captureRefused = true; limitations.push("learn: tenant lesson capture stopped early (budget or deadline); later stages not run"); break; }
    ev.put(`private/learn/tenants/${tenant}/capture-${r.task.id}.json`, { reply: out.text, turn_id: out.turnId }, "tenant_private_lesson");
    const lessons = parseJsonBlock(out.text)?.lessons;
    for (const l of Array.isArray(lessons) ? lessons : []) {
      if (!l || typeof l.rule !== "string") continue;
      lessonsByTenant[tenant].push({ error: l.error === "miss" ? "miss" : "false_alarm", rule: l.rule.slice(0, 400), applies_when: String(l.applies_when || "").slice(0, 200), turn_id: out.turnId });
    }
  }
  for (const t of tenants) if (lessonsByTenant[t].length) ev.put(`private/learn/tenants/${t}/lessons.json`, lessonsByTenant[t], "tenant_private_lesson");
  const allLessons = Object.values(lessonsByTenant).flat();
  pub.errors = { false_alarms: falseAlarms, misses };
  pub.tenant_lessons = Object.fromEntries(tenants.map((t) => [t, { lessons: lessonsByTenant[t].length, consenting: !nonConsenting.has(t) }]));
  stages.tenant_lesson_capture = captureRefused ? "INCOMPLETE" : falseAlarms + misses === 0 ? "NO_ERRORS" : allLessons.length ? "PASS" : "FAIL";
  if (stages.tenant_lesson_capture !== "PASS") return done();

  // C. Population ingestion: only consenting tenants' lessons, under opaque labels; support is verified, not trusted.
  const contributors = new Set(tenants.filter((t) => !nonConsenting.has(t) && lessonsByTenant[t].length));
  const labelToTenant = new Map([...contributors].map((t, i) => [`T${i + 1}`, t]));
  const tenantToLabel = new Map([...labelToTenant].map(([l, t]) => [t, l]));
  const pool = [...contributors].flatMap((t) => lessonsByTenant[t].map(({ error, rule, applies_when }) => ({ tenant: tenantToLabel.get(t), error, rule, applies_when })));
  if (contributors.size < POPULATION_MIN_TENANTS) { stages.population_ingestion = "FAIL"; pub.rules = []; return done(); }
  const selectSession = await newSession({ model: { name: model, params: { temperature: 0, maxTokens: 1500 } }, instructions: LEARN_SELECT, config: RUNTIME_CONFIG }, { phase: "learn", role: "population-select" });
  const selOut = await callTurn("learn", "population-select", selectSession, "Contributed lessons:\n```json\n" + JSON.stringify(pool, null, 1) + "\n```", LEARN_SELECT.length, 1500);
  if (selOut.refused) { stages.population_ingestion = "INCOMPLETE"; return done(); }
  ev.put("private/learn/population-selection.json", { reply: selOut.text, turn_id: selOut.turnId, labels: Object.fromEntries(labelToTenant) }, "population_selection");
  const rawRules = parseJsonBlock(selOut.text)?.rules;
  const proposed = (Array.isArray(rawRules) ? rawRules : []).filter((r) => r && typeof r.rule === "string").slice(0, MAX_RULES * 2);
  const screened = proposed.map((r) => {
    const support = verifiedSupport(r.tenants, labelToTenant, contributors);
    const rejection = ruleRejection(r.rule, devTasks) || (support.length < POPULATION_MIN_TENANTS ? "INSUFFICIENT_TENANT_SUPPORT" : null);
    return { text: r.rule.trim(), support, rejection };
  });
  const accepted = screened.filter((r) => !r.rejection).slice(0, MAX_RULES);
  ev.put("private/learn/screened-rules.json", screened, "population_selection");
  // Rejected rules may name private code, so only their hash is public; accepted rules passed the anonymisation filter.
  pub.rules = screened.map((r) => ({ ...(r.rejection ? { text_sha256: sha256(r.text) } : { text: r.text }), independent_tenants: r.support.length, rejection: r.rejection, accepted: accepted.includes(r) }));
  stages.population_ingestion = accepted.length ? "PASS" : "FAIL";
  emit("GK_LEARN_RULES", pub.rules);
  if (!accepted.length) return done();
  const sharedRules = accepted.map((r) => r.text);
  hashes.shared_rules_sha256 = sha256(learnedRulesSection(sharedRules));
  hashes.gate_keeper_learned_instructions_sha256 = sha256(armInstructions("gate_keeper_learned", { learnedRules: sharedRules }));

  // D. Qualification across every contributing tenant, adjudicated afresh.
  const learnedFor = (arm) => armInstructions(arm, arm === "gate_keeper_learned" ? { learnedRules: sharedRules } : {});
  const q = await reviewTasks({ tasks: devTasks, arms: ["gate_keeper_learned"], instructionsFor: learnedFor, phase: "qualify", tag: "qualify/", ...common });
  if (!q.completeTrials.length) { stages.qualification = "INCOMPLETE"; return done(); }
  const qAdj = await adjudicateTasks({ tasks: devTasks, scored: q.results, phase: "qualify", ev, evPrefix: "private/learn/qualify-adjudication", ...common });
  const after = aggregateArm("gate_keeper_learned", q.results, qAdj.judgements, qAdj.blindKey);
  ev.put("private/learn/qualify-replies.json", q.results.map(({ task, ...r }) => ({ ...r, task_id: task.id, tenant: task.tenant })), "candidate_replies");
  const tBefore = perTenant("gate_keeper", a.results, aAdj), tAfter = perTenant("gate_keeper_learned", q.results, qAdj);
  const lost = lostIssues(tBefore, tAfter, tenants, "matchedIds"), lostSec = lostIssues(tBefore, tAfter, tenants, "securityIds");
  const tenantRegressions = tenants.filter((t) => lost[t].length);
  const securityLost = tenants.reduce((n, t) => n + lostSec[t].length, 0);
  pub.dev_after = pick(after);
  pub.per_tenant = Object.fromEntries(tenants.map((t) => [t, { before: countsOnly(tBefore[t]), after: countsOnly(tAfter[t]), issues_lost: lost[t].length }]));
  pub.tenant_regressions = tenantRegressions.length;
  pub.security_issues_lost = securityLost;
  const qualified = !after.unjudged_findings && after.false_positives < before.false_positives && tenantRegressions.length === 0 && securityLost === 0;
  stages.qualification = after.unjudged_findings ? "INCOMPLETE" : qualified ? "PASS" : "FAIL";
  emit("GK_LEARN_QUALIFY", { qualified, before: pub.dev_before, after: pub.dev_after, tenant_regressions: tenantRegressions.length, security_issues_lost: securityLost });

  // E. New-tenant proof, only for qualified shared rules: three arms, identical inputs, blinded adjudication.
  let proved = null;
  if (qualified) {
    // The criterion compares the same adversarial reviewer with and without shared rules; plain TrueForge is optional context.
    const arms = env.GK_LEARN_PROVE_BASELINE === "0" ? ["gate_keeper", "gate_keeper_learned"] : ["baseline", "gate_keeper", "gate_keeper_learned"];
    const p = await reviewTasks({ tasks: newTenantTasks, arms, instructionsFor: learnedFor, phase: "prove", tag: "prove/", ...common });
    if (!p.completeTrials.length) stages.new_tenant_proof = "INCOMPLETE";
    else {
      const pAdj = await adjudicateTasks({ tasks: newTenantTasks, scored: p.results, phase: "prove", ev, evPrefix: "private/learn/prove-adjudication", ...common });
      ev.put("private/learn/prove-replies.json", p.results.map(({ task, ...r }) => ({ ...r, task_id: task.id })), "candidate_replies");
      const agg = Object.fromEntries(arms.map((arm) => [arm, aggregateArm(arm, p.results, pAdj.judgements, pAdj.blindKey)]));
      const cleanIds = new Set(newTenantTasks.filter((t) => !t.expected.length).map((t) => t.id));
      pub.new_tenant = Object.fromEntries(arms.map((arm) => [arm, { ...pick(agg[arm]),
        findings_on_clean_tasks: p.results.filter((r) => r.arm === arm && cleanIds.has(r.task.id)).reduce((n, r) => n + (r.findings || []).length, 0) }]));
      const L = agg.gate_keeper_learned, G = agg.gate_keeper;
      const unjudged = arms.some((arm) => agg[arm].unjudged_findings);
      proved = !unjudged && L.false_positives < G.false_positives && L.matched_issues >= G.matched_issues;
      stages.new_tenant_proof = unjudged ? "INCOMPLETE" : proved ? "PASS" : "FAIL";
      emit("GK_LEARN_PROVE", { proved, arms: pub.new_tenant });
    }
  }

  // F. Core-candidate selection, recorded exactly as Gate Keeper's policy answers with the measured inputs.
  const policy = { ownerAllowsCoreCandidates: env.GK_OWNER_ALLOWS_CORE_CANDIDATES === "1" };
  pub.core_selection = accepted.map((r) => {
    const lesson = { scope: "user", tenantId: r.support[0], text: r.text,
      evidenceIds: r.support.flatMap((t) => lessonsByTenant[t].map((l) => l.turn_id)).filter(Boolean),
      verifiedSuccesses: qualified ? Math.max(0, before.false_positives - after.false_positives) : 0,
      independentTenants: r.support.length, regressions: qualified ? 0 : tenantRegressions.length + securityLost,
      userConsent: r.support.every((t) => !nonConsenting.has(t)), anonymized: true,
      containsSecrets: false, containsPersonalData: false, containsProprietaryCode: false,
      independentHoldoutPassed: proved === true, adversarialSecurityPassed: false, signedVerifierPassed: false, expectedSourceBound: true };
    const sel = assessLessonForCore(lesson, policy);
    return { text_sha256: sha256(r.text), independent_tenants: r.support.length, selected: sel.selected, reasons: sel.reasons };
  });
  ev.put("private/learn/shared-rules.json", { sharedRules, support: accepted.map((r) => r.support), qualified, proved }, "shared_rules");
  return done();
}
