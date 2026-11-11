/**
 * F3.03 out-of-sequence override. The client may let the provider submit a later milestone before its
 * prerequisites are settled — for example, parts arrive early. Payout amounts and the contract are unchanged: only the
 * order in which evidence may be submitted is relaxed for that one milestone. The tranche must still be held in PayPal.
 *
 * Flow: the provider asks (optional) → the client signs (HMAC over milestone + canonical contract hash + skipped
 * prerequisites, MFA as for approvals) → the milestone opens if its tranche is funded, else at the provider's submit.
 * The client may decline a request, and may withdraw a signed override while the milestone has not opened yet.
 * Every step is audited and notified. Permissions: provider = evidence.submit on their own contract; client =
 * release.approve on their own contract.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { tranches, workspaces, wsMilestones } from "@/db/schema";
import { evidenceNotifications, sequenceOverrides, type OverrideStatus } from "@/db/schema-evidence";
import { audit } from "@/lib/audit";
import { canWrite } from "@/lib/rbac";
import { newId } from "@/lib/ids";
import { workspaceNow } from "../clock";
import { DomainError, type Actor } from "../types";
import { checkMfa, evidenceHmac, openIfReady, unsettledPrerequisites } from "./index";

export type SequenceOverride = typeof sequenceOverrides.$inferSelect;
const Reason = z.string().trim().min(10, "Say in a sentence why (at least 10 characters).").max(500, "Keep the reason under 500 characters.");
const actorOf = (a: Actor) => ({ id: a.id, role: a.role, requestId: a.requestId });

/** What a signature binds: the milestone, the signed contract revision, and the prerequisites it may skip. */
export const overridePayload = (milestoneId: string, canonicalHash: string, skipped: string[], clientId: string) =>
  `paysettle.sequence-override:v1|${milestoneId}|${canonicalHash}|${[...skipped].sort().join(",")}|${clientId}`;
export const overrideSignature = (milestoneId: string, canonicalHash: string, skipped: string[], clientId: string) =>
  evidenceHmac(overridePayload(milestoneId, canonicalHash, skipped, clientId));

async function load(milestoneId: string) {
  const [row] = await db.select({ m: wsMilestones, ws: workspaces }).from(wsMilestones).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).where(eq(wsMilestones.id, milestoneId)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "That milestone does not exist.");
  const all = await db.select({ id: wsMilestones.id, code: wsMilestones.code, state: wsMilestones.state, targetDay: wsMilestones.targetDay, dependsOn: wsMilestones.dependsOn }).from(wsMilestones)
    .where(and(eq(wsMilestones.workspaceId, row.ws.id), eq(wsMilestones.active, true))).orderBy(asc(wsMilestones.seq));
  return { ...row, pending: unsettledPrerequisites(row.m, all) };
}

/** The latest override row for a milestone (any status), or null. */
export async function overrideFor(milestoneId: string): Promise<SequenceOverride | null> {
  const [o] = await db.select().from(sequenceOverrides).where(eq(sequenceOverrides.milestoneId, milestoneId)).orderBy(desc(sequenceOverrides.createdAt)).limit(1);
  return o ?? null;
}
async function current(milestoneId: string, statuses: OverrideStatus[]): Promise<SequenceOverride | null> {
  const [o] = await db.select().from(sequenceOverrides).where(and(eq(sequenceOverrides.milestoneId, milestoneId), inArray(sequenceOverrides.status, statuses))).orderBy(desc(sequenceOverrides.createdAt)).limit(1);
  return o ?? null;
}

/** Shared preconditions: locked contract, active milestone still waiting on prerequisites. */
function assertEligible(r: Awaited<ReturnType<typeof load>>) {
  if (r.ws.state !== "LOCKED") throw new DomainError("NOT_LOCKED", "An out-of-sequence start is possible once the contract is signed and locked.");
  if (!r.m.active) throw new DomainError("BAD_STATE", "This milestone was removed from the contract.");
  if (r.m.state !== "LOCKED") throw new DomainError("NOT_NEEDED", `${r.m.code} is already ${r.m.state.toLowerCase()}; no override is needed.`);
  if (!r.pending.length) throw new DomainError("NOT_NEEDED", `${r.m.code} has no unsettled prerequisites; it opens as soon as its tranche is held.`);
}

