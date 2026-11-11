/**
 * F3.07 F3.08 F3.11 P2 P4 P6 — deadline adjustments for milestone releases (money module).
 *
 * Loads the facts the signed deadline terms are measured on, all on the contract's virtual clock:
 *   due      = tranche held at + the milestone's day in that tranche (src/lib/deadline dueOffsetDays)
 *   accepted = the provider's submission of the evidence package the client approved (the first accepted one)
 *   review   = periods the client had this milestone's earlier attempts, or its prerequisites, in review (not counted)
 *   excused  = days from extensions both parties signed and from mediator rulings (deadline_extensions)
 * then fixes the adjustment in release_adjustments BEFORE PayPal is called (P2): a retry moves exactly the stored amounts.
 * The bonus is reserved from the tranche's pool under a row lock, so two releases never spend the same pool cents.
 *
 * Virtual times: the evidence module writes the virtual review deadline into its audit rows (submit: reviewDueAt = now + 48 h;
 * fix request: fixDueAt = now + 72 h), which gives the exact virtual moment. Other moments are real timestamps shifted by
 * the playground offset that was in force at that moment (from the sandbox.time_travel audit rows). Outside sandbox mode
 * the offset is always zero.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { auditChain, evidencePackages, tranches, workspaces, wsMilestones } from "@/db/schema";
import { evidenceReviews } from "@/db/schema-evidence";
import { deadlineExtensions, releaseAdjustments } from "@/db/schema-money";
import { audit } from "@/lib/audit";
import { HOUR, sandboxMode } from "@/lib/clock";
import {
  NO_ADJUSTMENT, adjustmentFor, dueAtMs, dueOffsetDays, measure, normalizeTerms, type Adjustment, type DeadlineTerms, type Interval, type Lateness,
} from "@/lib/deadline";
import { idemKey, newId } from "@/lib/ids";
import { offsetFor, workspaceNow } from "../clock";
import type { Actor } from "../types";
import { auditActor, type MilestoneRow, type TrancheRow, type WorkspaceRow } from "./internal";

/** The evidence module's review and fix windows (src/server/evidence REVIEW_HOURS / FIX_WINDOW_HOURS; a test keeps them equal). */
export const EVIDENCE_REVIEW_HOURS = 48;
export const EVIDENCE_FIX_WINDOW_HOURS = 72;
const DECISIONS = ["REQUEST_FIX", "THIRD_REJECTION", "APPROVE", "DEEMED_APPROVED"];

export type AdjustmentRow = typeof releaseAdjustments.$inferSelect;

/** real time → the workspace's virtual time at that moment (offset history from the playground's time-travel audit rows). */
export async function virtualClock(workspaceId: string): Promise<(real: Date) => Date> {
  if (!sandboxMode()) return (d) => d;
  const travels = await db.select({ at: auditChain.at, detail: auditChain.detail }).from(auditChain)
    .where(and(eq(auditChain.action, "sandbox.time_travel"), sql`${auditChain.detail}->>'workspaceId' = ${workspaceId}`)).orderBy(asc(auditChain.seq));
  if (!travels.length) { const off = await offsetFor(workspaceId); return (d) => new Date(d.getTime() + off * HOUR); }
  return (d) => {
    let off = Number(travels[0].detail.from ?? 0);
    for (const t of travels) { if (t.at.getTime() <= d.getTime()) off = Number(t.detail.to ?? off); else break; }
    return new Date(d.getTime() + off * HOUR);
  };
}

export interface DeadlineFacts {
  terms: DeadlineTerms;
  milestone: Pick<MilestoneRow, "id" | "code" | "title" | "type" | "amountCents" | "targetDay" | "trancheIdx" | "state">;
  /** null while the tranche is not held yet (the clock starts with the hold). */
  dueAt: Date | null;
  dueOffsetDays: number;
  /** The accepted submission; for a preview, the latest submission or (nothing submitted yet) now. */
  acceptedAt: Date | null;
  basis: "ACCEPTED" | "IN_REVIEW" | "IF_DELIVERED_NOW" | "NOT_HELD";
  packageId: string | null;
  review: Interval[];
  excusedDays: number;
  lateness: Lateness | null;
  adjustment: Adjustment;
  poolCents: number;
  poolLeftCents: number;
  /** The stored adjustment once the release ran (amounts never change after that). */
  stored: AdjustmentRow | null;
}

