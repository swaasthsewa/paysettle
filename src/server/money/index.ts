/**
 * Money: funding, confirmation, releases, refunds, voids, ledger, hold-expiry watchdog.
 * Requirements: F3.01 (order from the sealed contract), F3.02 (hold verification), F3.07 (exactly-once release),
 * F3.08 (release executor with retries), F3.10 (watchdog and rollover), F3.11 (double-entry ledger), F4.08 (refund/void legs).
 * Constitution: P1 every movement through a rail; P2 deterministic idempotency keys stored before the call;
 * P4 every release needs a signed approval or verdict; P6 integer cents; ledger invariant per tranche:
 * held + bonuses = Σ released (gross) + Σ returned + remaining, and for the bonus pool: pool = paid + returned + left ≥ 0.
 * Deadline terms: the client funds a bonus pool with the tranche (same authorization / capture); a milestone release
 * moves gross − late deduction + early bonus, fixed before PayPal is called (./deadline.ts); the fee is charged on what is
 * released only; the deduction goes back to the client (Rail A: stays authorized and is voided with the remainder; Rail B:
 * refunded), and the unused pool goes back when the tranche closes.
 */
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { disputes, ledgerEntries, refunds, releases, tranches, verdicts, wsMilestones } from "@/db/schema";
import { evidenceReviews } from "@/db/schema-evidence";
import { audit } from "@/lib/audit";
import { DAY, HOUR, daysBetween, sandboxMode } from "@/lib/clock";
import { milestoneMachine, trancheMachine } from "@/lib/fsm";
import { idemKey, newId } from "@/lib/ids";
import { feeFor, formatCents } from "@/lib/money";
import { releaseSplit } from "@/lib/deadline";
import { releaseAdjustments } from "@/db/schema-money";
import { changeOrders, type ChangeOrderReturn } from "@/db/schema-amend";
import { watchdogPlan, type Rail as PolicyRail } from "@/lib/policy";
import { RailError, type HoldRef, type HoldState } from "@/lib/rails";
import { canWrite } from "@/lib/rbac";
import { offsetFor, workspaceNow } from "../clock";
import { DomainError, type Actor } from "../types";
import {
  FEE_ACCOUNT, FUNDED, SETTLE_DAY, SYSTEM, auditActor, balanceOf, claimMark, clientAccount, fundedAmount, hasMark, holdAccount,
  isRailB, loadMilestone, loadTranche, loadWorkspace, movedByMilestone, notify, openReady, payeeOf, poolAccount, providerAccount, railMessage,
  railOf, trancheFor, trancheMilestones, unclaimMark, withRetry, type MilestoneRow, type TrancheRow, type WorkspaceRow,
} from "./internal";
import { prepareAdjustment, type AdjustmentRow } from "./deadline";

type MState = Parameters<typeof milestoneMachine.next>[0];
type TState = Parameters<typeof trancheMachine.next>[0];
type TEvent = Parameters<typeof trancheMachine.next>[1];
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const stepTranche = (from: string, ev: TEvent) => (trancheMachine.allows(from as TState, ev) ? trancheMachine.next(from as TState, ev) : from);

/* ───────────────────────── fund (F3.01) ───────────────────────── */

export async function fundTranche(a: Actor, trancheId: string): Promise<{ approveUrl: string }> {
  const t = await loadTranche(db, trancheId);
  const w = await loadWorkspace(db, t.workspaceId);
  if (a.id !== w.clientId || !canWrite(a.role, "hold.fund")) throw new DomainError("FORBIDDEN", "Only the client of this contract can fund its tranches.");
  if (w.state !== "LOCKED") throw new DomainError("NOT_LOCKED", "Both parties must sign and the contract must be locked before money is held.");
  if (t.state === "AWAITING_APPROVAL" && t.approveUrl) return { approveUrl: t.approveUrl };
  if (t.state !== "PLANNED") throw new DomainError("TRANCHE_STATE", `Tranche ${t.idx} is ${t.state.toLowerCase().replace(/_/g, " ")}; it cannot be funded again.`);
  const ms = (await trancheMilestones(db, w.id, t.idx)).filter((m) => m.type === "PAY");
  const sum = ms.reduce((s, m) => s + m.amountCents, 0);
  if (sum !== t.amountCents || t.amountCents <= 0) throw new DomainError("AMOUNT_MISMATCH", `Tranche ${t.idx} is ${formatCents(t.amountCents, w.currency)} but its payment milestones add up to ${formatCents(sum, w.currency)}.`);
  const payee = await payeeOf(db, w.providerId);
  const rail = await railOf(t);
  if (rail.id !== "MOCK" && (!payee || !payee.receivable || !payee.emailConfirmed)) throw new DomainError("PAYEE_NOT_READY", "The provider's PayPal business account is not linked or cannot receive payments yet, so checkout is halted.");
  const key = idemKey("fund", t.id);
  const total = fundedAmount(t); // the bonus pool is funded with the tranche (one authorization / capture)
  await audit(db, auditActor(a), "money.fund_requested", t.id, { idemKey: key, rail: rail.id, amountCents: t.amountCents, bonusPoolCents: t.bonusPoolCents, fundCents: total });
  let ref: HoldRef;
  try {
    ref = await withRetry(() => rail.fund({
      trancheId: t.id, amountCents: total, currency: w.currency, payeeEmail: payee?.email ?? undefined, payeeMerchantId: payee?.merchantId ?? undefined,
      description: t.bonusPoolCents > 0 ? `${w.title} · tranche ${t.idx} incl. bonus pool` : `${w.title} · tranche ${t.idx}`, returnUrl: `${appUrl()}/api/paypal/return?tranche=${encodeURIComponent(t.id)}`,
      cancelUrl: `${appUrl()}/api/paypal/cancel?tranche=${encodeURIComponent(t.id)}`, feeCents: ms.reduce((s, m) => s + feeFor(m.amountCents, w.feeBps), 0), idemKey: key,
    }));
  } catch (e) {
    await audit(db, auditActor(a), "money.fund_failed", t.id, { idemKey: key, error: railMessage(e) });
    if (e instanceof RailError) throw new DomainError(e.kind === "PAYEE_PROBLEM" ? "PAYEE_PROBLEM" : "RAIL_ERROR", railMessage(e));
    throw e;
  }
  await db.transaction(async (tx) => {
    const cur = await loadTranche(tx, t.id, true);
    if (cur.state !== "PLANNED") return;
    await tx.update(tranches).set({ paypalOrderId: ref.orderId, approveUrl: ref.approveUrl, state: trancheMachine.next("PLANNED", "fund") }).where(eq(tranches.id, t.id));
    await audit(tx, auditActor(a), "money.fund", t.id, { orderId: ref.orderId, rail: rail.id, amountCents: t.amountCents, bonusPoolCents: t.bonusPoolCents, idemKey: key });
  });
  return { approveUrl: ref.approveUrl };
}

/* ───────────────────────── confirm (F3.02) ───────────────────────── */

