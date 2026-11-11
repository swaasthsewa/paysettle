/**
 * Money module internals (F3.01, F3.02, F3.08, F3.11, F4.08): rail selection per tranche, retries with the same
 * idempotency key, ledger balances, milestone unlocking, notices. Only src/server/money/* imports this file.
 * The bonus pool is a sub-account of the tranche hold (same PayPal authorization); balances report it separately.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "@/db/client";
import { ledgerEntries, paypalLinks, refunds, releases, simSessions, tranches, workspaces, wsMilestones } from "@/db/schema";
import { moneyNotices } from "@/db/schema-money";
import { railFor, RailError, type Rail, type RailId } from "@/lib/rails";
import { milestoneMachine } from "@/lib/fsm";
import { newId, sha256 } from "@/lib/ids";
import type { Actor as AuditActor } from "@/lib/audit";
import { DomainError, type Actor } from "../types";

export type Q = Db | Tx;
export type TrancheRow = typeof tranches.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type MilestoneRow = typeof wsMilestones.$inferSelect;

export const SYSTEM: AuditActor = { id: null, role: "system" };
export const auditActor = (a: Actor | null): AuditActor => (a ? { id: a.id, role: a.role, requestId: a.requestId } : SYSTEM);

/** Tranche states in which PayPal still holds money for the tranche. */
export const FUNDED = ["HELD", "PARTIALLY_RELEASED", "SETTLING", "ROLLED_OVER", "BREAKER"] as const;
/** Milestone states that are finished as far as money is concerned. */
export const SETTLED_MS = ["RELEASED", "SETTLED_BY_VERDICT", "REFUNDED"] as const;
export const holdAccount = (trancheId: string) => `paypal:hold:${trancheId}`;
export const clientAccount = (userId: string) => `client:${userId}`;
export const providerAccount = (userId: string) => `provider:${userId}`;
export const FEE_ACCOUNT = "platform:fees";
/** The early-finish bonus pool, held in PayPal with the tranche (same authorization on Rail A, same capture on Rail B). */
export const poolAccount = (trancheId: string) => `paypal:pool:${trancheId}`;
/** Window length per rail (PRD §6.7): Rail A authorization 29 days; Rail B delayed disbursement 28 days. */
export const windowDays = (rail: string) => (rail === "B" ? 28 : 29);
export const SETTLE_DAY = 27;

export async function loadTranche(q: Q, id: string, lock = false): Promise<TrancheRow> {
  const base = q.select().from(tranches).where(eq(tranches.id, id)).limit(1);
  const [t] = lock ? await base.for("update") : await base;
  if (!t) throw new DomainError("NOT_FOUND", "This tranche does not exist.");
  return t;
}
export async function loadWorkspace(q: Q, id: string): Promise<WorkspaceRow> {
  const [w] = await q.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  if (!w) throw new DomainError("NOT_FOUND", "This contract does not exist.");
  return w;
}
export async function loadMilestone(q: Q, id: string): Promise<MilestoneRow> {
  const [m] = await q.select().from(wsMilestones).where(eq(wsMilestones.id, id)).limit(1);
  if (!m) throw new DomainError("NOT_FOUND", "This milestone does not exist.");
  return m;
}
export async function trancheMilestones(q: Q, workspaceId: string, idx: number): Promise<MilestoneRow[]> {
  return q.select().from(wsMilestones)
    .where(and(eq(wsMilestones.workspaceId, workspaceId), eq(wsMilestones.trancheIdx, idx), eq(wsMilestones.active, true)))
    .orderBy(asc(wsMilestones.targetDay), asc(wsMilestones.seq));
}
export async function trancheFor(q: Q, workspaceId: string, idx: number): Promise<TrancheRow> {
  const [t] = await q.select().from(tranches).where(and(eq(tranches.workspaceId, workspaceId), eq(tranches.idx, idx))).limit(1);
  if (!t) throw new DomainError("NOT_FOUND", "This milestone has no tranche yet.");
  return t;
}

/**
 * Ledger figures for one tranche (hold account and its bonus-pool sub-account):
 *   held = Σ HOLD (the contract part) · released = Σ RELEASE + FEE (what PayPal captured, bonus included)
 *   returned = Σ VOID + REFUND + LATE_DEDUCTION · bonuses = Σ EARLY_BONUS (moved from the pool into releases)
 *   remaining = held + bonuses − released − returned  (what is still held for unpaid milestones)
 *   pool: held = Σ BONUS_POOL, paid = Σ EARLY_BONUS, returned = Σ POOL_RETURN, remaining = held − paid − returned (never < 0)
 */
