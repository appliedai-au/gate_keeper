// External spend controller. Runs in the evaluator process, never inside an
// agent. Every model call must reserve a worst-case amount first; the call is
// refused when the reservation would breach the phase or total cap. Actual
// spend is settled from TrueForge's per-turn cost metric (or tokens x price).
import { PRICE_PER_MTOK, UNKNOWN_MODEL_TURN_RESERVE_USD } from "./config.mjs";

export function priceFor(model) {
  for (const [re, p] of PRICE_PER_MTOK) if (re.test(model)) return p;
  return null;
}

export class BudgetController {
  constructor({ capUsd, phaseShare, model, now = () => Date.now() }) {
    if (!(capUsd > 0 && capUsd <= 100)) throw new Error("BUDGET_CAP_INVALID");
    this.capUsd = capUsd;
    this.phaseCaps = Object.fromEntries(Object.entries(phaseShare).map(([k, s]) => [k, capUsd * s]));
    this.price = priceFor(model);
    this.model = model;
    this.spent = 0;
    this.phaseSpent = Object.fromEntries(Object.keys(phaseShare).map((k) => [k, 0]));
    this.reserved = 0;
    this.ledger = [];
    this.refusals = [];
    this.now = now;
    this.seq = 0;
  }
  estimate(inputChars, maxOutputTokens) {
    if (!this.price) return UNKNOWN_MODEL_TURN_RESERVE_USD;
    const inTok = Math.ceil(inputChars / 3) + 200; // conservative chars->tokens
    return (inTok * this.price[0] + maxOutputTokens * this.price[1]) / 1e6;
  }
  /** Reserve before a call. Returns a reservation or null when refused. */
  reserve(phase, label, inputChars, maxOutputTokens) {
    if (!(phase in this.phaseCaps)) throw new Error("BUDGET_UNKNOWN_PHASE");
    const amount = this.estimate(inputChars, maxOutputTokens);
    const phaseUsed = this.phaseSpent[phase] + this.pendingFor(phase);
    if (this.spent + this.reserved + amount > this.capUsd || phaseUsed + amount > this.phaseCaps[phase]) {
      this.refusals.push({ at: new Date(this.now()).toISOString(), phase, label, requested_usd: round(amount) });
      return null;
    }
    const r = { id: ++this.seq, phase, label, amount, open: true };
    this.reserved += amount;
    this.ledger.push({ ...r, at: new Date(this.now()).toISOString(), state: "reserved" });
    return r;
  }
  pendingFor(phase) {
    return this.ledger.filter((e) => e.state === "reserved" && e.phase === phase).reduce((s, e) => s + e.amount, 0);
  }
  /** Settle with the measured turn metrics. Unknown cost settles at the full reservation. */
  settle(r, metrics) {
    if (!r || !r.open) throw new Error("BUDGET_SETTLE_INVALID");
    r.open = false;
    let cost = null, source = "reservation";
    if (metrics && Number.isFinite(metrics.totalCostInUsd)) { cost = metrics.totalCostInUsd; source = "trueforge_turn_metric"; }
    else if (metrics && this.price && Number.isFinite(metrics.totalInputTokens) && Number.isFinite(metrics.totalOutputTokens)) {
      cost = (metrics.totalInputTokens * this.price[0] + metrics.totalOutputTokens * this.price[1]) / 1e6; source = "tokens_x_list_price";
    }
    if (cost === null) cost = r.amount;
    this.reserved -= r.amount;
    this.spent += cost;
    this.phaseSpent[r.phase] += cost;
    const entry = this.ledger.find((e) => e.id === r.id);
    Object.assign(entry, { state: "settled", cost_usd: round(cost), cost_source: source });
    return cost;
  }
  remaining() { return round(this.capUsd - this.spent - this.reserved); }
  snapshot() {
    return {
      cap_usd: this.capUsd, model: this.model, list_price_per_mtok: this.price,
      spent_usd: round(this.spent), reserved_usd: round(this.reserved),
      phase_caps_usd: mapRound(this.phaseCaps), phase_spent_usd: mapRound(this.phaseSpent),
      calls: this.ledger.length, refusals: this.refusals,
      cost_sources: countBy(this.ledger.filter((e) => e.state === "settled"), "cost_source"),
    };
  }
}
const round = (x) => Math.round(x * 1e6) / 1e6;
const mapRound = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));
const countBy = (xs, k) => xs.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