export async function confirmTranche(a: Actor | null, trancheId: string, orderId?: string): Promise<void> {
  const t = await loadTranche(db, trancheId);
  if ((FUNDED as readonly string[]).includes(t.state) || t.state === "CLOSED") return; // already confirmed (return page and webhook both call)
  if (t.state !== "AWAITING_APPROVAL" || !t.paypalOrderId) throw new DomainError("TRANCHE_STATE", "This tranche is not waiting for PayPal approval.");
  if (orderId && orderId !== t.paypalOrderId) throw new DomainError("ORDER_MISMATCH", "The PayPal order does not belong to this tranche.");
  const w = await loadWorkspace(db, t.workspaceId);
  const rail = await railOf(t);
  const key = idemKey("confirm", t.id);
  await audit(db, auditActor(a), "money.confirm_requested", t.id, { idemKey: key, orderId: t.paypalOrderId });
  let hs: HoldState;
  try { hs = await withRetry(() => rail.confirm(t.paypalOrderId!, key)); }
  catch (e) {
    await audit(db, auditActor(a), "money.confirm_failed", t.id, { idemKey: key, error: railMessage(e) });
    if (e instanceof RailError) throw new DomainError(e.kind === "BUYER_ACTION" ? "BUYER_ACTION" : "RAIL_ERROR", railMessage(e));
    throw e;
  }
  if (hs.status !== "HELD" && hs.status !== "COMPLETED") throw new DomainError("NOT_HELD", `PayPal reports the order as ${hs.status.toLowerCase()}; nothing is held yet.`);
  const reported = hs.heldCents + hs.capturedCents;
  const expected = fundedAmount(t);
  if (reported && reported !== expected) throw new DomainError("AMOUNT_MISMATCH", `PayPal holds ${formatCents(reported, w.currency)} but the tranche is ${formatCents(expected, w.currency)}.`);
  const heldAt = await workspaceNow(w.id);
  const windowEndsAt = new Date(heldAt.getTime() + (t.rail === "B" ? 28 : 29) * DAY);
  await db.transaction(async (tx) => {
    const cur = await loadTranche(tx, t.id, true);
    if (cur.state !== "AWAITING_APPROVAL") return;
    await tx.update(tranches).set({ authorizationId: hs.authorizationId ?? null, captureId: hs.captureId ?? null, heldAt, windowEndsAt, state: trancheMachine.next("AWAITING_APPROVAL", "confirm") }).where(eq(tranches.id, t.id));
    const holdRef = hs.authorizationId ?? hs.captureId ?? t.paypalOrderId;
    await tx.insert(ledgerEntries).values({ trancheId: t.id, type: "HOLD", debit: holdAccount(t.id), credit: clientAccount(w.clientId), amountCents: t.amountCents, paypalRef: holdRef });
    if (t.bonusPoolCents > 0) await tx.insert(ledgerEntries).values({ trancheId: t.id, type: "BONUS_POOL", debit: poolAccount(t.id), credit: clientAccount(w.clientId), amountCents: t.bonusPoolCents, paypalRef: holdRef });
    const opened = await openReady(tx, w.id);
    await audit(tx, auditActor(a), "money.hold_confirmed", t.id, { idemKey: key, authorizationId: hs.authorizationId, captureId: hs.captureId, amountCents: t.amountCents, bonusPoolCents: t.bonusPoolCents, heldAt: heldAt.toISOString(), windowEndsAt: windowEndsAt.toISOString(), opened });
  });
}

/* ───────────────────────── release (F3.07, F3.08) ───────────────────────── */