export interface Balance {
  held: number; releasedNet: number; fees: number; released: number; returned: number; remaining: number;
  deductions: number; bonuses: number; pool: { held: number; paid: number; returned: number; remaining: number };
}
export async function balanceOf(q: Q, trancheId: string): Promise<Balance> {
  const rows = await q.select({ type: ledgerEntries.type, sum: sql<string>`coalesce(sum(${ledgerEntries.amountCents}), 0)` })
    .from(ledgerEntries).where(eq(ledgerEntries.trancheId, trancheId)).groupBy(ledgerEntries.type);
  const by = (t: string) => Number(rows.find((r) => r.type === t)?.sum ?? 0);
  const held = by("HOLD"), releasedNet = by("RELEASE"), fees = by("FEE"), deductions = by("LATE_DEDUCTION"), bonuses = by("EARLY_BONUS");
  const returned = by("VOID") + by("REFUND") + deductions;
  const pool = { held: by("BONUS_POOL"), paid: bonuses, returned: by("POOL_RETURN"), remaining: by("BONUS_POOL") - bonuses - by("POOL_RETURN") };
  return { held, releasedNet, fees, released: releasedNet + fees, returned, remaining: held + bonuses - releasedNet - fees - returned, deductions, bonuses, pool };
}
/** Money already moved per milestone out of the hold (release + returns attributed to it; + deduction − bonus = the milestone's own share). */
export async function movedByMilestone(q: Q, trancheId: string): Promise<Map<string, number>> {
  const rows = await q.select({ m: ledgerEntries.milestoneId, sum: sql<string>`coalesce(sum(case when ${ledgerEntries.type} = 'EARLY_BONUS' then -${ledgerEntries.amountCents} else ${ledgerEntries.amountCents} end), 0)` })
    .from(ledgerEntries).where(and(eq(ledgerEntries.trancheId, trancheId), inArray(ledgerEntries.type, ["RELEASE", "FEE", "VOID", "REFUND", "LATE_DEDUCTION", "EARLY_BONUS"])))
    .groupBy(ledgerEntries.milestoneId);
  return new Map(rows.filter((r) => r.m).map((r) => [r.m as string, Number(r.sum)]));
}
/** What PayPal holds for the tranche in total (Rail A authorization / Rail B capture): the milestones plus the bonus pool. */
export const fundedAmount = (t: Pick<TrancheRow, "amountCents" | "bonusPoolCents">) => t.amountCents + (t.bonusPoolCents ?? 0);

/* ── rail selection ── */

/** Live/mock mode of the workspace's latest playground session (LIVE when none). */
async function modeFor(workspaceId: string): Promise<"LIVE" | "MOCK"> {
  const [s] = await db.select({ mode: simSessions.mode }).from(simSessions).where(eq(simSessions.workspaceId, workspaceId)).orderBy(desc(simSessions.createdAt)).limit(1);
  return s?.mode ?? "LIVE";
}
/**
 * The rail that holds (or will hold) this tranche's money. Once an order exists, the rail that created it is used for
 * every later call, whatever the playground mode is now — a PayPal order is never driven through the mock and vice versa.
 */
export async function railOf(t: TrancheRow): Promise<Rail> {
  if (testRail && process.env.VITEST) { const r = testRail(t); if (r) return r; }
  if (t.paypalOrderId?.startsWith("MOCKORD-")) { const r = railFor("MOCK"); await rehydrateMock(t); return r; }
  if (t.paypalOrderId) {
    const r = railFor(t.rail as RailId, "LIVE");
    if (r.id === "MOCK") throw new DomainError("RAIL_UNAVAILABLE", "This tranche is held in PayPal Sandbox, but PayPal credentials are not configured on this server.");
    return r;
  }
  return railFor(t.rail as RailId, await modeFor(t.workspaceId));
}
/**
 * Test hook (money-flow tests for Rail B semantics on a simulated rail): only honoured while Vitest runs, never in
 * the app. Return a rail for a tranche, or null to fall through to the normal choice.
 */
