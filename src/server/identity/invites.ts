/**
 * F1.1, F2.02 · invite shadow profile: a client can invite a provider by e-mail before that person has an account
 * (workspaces.invite_email, provider_id empty). When someone registers as a provider with that address AND the address
 * is confirmed (link in the confirmation e-mail, or an identity provider's verified e-mail), the contract is linked to
 * them as the counterparty and they land in its negotiation room.
 *
 * Linking is a change to the contract, so it follows the same rules as any other change (F2.10, P5):
 *   · the provider id and invite e-mail are part of the canonical document, so a NEW revision is written (the old ones
 *     stay as they were), its hash becomes the contract's hash, and any signature on the old revision is voided;
 *   · the policy gate runs again with the new provider's facts (PayPal account, trust tier) and sets the state;
 *   · only contracts still open for negotiation are linked (DRAFT, READY_TO_SIGN, PARTIALLY_SIGNED), never playground
 *     simulations, and only while provider_id is still empty (row locked FOR UPDATE, so two registrations cannot race).
 * Safety net: before writing, the current document is rebuilt and its hash compared with the stored one. If they differ
 * (the contract format gained fields this code does not know), nothing is written and the invite stays pending — the
 * provider still sees it on their overview — instead of a revision with a wrong hash.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { paypalLinks, revisions, signatures, users, workspaces, wsClauses, wsMilestones } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canonical, canonicalHash } from "@/lib/canonical";
import { normalizeTerms } from "@/lib/deadline";
import { workspaceMachine } from "@/lib/fsm";
import type { Rail, Tier } from "@/lib/policy";
import { isSimWorkspaceSql } from "@/lib/sim";
import { canonicalDoc, evaluate, type ClDraft, type MsDraft, type WsHead } from "@/server/contracts/core";

export const LINKABLE_STATES = ["DRAFT", "READY_TO_SIGN", "PARTIALLY_SIGNED"] as const;
export const ATTACH_ACTION = "ATTACH_PROVIDER";

export interface InviteLinkResult { linked: { id: string; title: string; revNo: number }[]; deferred: { id: string; reason: "state" | "hash_mismatch" }[] }

/** Open invites for an e-mail (provider seat empty, not a simulation). Used for the count on the welcome page. */
export async function openInvites(email: string) {
  return db.select({ id: workspaces.id, title: workspaces.title, state: workspaces.state }).from(workspaces)
    .where(and(isNull(workspaces.providerId), sql`lower(${workspaces.inviteEmail}) = ${email.trim().toLowerCase()}`, sql`not ${isSimWorkspaceSql(workspaces.id)}`))
    .orderBy(asc(workspaces.createdAt));
}

async function loadParts(tx: Tx, id: string): Promise<{ ms: MsDraft[]; cl: ClDraft[] }> {
  const m = await tx.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, id)).orderBy(asc(wsMilestones.seq));
  const c = await tx.select().from(wsClauses).where(eq(wsClauses.workspaceId, id));
  return {
    ms: m.map((r) => ({ id: r.id, seq: r.seq, code: r.code, origin: r.origin, active: r.active, prunedBy: r.prunedBy, type: r.type, title: r.title, targetDay: r.targetDay, bps: r.bps, amountCents: r.amountCents, proof: r.proof, lockRule: r.lockRule, disputeRule: r.disputeRule, dependsOn: r.dependsOn, trancheIdx: r.trancheIdx, state: r.state })),
    cl: c.map((r) => ({ id: r.id, category: r.category, code: r.code, title: r.title, body: r.body, active: r.active, protective: r.protective, linkedMilestone: r.linkedMilestone, byUser: r.byUser })),
  };
}

/**
 * Link every open invite for the user's confirmed e-mail. Refuses (returns nothing linked) for anyone who is not a
 * provider or whose e-mail is not confirmed. Each contract is linked in its own transaction.
 */
