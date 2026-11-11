/**
 * F2.05 F3.07 P5 — deadline extensions and excused days (contract amendments that move no money, P1).
 *
 *  - EXTENSION: one party asks for N more days on a milestone's due date; the other party signs to accept (or declines).
 *    Both signatures are stored with the time each was given (virtual contract clock), with the due date before and after.
 *  - MEDIATOR_RULING: a mediator (or Operations) records days a ruling excused. Recorded as is; the mediator module adds no code.
 * Excused days reduce the counted late days of the late deduction (src/lib/deadline). Once a milestone's release has fixed
 * its adjustment (release_adjustments), its due date can no longer change.
 */
import { createHmac } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { disputes, users, workspaces, wsMilestones } from "@/db/schema";
import { deadlineExtensions, releaseAdjustments } from "@/db/schema-money";
import { audit } from "@/lib/audit";
import { canonicalHash } from "@/lib/canonical";
import { DAY, sandboxMode } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { can, canWrite } from "@/lib/rbac";
import { workspaceNow } from "../clock";
import { deadlineFacts } from "../money/deadline";
import { DomainError, type Actor } from "../types";

export const MAX_EXTENSION_DAYS = 30;
const FINAL = ["RELEASED", "SETTLED_BY_VERDICT", "REFUNDED"];
const zRequest = z.object({ days: z.number().int().min(1).max(MAX_EXTENSION_DAYS), reason: z.string().trim().min(5, "Say in a few words why more time is needed.").max(500) });
const zRuling = z.object({ days: z.number().int().min(1).max(60), reason: z.string().trim().min(5, "Quote the ruling in a few words.").max(500), disputeId: z.string().max(64).optional() });

function signingKey(): string {
  const k = process.env.SIGNING_KEY;
  if (k) return k;
  if (!sandboxMode()) throw new DomainError("CONFIG", "SIGNING_KEY is not set.");
  return "paysettle-dev-signing-key";
}
/** HMAC-SHA256 over the amendment's canonical hash, bound to the workspace, the signer and their role (same key as contract signatures). */
export const amendmentSignature = (workspaceId: string, hash: string, signerId: string, role: string) =>
  createHmac("sha256", signingKey()).update(`amend|${workspaceId}|${hash}|${signerId}|${role}`).digest("hex");

async function context(milestoneId: string) {
  const [row] = await db.select({ m: wsMilestones, w: workspaces }).from(wsMilestones).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).where(eq(wsMilestones.id, milestoneId)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "This milestone does not exist.");
  return row;
}
function sideOf(a: Actor, w: typeof workspaces.$inferSelect): "client" | "provider" | null {
  if (a.id === w.clientId && a.role === "client") return "client";
  if (a.id === w.providerId && a.role === "provider") return "provider";
  return null;
}
async function assertOpen(m: typeof wsMilestones.$inferSelect, w: typeof workspaces.$inferSelect) {
  if (w.state !== "LOCKED") throw new DomainError("NOT_LOCKED", "Extensions apply to signed, locked contracts.");
  if (!m.active) throw new DomainError("BAD_STATE", "This milestone was removed from the contract.");
  if (FINAL.includes(m.state)) throw new DomainError("BAD_STATE", `${m.code} is settled; its due date can no longer change.`);
  const [fixed] = await db.select({ id: releaseAdjustments.id }).from(releaseAdjustments).where(eq(releaseAdjustments.milestoneId, m.id)).limit(1);
  if (fixed) throw new DomainError("BAD_STATE", `${m.code} has been released; its deadline adjustment is fixed.`);
}