export async function releaseMilestone(a: Actor, milestoneId: string, p: { amountCents?: number; kind: "MILESTONE" | "VERDICT"; approvalSig: string }): Promise<{ releaseId: string; netCents: number; feeCents: number }> {
  if (!p.approvalSig || !p.approvalSig.trim()) throw new DomainError("P4_UNSIGNED", "A release needs the client's signed approval or a mediator's signed verdict.");
  const m = await loadMilestone(db, milestoneId);
  const w = await loadWorkspace(db, m.workspaceId);
  const kind = p.kind;
  if (kind === "MILESTONE" && !(a.id === w.clientId || ["admin", "ops"].includes(a.role) || (a.role === "judge" && sandboxMode())))
    throw new DomainError("FORBIDDEN", "Only the client (or a timer acting under the contract's review rule) can release a milestone.");
  if (kind === "VERDICT" && !["mediator", "ops", "admin"].includes(a.role) && !(a.role === "judge" && sandboxMode()))
    throw new DomainError("FORBIDDEN", "Only a mediator's verdict can release disputed money.");

  await assertApproval(m.id, kind, p.approvalSig);

  const [existing] = await db.select().from(releases).where(and(eq(releases.milestoneId, m.id), eq(releases.kind, kind))).limit(1);
  if (existing && (existing.status === "COMPLETED" || existing.status === "IN_FLIGHT")) {
    await afterRelease(a, m.id, existing.trancheId); // finish a deduction return or pool close that did not complete earlier
    return { releaseId: existing.id, netCents: existing.netCents, feeCents: existing.feeCents };
  }

  const t = await trancheFor(db, w.id, m.trancheIdx);
  let gross: number;
  if (kind === "VERDICT") {
    gross = p.amountCents ?? m.amountCents;
    if (!Number.isSafeInteger(gross) || gross < 0 || gross > m.amountCents) throw new DomainError("BAD_AMOUNT", "A verdict release must be whole cents between zero and the milestone amount.");
  } else gross = m.amountCents;
  const allowed: string[] = kind === "VERDICT" ? ["DISPUTED"] : ["APPROVED", "SUBMITTED", "ESCALATED"];
  if (!allowed.includes(m.state)) throw new DomainError("MILESTONE_STATE", `Milestone ${m.code} is ${m.state.toLowerCase()}; it cannot be released now.`);
  if (gross > 0) assertReleasable(t);

  const releaseId = existing?.id ?? newId("rel");
  /* The deadline adjustment (late deduction or early bonus) is fixed before PayPal is called and never recomputed. */
  const adj: AdjustmentRow | null = kind === "MILESTONE" && gross > 0 ? await prepareAdjustment(a, m, w, t, releaseId) : null;
  const deduction = adj?.deductionCents ?? 0, bonus = adj?.bonusCents ?? 0;
  const { releasedCents: released, feeCents: fee, netCents: net } = releaseSplit(gross, deduction, bonus, w.feeBps);
  const deadlineFlow = adj !== null || t.bonusPoolCents > 0;
  const key = idemKey("release", m.id, kind);
  /* P2: the release row (with its idempotency key) exists before PayPal is called; the unique (milestone, kind) makes it exactly-once. */
  if (!existing) {
    await db.insert(releases).values({ id: releaseId, milestoneId: m.id, trancheId: t.id, idemKey: key, kind, grossCents: released, feeCents: fee, netCents: net, status: "PENDING", approvedBy: a.id, approvalSig: p.approvalSig }).onConflictDoNothing();
  } else if (existing.status === "FAILED") {
    await db.update(releases).set({ status: "PENDING", grossCents: released, feeCents: fee, netCents: net }).where(and(eq(releases.id, existing.id), eq(releases.status, "FAILED")));
  }
  const [row] = await db.select().from(releases).where(and(eq(releases.milestoneId, m.id), eq(releases.kind, kind))).limit(1);
  if (row.status === "COMPLETED" || row.status === "IN_FLIGHT") return { releaseId: row.id, netCents: row.netCents, feeCents: row.feeCents };

  let out: { releaseId: string; netCents: number; feeCents: number };
  try {
    out = await db.transaction(async (tx) => {
      const cur = await loadTranche(tx, t.id, true);
      const [again] = await tx.select().from(releases).where(eq(releases.id, row.id)).limit(1);
      if (again.status === "COMPLETED" || again.status === "IN_FLIGHT") return { releaseId: again.id, netCents: again.netCents, feeCents: again.feeCents };
      const curM = await loadMilestone(tx, m.id);
      if (!allowed.includes(curM.state)) throw new DomainError("MILESTONE_STATE", `Milestone ${m.code} is ${curM.state.toLowerCase()}; it cannot be released now.`);
      if (gross > 0) assertReleasable(cur);
      const bal = await balanceOf(tx, t.id);
      if (gross > bal.remaining) throw new DomainError("EXCEEDS_HELD", `Only ${formatCents(bal.remaining, w.currency)} is still held in this tranche; ${formatCents(gross, w.currency)} cannot be released.`);
      if (bonus > bal.pool.remaining) throw new DomainError("POOL_EXHAUSTED", `The bonus pool has ${formatCents(bal.pool.remaining, w.currency)} left; a ${formatCents(bonus, w.currency)} bonus cannot be paid.`);
      const after = bal.remaining - gross; // what stays held for other milestones once this one (and its deduction) has left the hold
      /* Rail A: a final capture lets PayPal release whatever is left of the authorization. With deadline terms, anything left
         (deductions, the unused pool, recorded returns) is voided explicitly instead, so every cent has its own PayPal record. */
      const leftInAuth = fundedAmount(cur) - bal.released - released;
      const final = deadlineFlow ? after === 0 && leftInAuth === 0 : after === 0;
      let paypalRef: string | null = null, status: "COMPLETED" | "IN_FLIGHT" = "COMPLETED";
      if (released > 0) {
        const rail = await railOf(cur);
        const payee = await payeeOf(tx, w.providerId);
        const ref = await withRetry(() => rail.release({
          orderId: cur.paypalOrderId!, authorizationId: cur.authorizationId ?? undefined, captureId: cur.captureId ?? undefined, amountCents: released, payoutCents: net, currency: w.currency,
          final, payeeEmail: payee?.email ?? undefined, idemKey: key, note: `${w.title} · ${m.code} ${m.title}`.slice(0, 255),
        }));
        paypalRef = ref.id; status = ref.status === "COMPLETED" ? "COMPLETED" : "IN_FLIGHT";
        if (bonus > 0) await tx.insert(ledgerEntries).values({ trancheId: t.id, milestoneId: m.id, type: "EARLY_BONUS", debit: holdAccount(t.id), credit: poolAccount(t.id), amountCents: bonus, paypalRef });
        if (net > 0) await tx.insert(ledgerEntries).values({ trancheId: t.id, milestoneId: m.id, type: "RELEASE", debit: providerAccount(w.providerId ?? "unknown"), credit: holdAccount(t.id), amountCents: net, paypalRef });
        if (fee > 0) await tx.insert(ledgerEntries).values({ trancheId: t.id, milestoneId: m.id, type: "FEE", debit: FEE_ACCOUNT, credit: holdAccount(t.id), amountCents: fee, paypalRef });
      }
      await tx.update(releases).set({ status, paypalRef, completedAt: new Date() }).where(eq(releases.id, row.id));
      let ms: string = curM.state;
      if (kind === "MILESTONE") { if (ms !== "APPROVED") ms = milestoneMachine.next(ms as MState, "approve"); ms = milestoneMachine.next(ms as MState, "released"); }
      else if (ms === "DISPUTED") ms = milestoneMachine.next("DISPUTED", "verdict_executed");
      await tx.update(wsMilestones).set({ state: ms }).where(eq(wsMilestones.id, m.id));
      let ts: string = cur.state;
      if (released > 0 && (ts === "HELD" || ts === "PARTIALLY_RELEASED")) ts = trancheMachine.next(ts as TState, "release");
      /* with deadline terms the tranche closes once the deduction and the unused pool have gone back too (afterRelease) */
      if (after === 0 && bal.held > 0 && (!deadlineFlow || (deduction === 0 && bal.pool.remaining - bonus === 0 && leftInAuth === 0))) ts = stepTranche(ts, "close");
      if (ts !== cur.state) await tx.update(tranches).set({ state: ts }).where(eq(tranches.id, t.id));
      const opened = await openReady(tx, w.id);
      await audit(tx, auditActor(a), "money.release", m.id, { releaseId: row.id, trancheId: t.id, kind, idemKey: key, grossCents: released, milestoneCents: gross, deductionCents: deduction, bonusCents: bonus, feeCents: fee, netCents: net, final, paypalRef, trancheState: ts, opened });
      return { releaseId: row.id, netCents: net, feeCents: fee };
    });
  } catch (e) {
    await db.update(releases).set({ status: "FAILED" }).where(and(eq(releases.id, row.id), eq(releases.status, "PENDING")));
    await audit(db, auditActor(a), "money.release_failed", m.id, { releaseId: row.id, idemKey: key, error: railMessage(e) });
    if (e instanceof RailError) throw new DomainError("RAIL_ERROR", railMessage(e));
    throw e;
  }
  await afterRelease(a, m.id, t.id);
  return out;
}

/**
 * After a milestone release: give the late deduction back to the client (P2 key stored on the adjustment row) and,
 * Once nothing is held for milestones any more, give back the unused bonus pool and close the tranche. Idempotent; a
 * failure is recorded and retried by the watchdog — the provider's release itself has already completed.
 */
async function afterRelease(a: Actor | null, milestoneId: string, trancheId: string): Promise<void> {
  try {
    const [adj] = await db.select().from(releaseAdjustments).where(eq(releaseAdjustments.milestoneId, milestoneId)).limit(1);
    const [rel] = await db.select({ status: releases.status }).from(releases).where(and(eq(releases.milestoneId, milestoneId), eq(releases.kind, "MILESTONE"))).limit(1);
    if (adj && adj.deductionCents > 0 && adj.deductionIdemKey && ["PENDING", "FAILED"].includes(adj.deductionStatus) && rel && ["COMPLETED", "IN_FLIGHT"].includes(rel.status)) {
      try {
        const r = await returnFunds(a, adj.trancheId, [{ milestoneId, amountCents: adj.deductionCents }], `Late delivery deduction (${adj.daysLate} day${adj.daysLate === 1 ? "" : "s"} late, ${adj.countedDays} counted) goes back to the client`, adj.deductionIdemKey, { kind: "LATE_DEDUCTION" });
        const [ret] = await db.select({ status: refunds.status }).from(refunds).where(eq(refunds.id, r.refundId)).limit(1);
        await db.update(releaseAdjustments).set({ deductionStatus: ret?.status === "RECORDED" ? "RECORDED" : "COMPLETED" }).where(eq(releaseAdjustments.id, adj.id));
      } catch (e) {
        await db.update(releaseAdjustments).set({ deductionStatus: "FAILED" }).where(eq(releaseAdjustments.id, adj.id));
        throw e;
      }
    }
    await closeLeftovers(a, trancheId);
  } catch (e) {
    await audit(db, auditActor(a), "money.deadline_settle_failed", milestoneId, { trancheId, error: railMessage(e) });
  }
}

