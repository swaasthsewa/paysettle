/**
 * Read models for the money screens and other modules' cards (F3.10, F3.11). Read-only: nothing here moves money.
 * The ledger invariant per tranche (P6): held = Σ released (gross) + Σ returned + remaining, cross-checked against the
 * releases and refunds tables and against the milestones still waiting for money.
 * The bonus pool sub-account (never negative, empty at close) and the stored deadline adjustments are checked too.
 */
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ledgerEntries, refunds, releases, tranches, users, workspaces, wsMilestones } from "@/db/schema";
import { moneyNotices, releaseAdjustments } from "@/db/schema-money";
import { DAY, HOUR, daysBetween, sandboxMode } from "@/lib/clock";
import { feeFor } from "@/lib/money";
import { watchdogPlan, type Rail as PolicyRail } from "@/lib/policy";
import { excludeSim, isTestOrgId } from "@/lib/sim";
import { offsetFor } from "../clock";
import { balanceOf, SETTLED_MS, windowDays, type Balance } from "./internal";

export const TEST_ORG_PREFIX = "org_test_";
/** Default staff views leave out playground simulations and test organisations (src/lib/sim.ts). */
const realOnly = () => excludeSim(workspaces.id, workspaces.orgId);

export interface TrancheSummary {
  id: string; idx: number; rail: string; state: string; amountCents: number; heldAt: Date | null; windowEndsAt: Date | null;
  workspaceId: string; currency: string; balance: Balance; warned: string[]; bonusPoolCents: number;
}
/** Totals per tranche for TrancheCard (other modules call this, then render the card). */
export async function trancheSummaries(workspaceId: string): Promise<TrancheSummary[]> {
  const rows = await db.select({ t: tranches, currency: workspaces.currency }).from(tranches).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId))
    .where(eq(tranches.workspaceId, workspaceId)).orderBy(asc(tranches.idx));
  return Promise.all(rows.map(async ({ t, currency }) => ({ id: t.id, idx: t.idx, rail: t.rail, state: t.state, amountCents: t.amountCents, heldAt: t.heldAt, windowEndsAt: t.windowEndsAt, workspaceId: t.workspaceId, currency, balance: await balanceOf(db, t.id), warned: t.warned, bonusPoolCents: t.bonusPoolCents })));
}

/** The workspace's virtual now (real time plus the playground offset, sandbox only). */
export async function virtualNow(workspaceId: string): Promise<Date> {
  const off = sandboxMode() ? await offsetFor(workspaceId) : 0;
  return new Date(Date.now() + off * HOUR);
}

/* ── fund screen ── */
export async function fundView(workspaceId: string, trancheId: string) {
  const [row] = await db.select({ t: tranches, w: workspaces }).from(tranches).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId))
    .where(and(eq(tranches.id, trancheId), eq(tranches.workspaceId, workspaceId))).limit(1);
  if (!row) return null;
  const { t, w } = row;
  const ms = await db.select().from(wsMilestones).where(and(eq(wsMilestones.workspaceId, w.id), eq(wsMilestones.trancheIdx, t.idx), eq(wsMilestones.active, true))).orderBy(asc(wsMilestones.targetDay), asc(wsMilestones.seq));
  const people = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [w.clientId, w.providerId ?? w.clientId]));
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? "—";
  const lines = ms.map((m) => { const fee = m.type === "PAY" ? feeFor(m.amountCents, w.feeBps) : 0; return { id: m.id, code: m.code, title: m.title, type: m.type, day: m.targetDay, state: m.state, amountCents: m.amountCents, feeCents: fee, netCents: m.amountCents - fee }; });
  return {
    tranche: t, workspace: w, client: name(w.clientId), provider: name(w.providerId), lines, bonusPoolCents: t.bonusPoolCents, fundCents: t.amountCents + t.bonusPoolCents,
    totalFee: lines.reduce((s, l) => s + l.feeCents, 0), windowDays: windowDays(t.rail), balance: await balanceOf(db, t.id), now: await virtualNow(w.id),
  };
}