let testRail: ((t: TrancheRow) => Rail | null) | null = null;
export function setTestRail(fn: ((t: TrancheRow) => Rail | null) | null) {
  if (!process.env.VITEST) throw new Error("setTestRail is for tests only");
  testRail = fn;
}
/** Rail A semantics (authorization + partial captures + void) unless the rail is B (captured, delayed disbursement). */
export const isRailB = (r: Rail) => r.id === "B";

/**
 * The mock rail keeps its orders in process memory. After a server restart, orders funded earlier are rebuilt from the
 * database (same deterministic ids the mock derives), so the demo survives restarts. Sandbox/mock only — never PayPal.
 * F3.08 F5.03: the order's transaction log is rebuilt too (authorization, one capture per release, the void or refunds),
 * so a release after a restart does not leave reconciliation with a capture whose earlier history is missing (which read
 * as drift and paused the tranche). Rebuilt from the rail-facing records (releases, refunds), not from the ledger, so a
 * ledger posting with no PayPal movement behind it is still caught.
 */
async function rehydrateMock(t: TrancheRow) {
  type MockOrder = { id: string; amount: number; status: string; authId: string; captured: number; refunded: number; captures: string[] };
  type MockTxn = { id: string; type: "AUTHORIZATION" | "CAPTURE" | "REFUND" | "PAYOUT" | "VOID"; amountCents: number; ref: string; at: string };
  const store = (globalThis as unknown as { __mockRail?: { orders: Map<string, MockOrder>; txns?: MockTxn[] } }).__mockRail;
  if (!store || !t.paypalOrderId || store.orders.has(t.paypalOrderId)) return;
  const rel = await db.select({ gross: releases.grossCents, ref: releases.paypalRef, at: releases.completedAt, created: releases.createdAt }).from(releases)
    .where(and(eq(releases.trancheId, t.id), inArray(releases.status, ["COMPLETED", "IN_FLIGHT"]))).orderBy(asc(releases.createdAt));
  const rets = await db.select().from(refunds).where(and(eq(refunds.trancheId, t.id), inArray(refunds.status, ["COMPLETED", "IN_FLIGHT"]))).orderBy(asc(refunds.createdAt));
  const bal = await balanceOf(db, t.id);
  const status = t.state === "PLANNED" || t.state === "AWAITING_APPROVAL" ? "CREATED" : t.state === "CLOSED" ? (bal.returned > 0 || bal.pool.returned > 0 ? "VOIDED" : "COMPLETED") : "HELD";
  const authId = t.authorizationId ?? "MOCKAUTH-" + sha256(t.paypalOrderId).slice(0, 17).toUpperCase();
  const captured = rel.reduce((a, r) => a + r.gross, 0);
  store.orders.set(t.paypalOrderId, {
    id: t.paypalOrderId, amount: fundedAmount(t), status, authId,
    captured, refunded: 0, captures: rel.map((r) => r.ref).filter((x): x is string => Boolean(x)),
  });
  const txns = store.txns;
  if (!txns || status === "CREATED") return;
  const known = new Set(txns.map((x) => x.id));
  const push = (x: MockTxn) => { if (!known.has(x.id)) { known.add(x.id); txns.push(x); } };
  push({ id: authId, type: "AUTHORIZATION", amountCents: fundedAmount(t), ref: t.paypalOrderId, at: (t.heldAt ?? new Date()).toISOString() });
  for (const r of rel) if (r.ref) push({ id: r.ref, type: "CAPTURE", amountCents: r.gross, ref: authId, at: (r.at ?? r.created).toISOString() });
  let voided = false; // one void can cover several returns (deduction, unused pool); the rail recorded it once
  for (const f of rets) {
    if (!f.paypalRef || f.paypalRef.startsWith("recorded:")) continue; // stays authorized; voided with the last remainder
    if (f.paypalRef.startsWith("void:")) { if (!voided) push({ id: "MOCKVOID-" + sha256(f.idemKey).slice(0, 17).toUpperCase(), type: "VOID", amountCents: fundedAmount(t) - captured, ref: authId, at: f.createdAt.toISOString() }); voided = true; continue; }
    const [e] = await db.select({ type: ledgerEntries.type }).from(ledgerEntries).where(and(eq(ledgerEntries.trancheId, t.id), eq(ledgerEntries.paypalRef, f.paypalRef))).limit(1);
    push({ id: f.paypalRef, type: e?.type === "VOID" ? "VOID" : "REFUND", amountCents: f.amountCents, ref: e?.type === "VOID" ? authId : (t.captureId ?? authId), at: f.createdAt.toISOString() });
  }
}