/**
 * P4 proof of authority. A signature string alone is not enough: it must be one the system recorded.
 *  - MILESTONE: an evidence_reviews row for this milestone, written by the evidence module, with decision APPROVE (the
 *    client's signed approval; gates use the same row) or DEEMED_APPROVED (the deemed-approval rule the client signed into
 *    the contract), whose signature equals approvalSig.
 *  - VERDICT: a verdicts row for the dispute on this milestone whose signature equals approvalSig.
 * Otherwise APPROVAL_REQUIRED and nothing is recorded or moved.
 */
async function assertApproval(milestoneId: string, kind: "MILESTONE" | "VERDICT", sig: string): Promise<void> {
  if (kind === "MILESTONE") {
    const [r] = await db.select({ id: evidenceReviews.id }).from(evidenceReviews)
      .where(and(eq(evidenceReviews.milestoneId, milestoneId), inArray(evidenceReviews.decision, ["APPROVE", "DEEMED_APPROVED"]), eq(evidenceReviews.signature, sig))).limit(1);
    if (r) return;
    throw new DomainError("APPROVAL_REQUIRED", "This release has no recorded client approval with a matching signature. The client approves the evidence first; then the release can run.");
  }
  const [v] = await db.select({ id: verdicts.id }).from(verdicts).innerJoin(disputes, eq(disputes.id, verdicts.disputeId))
    .where(and(eq(disputes.milestoneId, milestoneId), eq(verdicts.signature, sig))).limit(1);
  if (v) return;
  throw new DomainError("APPROVAL_REQUIRED", "This release has no recorded mediator verdict with a matching signature, so no disputed money can move.");
}

function assertReleasable(t: TrancheRow) {
  if (hasMark(t, "EXTERNAL_DISPUTE")) throw new DomainError("RELEASE_BLOCKED", "A PayPal dispute is open on this payment. Releases on this tranche are paused until it is resolved.");
  if (t.state === "BREAKER") throw new DomainError("RELEASE_BLOCKED", "Reconciliation found a difference on this tranche. Releases are paused until Finance clears it.");
  if (!["HELD", "PARTIALLY_RELEASED", "SETTLING"].includes(t.state)) throw new DomainError("NOT_HELD", `Tranche ${t.idx} is ${t.state.toLowerCase().replace(/_/g, " ")}; nothing is held for this milestone.`);
}

/* ───────────────────────── return to client (F4.08) ───────────────────────── */

export async function returnToClient(a: Actor, trancheId: string, amountCents: number, reason: string, key: string): Promise<{ refundId: string }> {
  const t = await loadTranche(db, trancheId);
  const w = await loadWorkspace(db, t.workspaceId);
  const ok = ["mediator", "ops", "admin", "finance"].includes(a.role) || a.id === w.providerId || (a.role === "judge" && sandboxMode());
  if (!ok) throw new DomainError("FORBIDDEN", "Returning held money needs a mediator's verdict, Operations, or the provider's own consent.");
  return returnFunds(a, t.id, [{ milestoneId: null, amountCents }], reason, key);
}

/**
 * Returns money to the client, attributed to milestones where known. Rail A: money is only authorized — the last return
 * voids the authorization remainder; earlier ones are recorded (never captured). Rail B: refund of the captured payment.
 * `kind: "LATE_DEDUCTION"` posts a late deduction instead of a plain return. When a return empties the hold, the
 * unused bonus pool goes back as well (Rail A: the same void covers it; Rail B: its own refund, key pool_return).
 */
async function returnFunds(a: Actor | null, trancheId: string, items: { milestoneId: string | null; amountCents: number }[], reason: string, key: string, opts: { close?: boolean; kind?: "LATE_DEDUCTION" } = {}): Promise<{ refundId: string }> {
  const amount = items.reduce((s, i) => s + i.amountCents, 0);
  if (!items.every((i) => Number.isSafeInteger(i.amountCents) && i.amountCents >= 0) || amount <= 0) throw new DomainError("BAD_AMOUNT", "A return must be a positive whole number of cents.");
  if (!key || !reason.trim()) throw new DomainError("BAD_INPUT", "A return needs a reason and an idempotency key.");
  const [prior] = await db.select().from(refunds).where(eq(refunds.idemKey, key)).limit(1);
  if (prior && ["COMPLETED", "RECORDED", "IN_FLIGHT"].includes(prior.status)) return { refundId: prior.id };
  const t0 = await loadTranche(db, trancheId);
  const pre = await balanceOf(db, trancheId);
  if (pre.held === 0) throw new DomainError("NOT_HELD", "Nothing has been held in this tranche, so there is nothing to return.");
  if (amount > pre.remaining) throw new DomainError("EXCEEDS_HELD", `A return can never exceed what is still held: ${formatCents(pre.remaining)} remains, ${formatCents(amount)} was asked.`);
  const id = prior?.id ?? newId("ret");
  if (!prior) await db.insert(refunds).values({ id, trancheId, idemKey: key, amountCents: amount, reason: reason.slice(0, 500), status: "PENDING" }).onConflictDoNothing();
  else await db.update(refunds).set({ status: "PENDING", amountCents: amount }).where(eq(refunds.id, id));
  const w = await loadWorkspace(db, t0.workspaceId);
  /* P2: the pool's own return row (and key) exists before any rail call that could return it */
  const poolKey = idemKey("pool_return", trancheId);
  const poolRowId = pre.pool.remaining > 0 && amount === pre.remaining ? await poolRow(trancheId, pre.pool.remaining, poolKey) : null;
  try {
    await db.transaction(async (tx) => {
      const t = await loadTranche(tx, trancheId, true);
      const bal = await balanceOf(tx, trancheId);
      if (amount > bal.remaining) throw new DomainError("EXCEEDS_HELD", `A return can never exceed what is still held: ${formatCents(bal.remaining, w.currency)} remains.`);
      const after = bal.remaining - amount;
      const rail = await railOf(t);
      let type: "VOID" | "REFUND", status: string, paypalRef: string | null = null;
      if (isRailB(rail)) {
        if (!t.captureId) throw new DomainError("NOT_HELD", "PayPal has no captured payment for this tranche.");
        const r = await withRetry(() => rail.refund(t.captureId!, amount, w.currency, key, reason));
        type = "REFUND"; paypalRef = r.id; status = r.status === "COMPLETED" ? "COMPLETED" : "IN_FLIGHT";
      } else if (after === 0) {
        if (!t.authorizationId) throw new DomainError("NOT_HELD", "PayPal has no authorization for this tranche.");
        await withRetry(() => rail.voidRemainder(t.authorizationId!, key));
        type = "VOID"; paypalRef = `void:${t.authorizationId}`; status = "COMPLETED";
      } else { type = "VOID"; status = "RECORDED"; } // stays authorized but will never be captured; voided with the last remainder
      await tx.update(refunds).set({ status, paypalRef }).where(eq(refunds.id, id));
      const kind = opts.kind ?? type;
      for (const i of items) if (i.amountCents > 0) await tx.insert(ledgerEntries).values({ trancheId, milestoneId: i.milestoneId, type: kind, debit: clientAccount(w.clientId), credit: holdAccount(trancheId), amountCents: i.amountCents, paypalRef: paypalRef ?? `recorded:${id}` });
      let pool = 0;
      if (after === 0 && bal.pool.remaining > 0 && poolRowId) pool = await poolReturnTx(tx, t, w, bal.pool.remaining, poolRowId, poolKey, isRailB(rail) ? null : paypalRef);
      let ts = t.state;
      if (after === 0 && opts.close !== false) ts = stepTranche(ts, "close");
      if (ts !== t.state) await tx.update(tranches).set({ state: ts }).where(eq(tranches.id, trancheId));
      await audit(tx, auditActor(a), opts.kind === "LATE_DEDUCTION" ? "money.late_deduction_returned" : "money.return", trancheId, { refundId: id, idemKey: key, amountCents: amount, type: kind, status, reason, items, trancheState: ts, rail: rail.id, poolReturnedCents: pool });
    });
  } catch (e) {
    await db.update(refunds).set({ status: "FAILED" }).where(and(eq(refunds.id, id), eq(refunds.status, "PENDING")));
    await audit(db, auditActor(a), "money.return_failed", trancheId, { refundId: id, idemKey: key, error: railMessage(e) });
    if (e instanceof RailError) throw new DomainError("RAIL_ERROR", railMessage(e));
    throw e;
  }
  return { refundId: id };
}

