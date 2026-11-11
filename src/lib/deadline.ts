/**
 * F3.07 F3.08 F3.11 P6 — deadline terms: a late deduction and an early-finish bonus (pure: no I/O, no clock).
 *
 * Both terms are OFF by default. When the parties switch one on, it becomes part of the signed contract (canonical hash),
 * so any change voids the signatures and both parties opt in by signing the new revision.
 *
 *  - LATE_DEDUCTION: rateBps per counted day late, after graceDays, capped at capBps of the milestone.
 *  - EARLY_BONUS:    rateBps per day early once at least minDaysEarly days early, capped at capBps of the milestone,
 *                    paid from a bonus pool the client funds with the tranche (pool ≤ 15% of the contract, never negative).
 *
 * Timing (the rule both parties sign):
 *  - due      = the time the tranche was held in PayPal + the milestone's day within that tranche;
 *  - measured = the provider's FIRST ACCEPTED submission (the evidence package the client approved), not the approval;
 *  - time under client review (submission → decision, for this milestone's earlier attempts and its prerequisites) never
 *    counts against the provider; remediation time does count;
 *  - excused days (an extension signed by both parties, or a mediator ruling) reduce the counted late days;
 *  - days are whole days, to the nearest day (12 hours or more counts as a day).
 *
 * Money (P6): integers only. deduction = round_half_even(gross × min(cap, rate × counted days) / 10,000), the bonus the
 * same way for early days and limited by the pool still unpaid. The platform fee is charged on what is released only:
 * released = gross − deduction + bonus. Rounding goes through src/lib/money (feeFor is round-half-even of amount × bps).
 */
import { z } from "zod";
import { BPS_FULL, feeFor, splitByBps } from "./money";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** Default terms: 50 bps/day after 1 grace day, cap 10%; bonus 25 bps/day from 2 days early, cap 1%. */
export const DEADLINE_DEFAULTS = {
  late: { rateBps: 50, graceDays: 1, capBps: 1000 },
  early: { rateBps: 25, minDaysEarly: 2, capBps: 100 },
} as const;
/** Policy limits checked by R11 and R12 (src/lib/policy.ts). */
export const DEADLINE_LIMITS = { lateCapMaxBps: 2000, minGraceDays: 1, capReachedByDay: 27, poolMaxBps: 1500 } as const;
/** Clause codes the two terms appear under in the contract text. */
export const DEADLINE_CLAUSES = { late: "LATE_DEDUCTION", early: "EARLY_BONUS" } as const;
export const DEADLINE_CLAUSE_CODES: readonly string[] = [DEADLINE_CLAUSES.late, DEADLINE_CLAUSES.early];

/** Ledger kinds added for deadline terms. BONUS_POOL funds the pool with the tranche; POOL_RETURN gives the unused pool back. */
export const DEADLINE_LEDGER_KINDS = ["LATE_DEDUCTION", "EARLY_BONUS", "BONUS_POOL", "POOL_RETURN"] as const;
export type DeadlineLedgerKind = (typeof DEADLINE_LEDGER_KINDS)[number];

/* ───────────── terms (validated input; wide ranges here, the policy rules R11/R12 flag what may not be signed) ───────────── */

const zScope = z.union([z.literal("ALL"), z.array(z.string().trim().min(1).max(40)).min(1).max(50)]);
export const zLateTerms = z.object({
  rateBps: z.number().int().min(1).max(BPS_FULL),
  graceDays: z.number().int().min(0).max(60),
  capBps: z.number().int().min(1).max(BPS_FULL),
  milestones: zScope,
});
export const zEarlyTerms = z.object({
  poolCents: z.number().int().min(0).max(100_000_000),
  rateBps: z.number().int().min(1).max(BPS_FULL),
  minDaysEarly: z.number().int().min(1).max(60),
  capBps: z.number().int().min(1).max(BPS_FULL),
  milestones: zScope,
});
export const zDeadlineTerms = z.object({ late: zLateTerms.nullable(), early: zEarlyTerms.nullable() });
export type LateTerms = z.infer<typeof zLateTerms>;
export type EarlyTerms = z.infer<typeof zEarlyTerms>;
export type DeadlineTerms = z.infer<typeof zDeadlineTerms>;
export type Scope = LateTerms["milestones"];