/* ── receipts and payouts ── */
export interface MoneyLine {
  at: Date; workspaceId: string; title: string; trancheIdx: number; code: string | null; label: string; kind: "RELEASE" | "VERDICT" | "RETURN"; status: string; grossCents: number; feeCents: number; netCents: number; paypalRef: string | null;
  /** The deadline adjustment inside a milestone release (base = milestone amount; gross = base − deduction + bonus). */
  adjustment?: { timing: "ON_TIME" | "LATE" | "EARLY"; daysLate: number; daysEarly: number; countedDays: number; excusedDays: number; baseCents: number; deductionCents: number; bonusCents: number } | null;
}

async function linesFor(wsIds: string[]): Promise<MoneyLine[]> {
  if (!wsIds.length) return [];
  // Gates carry no money, so their zero-amount release records are not receipts or payouts.
  const rel = await db.select({ r: releases, m: wsMilestones, w: workspaces, t: tranches }).from(releases)
    .innerJoin(wsMilestones, eq(wsMilestones.id, releases.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).innerJoin(tranches, eq(tranches.id, releases.trancheId))
    .where(and(inArray(workspaces.id, wsIds), ne(wsMilestones.type, "GATE")));
  const ret = await db.select({ f: refunds, w: workspaces, t: tranches }).from(refunds).innerJoin(tranches, eq(tranches.id, refunds.trancheId)).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId))
    .where(inArray(workspaces.id, wsIds));
  const adjs = rel.length ? await db.select().from(releaseAdjustments).where(inArray(releaseAdjustments.releaseId, rel.map((x) => x.r.id))) : [];
  const adjOf = (id: string) => { const a = adjs.find((x) => x.releaseId === id); return a ? { timing: a.timing, daysLate: a.daysLate, daysEarly: a.daysEarly, countedDays: a.countedDays, excusedDays: a.excusedDays, baseCents: a.baseCents, deductionCents: a.deductionCents, bonusCents: a.bonusCents } : null; };
  const out: MoneyLine[] = [
    ...rel.map(({ r, m, w, t }) => ({ at: r.completedAt ?? r.createdAt, workspaceId: w.id, title: w.title, trancheIdx: t.idx, code: m.code, label: m.title, kind: r.kind === "VERDICT" ? "VERDICT" as const : "RELEASE" as const, status: r.status, grossCents: r.grossCents, feeCents: r.feeCents, netCents: r.netCents, paypalRef: r.paypalRef, adjustment: adjOf(r.id) })),
    ...ret.map(({ f, w, t }) => ({ at: f.createdAt, workspaceId: w.id, title: w.title, trancheIdx: t.idx, code: null, label: f.reason, kind: "RETURN" as const, status: f.status, grossCents: f.amountCents, feeCents: 0, netCents: f.amountCents, paypalRef: f.paypalRef })),
  ];
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** A person's own default view leaves out simulations, and test organisations unless the person is in one. */
async function personFilter(userId: string) {
  const [me] = await db.select({ orgId: users.orgId }).from(users).where(eq(users.id, userId)).limit(1);
  return excludeSim(workspaces.id, workspaces.orgId, { keepTest: isTestOrgId(me?.orgId) });
}
export async function receiptsFor(clientId: string) {
  const ws = await db.select().from(workspaces).where(and(eq(workspaces.clientId, clientId), await personFilter(clientId))).orderBy(desc(workspaces.updatedAt));
  return contractsWithMoney(ws);
}
export async function payoutsFor(providerId: string) {
  const ws = await db.select().from(workspaces).where(and(eq(workspaces.providerId, providerId), await personFilter(providerId))).orderBy(desc(workspaces.updatedAt));
  return contractsWithMoney(ws);
}
async function contractsWithMoney(ws: (typeof workspaces.$inferSelect)[]) {
  const lines = await linesFor(ws.map((w) => w.id));
  const out = [];
  for (const w of ws) {
    const sums = await trancheSummaries(w.id);
    if (!sums.some((s) => s.balance.held > 0) && !lines.some((l) => l.workspaceId === w.id)) continue;
    out.push({ workspace: w, tranches: sums, lines: lines.filter((l) => l.workspaceId === w.id) });
  }
  return out;
}

export async function noticesFor(userId: string, limit = 8) {
  return db.select().from(moneyNotices).where(eq(moneyNotices.userId, userId)).orderBy(desc(moneyNotices.createdAt)).limit(limit);
}