async function loadTerms(workspaceId: string): Promise<DeadlineTerms | null> {
  const [w] = await db.select({ t: workspaces.deadlineTerms }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return normalizeTerms(w?.t ?? null);
}

/** Pool cents of the tranche not yet reserved by another milestone's adjustment. */
async function poolLeft(q: Tx | typeof db, t: Pick<TrancheRow, "id" | "bonusPoolCents">, exceptMilestone?: string): Promise<number> {
  const [r] = await q.select({ s: sql<string>`coalesce(sum(${releaseAdjustments.bonusCents}), 0)` }).from(releaseAdjustments)
    .where(and(eq(releaseAdjustments.trancheId, t.id), exceptMilestone ? ne(releaseAdjustments.milestoneId, exceptMilestone) : undefined));
  return Math.max(0, (t.bonusPoolCents ?? 0) - Number(r?.s ?? 0));
}

/** The milestones whose review time also holds this one up: DAG prerequisites (transitively), else every earlier-dated step. */
function prerequisites(m: Pick<MilestoneRow, "code" | "targetDay" | "id">, all: Pick<MilestoneRow, "id" | "code" | "targetDay" | "dependsOn" | "active">[]): string[] {
  const act = all.filter((x) => x.active);
  if (act.some((x) => x.dependsOn.length > 0)) {
    const byCode = new Map(act.map((x) => [x.code, x]));
    const need = new Set<string>();
    const walk = (c: string) => { for (const d of byCode.get(c)?.dependsOn ?? []) { const p = byCode.get(d); if (p && !need.has(p.id)) { need.add(p.id); walk(p.code); } } };
    walk(m.code);
    return [...need];
  }
  return act.filter((x) => x.id !== m.id && x.targetDay < m.targetDay).map((x) => x.id);
}

/**
 * The deadline facts and adjustment for one milestone (null when the contract has no deadline terms). Read-only.
 * `now` is the virtual now used for previews; it defaults to the workspace's current virtual time.
 */
export async function deadlineFacts(milestoneId: string, opts: { now?: Date } = {}): Promise<DeadlineFacts | null> {
  const [m] = await db.select().from(wsMilestones).where(eq(wsMilestones.id, milestoneId)).limit(1);
  if (!m) return null;
  const terms = await loadTerms(m.workspaceId);
  if (!terms) return null;
  const [stored] = await db.select().from(releaseAdjustments).where(eq(releaseAdjustments.milestoneId, m.id)).limit(1);
  const [t] = await db.select().from(tranches).where(and(eq(tranches.workspaceId, m.workspaceId), eq(tranches.idx, m.trancheIdx))).limit(1);
  const offsetDays = dueOffsetDays(m.targetDay, m.trancheIdx, t?.startDay ?? 1);
  const base = { terms, milestone: m, dueOffsetDays: offsetDays, poolCents: t?.bonusPoolCents ?? 0, stored: stored ?? null };
  if (stored) {
    const adj: Adjustment = {
      ...NO_ADJUSTMENT, timing: stored.timing, daysLate: stored.daysLate, daysEarly: stored.daysEarly, excusedDays: stored.excusedDays,
      graceDays: terms.late?.graceDays ?? 0, countedLateDays: stored.timing === "LATE" ? stored.countedDays : 0, countedEarlyDays: stored.timing === "EARLY" ? stored.countedDays : 0,
      deductionCents: stored.deductionCents, bonusCents: stored.bonusCents, deductionBps: Number(stored.detail.deductionBps ?? 0), bonusBps: Number(stored.detail.bonusBps ?? 0),
      bonusWantedCents: Number(stored.detail.bonusWantedCents ?? stored.bonusCents), limitedByPool: Boolean(stored.detail.limitedByPool),
    };
    const lat: Lateness = { dueAt: stored.dueAt.getTime(), acceptedAt: stored.acceptedAt.getTime(), rawMs: stored.acceptedAt.getTime() - stored.dueAt.getTime(), reviewExcludedMs: stored.reviewExcludedMs, daysLate: stored.daysLate, daysEarly: stored.daysEarly, excusedDays: stored.excusedDays };
    return { ...base, dueAt: stored.dueAt, acceptedAt: stored.acceptedAt, basis: "ACCEPTED", packageId: stored.packageId, review: [], excusedDays: stored.excusedDays, lateness: lat, adjustment: adj, poolLeftCents: t ? await poolLeft(db, t) : 0 };
  }
  const excusedDays = await excusedDaysFor(m.id);
  const left = t ? await poolLeft(db, t, m.id) : 0;
  if (!t?.heldAt) return { ...base, dueAt: null, acceptedAt: null, basis: "NOT_HELD", packageId: null, review: [], excusedDays, lateness: null, adjustment: { ...NO_ADJUSTMENT, excusedDays }, poolLeftCents: left };

  const clock = await virtualClock(m.workspaceId);
  const now = opts.now ?? (await workspaceNow(m.workspaceId));
  const all = await db.select({ id: wsMilestones.id, code: wsMilestones.code, targetDay: wsMilestones.targetDay, dependsOn: wsMilestones.dependsOn, active: wsMilestones.active }).from(wsMilestones).where(eq(wsMilestones.workspaceId, m.workspaceId));
  const ids = [m.id, ...prerequisites(m, all)];
  const pkgs = await db.select({ id: evidencePackages.id, milestoneId: evidencePackages.milestoneId, attempt: evidencePackages.attempt, state: evidencePackages.state, createdAt: evidencePackages.createdAt }).from(evidencePackages).where(inArray(evidencePackages.milestoneId, ids)).orderBy(asc(evidencePackages.attempt));
  const reviews = await db.select({ packageId: evidenceReviews.packageId, decision: evidenceReviews.decision, createdAt: evidenceReviews.createdAt }).from(evidenceReviews).where(inArray(evidenceReviews.milestoneId, ids));
  const trail = await db.select({ action: auditChain.action, detail: auditChain.detail }).from(auditChain).where(and(inArray(auditChain.target, ids), inArray(auditChain.action, ["evidence.submit", "evidence.request_fix"])));
  const exact = (action: string, pkgId: string, field: string, hours: number): Date | null => {
    const row = trail.find((x) => x.action === action && x.detail.packageId === pkgId && typeof x.detail[field] === "string");
    const at = row ? Date.parse(String(row.detail[field])) : NaN;
    return Number.isFinite(at) ? new Date(at - hours * HOUR) : null;
  };
  const submittedAt = (p: (typeof pkgs)[number]) => exact("evidence.submit", p.id, "reviewDueAt", EVIDENCE_REVIEW_HOURS) ?? clock(p.createdAt);
  const decidedAt = (p: (typeof pkgs)[number]): Date | null => {
    const rs = reviews.filter((r) => r.packageId === p.id && DECISIONS.includes(r.decision)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (!rs.length) return null;
    const r = rs[0];
    return (r.decision === "REQUEST_FIX" ? exact("evidence.request_fix", p.id, "fixDueAt", EVIDENCE_FIX_WINDOW_HOURS) : null) ?? clock(r.createdAt);
  };
  const review: Interval[] = pkgs.map((p) => ({ from: submittedAt(p).getTime(), to: (decidedAt(p) ?? now).getTime() }));

  const mine = pkgs.filter((p) => p.milestoneId === m.id);
  const approvedIds = new Set(reviews.filter((r) => r.decision === "APPROVE" || r.decision === "DEEMED_APPROVED").map((r) => r.packageId));
  const accepted = mine.find((p) => p.state === "APPROVED" || approvedIds.has(p.id)) ?? null;
  const pending = [...mine].reverse().find((p) => p.state === "SUBMITTED") ?? null;
  const pick = accepted ?? pending;
  const acceptedAt = pick ? submittedAt(pick) : now;
  const basis: DeadlineFacts["basis"] = accepted ? "ACCEPTED" : pending ? "IN_REVIEW" : "IF_DELIVERED_NOW";
  const dueAt = new Date(dueAtMs(t.heldAt.getTime(), offsetDays));
  const lateness = measure({ dueAt: dueAt.getTime(), acceptedAt: acceptedAt.getTime(), review: review.filter((r) => !pick || r.from < acceptedAt.getTime()), excusedDays });
  const adjustment = adjustmentFor(terms, m, lateness, left);
  return { ...base, dueAt, acceptedAt, basis, packageId: pick?.id ?? null, review, excusedDays, lateness, adjustment, poolLeftCents: left };
}

export async function excusedDaysFor(milestoneId: string): Promise<number> {
  const [r] = await db.select({ s: sql<string>`coalesce(sum(${deadlineExtensions.days}), 0)` }).from(deadlineExtensions)
    .where(and(eq(deadlineExtensions.milestoneId, milestoneId), eq(deadlineExtensions.state, "ACCEPTED")));
  return Number(r?.s ?? 0);
}

/**
 * Fixes the adjustment of a milestone release (once; later calls return the stored row). Null when the contract has no
 * deadline terms or the milestone is a gate. The bonus is reserved from the tranche pool under the tranche row lock.
 */
export async function prepareAdjustment(a: Actor | null, m: MilestoneRow, w: WorkspaceRow, t: TrancheRow, releaseId: string): Promise<AdjustmentRow | null> {
  const [have] = await db.select().from(releaseAdjustments).where(eq(releaseAdjustments.milestoneId, m.id)).limit(1);
  if (have) return have;
  const terms = normalizeTerms(w.deadlineTerms);
  if (!terms || m.type !== "PAY" || m.amountCents <= 0) return null;
  const facts = await deadlineFacts(m.id);
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(tranches).where(eq(tranches.id, t.id)).limit(1).for("update");
    const [again] = await tx.select().from(releaseAdjustments).where(eq(releaseAdjustments.milestoneId, m.id)).limit(1);
    if (again) return again;
    const left = await poolLeft(tx, cur, m.id);
    const ok = facts && facts.lateness && facts.basis === "ACCEPTED";
    const adj = ok ? adjustmentFor(terms, m, facts.lateness!, left) : { ...NO_ADJUSTMENT };
    const released = m.amountCents - adj.deductionCents + adj.bonusCents;
    const counted = adj.timing === "LATE" ? adj.countedLateDays : adj.timing === "EARLY" ? adj.countedEarlyDays : 0;
    const now = await workspaceNow(w.id);
    const [row] = await tx.insert(releaseAdjustments).values({
      id: newId("adj"), milestoneId: m.id, trancheId: cur.id, workspaceId: w.id, releaseId, baseCents: m.amountCents,
      deductionCents: adj.deductionCents, bonusCents: adj.bonusCents, releasedCents: released, timing: adj.timing,
      daysLate: adj.daysLate, daysEarly: adj.daysEarly, excusedDays: adj.excusedDays, countedDays: counted, reviewExcludedMs: facts?.lateness?.reviewExcludedMs ?? 0,
      dueAt: facts?.dueAt ?? now, acceptedAt: facts?.acceptedAt ?? now, packageId: facts?.packageId ?? null,
      terms: terms as unknown as Record<string, unknown>,
      detail: { deductionBps: adj.deductionBps, bonusBps: adj.bonusBps, bonusWantedCents: adj.bonusWantedCents, limitedByPool: adj.limitedByPool, poolLeftBefore: left, graceDays: adj.graceDays, ...(ok ? {} : { note: "No accepted evidence package with a submission time was found; no adjustment applies." }) },
      deductionIdemKey: adj.deductionCents > 0 ? idemKey("late_deduction", m.id) : null,
      deductionStatus: adj.deductionCents > 0 ? "PENDING" : "NONE",
    }).returning();
    await audit(tx, auditActor(a), "money.deadline_adjustment", m.id, {
      trancheId: cur.id, releaseId, timing: adj.timing, daysLate: adj.daysLate, daysEarly: adj.daysEarly, excusedDays: adj.excusedDays, countedDays: counted,
      baseCents: m.amountCents, deductionCents: adj.deductionCents, bonusCents: adj.bonusCents, releasedCents: released, poolLeftBefore: left,
      dueAt: row.dueAt.toISOString(), acceptedAt: row.acceptedAt.toISOString(), deductionIdemKey: row.deductionIdemKey,
    });
    return row;
  });
}

/** Stored adjustments for a set of milestones (receipts, payouts, milestone page). */
export async function adjustmentsFor(milestoneIds: string[]): Promise<Map<string, AdjustmentRow>> {
  if (!milestoneIds.length) return new Map();
  const rows = await db.select().from(releaseAdjustments).where(inArray(releaseAdjustments.milestoneId, milestoneIds));
  return new Map(rows.map((r) => [r.milestoneId, r]));
}