/** Canonical form: null when both terms are off; milestone lists sorted and de-duplicated (stable hash). */
export function normalizeTerms(t: DeadlineTerms | null | undefined): DeadlineTerms | null {
  if (!t || (!t.late && !t.early)) return null;
  const scope = (s: Scope): Scope => (s === "ALL" ? "ALL" : [...new Set(s)].sort());
  return {
    late: t.late ? { rateBps: t.late.rateBps, graceDays: t.late.graceDays, capBps: t.late.capBps, milestones: scope(t.late.milestones) } : null,
    early: t.early ? { poolCents: t.early.poolCents, rateBps: t.early.rateBps, minDaysEarly: t.early.minDaysEarly, capBps: t.early.capBps, milestones: scope(t.early.milestones) } : null,
  };
}
export const appliesTo = (scope: Scope, code: string) => scope === "ALL" || scope.includes(code);
export const poolOf = (t: DeadlineTerms | null | undefined) => t?.early?.poolCents ?? 0;

/* ───────────── timing ───────────── */

/** A milestone's day inside its tranche: tranche 1 counts from the hold; later tranches from their first contract day. */
export function dueOffsetDays(targetDay: number, trancheIdx: number, trancheStartDay: number): number {
  if (trancheIdx <= 1) return Math.max(0, targetDay);
  return Math.max(1, targetDay - trancheStartDay + 1);
}
export const dueAtMs = (heldAtMs: number, offsetDays: number) => heldAtMs + offsetDays * DAY_MS;

/** Whole days to the nearest day (half a day or more rounds up). Integer arithmetic on integer milliseconds. */
export function wholeDays(ms: number): number {
  if (!Number.isSafeInteger(ms)) throw new TypeError(`milliseconds must be a safe integer, got ${ms}`);
  if (ms <= 0) return 0;
  return Math.floor((ms + DAY_MS / 2) / DAY_MS);
}

export interface Interval { from: number; to: number }
/** Sorted, non-overlapping union of intervals (empty and inverted ones dropped). */
export function mergeIntervals(xs: Interval[]): Interval[] {
  const s = xs.filter((x) => x.to > x.from).sort((a, b) => a.from - b.from);
  const out: Interval[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.from <= last.to) last.to = Math.max(last.to, x.to);
    else out.push({ ...x });
  }
  return out;
}
/** Length of the part of `xs` (merged first) inside [from, to]. */
export function overlapMs(xs: Interval[], from: number, to: number): number {
  if (to <= from) return 0;
  return mergeIntervals(xs).reduce((s, x) => s + Math.max(0, Math.min(x.to, to) - Math.max(x.from, from)), 0);
}

export interface DeliveryFacts {
  /** When the milestone was due (virtual contract clock, epoch ms). */
  dueAt: number;
  /** When the accepted evidence package was submitted (epoch ms). */
  acceptedAt: number;
  /** Periods the client had evidence in review (this milestone's earlier attempts and its prerequisites). */
  review: Interval[];
  /** Days excused by an extension both parties signed, or by a mediator ruling. */
  excusedDays: number;
}
export interface Lateness {
  dueAt: number; acceptedAt: number;
  /** acceptedAt − dueAt before any exclusion (negative when early). */
  rawMs: number;
  /** Client review time inside [due, accepted] that was not counted. */
  reviewExcludedMs: number;
  daysLate: number; daysEarly: number; excusedDays: number;
}

export function measure(f: DeliveryFacts): Lateness {
  const rawMs = f.acceptedAt - f.dueAt;
  const excused = Math.max(0, Math.trunc(f.excusedDays || 0));
  if (rawMs > 0) {
    const reviewExcludedMs = overlapMs(f.review, f.dueAt, f.acceptedAt);
    return { dueAt: f.dueAt, acceptedAt: f.acceptedAt, rawMs, reviewExcludedMs, daysLate: wholeDays(rawMs - reviewExcludedMs), daysEarly: 0, excusedDays: excused };
  }
  return { dueAt: f.dueAt, acceptedAt: f.acceptedAt, rawMs, reviewExcludedMs: 0, daysLate: 0, daysEarly: wholeDays(-rawMs), excusedDays: excused };
}

/* ───────────── money ───────────── */

export type Timing = "ON_TIME" | "LATE" | "EARLY";
export interface Adjustment {
  timing: Timing;
  daysLate: number; daysEarly: number; excusedDays: number; graceDays: number;
  /** Late days that cost money: daysLate − excused − grace (never below zero). */
  countedLateDays: number;
  /** Early days that earn the bonus (0 below minDaysEarly). */
  countedEarlyDays: number;
  deductionBps: number; deductionCents: number;
  bonusBps: number; bonusCents: number;
  /** The bonus the terms allow before the pool limit. */
  bonusWantedCents: number;
  limitedByPool: boolean;
}
export const NO_ADJUSTMENT: Adjustment = { timing: "ON_TIME", daysLate: 0, daysEarly: 0, excusedDays: 0, graceDays: 0, countedLateDays: 0, countedEarlyDays: 0, deductionBps: 0, deductionCents: 0, bonusBps: 0, bonusCents: 0, bonusWantedCents: 0, limitedByPool: false };