/* ── finance ledger ── */
export interface LedgerFilter { workspaceId?: string; trancheId?: string; type?: string; includeTest?: boolean }
export async function ledgerView(f: LedgerFilter) {
  const conds = [];
  if (f.workspaceId) conds.push(eq(tranches.workspaceId, f.workspaceId));
  if (f.trancheId) conds.push(eq(ledgerEntries.trancheId, f.trancheId));
  if (f.type) conds.push(eq(ledgerEntries.type, f.type as "HOLD"));
  if (!f.includeTest) conds.push(realOnly());
  const rows = await db.select({ e: ledgerEntries, title: workspaces.title, wsId: workspaces.id, idx: tranches.idx, code: wsMilestones.code }).from(ledgerEntries)
    .innerJoin(tranches, eq(tranches.id, ledgerEntries.trancheId)).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId))
    .leftJoin(wsMilestones, eq(wsMilestones.id, ledgerEntries.milestoneId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(ledgerEntries.id)).limit(500);
  const accounts = new Map<string, { debit: number; credit: number }>();
  for (const { e } of rows) {
    const d = accounts.get(e.debit) ?? { debit: 0, credit: 0 }; d.debit += e.amountCents; accounts.set(e.debit, d);
    const c = accounts.get(e.credit) ?? { debit: 0, credit: 0 }; c.credit += e.amountCents; accounts.set(e.credit, c);
  }
  const contracts = await db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces).innerJoin(tranches, eq(tranches.workspaceId, workspaces.id))
    .where(f.includeTest ? undefined : realOnly()).groupBy(workspaces.id, workspaces.title).orderBy(asc(workspaces.title));
  return { rows, accounts: [...accounts.entries()].map(([account, v]) => ({ account, ...v, balance: v.debit - v.credit })).sort((a, b) => a.account.localeCompare(b.account)), contracts };
}

export interface InvariantResult { trancheId: string; workspaceId: string; title: string; idx: number; state: string; ok: boolean; balance: Balance; checks: { name: string; ok: boolean; detail: string }[] }
/** Ledger invariant for one tranche, with the cross-checks that make it meaningful. */
export async function checkInvariant(trancheId: string): Promise<InvariantResult> {
  const [{ t, w }] = await db.select({ t: tranches, w: workspaces }).from(tranches).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId)).where(eq(tranches.id, trancheId)).limit(1);
  const bal = await balanceOf(db, trancheId);
  const [relSum] = await db.select({ s: sql<string>`coalesce(sum(${releases.grossCents}), 0)` }).from(releases).where(and(eq(releases.trancheId, trancheId), inArray(releases.status, ["COMPLETED", "IN_FLIGHT"])));
  const [retSum] = await db.select({ s: sql<string>`coalesce(sum(${refunds.amountCents}), 0)` }).from(refunds).where(and(eq(refunds.trancheId, trancheId), inArray(refunds.status, ["COMPLETED", "RECORDED", "IN_FLIGHT"])));
  const ms = await db.select().from(wsMilestones).where(and(eq(wsMilestones.workspaceId, w.id), eq(wsMilestones.trancheIdx, t.idx), eq(wsMilestones.active, true), eq(wsMilestones.type, "PAY")));
  const waiting = ms.filter((m) => !(SETTLED_MS as readonly string[]).includes(m.state) && m.state !== "DISPUTED").reduce((s, m) => s + m.amountCents, 0);
  const funded = bal.held > 0;
  const [adj] = await db.select({ d: sql<string>`coalesce(sum(${releaseAdjustments.deductionCents}) filter (where ${releaseAdjustments.deductionStatus} in ('RECORDED','COMPLETED')), 0)`, b: sql<string>`coalesce(sum(${releaseAdjustments.bonusCents}), 0)` })
    .from(releaseAdjustments).innerJoin(releases, eq(releases.id, releaseAdjustments.releaseId)).where(and(eq(releaseAdjustments.trancheId, trancheId), inArray(releases.status, ["COMPLETED", "IN_FLIGHT"])));
  const checks = [
    { name: "Hold matches tranche", ok: !funded || bal.held === t.amountCents, detail: `${bal.held} held vs ${t.amountCents} planned` },
    { name: "Bonus pool matches tranche", ok: !funded || bal.pool.held === t.bonusPoolCents, detail: `${bal.pool.held} pool held vs ${t.bonusPoolCents} planned` },
    { name: "Releases match ledger", ok: Number(relSum.s) === bal.released, detail: `${relSum.s} in releases vs ${bal.released} in ledger` },
    { name: "Returns match ledger", ok: Number(retSum.s) === bal.returned + bal.pool.returned, detail: `${retSum.s} in returns vs ${bal.returned} + ${bal.pool.returned} (pool) in ledger` },
    { name: "Adjustments match ledger", ok: Number(adj?.d ?? 0) === bal.deductions && Number(adj?.b ?? 0) === bal.bonuses, detail: `deductions ${adj?.d ?? 0} vs ${bal.deductions}; bonuses ${adj?.b ?? 0} vs ${bal.bonuses}` },
    { name: "held + bonuses = released + returned + remaining", ok: bal.remaining >= 0 && bal.held + bal.bonuses === bal.released + bal.returned + bal.remaining, detail: `${bal.held} + ${bal.bonuses} = ${bal.released} + ${bal.returned} + ${bal.remaining}` },
    { name: "Pool = paid + returned + left, never negative", ok: bal.pool.remaining >= 0 && bal.pool.held === bal.pool.paid + bal.pool.returned + bal.pool.remaining, detail: `${bal.pool.held} = ${bal.pool.paid} + ${bal.pool.returned} + ${bal.pool.remaining}` },
    { name: "Remaining covers open milestones", ok: !funded || ["ROLLED_OVER", "CLOSED"].includes(t.state) || bal.remaining >= waiting, detail: `${bal.remaining} remaining vs ${waiting} still due` },
    { name: "Closed means empty", ok: t.state !== "CLOSED" || (bal.remaining === 0 && bal.pool.remaining === 0), detail: `state ${t.state}, remaining ${bal.remaining}, pool left ${bal.pool.remaining}` },
  ];
  return { trancheId, workspaceId: w.id, title: w.title, idx: t.idx, state: t.state, ok: checks.every((c) => c.ok), balance: bal, checks };
}
export async function invariants(f: LedgerFilter) {
  const conds = [inArray(tranches.state, ["HELD", "PARTIALLY_RELEASED", "SETTLING", "ROLLED_OVER", "CLOSED", "BREAKER"])];
  if (f.workspaceId) conds.push(eq(tranches.workspaceId, f.workspaceId));
  if (f.trancheId) conds.push(eq(tranches.id, f.trancheId));
  if (!f.includeTest) conds.push(realOnly());
  const ts = await db.select({ id: tranches.id }).from(tranches).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId)).where(and(...conds)).orderBy(asc(workspaces.title), asc(tranches.idx)).limit(200);
  return Promise.all(ts.map((t) => checkInvariant(t.id)));
}

