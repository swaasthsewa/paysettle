/**
 * F2.04 F2.05 F2.06 F2.07 F2.10 — pure contract helpers (no I/O): amounts by largest remainder, tranching,
 * the canonical document a signature binds to, the change diff against revision 1, and safe input parsing.
 * Deadline terms are part of the canonical document; the bonus pool is split over the tranches it is funded with.
 * Integer cents and basis points only (P6).
 */
import { BPS_FULL, splitByBps } from "@/lib/money";
import { allocatePool, dueOffsetDays, maxBonusFor, poolOf, type DeadlineTerms } from "@/lib/deadline";
import { checkPolicy, riskScore, trancheOf, type PClause, type PMilestone, type PWorkspace, type Rail, type Tier, type Violation } from "@/lib/policy";
import type { ProofSpec } from "@/db/schema";

export interface MsDraft {
  id: string; seq: number; code: string; origin: "BASELINE" | "CUSTOM"; active: boolean; prunedBy: string | null;
  type: "GATE" | "PAY"; title: string; targetDay: number; bps: number; amountCents: number; proof: ProofSpec;
  lockRule: string; disputeRule: string; dependsOn: string[]; trancheIdx: number; state: string;
}
export interface ClDraft { id: string; category: "SYSTEM" | "BASELINE" | "CUSTOM"; code: string; title: string; body: string; active: boolean; protective: boolean; linkedMilestone: string | null; byUser: string | null }
export interface WsHead { id: string; title: string; blueprintCode: string; currency: string; totalCents: number; feeBps: number; rail: Rail; clientId: string; providerId: string | null; inviteEmail: string | null; reviewTimeoutRule: string; /** Optional so older callers keep compiling; absent = both terms off. */ deadline?: DeadlineTerms | null }

/** Day order, then sequence: the order every list, tranche and policy check uses. */
export const byDay = <T extends { targetDay: number; seq: number }>(a: T, b: T) => a.targetDay - b.targetDay || a.seq - b.seq;

/**
 * F2.06 amounts: largest remainder over the active payment milestones. When the shares add to 100% the amounts add to
 * the total to the cent; when they do not, each amount still reflects its own share (so R01 reports both sums honestly).
 */
export function recomputeAmounts(ms: MsDraft[], totalCents: number): void {
  const pay = ms.filter((m) => m.active && m.type === "PAY").sort(byDay);
  const sumBps = pay.reduce((a, m) => a + m.bps, 0);
  const base = sumBps === BPS_FULL ? totalCents : Math.floor((totalCents * sumBps) / BPS_FULL);
  const amts = splitByBps(base, pay.map((m) => m.bps));
  for (const m of ms) m.amountCents = 0;
  pay.forEach((m, i) => (m.amountCents = amts[i]));
}

/** F2.07 tranche index per milestone (active ones in day order; a pruned one takes the tranche of the step before it). */
export function recomputeTranches(ms: MsDraft[], rail: Rail): void {
  const act = ms.filter((m) => m.active).sort(byDay);
  const idx = trancheOf(act.map(toP), rail);
  act.forEach((m, i) => (m.trancheIdx = idx[i]));
  for (const m of ms.filter((x) => !x.active)) {
    const before = act.filter((a) => a.targetDay <= m.targetDay).pop();
    m.trancheIdx = before?.trancheIdx ?? 1;
  }
}

export const toP = (m: MsDraft): PMilestone => ({ code: m.code, type: m.type, day: m.targetDay, bps: m.bps, amountCents: m.amountCents, active: m.active, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn, trancheIdx: m.trancheIdx });
export const toPC = (c: ClDraft): PClause => ({ category: c.category, code: c.code, body: c.body, active: c.active, protective: c.protective });

type PolicyHead = Pick<WsHead, "totalCents" | "rail"> & { deadline?: DeadlineTerms | null };
export function policyInput(h: PolicyHead, ms: MsDraft[], cl: ClDraft[], providerPayable: boolean): PWorkspace {
  return { totalCents: h.totalCents, rail: h.rail, milestones: [...ms].sort(byDay).map(toP), clauses: cl.map(toPC), providerPayable, deadline: h.deadline ?? null };
}
export function evaluate(h: PolicyHead, ms: MsDraft[], cl: ClDraft[], providerPayable: boolean, tier: Tier): { violations: Violation[]; risk: { score: number; parts: Record<string, number> } } {
  const p = policyInput(h, ms, cl, providerPayable);
  return { violations: checkPolicy(p), risk: riskScore(p, tier) };
}

/** F2.10 the document both signatures bind to (canonical JSON, then SHA-256). Revision number is part of it. */
export function canonicalDoc(h: WsHead, revNo: number, ms: MsDraft[], cl: ClDraft[]) {
  return {
    kind: "paysettle.contract", v: 1, id: h.id, revNo, title: h.title, blueprint: h.blueprintCode, currency: h.currency,
    totalCents: h.totalCents, feeBps: h.feeBps, rail: h.rail, clientId: h.clientId, providerId: h.providerId, inviteEmail: h.inviteEmail,
    reviewTimeoutRule: h.reviewTimeoutRule,
    /* Present only when a deadline term is on, so contracts without one keep their hash */
    deadline: h.deadline ?? undefined,
    milestones: [...ms].sort((a, b) => a.seq - b.seq).map((m) => ({
      code: m.code, seq: m.seq, origin: m.origin, active: m.active, type: m.type, title: m.title, day: m.targetDay, bps: m.bps,
      amountCents: m.amountCents, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn, tranche: m.trancheIdx,
    })),
    clauses: [...cl].sort((a, b) => a.code.localeCompare(b.code)).map((c) => ({ code: c.code, category: c.category, title: c.title, body: c.body, active: c.active, protective: c.protective, linkedMilestone: c.linkedMilestone })),
  };
}
export type CanonicalDoc = ReturnType<typeof canonicalDoc>;