/** Basis points of an amount, rounded half to even (the same rounding as the platform fee). */
export const bpsOf = (amountCents: number, bps: number) => feeFor(amountCents, bps);

export function adjustmentFor(terms: DeadlineTerms | null, m: { code: string; type: "GATE" | "PAY"; amountCents: number }, l: Pick<Lateness, "daysLate" | "daysEarly" | "excusedDays">, poolRemainingCents: number): Adjustment {
  const timing: Timing = l.daysLate > 0 ? "LATE" : l.daysEarly > 0 ? "EARLY" : "ON_TIME";
  const base: Adjustment = { ...NO_ADJUSTMENT, timing, daysLate: l.daysLate, daysEarly: l.daysEarly, excusedDays: l.excusedDays };
  if (!terms || m.type !== "PAY" || m.amountCents <= 0) return base;
  if (terms.late && l.daysLate > 0 && appliesTo(terms.late.milestones, m.code)) {
    const counted = Math.max(0, l.daysLate - l.excusedDays - terms.late.graceDays);
    const bps = Math.min(terms.late.capBps, terms.late.rateBps * counted, BPS_FULL);
    return { ...base, graceDays: terms.late.graceDays, countedLateDays: counted, deductionBps: bps, deductionCents: bpsOf(m.amountCents, bps) };
  }
  if (terms.early && l.daysEarly >= terms.early.minDaysEarly && appliesTo(terms.early.milestones, m.code)) {
    const bps = Math.min(terms.early.capBps, terms.early.rateBps * l.daysEarly, BPS_FULL);
    const wanted = bpsOf(m.amountCents, bps);
    const left = Math.max(0, poolRemainingCents);
    const bonus = Math.min(wanted, left);
    return { ...base, countedEarlyDays: l.daysEarly, bonusBps: bps, bonusWantedCents: wanted, bonusCents: bonus, limitedByPool: bonus < wanted };
  }
  return base;
}

/** What one milestone release moves: released = gross − deduction + bonus; the fee is on the released amount only. */
export function releaseSplit(grossCents: number, deductionCents: number, bonusCents: number, feeBps: number): { releasedCents: number; feeCents: number; netCents: number } {
  for (const [k, v] of Object.entries({ grossCents, deductionCents, bonusCents })) if (!Number.isSafeInteger(v) || v < 0) throw new TypeError(`${k} must be a non-negative safe integer, got ${v}`);
  if (deductionCents > grossCents) throw new RangeError("a deduction cannot exceed the milestone amount");
  const releasedCents = grossCents - deductionCents + bonusCents;
  const feeCents = feeFor(releasedCents, feeBps);
  return { releasedCents, feeCents, netCents: releasedCents - feeCents };
}

/** "On time" · "2 days late" · "3 days early" (plain words for badges and receipts). */
export function timingLabel(a: Pick<Adjustment, "timing" | "daysLate" | "daysEarly">): string {
  const d = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (a.timing === "LATE") return `${d(a.daysLate)} late`;
  if (a.timing === "EARLY") return `${d(a.daysEarly)} early`;
  return "On time";
}

/* ───────────── planning: largest possible bonus, pool per tranche ───────────── */

export interface PlanMilestone { code: string; type: "GATE" | "PAY"; amountCents: number; active: boolean; trancheIdx: number; maxEarlyDays: number }
/** The largest bonus a milestone can earn (delivered on the first day of its tranche). */
export function maxBonusFor(terms: DeadlineTerms | null, m: PlanMilestone): number {
  const e = terms?.early;
  if (!e || !m.active || m.type !== "PAY" || m.amountCents <= 0 || !appliesTo(e.milestones, m.code) || m.maxEarlyDays < e.minDaysEarly) return 0;
  return bpsOf(m.amountCents, Math.min(e.capBps, e.rateBps * m.maxEarlyDays, BPS_FULL));
}
export const maxBonusCents = (terms: DeadlineTerms | null, ms: PlanMilestone[]) => ms.reduce((s, m) => s + maxBonusFor(terms, m), 0);

