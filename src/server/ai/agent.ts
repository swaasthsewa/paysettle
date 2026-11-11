/**
 * A5 · MCP agent tokens and the human gate for releases.
 *
 * - A signed-in person mints a bearer token for their agent (sandbox only, P9). Only its SHA-256 is stored; the token is
 *   shown once. Each token has an expiry and a spend limit in cents that request_funding reserves against.
 * - approve_release never releases money: it records a PENDING agent approval here. The client confirms in the app
 *   (milestone screen, own session and MFA); the evidence module then calls resolveAgentApproval(). (P3, P4)
 * Every mutation writes an audit record.
 */
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { agentApprovals, agentTokens } from "@/db/schema-ai";
import { audit } from "@/lib/audit";
import { newId, sha256 } from "@/lib/ids";
import { sandboxMode } from "@/lib/clock";
import { DomainError, type Actor } from "../types";

export const TOKEN_PREFIX = "psa_";
export const DEFAULT_SPEND_LIMIT_CENTS = 1_500_000; // $15,000.00
export const MAX_SPEND_LIMIT_CENTS = 10_000_000;     // $100,000.00
export const DEFAULT_TTL_HOURS = 24;

export interface AgentPrincipal { tokenId: string; actor: Actor & { name: string }; orgId: string; spendLimitCents: number; spentCents: number; label: string }

export async function mintAgentToken(a: Actor, p: { label?: string; spendLimitCents?: number; ttlHours?: number } = {}) {
  if (!sandboxMode()) throw new DomainError("SANDBOX_ONLY", "Agent tokens are a sandbox feature in this build.");
  const limit = Math.floor(p.spendLimitCents ?? DEFAULT_SPEND_LIMIT_CENTS);
  if (!Number.isFinite(limit) || limit < 0 || limit > MAX_SPEND_LIMIT_CENTS) throw new DomainError("BAD_LIMIT", "The spend limit must be between $0.00 and $100,000.00.");
  const ttl = Math.min(24 * 30, Math.max(1, Math.floor(p.ttlHours ?? DEFAULT_TTL_HOURS)));
  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const id = newId("agt");
  const expiresAt = new Date(Date.now() + ttl * 3_600_000);
  const label = (p.label ?? "").trim().slice(0, 60) || "Agent";
  await db.transaction(async (tx) => {
    await tx.insert(agentTokens).values({ id, userId: a.id, label, tokenHash: sha256(token), prefix: token.slice(0, 10), spendLimitCents: limit, expiresAt });
    await audit(tx, { id: a.id, role: a.role, requestId: a.requestId }, "ai.agent_token.mint", id, { label, spendLimitCents: limit, ttlHours: ttl });
  });
  return { id, token, prefix: token.slice(0, 10), label, spendLimitCents: limit, expiresAt };
}

export async function resolveAgentToken(bearer: string | null | undefined): Promise<AgentPrincipal | null> {
  if (!bearer || !bearer.startsWith(TOKEN_PREFIX) || bearer.length > 200) return null;
  const now = new Date();
  const [row] = await db.select({ t: agentTokens, u: users }).from(agentTokens).innerJoin(users, eq(users.id, agentTokens.userId))
    .where(and(eq(agentTokens.tokenHash, sha256(bearer)), isNull(agentTokens.revokedAt), gt(agentTokens.expiresAt, now))).limit(1);
  if (!row) return null;
  if (!row.t.lastUsedAt || now.getTime() - row.t.lastUsedAt.getTime() > 60_000) await db.update(agentTokens).set({ lastUsedAt: now }).where(eq(agentTokens.id, row.t.id));
  return { tokenId: row.t.id, actor: { id: row.u.id, role: row.u.role, name: row.u.name }, orgId: row.u.orgId, spendLimitCents: row.t.spendLimitCents, spentCents: row.t.spentCents, label: row.t.label };
}

export async function listAgentTokens(userId: string) {
  return db.select({ id: agentTokens.id, label: agentTokens.label, prefix: agentTokens.prefix, spendLimitCents: agentTokens.spendLimitCents, spentCents: agentTokens.spentCents, expiresAt: agentTokens.expiresAt, revokedAt: agentTokens.revokedAt, lastUsedAt: agentTokens.lastUsedAt, createdAt: agentTokens.createdAt })
    .from(agentTokens).where(eq(agentTokens.userId, userId)).orderBy(desc(agentTokens.createdAt)).limit(20);
}

