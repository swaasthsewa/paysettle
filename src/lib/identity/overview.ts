// F1 role overviews (client and provider home pages) · where the money is for every contract a person takes part in,
// and what is waiting for them. Read-only: queries workspaces, ws_milestones, tranches, releases, refunds, ledger
// voids, disputes and signatures directly, and reads deadlines on each contract's virtual clock.
//
// Money per tranche (integer cents, P6):
//   funded    the tranche's amount once PayPal holds it (any state after AWAITING_APPROVAL)
//   released  gross of completed releases (what left the hold: the provider's net plus the release fee)
//   returned  completed refunds plus voided remainders
//   held      funded − released − returned, never below zero, and zero once the tranche is CLOSED
//   waiting   the amount of tranches of a sealed contract that are not funded yet
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { disputes, ledgerEntries, refunds, releases, signatures, tranches, users, workspaces, wsMilestones } from "@/db/schema";
import { workspaceNow } from "@/server/clock";
import { excludeSim, isTestOrgId } from "@/lib/sim";

import { addMoney, contractStage, STAGE_ORDER, trancheMoney, UNFUNDED, zero, type Money } from "./money-view";
export { addMoney, contractStage, OPEN_DISPUTE, STAGE_ORDER, trancheMoney, zero, type Money } from "./money-view";

export interface OverviewContract {
  id: string; title: string; state: string; stage: { key: string; label: string }; currency: string; totalCents: number; feeBps: number; revision: number;
  counterpart: string | null; inviteEmail: string | null; money: Money; nowMs: number; blueprintCode: string;
  signedByMe: boolean; signedByThem: boolean;
}
export interface OverviewMilestone { id: string; workspaceId: string; code: string; title: string; type: "GATE" | "PAY"; state: string; amountCents: number; targetDay: number; attempts: number; reviewDueAt: Date | null; trancheIdx: number; funded: boolean }
export interface OverviewDispute { id: string; milestoneId: string; workspaceId: string; code: string; title: string; state: string; tier: number; amountCents: number; tier1Until: Date; vaultUntil: Date }
export interface OverviewTranche { id: string; workspaceId: string; idx: number; amountCents: number; state: string; startDay: number; endDay: number; windowEndsAt: Date | null }
export interface OverviewRelease { workspaceId: string; milestoneId: string; netCents: number; feeCents: number; grossCents: number; status: string; completedAt: Date | null; createdAt: Date }
export interface Overview { realNowMs: number; contracts: OverviewContract[]; milestones: OverviewMilestone[]; tranches: OverviewTranche[]; disputes: OverviewDispute[]; releases: OverviewRelease[]; total: Money; invites: OverviewContract[] }