/* ── ops radar ── */
export interface RadarRow { trancheId: string; workspaceId: string; title: string; idx: number; rail: string; state: string; remainingCents: number; currency: string; day: number; daysLeft: number; next: { day: number; action: string } | null; urgency: "ok" | "warn" | "risk" | "danger"; warned: string[]; simulated: boolean }
export async function radar(includeTest = false): Promise<RadarRow[]> {
  const conds = [inArray(tranches.state, ["HELD", "PARTIALLY_RELEASED", "SETTLING", "ROLLED_OVER", "BREAKER"])];
  if (!includeTest) conds.push(realOnly());
  const rows = await db.select({ t: tranches, w: workspaces }).from(tranches).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId)).where(and(...conds));
  const out: RadarRow[] = [];
  for (const { t, w } of rows) {
    if (!t.heldAt) continue;
    const bal = await balanceOf(db, t.id);
    if (bal.remaining <= 0) continue;
    const off = sandboxMode() ? await offsetFor(w.id) : 0;
    const now = new Date(Date.now() + off * HOUR);
    const day = daysBetween(t.heldAt, now);
    const ends = t.windowEndsAt ?? new Date(t.heldAt.getTime() + windowDays(t.rail) * DAY);
    const daysLeft = (ends.getTime() - now.getTime()) / DAY;
    const next = watchdogPlan(t.rail as PolicyRail).find((s) => !(t.warned ?? []).includes(s.action)) ?? null;
    const urgency = day >= 27 ? "danger" : day >= 25 ? "risk" : day >= 22 ? "warn" : "ok";
    out.push({ trancheId: t.id, workspaceId: w.id, title: w.title, idx: t.idx, rail: t.rail, state: t.state, remainingCents: bal.remaining, currency: w.currency, day, daysLeft, next, urgency, warned: t.warned ?? [], simulated: off !== 0 });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