export async function requestExtension(a: Actor, milestoneId: string, input: { days: number; reason: string }): Promise<string> {
  if (!canWrite(a.role, "contract.negotiate")) throw new DomainError("FORBIDDEN", "Only the client or the provider can ask for an extension.");
  const p = zRequest.safeParse(input);
  if (!p.success) throw new DomainError("INVALID_INPUT", p.error.issues.map((i) => i.message).join("; "));
  const { m, w } = await context(milestoneId);
  const side = sideOf(a, w);
  if (!side) throw new DomainError("FORBIDDEN", "Only the two parties to this contract can ask for an extension.");
  await assertOpen(m, w);
  const [open] = await db.select({ id: deadlineExtensions.id }).from(deadlineExtensions).where(and(eq(deadlineExtensions.milestoneId, m.id), eq(deadlineExtensions.state, "REQUESTED"))).limit(1);
  if (open) throw new DomainError("ALREADY_REQUESTED", "An extension for this milestone is already waiting for an answer.");
  const now = await workspaceNow(w.id);
  const id = newId("ext");
  const hash = canonicalHash({ kind: "paysettle.extension", id, workspaceId: w.id, milestone: m.code, days: p.data.days, reason: p.data.reason, requestedBy: a.id, at: now.toISOString() });
  await db.insert(deadlineExtensions).values({ id, workspaceId: w.id, milestoneId: m.id, kind: "EXTENSION", days: p.data.days, reason: p.data.reason, state: "REQUESTED", requestedBy: a.id, requestedRole: side, requestedAt: now, requestSig: amendmentSignature(w.id, hash, a.id, side) });
  await audit(db, a, "contract.extension_requested", m.id, { extensionId: id, workspaceId: w.id, code: m.code, days: p.data.days, reason: p.data.reason, hash });
  return id;
}

export async function decideExtension(a: Actor, extensionId: string, decision: "accept" | "decline"): Promise<void> {
  if (decision !== "accept" && decision !== "decline") throw new DomainError("INVALID_INPUT", "Decide accept or decline.");
  const [x] = await db.select().from(deadlineExtensions).where(eq(deadlineExtensions.id, extensionId)).limit(1);
  if (!x || x.kind !== "EXTENSION") throw new DomainError("NOT_FOUND", "This extension request does not exist.");
  const { m, w } = await context(x.milestoneId);
  const side = sideOf(a, w);
  if (!side) throw new DomainError("FORBIDDEN", "Only the two parties to this contract can answer an extension request.");
  if (side === x.requestedRole) throw new DomainError("FORBIDDEN", "The other party answers an extension request, not the one who asked.");
  if (x.state !== "REQUESTED") throw new DomainError("BAD_STATE", `This request was already ${x.state.toLowerCase()}.`);
  if (decision === "accept") await assertOpen(m, w);
  const now = await workspaceNow(w.id);
  const facts = decision === "accept" ? await deadlineFacts(m.id) : null;
  const before = facts?.dueAt ? new Date(facts.dueAt.getTime() + facts.excusedDays * DAY) : null;
  const after = before ? new Date(before.getTime() + x.days * DAY) : null;
  const hash = canonicalHash({ kind: "paysettle.extension.decision", id: x.id, requestSig: x.requestSig, decision, by: a.id, at: now.toISOString() });
  const r = await db.update(deadlineExtensions).set({ state: decision === "accept" ? "ACCEPTED" : "DECLINED", decidedBy: a.id, decidedAt: now, decisionSig: amendmentSignature(w.id, hash, a.id, side), dueBefore: before, dueAfter: after })
    .where(and(eq(deadlineExtensions.id, x.id), eq(deadlineExtensions.state, "REQUESTED"))).returning({ id: deadlineExtensions.id });
  if (!r.length) throw new DomainError("CONFLICT", "This request changed a moment ago. Reload to see it.");
  await audit(db, a, decision === "accept" ? "contract.extension_accepted" : "contract.extension_declined", m.id, { extensionId: x.id, workspaceId: w.id, code: m.code, days: x.days, dueBefore: before?.toISOString() ?? null, dueAfter: after?.toISOString() ?? null, hash });
}

export async function withdrawExtension(a: Actor, extensionId: string): Promise<void> {
  const [x] = await db.select().from(deadlineExtensions).where(eq(deadlineExtensions.id, extensionId)).limit(1);
  if (!x || x.kind !== "EXTENSION") throw new DomainError("NOT_FOUND", "This extension request does not exist.");
  if (x.requestedBy !== a.id) throw new DomainError("FORBIDDEN", "Only the person who asked can withdraw the request.");
  const r = await db.update(deadlineExtensions).set({ state: "WITHDRAWN", decidedBy: a.id, decidedAt: await workspaceNow(x.workspaceId) })
    .where(and(eq(deadlineExtensions.id, x.id), eq(deadlineExtensions.state, "REQUESTED"))).returning({ id: deadlineExtensions.id });
  if (!r.length) throw new DomainError("BAD_STATE", `This request was already ${x.state.toLowerCase()}.`);
  await audit(db, a, "contract.extension_withdrawn", x.milestoneId, { extensionId: x.id, workspaceId: x.workspaceId });
}

