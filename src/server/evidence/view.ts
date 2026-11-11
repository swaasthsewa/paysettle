/**
 * Read model for the milestone page (F3.03 incl. the out-of-sequence override, F3.04, F3.06, F3.07, F3.09, A3). Reads the database directly so the page works
 * whichever other modules have landed. Access: the workspace's client and provider, staff roles, and the judge in sandbox.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { disputes, evidencePackages, releases, tranches, users, workspaces, wsMilestones } from "@/db/schema";
import { evidenceReviews, workspaceSites } from "@/db/schema-evidence";
import { sandboxMode } from "@/lib/clock";
import { workspaceNow } from "../clock";
import { STAFF_ROLES, prerequisitesSettled, unsettledPrerequisites } from "./index";
import { overrideFor } from "./override";

export type ViewerRole = "client" | "provider" | "staff";
export async function getMilestoneDetail(v: { id: string; role: string }, workspaceId: string, milestoneId: string) {
  const [row] = await db.select({ m: wsMilestones, ws: workspaces }).from(wsMilestones).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .where(and(eq(wsMilestones.id, milestoneId), eq(wsMilestones.workspaceId, workspaceId))).limit(1);
  if (!row) return null;
  const { m, ws } = row;
  const staff = (STAFF_ROLES as readonly string[]).includes(v.role) || (v.role === "judge" && sandboxMode());
  const as: ViewerRole | null = v.id === ws.clientId ? "client" : v.id === ws.providerId ? "provider" : staff ? "staff" : null;
  if (!as) return null;
  const ids = [ws.clientId, ws.providerId].filter((x): x is string => Boolean(x));
  const people = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const [tranche] = await db.select().from(tranches).where(and(eq(tranches.workspaceId, ws.id), eq(tranches.idx, m.trancheIdx))).limit(1);
  const packages = await db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, m.id)).orderBy(desc(evidencePackages.attempt));
  const reviews = await db.select().from(evidenceReviews).where(eq(evidenceReviews.milestoneId, m.id)).orderBy(asc(evidenceReviews.createdAt));
  const rel = await db.select({ id: releases.id, status: releases.status, netCents: releases.netCents, feeCents: releases.feeCents, grossCents: releases.grossCents, kind: releases.kind }).from(releases).where(eq(releases.milestoneId, m.id));
  const [dispute] = await db.select({ id: disputes.id, state: disputes.state }).from(disputes).where(eq(disputes.milestoneId, m.id)).limit(1);
  const [site] = await db.select().from(workspaceSites).where(eq(workspaceSites.workspaceId, ws.id)).limit(1);
  const siblings = await db.select({ id: wsMilestones.id, code: wsMilestones.code, title: wsMilestones.title, state: wsMilestones.state, seq: wsMilestones.seq, targetDay: wsMilestones.targetDay, dependsOn: wsMilestones.dependsOn }).from(wsMilestones)
    .where(and(eq(wsMilestones.workspaceId, ws.id), eq(wsMilestones.active, true))).orderBy(asc(wsMilestones.seq));
  // F3.03: a signed out-of-sequence override lets this milestone start before its prerequisites settle.
  const override = await overrideFor(m.id);
  const overridden = override?.status === "GRANTED";
  return {
    as, now: await workspaceNow(ws.id),
    override, pendingPrerequisites: unsettledPrerequisites(m, siblings),
    workspace: { id: ws.id, title: ws.title, state: ws.state, currency: ws.currency, feeBps: ws.feeBps, rail: ws.rail, reviewTimeoutRule: ws.reviewTimeoutRule, clientName: nameOf(ws.clientId), providerName: nameOf(ws.providerId) },
    prerequisitesSettled: prerequisitesSettled(m, siblings, overridden),
    milestone: m, tranche: tranche ?? null, packages, reviews, releases: rel, dispute: dispute ?? null, site: site ?? null, siblings,
  };
}
export type MilestoneDetail = NonNullable<Awaited<ReturnType<typeof getMilestoneDetail>>>;
