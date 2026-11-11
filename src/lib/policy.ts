/**
 * Pre-signature policy gate: ten deterministic rules, tranching, risk score.
 * The AI linter (A2) only advises; these rules decide.
 */
import { BPS_FULL } from "./money";
import { DEADLINE_LIMITS, dueOffsetDays, maxBonusCents, type DeadlineTerms } from "./deadline";

export type Rail = "A1" | "A2" | "B" | "MOCK";
export const RAIL_CAP_DAYS: Record<Rail, number> = { A1: 26, A2: 26, B: 25, MOCK: 26 };

export interface PMilestone { code: string; type: "GATE" | "PAY"; day: number; bps: number; amountCents: number; active: boolean; proof: { artifacts: { kind: string; min: number }[]; oracle?: string; criteria: string[] }; lockRule: string; disputeRule: string; dependsOn: string[]; trancheIdx?: number }
export interface PClause { category: "SYSTEM" | "BASELINE" | "CUSTOM"; code: string; body: string; active: boolean; protective: boolean }
export interface PWorkspace { totalCents: number; rail: Rail; milestones: PMilestone[]; clauses: PClause[]; providerPayable: boolean; depositWaiver?: boolean; /** Deadline terms (R11/R12); absent or null = both off. */ deadline?: DeadlineTerms | null }
export interface Violation { rule: string; code: string; message: string; target?: string }

/** R07 patterns live in clause-patterns.ts (the list lives there). */
import { CONTRADICTIONS } from "./clause-patterns";
export { CONTRADICTIONS };

export function trancheOf(milestones: PMilestone[], rail: Rail): number[] {
  const cap = RAIL_CAP_DAYS[rail];
  let idx = 1, start = -1;
  return milestones.map((m) => {
    if (start < 0) start = Math.max(0, m.day - 1);
    if (m.day - start > cap) { idx += 1; start = m.day - 1; }
    return idx;
  });
}

export function checkPolicy(w: PWorkspace): Violation[] {
  const v: Violation[] = [];
  const act = w.milestones.filter((m) => m.active).sort((a, b) => a.day - b.day);
  const pay = act.filter((m) => m.type === "PAY");
  const sumBps = pay.reduce((a, m) => a + m.bps, 0);
  const sumAmt = pay.reduce((a, m) => a + m.amountCents, 0);
  if (sumBps !== BPS_FULL || sumAmt !== w.totalCents)
    v.push({ rule: "R01", code: "SUM_NOT_100", message: `Payment milestones add up to ${(sumBps / 100).toFixed(2)}% (${sumAmt} of ${w.totalCents} cents). They must add up to exactly 100%.` });
  const tr = trancheOf(act, w.rail);
  const cap = RAIL_CAP_DAYS[w.rail];
  const starts = new Map<number, number>();
  act.forEach((m, i) => { if (!starts.has(tr[i])) starts.set(tr[i], Math.max(0, m.day - 1)); });
  act.forEach((m, i) => { if (m.day - (starts.get(tr[i]) ?? 0) > cap) v.push({ rule: "R02", code: "EXCEEDS_HOLD_WINDOW", message: `“${m.code}” falls outside its tranche's ${cap}-day window. Split it into checkpoints.`, target: m.code }); });
  const byCode = new Map(act.map((m) => [m.code, m]));
  for (const m of act) for (const d of m.dependsOn) { const p = byCode.get(d); if (p && p.day > m.day) v.push({ rule: "R03", code: "TIMELINE_NOT_MONOTONIC", message: `“${m.code}” is due before “${d}”, which it depends on.`, target: m.code }); }
  const lastDay = Math.max(1, ...act.map((m) => m.day));
  const early = pay.filter((m) => m.day <= Math.ceil(lastDay * 0.2)).reduce((a, m) => a + m.bps, 0);
  if (early > 4000 && !w.depositWaiver) v.push({ rule: "R04", code: "FRONT_LOADED", message: `${(early / 100).toFixed(0)}% is paid in the first fifth of the timeline (limit 40% without a signed material-deposit waiver).` });
  for (const m of pay) if (!m.proof.artifacts.some((a) => a.min > 0) && !m.proof.oracle) v.push({ rule: "R05", code: "MISSING_PROOF_SPEC", message: `“${m.code}” pays money but names no concrete proof.`, target: m.code });
  for (const m of act) if (!m.lockRule.trim() || !m.disputeRule.trim()) v.push({ rule: "R06", code: "MISSING_RULES", message: `“${m.code}” needs both a lock rule and a dispute rule.`, target: m.code });
  for (const c of w.clauses.filter((c) => c.category === "CUSTOM" && c.active)) if (CONTRADICTIONS.some((r) => r.test(c.body))) v.push({ rule: "R07", code: "CLAUSE_CONTRADICTION", message: `Custom clause “${c.code}” contradicts a system rule.`, target: c.code });
  if (w.clauses.some((c) => c.category === "SYSTEM" && !c.active)) v.push({ rule: "R07", code: "SYSTEM_CLAUSE_OFF", message: "System clauses cannot be switched off." });
  if (!w.providerPayable) v.push({ rule: "R08", code: "PROVIDER_NOT_PAYABLE", message: "The provider's PayPal account is not linked and able to receive payments." });
  const perTranche = new Map<number, number>(); tr.forEach((t) => perTranche.set(t, (perTranche.get(t) ?? 0) + 1));
  for (const [t, n] of perTranche) if (n < 3 || n > 50) v.push({ rule: "R10", code: "BOUNDS", message: `Tranche ${t} has ${n} milestones (allowed 3–50).` });
  if (w.totalCents < 1000) v.push({ rule: "R10", code: "BOUNDS", message: "The contract total must be at least $10." });
  v.push(...checkDeadline(w, act, tr));
  return v;
}