async function notify(n: { key: string; workspaceId: string; milestoneId: string; to: string | null; kind: string; title: string; body: string }) {
  await db.insert(evidenceNotifications).values({ id: newId("nt"), dedupKey: n.key, workspaceId: n.workspaceId, milestoneId: n.milestoneId, toUserId: n.to, kind: n.kind, title: n.title, body: n.body }).onConflictDoNothing({ target: evidenceNotifications.dedupKey });
}

/** The provider asks the client for an out-of-sequence start. */
export async function requestSequenceOverride(a: Actor, milestoneId: string, reason: string): Promise<SequenceOverride> {
  if (!canWrite(a.role, "evidence.submit")) throw new DomainError("FORBIDDEN", "Only the provider of this contract can ask for an out-of-sequence start.");
  const why = Reason.safeParse(reason);
  if (!why.success) throw new DomainError("BAD_INPUT", why.error.issues[0].message);
  const r = await load(milestoneId);
  if (a.id !== r.ws.providerId) throw new DomainError("FORBIDDEN", "Only the provider of this contract can ask for an out-of-sequence start.");
  assertEligible(r);
  if (await current(milestoneId, ["REQUESTED", "GRANTED"])) throw new DomainError("ALREADY", `There is already an open request or a signed override for ${r.m.code}.`);
  const now = await workspaceNow(r.ws.id);
  const id = newId("so");
  const [row] = await db.insert(sequenceOverrides).values({ id, workspaceId: r.ws.id, milestoneId, skipped: r.pending, status: "REQUESTED", reason: why.data, requestedBy: a.id, requestedAt: now }).returning();
  await audit(db, actorOf(a), "evidence.sequence_override_requested", milestoneId, { overrideId: id, code: r.m.code, skipped: r.pending });
  await notify({ key: `so:req:${id}`, workspaceId: r.ws.id, milestoneId, to: r.ws.clientId, kind: "OVERRIDE_REQUESTED", title: `${r.m.code}: the provider asks to start early`, body: `Start ${r.m.code} before ${r.pending.join(", ")} ${r.pending.length === 1 ? "is" : "are"} settled. Reason: ${why.data}` });
  return row;
}

/**
 * The client signs the override. Needs a tick-box confirmation; MFA as for approvals (optional in sandbox).
 * Opens the milestone straight away when its tranche is held in PayPal.
 */
export async function grantSequenceOverride(a: Actor, milestoneId: string, input: { reason: string; confirm: boolean; mfaCode?: string }): Promise<{ override: SequenceOverride; opened: boolean }> {
  if (!canWrite(a.role, "release.approve")) throw new DomainError("FORBIDDEN", "Only the client of this contract can sign an out-of-sequence start.");
  const r = await load(milestoneId);
  if (a.id !== r.ws.clientId) throw new DomainError("FORBIDDEN", "Only the client of this contract can sign an out-of-sequence start.");
  if (!input.confirm) throw new DomainError("CONFIRM_REQUIRED", "Tick the box to confirm that payout amounts stay as signed.");
  const pendingReq = await current(milestoneId, ["REQUESTED"]);
  const why = Reason.safeParse(input.reason?.trim() ? input.reason : pendingReq?.reason ?? "");
  if (!why.success) throw new DomainError("BAD_INPUT", why.error.issues[0].message);
  assertEligible(r);
  if (await current(milestoneId, ["GRANTED"])) throw new DomainError("ALREADY", `${r.m.code} already has a signed override.`);
  if (!r.ws.canonicalHash) throw new DomainError("BAD_STATE", "This contract has no signed hash.");
  const mfa = await checkMfa(a, input.mfaCode);
  const now = await workspaceNow(r.ws.id);
  const signature = overrideSignature(milestoneId, r.ws.canonicalHash, r.pending, r.ws.clientId);
  const values = { status: "GRANTED" as const, skipped: r.pending, reason: why.data, decidedBy: a.id, decidedAt: now, canonicalHash: r.ws.canonicalHash, signature, mfa };
  const row = await db.transaction(async (tx) => {
    let out: SequenceOverride;
    if (pendingReq) {
      const u = await tx.update(sequenceOverrides).set(values).where(and(eq(sequenceOverrides.id, pendingReq.id), eq(sequenceOverrides.status, "REQUESTED"))).returning();
      if (!u.length) throw new DomainError("CONFLICT", "The request changed a moment ago. Reload and try again.");
      out = u[0];
    } else {
      [out] = await tx.insert(sequenceOverrides).values({ id: newId("so"), workspaceId: r.ws.id, milestoneId, ...values }).returning();
    }
    await audit(tx, actorOf(a), "evidence.sequence_override_granted", milestoneId, { overrideId: out.id, code: r.m.code, skipped: r.pending, hash: r.ws.canonicalHash, sig: signature.slice(0, 16), mfa, amountCents: r.m.amountCents });
    return out;
  });
  await notify({ key: `so:grant:${row.id}`, workspaceId: r.ws.id, milestoneId, to: r.ws.providerId, kind: "OVERRIDE_GRANTED", title: `${r.m.code} may start before ${r.pending.join(", ")}`, body: `The client signed an out-of-sequence start. The payout for ${r.m.code} is unchanged.` });
  const [t] = await db.select({ state: tranches.state }).from(tranches).where(and(eq(tranches.workspaceId, r.ws.id), eq(tranches.idx, r.m.trancheIdx))).limit(1);
  const opened = t && ["HELD", "PARTIALLY_RELEASED"].includes(t.state) ? await openIfReady(milestoneId, a) : false;
  return { override: row, opened };
}

