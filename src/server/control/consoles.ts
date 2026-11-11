/**
 * Read models for the back-office consoles: Ops overview (F2.11 clearance SLA, hold-window radar summary,
 * escalations, dispute SLAs), Finance overview (F3.11 ledger totals, breakers), webhook/DLQ list (F5.02), audit explorer (F5.04).
 * Timers read the per-workspace virtual clock (workspaceNow).
 */
import { and, asc, desc, eq, gte, ilike, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { auditChain, disputes, ledgerEntries, tranches, users, webhookEvents, workspaces, wsMilestones } from "@/db/schema";
import { reconLines } from "@/db/schema-control";
import { HOUR } from "@/lib/clock";
import { workspaceNow } from "../clock";
import { REAL_WS_SQL, realWorkspace } from "./common";

export const CLEARANCE_SLA_MS = 2 * HOUR, CLEARANCE_ESCALATE_MS = 90 * 60_000;
/** F2.11: Ops clearance SLA is 2 h with escalation at 90 min. */
export const clearanceStatus = (ageMs: number) => (ageMs >= CLEARANCE_SLA_MS ? "BREACHED" : ageMs >= CLEARANCE_ESCALATE_MS ? "ESCALATED" : "ON_TIME");
const nowCache = async (ids: string[]) => new Map(await Promise.all([...new Set(ids)].map(async (id) => [id, await workspaceNow(id)] as const)));

export async function opsOverview() {
  const pending = await db.select({ id: workspaces.id, title: workspaces.title, riskScore: workspaces.riskScore, totalCents: workspaces.totalCents, since: workspaces.updatedAt })
    .from(workspaces).where(and(eq(workspaces.state, "PENDING_OPS"), realWorkspace(workspaces.id, workspaces.orgId))).orderBy(asc(workspaces.updatedAt));
  const held = await db.select({ id: tranches.id, workspaceId: tranches.workspaceId, title: workspaces.title, idx: tranches.idx, rail: tranches.rail, amountCents: tranches.amountCents, state: tranches.state, heldAt: tranches.heldAt, windowEndsAt: tranches.windowEndsAt })
    .from(tranches).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId)).where(and(inArray(tranches.state, ["HELD", "PARTIALLY_RELEASED", "SETTLING", "BREAKER"]), realWorkspace(workspaces.id, workspaces.orgId)));
  const escalated = await db.select({ id: wsMilestones.id, workspaceId: wsMilestones.workspaceId, title: workspaces.title, code: wsMilestones.code, milestone: wsMilestones.title, amountCents: wsMilestones.amountCents, reviewDueAt: wsMilestones.reviewDueAt })
    .from(wsMilestones).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).where(and(eq(wsMilestones.state, "ESCALATED"), realWorkspace(workspaces.id, workspaces.orgId)));
  const open = await db.select({ id: disputes.id, state: disputes.state, tier: disputes.tier, amountCents: disputes.amountCents, tier1Until: disputes.tier1Until, vaultUntil: disputes.vaultUntil, createdAt: disputes.createdAt, workspaceId: wsMilestones.workspaceId, title: workspaces.title, code: wsMilestones.code })
    .from(disputes).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .where(and(notInArray(disputes.state, ["RESOLVED", "SUPERSEDED"]), realWorkspace(workspaces.id, workspaces.orgId)));
  const clocks = await nowCache([...pending.map((p) => p.id), ...held.map((h) => h.workspaceId), ...open.map((d) => d.workspaceId)]);
  const real = Date.now();

  const clearance = pending.map((p) => {
    const age = (clocks.get(p.id)?.getTime() ?? real) - p.since.getTime();
    return { ...p, ageMs: age, status: clearanceStatus(age) };
  });
  const radar = held.map((h) => {
    const now = clocks.get(h.workspaceId)?.getTime() ?? real;
    const end = h.windowEndsAt?.getTime() ?? (h.heldAt ? h.heldAt.getTime() + 29 * 24 * HOUR : null);
    return { ...h, hoursLeft: end === null ? null : Math.floor((end - now) / HOUR) };
  }).filter((h) => h.hoursLeft !== null && h.hoursLeft <= 7 * 24).sort((a, b) => (a.hoursLeft ?? 0) - (b.hoursLeft ?? 0));
  const disputeSla = open.map((d) => {
    const now = clocks.get(d.workspaceId)?.getTime() ?? real;
    const deadline = d.state === "TIER1" ? d.tier1Until : d.state === "TIER2" ? d.vaultUntil : new Date(d.createdAt.getTime() + 144 * HOUR);
    return { ...d, deadline, hoursLeft: Math.floor((deadline.getTime() - now) / HOUR) };
  }).sort((a, b) => a.hoursLeft - b.hoursLeft);
  return { clearance, radar, escalated, disputeSla, nearingSla: disputeSla.filter((d) => d.hoursLeft <= 24) };
}