export async function loadOverview(v: { id: string; email: string; role: "client" | "provider" }): Promise<Overview> {
  const realNowMs = Date.now();
  const mineCond = v.role === "client" ? eq(workspaces.clientId, v.id)
    : or(eq(workspaces.providerId, v.id), and(isNull(workspaces.providerId), sql`lower(${workspaces.inviteEmail}) = ${v.email.toLowerCase()}`));
  // Playground simulations and test organisations stay off the real personas' overviews (src/lib/sim.ts).
  const [me] = await db.select({ orgId: users.orgId }).from(users).where(eq(users.id, v.id)).limit(1);
  const ws = await db.select().from(workspaces).where(and(mineCond, excludeSim(workspaces.id, workspaces.orgId, { keepTest: isTestOrgId(me?.orgId) })));
  if (!ws.length) return { realNowMs, contracts: [], milestones: [], tranches: [], disputes: [], releases: [], total: zero(), invites: [] };
  const ids = ws.map((w) => w.id);
  const people = new Set(ws.flatMap((w) => [w.clientId, w.providerId].filter((x): x is string => Boolean(x))));
  const [names, ms, ts, sigs] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...people])),
    db.select().from(wsMilestones).where(and(inArray(wsMilestones.workspaceId, ids), eq(wsMilestones.active, true))),
    db.select().from(tranches).where(inArray(tranches.workspaceId, ids)),
    db.select({ workspaceId: signatures.workspaceId, revNo: signatures.revNo, role: signatures.role, signerId: signatures.signerId, voided: signatures.voidedAtRev }).from(signatures).where(inArray(signatures.workspaceId, ids)),
  ]);
  const tIds = ts.map((t) => t.id), mIds = ms.map((m) => m.id);
  const [rel, ref, voids, dis] = await Promise.all([
    tIds.length ? db.select().from(releases).where(inArray(releases.trancheId, tIds)) : Promise.resolve([]),
    tIds.length ? db.select().from(refunds).where(inArray(refunds.trancheId, tIds)) : Promise.resolve([]),
    tIds.length ? db.select({ trancheId: ledgerEntries.trancheId, amountCents: ledgerEntries.amountCents }).from(ledgerEntries).where(and(inArray(ledgerEntries.trancheId, tIds), eq(ledgerEntries.type, "VOID"))) : Promise.resolve([]),
    mIds.length ? db.select().from(disputes).where(inArray(disputes.milestoneId, mIds)) : Promise.resolve([]),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const nows = new Map(await Promise.all(ids.map(async (id) => [id, (await workspaceNow(id)).getTime()] as const)));
  const wsOfTranche = new Map(ts.map((t) => [t.id, t.workspaceId]));
  const msById = new Map(ms.map((m) => [m.id, m]));

  const moneyBy = new Map<string, Money>();
  for (const t of ts) {
    const w = ws.find((x) => x.id === t.workspaceId)!;
    const moved = {
      releasedGross: rel.filter((r) => r.trancheId === t.id && r.status === "COMPLETED").reduce((a, r) => a + r.grossCents, 0),
      refunded: ref.filter((r) => r.trancheId === t.id && r.status === "COMPLETED").reduce((a, r) => a + r.amountCents, 0),
      voided: voids.filter((x) => x.trancheId === t.id).reduce((a, x) => a + x.amountCents, 0),
    };
    moneyBy.set(t.workspaceId, addMoney(moneyBy.get(t.workspaceId) ?? zero(), trancheMoney(t, moved, w.state === "LOCKED")));
  }

  const contracts: OverviewContract[] = ws.map((w) => {
    const live = sigs.filter((s) => s.workspaceId === w.id && s.revNo === w.revision && s.voided == null);
    const otherId = v.role === "client" ? w.providerId : w.clientId;
    return {
      id: w.id, title: w.title, state: w.state, stage: contractStage(w.state, ts.filter((t) => t.workspaceId === w.id).map((t) => t.state)), currency: w.currency,
      totalCents: w.totalCents, feeBps: w.feeBps, revision: w.revision, counterpart: otherId ? nameOf.get(otherId) ?? null : null, inviteEmail: w.inviteEmail,
      money: moneyBy.get(w.id) ?? zero(), nowMs: nows.get(w.id) ?? realNowMs, blueprintCode: w.blueprintCode,
      signedByMe: live.some((s) => s.role === v.role), signedByThem: live.some((s) => s.role !== v.role),
    };
  }).sort((a, b) => STAGE_ORDER.indexOf(a.stage.key) - STAGE_ORDER.indexOf(b.stage.key) || a.title.localeCompare(b.title));

  const fundedIdx = new Set(ts.filter((t) => !UNFUNDED.has(t.state)).map((t) => `${t.workspaceId}:${t.idx}`));
  const invites = v.role === "provider" ? contracts.filter((c) => ws.find((w) => w.id === c.id)?.providerId == null) : [];
  const inviteIds = new Set(invites.map((c) => c.id));
  return {
    realNowMs,
    contracts: contracts.filter((c) => !inviteIds.has(c.id)),
    invites,
    milestones: ms.filter((m) => !inviteIds.has(m.workspaceId)).map((m) => ({ id: m.id, workspaceId: m.workspaceId, code: m.code, title: m.title, type: m.type, state: m.state, amountCents: m.amountCents, targetDay: m.targetDay, attempts: m.attempts, reviewDueAt: m.reviewDueAt, trancheIdx: m.trancheIdx, funded: fundedIdx.has(`${m.workspaceId}:${m.trancheIdx}`) })),
    tranches: ts.map((t) => ({ id: t.id, workspaceId: t.workspaceId, idx: t.idx, amountCents: t.amountCents, state: t.state, startDay: t.startDay, endDay: t.endDay, windowEndsAt: t.windowEndsAt })),
    disputes: dis.map((d) => { const m = msById.get(d.milestoneId)!; return { id: d.id, milestoneId: d.milestoneId, workspaceId: m.workspaceId, code: m.code, title: m.title, state: d.state, tier: d.tier, amountCents: d.amountCents, tier1Until: d.tier1Until, vaultUntil: d.vaultUntil }; }),
    releases: rel.map((r) => ({ workspaceId: wsOfTranche.get(r.trancheId) ?? "", milestoneId: r.milestoneId, netCents: r.netCents, feeCents: r.feeCents, grossCents: r.grossCents, status: r.status, completedAt: r.completedAt, createdAt: r.createdAt })),
    total: contracts.filter((c) => !inviteIds.has(c.id)).reduce((a, c) => addMoney(a, c.money), zero()),
  };
}

/** Where things open: the contract screen, one milestone (evidence and review), funding a tranche, one dispute. */
export const contractHref = (_role: "client" | "provider", id: string) => `/contracts/${id}`;
export const milestoneHref = (wsId: string, milestoneId: string) => `/contracts/${wsId}/m/${milestoneId}`;
export const fundHref = (wsId: string, trancheId: string) => `/contracts/${wsId}/fund/${trancheId}`;
export const disputeHref = (disputeId: string) => `/disputes/${disputeId}`;