/** Excused days from a mediator's ruling (record only). Mediators, Operations and admins; same organisation. */
export async function recordExcusedDays(a: Actor, milestoneId: string, input: { days: number; reason: string; disputeId?: string }): Promise<string> {
  if (!(can(a.role, "dispute.verdict") || a.role === "ops" || a.role === "admin")) throw new DomainError("FORBIDDEN", "Only a mediator or Operations can record days excused by a ruling.");
  const p = zRuling.safeParse({ ...input, disputeId: input.disputeId || undefined });
  if (!p.success) throw new DomainError("INVALID_INPUT", p.error.issues.map((i) => i.message).join("; "));
  const { m, w } = await context(milestoneId);
  const [me] = await db.select({ orgId: users.orgId }).from(users).where(eq(users.id, a.id)).limit(1);
  if (!me || me.orgId !== w.orgId) throw new DomainError("FORBIDDEN", "This contract belongs to another organisation.");
  await assertOpen(m, w);
  if (p.data.disputeId) {
    const [d] = await db.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.id, p.data.disputeId), eq(disputes.milestoneId, m.id))).limit(1);
    if (!d) throw new DomainError("INVALID_INPUT", "That dispute is not about this milestone.");
  }
  const now = await workspaceNow(w.id);
  const id = newId("ext");
  const hash = canonicalHash({ kind: "paysettle.excused", id, workspaceId: w.id, milestone: m.code, days: p.data.days, reason: p.data.reason, by: a.id, disputeId: p.data.disputeId ?? null, at: now.toISOString() });
  const sig = amendmentSignature(w.id, hash, a.id, a.role);
  await db.insert(deadlineExtensions).values({ id, workspaceId: w.id, milestoneId: m.id, kind: "MEDIATOR_RULING", days: p.data.days, reason: p.data.reason, state: "ACCEPTED", requestedBy: a.id, requestedRole: a.role, requestedAt: now, requestSig: sig, decidedBy: a.id, decidedAt: now, decisionSig: sig, disputeId: p.data.disputeId ?? null });
  await audit(db, a, "contract.excused_days_recorded", m.id, { extensionId: id, workspaceId: w.id, code: m.code, days: p.data.days, disputeId: p.data.disputeId ?? null, hash });
  return id;
}

export interface ExtensionView {
  id: string; kind: "EXTENSION" | "MEDIATOR_RULING"; days: number; reason: string; state: string;
  requestedBy: { id: string; name: string; role: string }; requestedAt: Date; requestSig: string;
  decidedBy: { id: string; name: string } | null; decidedAt: Date | null; decisionSig: string | null; dueBefore: Date | null; dueAfter: Date | null; disputeId: string | null;
}
export async function extensionsFor(milestoneId: string): Promise<ExtensionView[]> {
  const rows = await db.select().from(deadlineExtensions).where(eq(deadlineExtensions.milestoneId, milestoneId)).orderBy(asc(deadlineExtensions.createdAt));
  const ids = [...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy].filter((x): x is string => Boolean(x))))];
  const people = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  return rows.map((r) => ({
    id: r.id, kind: r.kind, days: r.days, reason: r.reason, state: r.state,
    requestedBy: { id: r.requestedBy, name: name(r.requestedBy), role: r.requestedRole }, requestedAt: r.requestedAt, requestSig: r.requestSig,
    decidedBy: r.decidedBy ? { id: r.decidedBy, name: name(r.decidedBy) } : null, decidedAt: r.decidedAt, decisionSig: r.decisionSig, dueBefore: r.dueBefore, dueAfter: r.dueAfter, disputeId: r.disputeId,
  }));
}
