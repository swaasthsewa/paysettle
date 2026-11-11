/**
 * F4.01 F4.05 — read model for the mediator schedule. Read-only: unlike the case queue it never advances a dispute, it
 * only reads the stored deadlines (disputes.tier1_until / vault_until, dispute_meta.tier3_until) and each contract's
 * virtual clock. Returns plain data (ISO strings) for the Bryntum Scheduler client component.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { disputes, users, workspaces, wsMilestones } from "@/db/schema";
import { disputeMeta } from "@/db/schema-disputes";
import type { Viewer } from "@/lib/session";
import { excludeSim, isTestOrgId } from "@/lib/sim";
import { workspaceNow } from "@/server/clock";
import { buildCaseEvent, UNASSIGNED, type CaseEvent } from "@/components/timeline/plan";

export interface ScheduleData {
  resources: { id: string; name: string; open: number; you: boolean }[];
  events: (CaseEvent & { mediator: string; cosigner: string | null; client: string; provider: string; fastTrack: boolean; amountCents: number })[];
  now: string; startDate: string; endDate: string;
}

const HOUR = 3_600_000;

export async function mediatorSchedule(v: Viewer): Promise<ScheduleData> {
  const rows = await db.select({ d: disputes, m: wsMilestones, w: workspaces, meta: disputeMeta }).from(disputes)
    .innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .leftJoin(disputeMeta, eq(disputeMeta.disputeId, disputes.id))
    .where(and(eq(workspaces.orgId, v.orgId), excludeSim(workspaces.id, workspaces.orgId, { keepTest: isTestOrgId(v.orgId) }))).orderBy(asc(disputes.createdAt)); // no playground cases
  const mediators = await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.orgId, v.orgId), eq(users.role, "mediator"))).orderBy(asc(users.name));
  const ids = [...new Set(rows.flatMap((r) => [r.w.clientId, r.w.providerId, r.d.mediatorId, r.d.cosignerId]).filter((x): x is string => !!x))];
  const names = new Map((ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : []).map((u) => [u.id, u.name]));
  const clocks = new Map<string, Date>();
  for (const id of new Set(rows.map((r) => r.w.id))) clocks.set(id, await workspaceNow(id));

  const events = rows.filter((r) => r.d.state !== "SUPERSEDED").map((r) => {
    const e = buildCaseEvent({
      id: r.d.id, state: r.d.state, amountCents: r.d.amountCents, currency: r.w.currency, mediatorId: r.d.mediatorId, createdAt: r.d.createdAt,
      tier1Until: r.d.tier1Until, vaultUntil: r.d.vaultUntil, tier3Until: r.meta?.tier3Until ?? null, fastTrack: r.meta?.fastTrack ?? false,
      workspace: r.w.title, milestone: `${r.m.code} · ${r.m.title}`, now: clocks.get(r.w.id) ?? new Date(),
    });
    return {
      ...e, mediator: r.d.mediatorId ? names.get(r.d.mediatorId) ?? r.d.mediatorId : "Not assigned yet", cosigner: r.d.cosignerId ? names.get(r.d.cosignerId) ?? r.d.cosignerId : null,
      client: names.get(r.w.clientId) ?? "Client", provider: r.w.providerId ? names.get(r.w.providerId) ?? "Provider" : "Provider", fastTrack: r.meta?.fastTrack ?? false, amountCents: r.d.amountCents,
    };
  });
  /* a case can name a mediator who is not (or no longer) a mediator in this organisation: still give it a row */
  const known = new Set(mediators.map((m) => m.id));
  const extra = [...new Set(events.map((e) => e.resourceId))].filter((id) => id !== UNASSIGNED && !known.has(id)).map((id) => ({ id, name: names.get(id) ?? id }));
  const openOf = (id: string) => events.filter((e) => e.resourceId === id && e.next).length;
  const resources = [
    ...[...mediators, ...extra].map((m) => ({ id: m.id, name: m.name, open: openOf(m.id), you: m.id === v.id })),
    { id: UNASSIGNED, name: "Not assigned yet", open: openOf(UNASSIGNED), you: false },
  ];
  const now = new Date();
  const times = events.flatMap((e) => [Date.parse(e.startDate), Date.parse(e.endDate)]).concat(now.getTime());
  return {
    resources, events, now: now.toISOString(),
    startDate: new Date(Math.min(...times) - 24 * HOUR).toISOString(), endDate: new Date(Math.max(...times) + 48 * HOUR).toISOString(),
  };
}