/** The refunds row for the unused bonus pool (one per tranche, key pool_return:<tranche>), created before the rail call. */
async function poolRow(trancheId: string, amountCents: number, key: string): Promise<string> {
  const [have] = await db.select().from(refunds).where(eq(refunds.idemKey, key)).limit(1);
  if (have) {
    if (have.status === "FAILED" || have.status === "PENDING") await db.update(refunds).set({ status: "PENDING", amountCents }).where(eq(refunds.id, have.id));
    return have.id;
  }
  const id = newId("ret");
  await db.insert(refunds).values({ id, trancheId, idemKey: key, amountCents, reason: "Unused early-finish bonus pool goes back to the client", status: "PENDING" }).onConflictDoNothing();
  const [row] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.idemKey, key)).limit(1);
  return row.id;
}

/**
 * Posts the return of the unused pool inside the caller's transaction. Rail A: `voidRef` is the void that already
 * released the authorization remainder (pool included). Rail B: refunds the pool from the captured payment (own key).
 */
async function poolReturnTx(tx: Tx, t: TrancheRow, w: WorkspaceRow, amountCents: number, rowId: string, key: string, voidRef: string | null): Promise<number> {
  let ref = voidRef, status = "COMPLETED";
  if (!ref) {
    const rail = await railOf(t);
    if (!t.captureId) throw new DomainError("NOT_HELD", "PayPal has no captured payment for this tranche.");
    const r = await withRetry(() => rail.refund(t.captureId!, amountCents, w.currency, key, "Unused early-finish bonus pool"));
    ref = r.id; status = r.status === "COMPLETED" ? "COMPLETED" : "IN_FLIGHT";
  }
  await tx.update(refunds).set({ status, paypalRef: ref, amountCents }).where(eq(refunds.id, rowId));
  await tx.insert(ledgerEntries).values({ trancheId: t.id, milestoneId: null, type: "POOL_RETURN", debit: clientAccount(w.clientId), credit: poolAccount(t.id), amountCents, paypalRef: ref });
  return amountCents;
}

/**
 * Once nothing is held for milestones, give back what is left — the unused bonus pool and (Rail A) deductions that
 * were recorded but still authorized — and close the tranche. Rail A: one void (key pool_return / void_close); Rail B: a
 * refund of the pool. Only for tranches with deadline terms (a pool or a stored adjustment); idempotent.
 */
async function closeLeftovers(a: Actor | null, trancheId: string): Promise<void> {
  const t0 = await loadTranche(db, trancheId);
  if (!["HELD", "PARTIALLY_RELEASED", "SETTLING"].includes(t0.state)) return;
  const pre = await balanceOf(db, trancheId);
  if (pre.held === 0 || pre.remaining !== 0) return;
  const [adj] = await db.select({ id: releaseAdjustments.id }).from(releaseAdjustments).where(eq(releaseAdjustments.trancheId, trancheId)).limit(1);
  if (t0.bonusPoolCents <= 0 && !adj) return;
  const w = await loadWorkspace(db, t0.workspaceId);
  const poolKey = idemKey("pool_return", trancheId);
  const rowId = pre.pool.remaining > 0 ? await poolRow(trancheId, pre.pool.remaining, poolKey) : null;
  await db.transaction(async (tx) => {
    const t = await loadTranche(tx, trancheId, true);
    if (!["HELD", "PARTIALLY_RELEASED", "SETTLING"].includes(t.state)) return;
    const bal = await balanceOf(tx, trancheId);
    if (bal.remaining !== 0) return;
    const rail = await railOf(t);
    let pool = 0, voided: string | null = null;
    if (isRailB(rail)) {
      if (bal.pool.remaining > 0 && rowId) pool = await poolReturnTx(tx, t, w, bal.pool.remaining, rowId, poolKey, null);
    } else {
      const left = fundedAmount(t) - bal.released;
      if (left > 0) {
        if (!t.authorizationId) throw new DomainError("NOT_HELD", "PayPal has no authorization for this tranche.");
        const vkey = rowId ? poolKey : idemKey("void_close", trancheId);
        await withRetry(() => rail.voidRemainder(t.authorizationId!, vkey));
        voided = `void:${t.authorizationId}`;
        if (bal.pool.remaining > 0 && rowId) pool = await poolReturnTx(tx, t, w, bal.pool.remaining, rowId, poolKey, voided);
        /* deductions and returns recorded while the hold was open are part of this void */
        await tx.update(refunds).set({ status: "COMPLETED", paypalRef: voided }).where(and(eq(refunds.trancheId, trancheId), eq(refunds.status, "RECORDED")));
      }
    }
    const ts = stepTranche(t.state, "close");
    if (ts !== t.state) await tx.update(tranches).set({ state: ts }).where(eq(tranches.id, trancheId));
    await audit(tx, auditActor(a), "money.tranche_closed", trancheId, { poolReturnedCents: pool, voided, trancheState: ts, rail: rail.id });
  });
}