/** Retry transient rail errors with the same idempotency key (the key lives inside `fn`): up to 3 retries (F3.08). */
export async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  const base = Number(process.env.MONEY_RETRY_MS ?? 250);
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (!(e instanceof RailError) || e.kind !== "TRANSIENT" || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, base * (attempt + 1) + Math.floor(Math.random() * base)));
    }
  }
}
export function railMessage(e: unknown): string {
  if (e instanceof RailError) {
    const why = { TRANSIENT: "PayPal is not answering right now", BUYER_ACTION: "PayPal needs the buyer to act", PAYEE_PROBLEM: "The provider's PayPal account cannot receive this payment", STATE: "PayPal reports a different state for this payment", BUG: "PayPal refused the request" }[e.kind];
    return `${why}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Provider's merchant link (A1 payee). */
export async function payeeOf(q: Q, providerId: string | null) {
  if (!providerId) return null;
  const [l] = await q.select().from(paypalLinks).where(and(eq(paypalLinks.userId, providerId), eq(paypalLinks.kind, "merchant"))).limit(1);
  return l ?? null;
}

/* ── milestone unlocking (F3.03 as used by the money module) ── */

/**
 * Opens LOCKED milestones whose prerequisites are done, in funded tranches only. DAG mode (any dependsOn in the
 * workspace): all listed prerequisites finished. Sequential mode: every active step with an earlier target day finished.
 * Returns the ids opened.
 */
export async function openReady(q: Q, workspaceId: string): Promise<string[]> {
  const ms = await q.select().from(wsMilestones).where(and(eq(wsMilestones.workspaceId, workspaceId), eq(wsMilestones.active, true)));
  const funded = new Set((await q.select({ idx: tranches.idx }).from(tranches)
    .where(and(eq(tranches.workspaceId, workspaceId), inArray(tranches.state, ["HELD", "PARTIALLY_RELEASED"])))).map((t) => t.idx));
  const done = (m: MilestoneRow) => (SETTLED_MS as readonly string[]).includes(m.state);
  const byCode = new Map(ms.map((m) => [m.code, m]));
  const dag = ms.some((m) => m.dependsOn.length > 0);
  const opened: string[] = [];
  for (const m of ms) {
    if (m.state !== "LOCKED" || !funded.has(m.trancheIdx)) continue;
    const ready = dag
      ? m.dependsOn.every((c) => { const d = byCode.get(c); return !d || done(d); })
      : ms.every((o) => o.id === m.id || o.targetDay >= m.targetDay || done(o));
    if (!ready) continue;
    await q.update(wsMilestones).set({ state: milestoneMachine.next("LOCKED", "open") }).where(and(eq(wsMilestones.id, m.id), eq(wsMilestones.state, "LOCKED")));
    opened.push(m.id);
  }
  return opened;
}

/* ── notices (F3.10) ── */

export async function notify(q: Q, w: WorkspaceRow, trancheId: string | null, kind: (typeof moneyNotices.$inferInsert)["kind"], message: string, dedup: string) {
  const people = [w.clientId, w.providerId].filter((x): x is string => Boolean(x));
  for (const userId of people) {
    await q.insert(moneyNotices).values({ id: newId("ntc"), workspaceId: w.id, trancheId, userId, kind, message, dedupKey: `${dedup}:${userId}` }).onConflictDoNothing();
  }
}

/** Atomically claims a watchdog action for a tranche (tranches.warned is the done-list). True when this call claimed it. */
export async function claimMark(q: Q, trancheId: string, mark: string): Promise<boolean> {
  const r = await q.update(tranches).set({ warned: sql`${tranches.warned} || ${JSON.stringify([mark])}::jsonb` })
    .where(and(eq(tranches.id, trancheId), sql`NOT (${tranches.warned} @> ${JSON.stringify([mark])}::jsonb)`)).returning({ id: tranches.id });
  return r.length > 0;
}
export async function unclaimMark(q: Q, trancheId: string, mark: string) {
  await q.update(tranches).set({ warned: sql`${tranches.warned} - ${mark}` }).where(eq(tranches.id, trancheId));
}
export const hasMark = (t: TrancheRow, prefix: string) => (t.warned ?? []).some((w) => w === prefix || w.startsWith(prefix + ":"));