/** The client declines the provider's request. */
export async function declineSequenceOverride(a: Actor, milestoneId: string, note = ""): Promise<SequenceOverride> {
  if (!canWrite(a.role, "release.approve")) throw new DomainError("FORBIDDEN", "Only the client of this contract can decline.");
  const r = await load(milestoneId);
  if (a.id !== r.ws.clientId) throw new DomainError("FORBIDDEN", "Only the client of this contract can decline.");
  const req = await current(milestoneId, ["REQUESTED"]);
  if (!req) throw new DomainError("NOT_FOUND", "There is no open request to decline.");
  const now = await workspaceNow(r.ws.id);
  const [row] = await db.update(sequenceOverrides).set({ status: "DECLINED", decidedBy: a.id, decidedAt: now }).where(and(eq(sequenceOverrides.id, req.id), eq(sequenceOverrides.status, "REQUESTED"))).returning();
  if (!row) throw new DomainError("CONFLICT", "The request changed a moment ago. Reload and try again.");
  await audit(db, actorOf(a), "evidence.sequence_override_declined", milestoneId, { overrideId: req.id, code: r.m.code, note: note.slice(0, 300) });
  await notify({ key: `so:decline:${req.id}`, workspaceId: r.ws.id, milestoneId, to: r.ws.providerId, kind: "OVERRIDE_DECLINED", title: `${r.m.code}: early start declined`, body: `${r.m.code} opens after ${req.skipped.join(", ")} ${req.skipped.length === 1 ? "is" : "are"} settled, as signed.${note.trim() ? ` Note: ${note.trim().slice(0, 300)}` : ""}` });
  return row;
}

/** The client withdraws a signed override — only while the milestone has not opened for evidence. */
export async function revokeSequenceOverride(a: Actor, milestoneId: string): Promise<SequenceOverride> {
  if (!canWrite(a.role, "release.approve")) throw new DomainError("FORBIDDEN", "Only the client of this contract can withdraw an override.");
  const r = await load(milestoneId);
  if (a.id !== r.ws.clientId) throw new DomainError("FORBIDDEN", "Only the client of this contract can withdraw an override.");
  const g = await current(milestoneId, ["GRANTED"]);
  if (!g) throw new DomainError("NOT_FOUND", "There is no signed override to withdraw.");
  if (r.m.state !== "LOCKED") throw new DomainError("TOO_LATE", `${r.m.code} is already open for evidence; the override can no longer be withdrawn.`);
  const now = await workspaceNow(r.ws.id);
  const [row] = await db.update(sequenceOverrides).set({ status: "REVOKED", revokedAt: now }).where(and(eq(sequenceOverrides.id, g.id), eq(sequenceOverrides.status, "GRANTED"))).returning();
  if (!row) throw new DomainError("CONFLICT", "The override changed a moment ago. Reload and try again.");
  await audit(db, actorOf(a), "evidence.sequence_override_revoked", milestoneId, { overrideId: g.id, code: r.m.code });
  await notify({ key: `so:revoke:${g.id}`, workspaceId: r.ws.id, milestoneId, to: r.ws.providerId, kind: "OVERRIDE_REVOKED", title: `${r.m.code}: early start withdrawn`, body: `${r.m.code} opens after ${g.skipped.join(", ")} ${g.skipped.length === 1 ? "is" : "are"} settled, as signed.` });
  return row;
}