/* ───────────────────────── rollover (F3.10) ───────────────────────── */

const IN_PROGRESS = ["SUBMITTED", "REMEDIATION", "ESCALATED", "APPROVED"];

export async function rollover(a: Actor, trancheId: string): Promise<{ newTrancheId: string }> {
  const t = await loadTranche(db, trancheId);
  const w = await loadWorkspace(db, t.workspaceId);
  const party = a.id === w.clientId || a.id === w.providerId;
  if (!party && !["ops", "admin"].includes(a.role) && !(a.role === "judge" && sandboxMode())) throw new DomainError("FORBIDDEN", "Only the parties to this contract or Operations can roll a tranche over.");
  const done = (t.warned ?? []).find((x) => x.startsWith("ROLLED_TO:"));
  if (done) return { newTrancheId: done.slice("ROLLED_TO:".length) };
  if (!["HELD", "PARTIALLY_RELEASED"].includes(t.state)) throw new DomainError("TRANCHE_STATE", "Only a tranche that still holds money can be rolled over.");
  if (hasMark(t, "EXTERNAL_DISPUTE")) throw new DomainError("RELEASE_BLOCKED", "A PayPal dispute is open on this payment; it must be resolved before the tranche is rolled over.");
  await retryApproved(a, t);
  const ms = await trancheMilestones(db, w.id, t.idx);
  const moving = ms.filter((m) => ["LOCKED", "OPEN", ...IN_PROGRESS].includes(m.state));
  if (!moving.length) throw new DomainError("NOTHING_TO_ROLL", "Every milestone in this tranche is finished or disputed; there is nothing to roll over.");
  const moved = await movedByMilestone(db, t.id);
  const items = moving.map((m) => ({ milestoneId: m.id, amountCents: Math.max(0, m.amountCents - (moved.get(m.id) ?? 0)) })).filter((i) => i.amountCents > 0);
  await db.update(tranches).set({ state: trancheMachine.next(t.state as TState, "rollover") }).where(eq(tranches.id, t.id));
  try {
    if (items.length) await returnFunds(a, t.id, items, "Rolled over into a new tranche before the PayPal hold window ends", idemKey("rollover", t.id), { close: false });
  } catch (e) {
    await db.update(tranches).set({ state: t.state }).where(eq(tranches.id, t.id)); // nothing moved: the tranche keeps holding its money
    throw e;
  }
  const carriedPool = (await balanceOf(db, t.id)).pool.returned; // the unused pool travels with the unfinished milestones
  const newTrancheId = await db.transaction(async (tx) => {
    const id = await moveToNextTranche(tx, t, moving, carriedPool);
    await tx.update(tranches).set({ warned: [...(await loadTranche(tx, t.id)).warned, `ROLLED_TO:${id}`] }).where(eq(tranches.id, t.id));
    await notify(tx, w, id, "OFFER_ROLLOVER", `Tranche ${t.idx} of “${w.title}” was rolled over. ${formatCents(items.reduce((s, i) => s + i.amountCents, 0), w.currency)} goes back to the client's PayPal account and a new tranche is ready for the client to approve in PayPal.`, `rolled:${t.id}`);
    await audit(tx, auditActor(a), "money.rollover", t.id, { newTrancheId: id, milestones: moving.map((m) => m.code), returnedCents: items.reduce((s, i) => s + i.amountCents, 0) });
    return id;
  });
  return { newTrancheId };
}

/**
 * Puts milestones into the next PLANNED tranche (merging when one exists) or a new tranche; buyer approval needed to fund it.
 * `poolCents` (the unused bonus pool returned from the old tranche) is funded again with the new one.
 */
async function moveToNextTranche(tx: Tx, t: TrancheRow, moving: MilestoneRow[], poolCents = 0): Promise<string> {
  const amount = moving.filter((m) => m.type === "PAY").reduce((s, m) => s + m.amountCents, 0);
  const days = moving.map((m) => m.targetDay);
  const [next] = await tx.select().from(tranches).where(and(eq(tranches.workspaceId, t.workspaceId), eq(tranches.idx, t.idx + 1))).limit(1).for("update");
  let id: string, idx: number;
  if (next && next.state === "PLANNED") {
    id = next.id; idx = next.idx;
    await tx.update(tranches).set({ amountCents: next.amountCents + amount, bonusPoolCents: next.bonusPoolCents + Math.max(0, poolCents), startDay: Math.min(next.startDay, ...days), endDay: Math.max(next.endDay, ...days) }).where(eq(tranches.id, id));
  } else {
    const [{ top }] = await tx.select({ top: max(tranches.idx) }).from(tranches).where(eq(tranches.workspaceId, t.workspaceId));
    idx = (top ?? t.idx) + 1; id = newId("tr");
    await tx.insert(tranches).values({ id, workspaceId: t.workspaceId, idx, rail: t.rail, amountCents: amount, bonusPoolCents: Math.max(0, poolCents), startDay: Math.min(...days), endDay: Math.max(...days), state: "PLANNED" });
  }
  await tx.update(wsMilestones).set({ trancheIdx: idx }).where(inArray(wsMilestones.id, moving.map((m) => m.id)));
  return id;
}

/** Retries releases that were approved and signed but did not complete (stored signature; never a new approval). */
async function retryApproved(a: Actor | null, t: TrancheRow) {
  const stuck = await db.select({ r: releases, m: wsMilestones }).from(releases).innerJoin(wsMilestones, eq(wsMilestones.id, releases.milestoneId))
    .where(and(eq(releases.trancheId, t.id), inArray(releases.status, ["PENDING", "FAILED"])));
  for (const { r, m } of stuck) {
    if (r.kind === "MILESTONE" && m.state !== "APPROVED") continue;
    try { await releaseMilestone(a ?? { id: "system:watchdog", role: "admin" }, r.milestoneId, { kind: r.kind, amountCents: r.grossCents, approvalSig: r.approvalSig }); }
    catch (e) { await audit(db, auditActor(a), "money.retry_failed", r.id, { error: railMessage(e) }); }
  }
}

/* ───────────────────────── watchdog (F3.10, F3.02) ───────────────────────── */