export async function financeOverview() {
  const [t] = (await db.execute(sql`
    select coalesce(sum(case when l.type in ('HOLD','BONUS_POOL') then l.amount_cents end),0)::bigint as hold,
      coalesce(sum(case when l.type = 'RELEASE' then l.amount_cents end),0)::bigint as released,
      coalesce(sum(case when l.type = 'FEE' then l.amount_cents end),0)::bigint as fees,
      coalesce(sum(case when l.type in ('REFUND','VOID','LATE_DEDUCTION','POOL_RETURN') then l.amount_cents end),0)::bigint as returned,
      count(*)::int as entries
    from ledger_entries l join tranches t on t.id = l.tranche_id join workspaces w on w.id = t.workspace_id where ${REAL_WS_SQL("w")}`)).rows as { hold: string; released: string; fees: string; returned: string; entries: number }[];
  const n = (x: string | number | undefined) => Number(x ?? 0);
  const hold = n(t?.hold), released = n(t?.released), fees = n(t?.fees), returned = n(t?.returned);
  const breakers = await db.select({ id: tranches.id, workspaceId: tranches.workspaceId, title: workspaces.title, idx: tranches.idx, rail: tranches.rail, amountCents: tranches.amountCents })
    .from(tranches).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId)).where(and(eq(tranches.state, "BREAKER"), realWorkspace(workspaces.id, workspaces.orgId)));
  const lastLines = breakers.length ? await db.select().from(reconLines).where(and(inArray(reconLines.trancheId, breakers.map((b) => b.id)), eq(reconLines.status, "DRIFT"))).orderBy(desc(reconLines.createdAt)) : [];
  const byState = await db.select({ state: tranches.state, n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${tranches.amountCents}),0)::bigint` }).from(tranches).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId)).where(realWorkspace(workspaces.id, workspaces.orgId)).groupBy(tranches.state);
  return {
    heldCents: hold - released - fees - returned, holdTotalCents: hold, releasedCents: released, feeCents: fees, returnedCents: returned, entries: t?.entries ?? 0,
    breakers: breakers.map((b) => ({ ...b, notes: lastLines.find((l) => l.trancheId === b.id)?.notes ?? [] })),
    byState: byState.map((s) => ({ state: s.state, n: s.n, cents: Number(s.cents) })),
  };
}

export async function webhookList(limit = 200) {
  return db.select().from(webhookEvents).orderBy(desc(webhookEvents.receivedAt)).limit(limit);
}

/** Dead letters: handler failures, plus verified events stuck unprocessed for more than 15 minutes. */
export function deadLetters<T extends { state: string; verified: boolean; receivedAt: Date }>(events: T[], now = new Date()): T[] {
  return events.filter((e) => e.state === "DEAD" || (e.state === "RECEIVED" && e.verified && now.getTime() - e.receivedAt.getTime() > 15 * 60_000));
}

export interface AuditFilter { action?: string; actor?: string; target?: string; from?: string; to?: string; page?: number; size?: number }
export async function auditPage(f: AuditFilter) {
  const size = Math.min(Math.max(f.size ?? 50, 10), 200), page = Math.max(f.page ?? 1, 1);
  const w: SQL[] = [];
  if (f.action) w.push(ilike(auditChain.action, `${f.action.replace(/[%_]/g, "")}%`));
  if (f.actor) w.push(eq(auditChain.actorId, f.actor));
  if (f.target) w.push(ilike(auditChain.target, `%${f.target.replace(/[%_]/g, "")}%`));
  if (f.from && !Number.isNaN(Date.parse(f.from))) w.push(gte(auditChain.at, new Date(f.from)));
  if (f.to && !Number.isNaN(Date.parse(f.to))) w.push(lte(auditChain.at, new Date(new Date(f.to).getTime() + 24 * HOUR - 1)));
  const where = w.length ? and(...w) : undefined;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(auditChain).where(where);
  const rows = await db.select({ a: auditChain, name: users.name }).from(auditChain).leftJoin(users, eq(users.id, auditChain.actorId)).where(where).orderBy(desc(auditChain.seq)).limit(size).offset((page - 1) * size);
  const actions = await db.selectDistinct({ a: sql<string>`split_part(${auditChain.action}, '.', 1)` }).from(auditChain);
  const actors = await db.selectDistinct({ id: auditChain.actorId, name: users.name }).from(auditChain).leftJoin(users, eq(users.id, auditChain.actorId));
  return { total: n, page, size, pages: Math.max(1, Math.ceil(n / size)), rows: rows.map((r) => ({ ...r.a, actorName: r.name })), areas: actions.map((x) => x.a).sort(), actors: actors.filter((x) => x.id).map((x) => ({ id: x.id!, name: x.name ?? x.id! })) };
}

export async function ledgerTotalsFor(trancheId: string) {
  return db.select({ type: ledgerEntries.type, cents: sql<number>`sum(${ledgerEntries.amountCents})::bigint` }).from(ledgerEntries).where(eq(ledgerEntries.trancheId, trancheId)).groupBy(ledgerEntries.type);
}