/** AST diff of a revision against revision 1: what was pruned, appended, changed (milestones and clauses). */
export interface Diff { pruned: string[]; restored: string[]; appended: string[]; changed: { code: string; fields: string[] }[]; clausesOff: string[]; clausesOn: string[]; clausesAdded: string[]; totalChanged: { from: number; to: number } | null; deadlineChanged?: boolean }
export function diffDocs(base: CanonicalDoc, cur: CanonicalDoc): Diff {
  const d: Diff = { pruned: [], restored: [], appended: [], changed: [], clausesOff: [], clausesOn: [], clausesAdded: [], totalChanged: null };
  if (JSON.stringify(base.deadline ?? null) !== JSON.stringify(cur.deadline ?? null)) d.deadlineChanged = true;
  const b = new Map(base.milestones.map((m) => [m.code, m]));
  for (const m of cur.milestones) {
    const o = b.get(m.code);
    if (!o) { d.appended.push(m.code); continue; }
    if (o.active && !m.active) d.pruned.push(m.code);
    if (!o.active && m.active) d.restored.push(m.code);
    const fields = (["day", "bps", "title", "type", "lockRule", "disputeRule"] as const).filter((k) => o[k] !== m[k]);
    if (fields.length) d.changed.push({ code: m.code, fields });
  }
  const bc = new Map(base.clauses.map((c) => [c.code, c]));
  for (const c of cur.clauses) {
    const o = bc.get(c.code);
    if (!o) { d.clausesAdded.push(c.code); continue; }
    if (o.active && !c.active) d.clausesOff.push(c.code);
    if (!o.active && c.active) d.clausesOn.push(c.code);
  }
  if (base.totalCents !== cur.totalCents) d.totalChanged = { from: base.totalCents, to: cur.totalCents };
  return d;
}

/** "15.25" → 1525 bps, without floating point. Returns null for anything that is not a plain percentage 0–100. */
export function parsePctToBps(s: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(s);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps <= BPS_FULL ? bps : null;
}
/** "6,000" or "6000.50" → cents, without floating point. */
export function parseDollarsToCents(s: string): number | null {
  const m = /^\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(s);
  if (!m) return null;
  return Number(m[1].replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

/** Next free custom code: C01, C02… (milestones) or CUS_01… (clauses). */
export function nextCode(prefix: string, taken: string[], width = 2): string {
  for (let n = 1; ; n++) { const c = `${prefix}${String(n).padStart(width, "0")}`; if (!taken.includes(c)) return c; }
}

/** Which milestones open at lock: in DAG mode those with no dependencies; otherwise the earliest step(s). */
export function openAtLock(ms: MsDraft[]): Set<string> {
  const act = ms.filter((m) => m.active).sort(byDay);
  if (!act.length) return new Set();
  const dag = act.some((m) => m.dependsOn.length > 0);
  const firstTranche = Math.min(...act.map((m) => m.trancheIdx));
  if (dag) return new Set(act.filter((m) => m.dependsOn.length === 0 && m.trancheIdx === firstTranche).map((m) => m.id));
  const first = act[0].targetDay;
  return new Set(act.filter((m) => m.targetDay === first).map((m) => m.id));
}

/**
 * The bonus pool per tranche index (the pool is funded with the tranche holds). Weighted by the largest bonus each
 * tranche's milestones can earn, so a pool that passes R12 covers every tranche.
 */
export function planPools(ms: MsDraft[], terms: DeadlineTerms | null): Map<number, number> {
  const pool = poolOf(terms);
  const plan = planTranches(ms);
  if (pool <= 0 || !plan.length) return new Map(plan.map((t) => [t.idx, 0]));
  const start = new Map(plan.map((t) => [t.idx, t.startDay]));
  const act = ms.filter((m) => m.active);
  return allocatePool(pool, plan.map((t) => ({
    idx: t.idx, amountCents: t.amountCents,
    maxBonusCents: act.filter((m) => m.trancheIdx === t.idx).reduce((s, m) => s + maxBonusFor(terms, { code: m.code, type: m.type, amountCents: m.amountCents, active: true, trancheIdx: m.trancheIdx, maxEarlyDays: dueOffsetDays(m.targetDay, m.trancheIdx, start.get(m.trancheIdx) ?? 1) }), 0),
  })));
}

/** One planned tranche per tranche index: amount = its payment milestones; days from its first to its last step. */
export function planTranches(ms: MsDraft[]): { idx: number; amountCents: number; startDay: number; endDay: number }[] {
  const act = ms.filter((m) => m.active).sort(byDay);
  const by = new Map<number, MsDraft[]>();
  for (const m of act) by.set(m.trancheIdx, [...(by.get(m.trancheIdx) ?? []), m]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([idx, list]) => ({
    idx, amountCents: list.filter((m) => m.type === "PAY").reduce((a, m) => a + m.amountCents, 0),
    startDay: idx === 1 ? 1 : list[0].targetDay, endDay: list[list.length - 1].targetDay,
  }));
}