/**
 * R11 (late deduction) and R12 (early-finish bonus). Both terms are optional; these rules only run when the parties
 * switched one on. R11: cap ≤ 20%, at least one grace day, and the cap is reached by day 27 of the hold (the settlement
 * day, after which nothing is counted). R12: pool ≤ 15% of the contract, the pool covers the largest bonus the terms can
 * pay (rate × the most days early each milestone can be), and the pool is funded with the tranche hold.
 */
function checkDeadline(w: PWorkspace, act: PMilestone[], tr: number[]): Violation[] {
  const t = w.deadline;
  const v: Violation[] = [];
  if (!t) return v;
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  const codes = new Set(act.filter((m) => m.type === "PAY").map((m) => m.code));
  if (t.late) {
    const L = t.late;
    if (L.capBps > DEADLINE_LIMITS.lateCapMaxBps) v.push({ rule: "R11", code: "LATE_CAP_TOO_HIGH", message: `The late deduction is capped at ${pct(L.capBps)}; the cap can be at most ${pct(DEADLINE_LIMITS.lateCapMaxBps)} of a milestone.` });
    if (L.graceDays < DEADLINE_LIMITS.minGraceDays) v.push({ rule: "R11", code: "NO_GRACE_DAY", message: "The late deduction needs at least one grace day before anything is deducted." });
    const daysToCap = L.graceDays + Math.ceil(L.capBps / Math.max(1, L.rateBps));
    if (daysToCap > DEADLINE_LIMITS.capReachedByDay) v.push({ rule: "R11", code: "LATE_CAP_UNREACHABLE", message: `At ${pct(L.rateBps)} a day after ${L.graceDays} grace day(s), the ${pct(L.capBps)} cap is reached on day ${daysToCap}; it must be reached by day ${DEADLINE_LIMITS.capReachedByDay} of the hold.` });
    if (L.rateBps > L.capBps) v.push({ rule: "R11", code: "LATE_RATE_ABOVE_CAP", message: `The daily rate (${pct(L.rateBps)}) is higher than the cap (${pct(L.capBps)}).` });
    if (L.milestones !== "ALL") for (const c of L.milestones) if (!codes.has(c)) v.push({ rule: "R11", code: "LATE_SCOPE_UNKNOWN", message: `The late deduction names ${c}, which is not an active payment milestone.`, target: c });
  }
  if (t.early) {
    const E = t.early;
    if (E.poolCents * BPS_FULL > DEADLINE_LIMITS.poolMaxBps * w.totalCents) v.push({ rule: "R12", code: "POOL_TOO_LARGE", message: `The bonus pool (${usd(E.poolCents)}) is more than ${pct(DEADLINE_LIMITS.poolMaxBps)} of the contract.` });
    if (E.poolCents <= 0) v.push({ rule: "R12", code: "POOL_NOT_FUNDED", message: "The early-finish bonus needs a bonus pool, funded with the tranche hold." });
    const starts = new Map<number, number>();
    act.forEach((m, i) => { if (!starts.has(tr[i])) starts.set(tr[i], tr[i] === 1 ? 1 : m.day); });
    const need = maxBonusCents(t, act.map((m, i) => ({ code: m.code, type: m.type, amountCents: m.amountCents, active: m.active, trancheIdx: tr[i], maxEarlyDays: dueOffsetDays(m.day, tr[i], starts.get(tr[i]) ?? 1) })));
    if (E.poolCents > 0 && need > E.poolCents) v.push({ rule: "R12", code: "POOL_TOO_SMALL", message: `At ${pct(E.rateBps)} a day (cap ${pct(E.capBps)}), early delivery can earn up to ${usd(need)}; the bonus pool of ${usd(E.poolCents)} must cover it.` });
    if (E.rateBps > E.capBps) v.push({ rule: "R12", code: "BONUS_RATE_ABOVE_CAP", message: `The daily bonus rate (${pct(E.rateBps)}) is higher than its cap (${pct(E.capBps)}).` });
    if (E.milestones !== "ALL") for (const c of E.milestones) if (!codes.has(c)) v.push({ rule: "R12", code: "BONUS_SCOPE_UNKNOWN", message: `The early bonus names ${c}, which is not an active payment milestone.`, target: c });
  }
  return v;
}