export async function runWatchdog(now: Date, workspaceId?: string): Promise<{ actions: { trancheId: string; action: string }[] }> {
  const actions: { trancheId: string; action: string }[] = [];
  if (await retryChangeOrders(workspaceId).catch(() => 0)) actions.push({ trancheId: "-", action: "CHANGE_ORDER_RETURNS" });
  const where = workspaceId
    ? and(inArray(tranches.state, ["HELD", "PARTIALLY_RELEASED", "SETTLING", "ROLLED_OVER", "AWAITING_APPROVAL"]), eq(tranches.workspaceId, workspaceId))
    : inArray(tranches.state, ["HELD", "PARTIALLY_RELEASED", "SETTLING", "ROLLED_OVER", "AWAITING_APPROVAL"]);
  const list = await db.select().from(tranches).where(where).orderBy(asc(tranches.workspaceId), asc(tranches.idx));
  for (const t of list) {
    try {
      if (t.state === "AWAITING_APPROVAL") { if (await pollApproval(t)) actions.push({ trancheId: t.id, action: "CONFIRMED_BY_POLL" }); continue; }
      if (!t.heldAt) continue;
      if (await retryDeadlineSteps(t)) actions.push({ trancheId: t.id, action: "DEADLINE_SETTLED" });
      const wnow = await effectiveNow(now, t.workspaceId);
      const day = daysBetween(t.heldAt, wnow);
      const bal = await balanceOf(db, t.id);
      if (bal.remaining <= 0) continue;
      for (const step of watchdogPlan(t.rail as PolicyRail)) {
        if (day < step.day) break;
        if (t.state === "ROLLED_OVER" && step.action !== "SETTLE") continue;
        if (!(await claimMark(db, t.id, step.action))) continue;
        try {
          const did = await perform(step.action, await loadTranche(db, t.id), day, wnow);
          if (did) actions.push({ trancheId: t.id, action: step.action });
        } catch (e) {
          if (step.action === "SETTLE") await unclaimMark(db, t.id, step.action); // settle must happen: try again next tick
          await audit(db, SYSTEM, "money.watchdog_error", t.id, { action: step.action, error: railMessage(e) });
        }
      }
    } catch (e) {
      await audit(db, SYSTEM, "money.watchdog_error", t.id, { error: railMessage(e) });
    }
  }
  return { actions };
}

/** Retries late-deduction returns that failed and closes tranches whose milestones are all paid but whose pool is left. */
async function retryDeadlineSteps(t: TrancheRow): Promise<boolean> {
  const pending = await db.select({ m: releaseAdjustments.milestoneId }).from(releaseAdjustments)
    .where(and(eq(releaseAdjustments.trancheId, t.id), inArray(releaseAdjustments.deductionStatus, ["PENDING", "FAILED"])));
  for (const p of pending) await afterRelease(null, p.m, t.id);
  const before = t.state;
  await closeLeftovers(null, t.id);
  return pending.length > 0 || (await loadTranche(db, t.id)).state !== before;
}

/**
 * The workspace's virtual "now". The cron passes real time (the offset is added here); the playground passes an
 * already-shifted time (taking the later of the two avoids counting the offset twice).
 */
async function effectiveNow(now: Date, workspaceId: string): Promise<Date> {
  const off = sandboxMode() ? await offsetFor(workspaceId) : 0;
  const shifted = Date.now() + off * HOUR;
  return new Date(Math.max(now.getTime(), shifted));
}

async function pollApproval(t: TrancheRow): Promise<boolean> {
  if (!t.paypalOrderId || t.paypalOrderId.startsWith("MOCKORD-")) return false; // the mock approval link lands on the return handler
  const rail = await railOf(t);
  const s = await rail.status(t.paypalOrderId);
  if (s.status !== "APPROVED") return false;
  await confirmTranche(null, t.id, t.paypalOrderId);
  return true;
}