export async function linkInvites(userId: string): Promise<InviteLinkResult> {
  const out: InviteLinkResult = { linked: [], deferred: [] };
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.role !== "provider" || !(u.profile as { emailVerifiedAt?: string }).emailVerifiedAt) return out;
  const [merchant] = await db.select({ id: paypalLinks.id }).from(paypalLinks).where(and(eq(paypalLinks.userId, u.id), eq(paypalLinks.kind, "merchant"), eq(paypalLinks.receivable, true))).limit(1);
  const actor = { id: u.id, role: u.role };

  for (const inv of await openInvites(u.email)) {
    const r = await db.transaction(async (tx) => {
      const [w] = await tx.select().from(workspaces).where(eq(workspaces.id, inv.id)).limit(1).for("update");
      if (!w || w.providerId || (w.inviteEmail ?? "").toLowerCase() !== u.email.toLowerCase()) return null;
      if (!(LINKABLE_STATES as readonly string[]).includes(w.state) || !workspaceMachine.allows(w.state as never, "edit")) return { kind: "deferred" as const, id: w.id, reason: "state" as const };
      const { ms, cl } = await loadParts(tx, w.id);
      const h: WsHead = { id: w.id, title: w.title, blueprintCode: w.blueprintCode, currency: w.currency, totalCents: w.totalCents, feeBps: w.feeBps, rail: w.rail as Rail, clientId: w.clientId, providerId: w.providerId, inviteEmail: w.inviteEmail, reviewTimeoutRule: w.reviewTimeoutRule, deadline: normalizeTerms(w.deadlineTerms) };
      if (!w.canonicalHash || canonicalHash(canonicalDoc(h, w.revision, ms, cl)) !== w.canonicalHash) {
        await audit(tx, actor, "identity.invite_link_deferred", w.id, { reason: "hash_mismatch", revNo: w.revision });
        return { kind: "deferred" as const, id: w.id, reason: "hash_mismatch" as const };
      }
      const next: WsHead = { ...h, providerId: u.id, inviteEmail: null };
      const ev = evaluate(next, ms, cl, Boolean(merchant), (u.tier ?? "new") as Tier);
      const revNo = w.revision + 1;
      let state = workspaceMachine.next(w.state as never, "edit");
      if (!ev.violations.length) state = workspaceMachine.next(state, "gate_pass");
      const doc = canonicalDoc(next, revNo, ms, cl);
      const hash = canonicalHash(doc);
      await tx.insert(revisions).values({ workspaceId: w.id, revNo, hash, canonical: JSON.parse(canonical(doc)), authorId: u.id, change: { action: ATTACH_ACTION, target: u.id, detail: { via: "registration", invited: "email" } } });
      const voided = await tx.update(signatures).set({ voidedAtRev: revNo }).where(and(eq(signatures.workspaceId, w.id), isNull(signatures.voidedAtRev))).returning({ role: signatures.role });
      await tx.update(workspaces).set({ providerId: u.id, inviteEmail: null, revision: revNo, canonicalHash: hash, riskScore: ev.risk.score, state, updatedAt: new Date() }).where(eq(workspaces.id, w.id));
      await audit(tx, actor, "identity.invite_linked", w.id, { revNo, state, violations: ev.violations.map((v) => v.code), risk: ev.risk.score });
      if (voided.length) await audit(tx, actor, "contract.signature_voided", w.id, { revNo, roles: voided.map((v) => v.role), reason: "provider_joined" });
      return { kind: "linked" as const, id: w.id, title: w.title, revNo };
    });
    if (!r) continue;
    if (r.kind === "deferred") out.deferred.push({ id: r.id, reason: r.reason });
    else out.linked.push({ id: r.id, title: r.title, revNo: r.revNo });
  }
  return out;
}

/** Where a newly registered person goes next: the room of their most recent linked contract, else the welcome page. */
export async function nextAfterRegistration(userId: string): Promise<string> {
  const [w] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.providerId, userId)).orderBy(sql`${workspaces.updatedAt} desc`).limit(1);
  return w ? `/contracts/${w.id}?joined=1` : "/register/welcome";
}
