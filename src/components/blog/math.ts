/* P6 — the numbers behind the blog's live blocks, computed with the same libraries the app uses (pure, no I/O):
 *   moneyFlow       → src/lib/money (largest-remainder split, platform fee round-half-even on the released part only)
 *   trancheTimeline → src/lib/policy (trancheOf + RAIL_CAP_DAYS + watchdogPlan)
 *   caseStudy       → src/data/blueprints (the blueprint's real milestones) split with src/lib/money
 * Integer cents and basis points only.
 */
import { BPS_FULL, feeFor, splitByBps } from "@/lib/money";
import { RAIL_CAP_DAYS, trancheOf, watchdogPlan, type PMilestone, type Rail } from "@/lib/policy";
import { BLUEPRINTS, type BlueprintDef } from "@/data/blueprints";

export interface FlowParts {
  totalCents: number;
  releasedBps: number;
  refundedBps: number;
  heldBps: number;
  /** gross released to the provider (before the fee) */
  releasedCents: number;
  feeCents: number;
  providerNetCents: number;
  refundedCents: number;
  stillHeldCents: number;
}

/**
 * Splits a funded amount into released / returned / still held by basis points (largest remainder, so the three parts
 * always add up to the total to the cent). The fee is charged on the released part only; a refund carries no fee.
 * Shares are clamped so released + refunded never pass 100%.
 */
export function moneyFlowParts(totalCents: number, releasedBps: number, refundedBps: number, feeBps: number): FlowParts {
  const rel = clampBps(releasedBps);
  const ref = Math.min(clampBps(refundedBps), BPS_FULL - rel);
  const held = BPS_FULL - rel - ref;
  const [releasedCents, refundedCents, stillHeldCents] = splitByBps(totalCents, [rel, ref, held]);
  const feeCents = feeFor(releasedCents, feeBps);
  return { totalCents, releasedBps: rel, refundedBps: ref, heldBps: held, releasedCents, feeCents, providerNetCents: releasedCents - feeCents, refundedCents, stillHeldCents };
}

const clampBps = (n: number) => Math.max(0, Math.min(BPS_FULL, Math.round(Number.isFinite(n) ? n : 0)));

export const RAIL_NAME: Record<"A1" | "A2" | "B", string> = {
  A1: "Rail A1 · PayPal authorization, captured per milestone",
  A2: "Rail A2 · authorization with payouts (sandbox only)",
  B: "Rail B · delayed disbursement",
};
export const WATCH_LABEL: Record<ReturnType<typeof watchdogPlan>[number]["action"], string> = {
  REAUTHORIZE_IF_NEEDED: "Reauthorize if needed",
  WARN: "Warn both parties",
  OFFER_ROLLOVER: "Offer rollover",
  SETTLE: "Settle the tranche",
};

export interface TrancheWindow { idx: number; fromDay: number; toDay: number; days: number }
export interface TranchePlan { rail: "A1" | "A2" | "B"; capDays: number; totalDays: number; tranches: TrancheWindow[]; watchdog: { day: number; action: keyof typeof WATCH_LABEL; label: string }[] }

/**
 * How a job of N working days splits into hold windows on a rail. One step per day is fed to the policy library's
 * trancheOf(), the same function that tranches real contracts, so the windows here match what the app would plan.
 * The watchdog days are counted from the start of each hold.
 */
export function tranchePlan(totalDays: number, rail: "A1" | "A2" | "B"): TranchePlan {
  const n = Math.max(1, Math.min(365, Math.floor(totalDays)));
  const steps: PMilestone[] = Array.from({ length: n }, (_, i) => ({
    code: `D${i + 1}`, type: "PAY", day: i + 1, bps: 0, amountCents: 0, active: true,
    proof: { artifacts: [], criteria: [] }, lockRule: "", disputeRule: "", dependsOn: [],
  }));
  const idx = trancheOf(steps, rail as Rail);
  const tranches: TrancheWindow[] = [];
  idx.forEach((t, i) => {
    const day = i + 1;
    const cur = tranches[tranches.length - 1];
    if (!cur || cur.idx !== t) tranches.push({ idx: t, fromDay: day, toDay: day, days: 1 });
    else { cur.toDay = day; cur.days += 1; }
  });
  const watchdog = watchdogPlan(rail as Rail).map((w) => ({ day: w.day, action: w.action, label: WATCH_LABEL[w.action] }));
  return { rail, capDays: RAIL_CAP_DAYS[rail as Rail], totalDays: n, tranches, watchdog };
}

export interface CaseRow { code: string; title: string; type: "GATE" | "PAY"; day: number; bps: number; amountCents: number; tranche: number; criteria: string[] }
export interface CaseView { blueprint: BlueprintDef; rows: CaseRow[]; totalCents: number; payCount: number; gateCount: number; days: number; tranches: number }

export function findBlueprint(code: string): BlueprintDef | undefined {
  return BLUEPRINTS.find((b) => b.code === code);
}

/** The blueprint's milestones with each payment milestone's amount for `totalCents` (largest remainder, P6). */
export function caseStudyView(code: string, totalCents: number, rail: Rail = "A1"): CaseView | null {
  const bp = findBlueprint(code);
  if (!bp) return null;
  const ms = [...bp.milestones].sort((a, b) => a.day - b.day);
  const pay = ms.filter((m) => m.type === "PAY");
  const amounts = splitByBps(totalCents, pay.map((m) => m.bps));
  const amountOf = new Map(pay.map((m, i) => [m.code, amounts[i]]));
  const tr = trancheOf(ms.map((m) => ({ code: m.code, type: m.type, day: m.day, bps: m.bps, amountCents: 0, active: true, proof: { artifacts: [], criteria: [] }, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn ?? [] })), rail);
  const rows = ms.map((m, i) => ({ code: m.code, title: m.title, type: m.type, day: m.day, bps: m.type === "PAY" ? m.bps : 0, amountCents: amountOf.get(m.code) ?? 0, tranche: tr[i], criteria: m.proof.criteria ?? [] }));
  return { blueprint: bp, rows, totalCents, payCount: pay.length, gateCount: ms.length - pay.length, days: Math.max(...ms.map((m) => m.day)), tranches: Math.max(...tr) };
}