/**
 * Splits the pool over the tranches it is funded with. Weighted by each tranche's largest possible bonus, so a pool that
 * covers the contract's largest bonus covers each tranche's too; by tranche amount when no milestone can earn a bonus.
 */
export function allocatePool(poolCents: number, tranches: { idx: number; amountCents: number; maxBonusCents: number }[]): Map<number, number> {
  const out = new Map<number, number>();
  if (!tranches.length) return out;
  const byBonus = tranches.reduce((s, t) => s + t.maxBonusCents, 0) > 0;
  const shares = splitByBps(Math.max(0, poolCents), tranches.map((t) => (byBonus ? t.maxBonusCents : t.amountCents)));
  tranches.forEach((t, i) => out.set(t.idx, shares[i]));
  return out;
}

/* ───────────── human-readable terms (clause text, previews) ───────────── */

const pctText = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
const usd = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);
const scopeText = (s: Scope) => (s === "ALL" ? "each payment milestone" : `milestone${s.length === 1 ? "" : "s"} ${s.join(", ")}`);

export function lateClauseText(t: LateTerms): string {
  return `For ${scopeText(t.milestones)}, each full day the accepted evidence arrives after the due date, beyond ${t.graceDays} grace day${t.graceDays === 1 ? "" : "s"}, reduces the release by ${pctText(t.rateBps)} of the milestone amount, up to ${pctText(t.capBps)}. Time the client spends reviewing never counts; days excused by a signed extension or a mediator ruling do not count. The deducted amount goes back to the client.`;
}
export function earlyClauseText(t: EarlyTerms): string {
  return `The client funds a bonus pool of ${usd(t.poolCents)} with the tranche hold. For ${scopeText(t.milestones)}, accepted evidence that arrives ${t.minDaysEarly} or more full days before the due date adds ${pctText(t.rateBps)} of the milestone amount per day early, up to ${pctText(t.capBps)}, while the pool lasts. Whatever the pool does not pay goes back to the client when the tranche closes.`;
}

/* ───────────── three-way reconciliation view (F5.01) ───────────── */

/**
 * Expresses the deadline-terms ledger kinds in the five base movement kinds the three-way reconciliation compares, so the planes
 * stay comparable: the bonus pool is one more line of the contract funded with the tranche (BONUS_POOL → HOLD, under the
 * same PayPal authorization); EARLY_BONUS is an internal move from the pool into the release (no PayPal movement of its
 * own: it is inside the capture); LATE_DEDUCTION and POOL_RETURN are returns to the client (VOID on Rail A — recorded,
 * then voided with the remainder — or REFUND on Rail B). A tranche with no pool and no deadline-terms entries is returned as is.
 */
export function withDeadlineAdjustments<T extends {
  tranche: { amountCents: number };
  milestones: { amountCents: number; state: string; type: string; active: boolean }[];
  ledger: { type: string; amountCents: number; paypalRef: string | null; milestoneId: string | null; at: Date }[];
}>(i: T, bonusPoolCents = 0): T {
  const kinds = DEADLINE_LEDGER_KINDS as readonly string[];
  if (!(bonusPoolCents > 0) && !i.ledger.some((e) => kinds.includes(e.type))) return i;
  const sum = (k: string) => i.ledger.filter((e) => e.type === k).reduce((s, e) => s + e.amountCents, 0);
  const paid = sum("EARLY_BONUS"), returned = sum("POOL_RETURN");
  const asReturn = (ref: string | null) => (!ref || ref.startsWith("void:") || ref.startsWith("recorded:") ? "VOID" : "REFUND");
  const ledger = i.ledger.flatMap((e) => {
    if (e.type === "BONUS_POOL") return [{ ...e, type: "HOLD" }];
    if (e.type === "EARLY_BONUS") return [];
    if (e.type === "LATE_DEDUCTION" || e.type === "POOL_RETURN") return [{ ...e, type: asReturn(e.paypalRef) }];
    return [e];
  });
  const pool = Math.max(0, bonusPoolCents);
  const poolLines = pool > 0 ? [
    { amountCents: paid + returned, state: "RELEASED", type: "PAY", active: true },
    { amountCents: pool - paid - returned, state: "OPEN", type: "PAY", active: true },
  ] : [];
  return {
    ...i,
    tranche: { ...i.tranche, amountCents: i.tranche.amountCents + pool },
    milestones: [...i.milestones, ...poolLines] as T["milestones"],
    ledger: ledger as T["ledger"],
  };
}