/** R09 is checked at countersign time: both signatures must reference the same revision and hash. */
export const sameRevision = (a: { revNo: number; hash: string }, b: { revNo: number; hash: string }) => a.revNo === b.revNo && a.hash === b.hash;

export type Tier = "platinum" | "standard" | "new" | "probation";
/**
 * The published risk formula (red-team item 17): score = round(100 × Σ weight × part), each part between 0 and 1.
 * Shown as a tooltip next to every risk score; riskScore() below uses exactly these weights.
 */
export const RISK_FORMULA = [
  { key: "valueBand", weight: 0.3, label: "Contract value", how: "0 under $1,000 · 0.33 under $5,000 · 0.66 under $10,000 · 1 above" },
  { key: "protectivePruned", weight: 0.25, label: "Protective clauses switched off", how: "share of the blueprint's protective clauses that are off" },
  { key: "custom", weight: 0.2, label: "Share of custom clauses", how: "custom clauses ÷ all active clauses" },
  { key: "tier", weight: 0.15, label: "Provider trust tier", how: "platinum 0 · standard 0.5 · new 0.7 · probation 1" },
  { key: "frontLoad", weight: 0.1, label: "Money paid early in the timeline", how: "share paid in the first fifth of the days, ÷ 40% (max 1)" },
] as const;
export function riskScore(w: PWorkspace, providerTier: Tier): { score: number; parts: Record<string, number> } {
  const total = w.totalCents / 100;
  const valueBand = total < 1000 ? 0 : total < 5000 ? 0.33 : total < 10000 ? 0.66 : 1;
  const prot = w.clauses.filter((c) => c.category === "BASELINE" && c.protective);
  const protectivePruned = prot.length ? prot.filter((c) => !c.active).length / prot.length : 0;
  const activeClauses = w.clauses.filter((c) => c.active);
  const custom = activeClauses.length ? Math.min(1, activeClauses.filter((c) => c.category === "CUSTOM").length / activeClauses.length) : 0;
  const tierF = { platinum: 0, standard: 0.5, new: 0.7, probation: 1 }[providerTier];
  const act = w.milestones.filter((m) => m.active && m.type === "PAY");
  const last = Math.max(1, ...act.map((m) => m.day));
  const early = act.filter((m) => m.day <= Math.ceil(last * 0.2)).reduce((a, m) => a + m.bps, 0) / BPS_FULL;
  const front = Math.min(1, early / 0.4);
  const parts = { valueBand, protectivePruned, custom, tier: tierF, frontLoad: front };
  const score = Math.round(100 * RISK_FORMULA.reduce((s, f) => s + f.weight * parts[f.key], 0));
  return { score, parts };
}
export const RISK_OPS_THRESHOLD = 75;

/** Watchdog schedule per rail. Days since the hold began. */
export function watchdogPlan(rail: Rail): { day: number; action: "REAUTHORIZE_IF_NEEDED" | "WARN" | "OFFER_ROLLOVER" | "SETTLE" }[] {
  const base = [{ day: 22, action: "WARN" as const }, { day: 25, action: "OFFER_ROLLOVER" as const }, { day: 27, action: "SETTLE" as const }];
  return rail === "B" ? base : [{ day: 3, action: "REAUTHORIZE_IF_NEEDED" as const }, ...base];
}

/** Blind-bid convergence: provider-share bids in bps. */
export function converge(clientOfferBps: number, providerAskBps: number): number | null {
  if (providerAskBps - clientOfferBps <= 500) return Math.round((clientOfferBps + providerAskBps) / 2);
  return null;
}