async function perform(action: string, t: TrancheRow, day: number, wnow: Date): Promise<boolean> {
  const w = await loadWorkspace(db, t.workspaceId);
  const bal = await balanceOf(db, t.id);
  const left = formatCents(bal.remaining, w.currency);
  const settleOn = new Date(t.heldAt!.getTime() + SETTLE_DAY * DAY).toUTCString().slice(0, 16);
  switch (action) {
    case "REAUTHORIZE_IF_NEEDED": {
      if (t.reauthorized || !t.authorizationId || bal.remaining <= 0) return false;
      const rail = await railOf(t);
      if (isRailB(rail)) return false;
      try {
        const r = await withRetry(() => rail.extend(t.authorizationId!, bal.remaining, w.currency, idemKey("reauth", t.id)));
        await db.update(tranches).set({ authorizationId: r.authorizationId, reauthorized: true }).where(eq(tranches.id, t.id));
        await audit(db, SYSTEM, "money.reauthorized", t.id, { day: round1(day), authorizationId: r.authorizationId, amountCents: bal.remaining, idemKey: idemKey("reauth", t.id) });
      } catch (e) {
        await audit(db, SYSTEM, "money.reauth_failed", t.id, { day: round1(day), error: railMessage(e) }); // once only (PayPal allows one reauthorization)
      }
      return true;
    }
    case "WARN":
      await notify(db, w, t.id, "WARN", `Day ${Math.floor(day)} of the PayPal hold for “${w.title}” (tranche ${t.idx}). ${left} is still held. On ${settleOn} PaySettle settles the tranche: approved milestones are paid, unstarted ones go back to the client.`, `warn:${t.id}`);
      await audit(db, SYSTEM, "money.watchdog_warn", t.id, { day: round1(day), remainingCents: bal.remaining, simulatedNow: wnow.toISOString() });
      return true;
    case "OFFER_ROLLOVER":
      await notify(db, w, t.id, "OFFER_ROLLOVER", `The PayPal hold for “${w.title}” (tranche ${t.idx}) ends soon. Either party can roll the unfinished milestones (${left}) into a new tranche; the client then approves a new hold in PayPal.`, `offer:${t.id}`);
      await audit(db, SYSTEM, "money.rollover_offered", t.id, { day: round1(day), remainingCents: bal.remaining });
      return true;
    case "SETTLE":
      await settle(t, w, day);
      return true;
  }
  return false;
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Day-27 settlement (PRD §5.2, §6.7, §6.9): release nothing new (only retry approvals already signed), return unstarted
 * milestones to the client, return disputed and in-review amounts and ask the parties to re-fund them in a new hold.
 */
async function settle(t0: TrancheRow, w: WorkspaceRow, day: number) {
  await retryApproved(null, t0);
  let t = await loadTranche(db, t0.id);
  if (t.state === "HELD" || t.state === "PARTIALLY_RELEASED") {
    await db.update(tranches).set({ state: trancheMachine.next(t.state as TState, "settle") }).where(eq(tranches.id, t.id));
    t = await loadTranche(db, t.id);
  }
  const ms = await trancheMilestones(db, w.id, t.idx);
  const unstarted = ms.filter((m) => m.state === "LOCKED" || m.state === "OPEN");
  const carried = ms.filter((m) => IN_PROGRESS.includes(m.state) || m.state === "DISPUTED");
  const bal = await balanceOf(db, t.id);
  const moved = await movedByMilestone(db, t.id);
  const items: { milestoneId: string | null; amountCents: number }[] = [];
  let budget = bal.remaining;
  for (const m of [...unstarted, ...carried]) {
    const owe = Math.min(budget, Math.max(0, m.amountCents - (moved.get(m.id) ?? 0)));
    if (owe > 0) { items.push({ milestoneId: m.id, amountCents: owe }); budget -= owe; }
  }
  if (budget > 0) items.push({ milestoneId: null, amountCents: budget }); // anything not attributable still leaves the hold
  if (items.length) await returnFunds(null, t.id, items, `Hold window day ${SETTLE_DAY}: unstarted and unresolved milestones returned to the client`, idemKey("settle", t.id));
  await db.transaction(async (tx) => {
    for (const m of unstarted) await tx.update(wsMilestones).set({ state: milestoneMachine.next(m.state as MState, "refund_unstarted") }).where(eq(wsMilestones.id, m.id));
    let refundTranche: string | null = null;
    if (carried.length) {
      refundTranche = await moveToNextTranche(tx, t, carried, (await balanceOf(tx, t.id)).pool.returned);
      await tx.update(tranches).set({ warned: [...(await loadTranche(tx, t.id)).warned, `REFUND_REQUESTED:${refundTranche}`] }).where(eq(tranches.id, t.id));
      await notify(tx, w, refundTranche, "REFUND_REQUESTED", `PaySettle cannot keep money past PayPal's hold window. ${carried.map((m) => m.code).join(", ")} ${carried.length === 1 ? "is" : "are"} still under review or in dispute, so ${formatCents(carried.reduce((s, m) => s + m.amountCents, 0), w.currency)} went back to the client. The client is asked to approve a new hold for ${carried.length === 1 ? "it" : "them"}; if the client declines, a dispute verdict is still issued.`, `refund:${t.id}`);
    }
    const left = await balanceOf(tx, t.id);
    const cur = await loadTranche(tx, t.id, true);
    if (left.remaining === 0 && cur.state !== "CLOSED") await tx.update(tranches).set({ state: stepTranche(cur.state, "close") }).where(eq(tranches.id, t.id));
    await notify(tx, w, t.id, "SETTLED", `Tranche ${t.idx} of “${w.title}” was settled on day ${Math.floor(day)} of the PayPal hold. ${unstarted.length ? `${unstarted.map((m) => m.code).join(", ")} had not started and went back to the client.` : "No unstarted milestones remained."}`, `settled:${t.id}`);
    await audit(tx, SYSTEM, "money.settled", t.id, { day: round1(day), returned: items, unstarted: unstarted.map((m) => m.code), carried: carried.map((m) => m.code), refundTranche });
  });
}

/* ───────────────────────── change orders (F2.12) ───────────────────────── */

/**
 * Executes the money part of an applied change order: each held tranche it reduces gives the amount back to the client
 * through returnFunds (the same return/void path as every other return; key stored on the change order before the
 * call, P2). Rail A: a part return stays authorized and is voided with the last remainder (or released by the final
 * capture); Rail B: refunded. Then milestones that are now ready open. Idempotent; a failure is recorded on the change
 * order and retried by the watchdog. Added money is never charged here: the new PLANNED tranches wait for the client to
 * fund them through fundTranche / confirmTranche.
 */
export async function settleChangeOrder(a: Actor | null, changeOrderId: string): Promise<{ pending: number }> {
  const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, changeOrderId)).limit(1);
  if (!co) throw new DomainError("NOT_FOUND", "This change order does not exist.");
  if (co.state !== "APPLIED") throw new DomainError("BAD_STATE", "Only an applied change order moves money.");
  const list: ChangeOrderReturn[] = co.returns.map((r) => ({ ...r }));
  const codes = new Map((await db.select({ id: wsMilestones.id, code: wsMilestones.code }).from(wsMilestones).where(eq(wsMilestones.workspaceId, co.workspaceId))).map((m) => [m.code, m.id]));
  for (const r of list) {
    if (r.status === "DONE") continue;
    try {
      const items = r.items.map((x) => ({ milestoneId: x.milestoneCode ? codes.get(x.milestoneCode) ?? null : null, amountCents: x.amountCents }));
      const out = await returnFunds(a, r.trancheId, items, `Change order ${co.no} (revision ${co.revNo}), signed by both parties: ${formatCents(r.amountCents)} goes back to the client`, r.idemKey);
      r.status = "DONE"; r.refundId = out.refundId; delete r.error;
    } catch (e) {
      r.status = "FAILED"; r.error = railMessage(e).slice(0, 300);
      await audit(db, auditActor(a), "money.change_order_return_failed", r.trancheId, { changeOrderId: co.id, idemKey: r.idemKey, amountCents: r.amountCents, error: r.error });
    }
  }
  await db.update(changeOrders).set({ returns: list }).where(eq(changeOrders.id, co.id));
  const opened = await openReady(db, co.workspaceId);
  const pending = list.filter((r) => r.status !== "DONE").length;
  await audit(db, auditActor(a), "money.change_order_settled", co.workspaceId, { changeOrderId: co.id, returns: list.map((r) => ({ trancheIdx: r.trancheIdx, amountCents: r.amountCents, status: r.status, refundId: r.refundId ?? null })), opened, pending });
  return { pending };
}

/** Change-order returns that have not completed (watchdog retry). */
async function retryChangeOrders(workspaceId?: string): Promise<number> {
  const rows = await db.select({ id: changeOrders.id, returns: changeOrders.returns }).from(changeOrders)
    .where(workspaceId ? and(eq(changeOrders.state, "APPLIED"), eq(changeOrders.workspaceId, workspaceId)) : eq(changeOrders.state, "APPLIED"));
  let n = 0;
  for (const r of rows) if (r.returns.some((x) => x.status !== "DONE")) { n += 1; await settleChangeOrder(null, r.id).catch(() => undefined); }
  return n;
}

/** Notices about contract amendments (change orders, continuations), to the people named (default: both parties). */
export async function noticeParties(workspaceId: string, kind: "CHANGE_ORDER" | "CONTINUATION", message: string, dedup: string, to?: string[]): Promise<void> {
  const w = await loadWorkspace(db, workspaceId);
  await notify(db, w, null, kind, message, dedup, to);
}

/* ───────────────────────── ledger (F3.11) ───────────────────────── */

export async function ledgerFor(trancheId?: string): Promise<{ at: Date; type: string; debit: string; credit: string; amountCents: number; paypalRef: string | null; milestoneId: string | null; trancheId: string }[]> {
  const q = db.select().from(ledgerEntries);
  const rows = trancheId ? await q.where(eq(ledgerEntries.trancheId, trancheId)).orderBy(asc(ledgerEntries.id)) : await q.orderBy(asc(ledgerEntries.id));
  return rows.map((r) => ({ at: r.at, type: r.type, debit: r.debit, credit: r.credit, amountCents: r.amountCents, paypalRef: r.paypalRef, milestoneId: r.milestoneId, trancheId: r.trancheId }));
}


export { processWebhookEvent } from "./webhook";

/* Deadline adjustments: read models for screens and the playground (no money moves through these). */
export { adjustmentsFor, deadlineFacts, excusedDaysFor, type AdjustmentRow, type DeadlineFacts } from "./deadline";
export { reconcileTranches, type DeadlineReconLine } from "./deadline-recon";