export async function revokeAgentToken(a: Actor, id: string) {
  await db.transaction(async (tx) => {
    const r = await tx.update(agentTokens).set({ revokedAt: new Date() }).where(and(eq(agentTokens.id, id), eq(agentTokens.userId, a.id), isNull(agentTokens.revokedAt))).returning({ id: agentTokens.id });
    if (!r.length) throw new DomainError("NOT_FOUND", "No active token with that id belongs to you.");
    await audit(tx, { id: a.id, role: a.role, requestId: a.requestId }, "ai.agent_token.revoke", id);
  });
}

/** Atomically reserve spend against the token's limit; false when it would pass the limit. */
export async function reserveSpend(tokenId: string, cents: number): Promise<boolean> {
  const r = await db.update(agentTokens).set({ spentCents: sql`${agentTokens.spentCents} + ${cents}` })
    .where(and(eq(agentTokens.id, tokenId), sql`${agentTokens.spentCents} + ${cents} <= ${agentTokens.spendLimitCents}`)).returning({ id: agentTokens.id });
  return r.length === 1;
}
export async function releaseSpend(tokenId: string, cents: number) {
  await db.update(agentTokens).set({ spentCents: sql`greatest(0, ${agentTokens.spentCents} - ${cents})` }).where(eq(agentTokens.id, tokenId));
}

export async function createAgentApproval(a: Actor, p: { tokenId: string; workspaceId: string; milestoneId: string; note: string; detail?: Record<string, unknown> }) {
  const [existing] = await db.select().from(agentApprovals)
    .where(and(eq(agentApprovals.milestoneId, p.milestoneId), eq(agentApprovals.userId, a.id), eq(agentApprovals.state, "PENDING"))).limit(1);
  if (existing) return { id: existing.id, state: existing.state, createdAt: existing.createdAt, reused: true };
  const id = newId("apr");
  const at = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(agentApprovals).values({ id, tokenId: p.tokenId, userId: a.id, workspaceId: p.workspaceId, milestoneId: p.milestoneId, note: p.note.slice(0, 1000), detail: p.detail ?? {}, createdAt: at });
    await audit(tx, { id: a.id, role: a.role, requestId: a.requestId }, "ai.agent_approval.request", p.milestoneId, { approvalId: id, tokenId: p.tokenId, workspaceId: p.workspaceId });
  });
  return { id, state: "PENDING" as const, createdAt: at, reused: false };
}

/** Pending and past agent release requests for a milestone (for the milestone screen of the evidence module). */
export async function listAgentApprovals(milestoneId: string): Promise<{ id: string; userId: string; tokenId: string; note: string; state: "PENDING" | "CONFIRMED" | "DISMISSED"; createdAt: Date; resolvedAt: Date | null }[]> {
  return db.select({ id: agentApprovals.id, userId: agentApprovals.userId, tokenId: agentApprovals.tokenId, note: agentApprovals.note, state: agentApprovals.state, createdAt: agentApprovals.createdAt, resolvedAt: agentApprovals.resolvedAt })
    .from(agentApprovals).where(eq(agentApprovals.milestoneId, milestoneId)).orderBy(desc(agentApprovals.createdAt)).limit(20);
}

export async function listAgentApprovalsForUser(userId: string) {
  return db.select().from(agentApprovals).where(eq(agentApprovals.userId, userId)).orderBy(desc(agentApprovals.createdAt)).limit(20);
}

/** Mark an agent's release request as confirmed (after the client approved in the app) or dismissed. Moves no money. */
export async function resolveAgentApproval(a: Actor, id: string, decision: "CONFIRMED" | "DISMISSED"): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await tx.update(agentApprovals).set({ state: decision, resolvedAt: new Date(), resolvedBy: a.id })
      .where(and(eq(agentApprovals.id, id), eq(agentApprovals.userId, a.id), eq(agentApprovals.state, "PENDING"))).returning({ ms: agentApprovals.milestoneId });
    if (!r.length) throw new DomainError("NOT_FOUND", "No pending agent request with that id belongs to you.");
    await audit(tx, { id: a.id, role: a.role, requestId: a.requestId }, `ai.agent_approval.${decision.toLowerCase()}`, r[0].ms, { approvalId: id });
  });
}
