/**
 * F1.10 Identity auditor data: every user with role, onboarding state, lock, MFA, last sign-in (latest of sessions and
 * sign-in audit entries), PayPal link status and F1.8 terms status; pure filtering; and a per-user audit trail
 * (audit_chain rows where the user is the actor or the target). Read-only. Access: admin and ops (auditorAccess).
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditChain, paypalLinks, ROLES, sessions, users, type Role } from "@/db/schema";
import { termsDecisions } from "@/db/schema-identity";
import { DAY, HOUR } from "@/lib/clock";
import { TERMS_VERSION } from "@/lib/identity/handshake";

export const AUDITOR_ROLES: Role[] = ["admin", "ops"];
export const auditorAccess = (role: Role) => AUDITOR_ROLES.includes(role);
export const SIGN_IN_ACTIONS = ["auth.sign_in", "auth.demo_sign_in", "auth.sso_sign_in", "auth.handshake_complete"];

const opt = <T extends readonly [string, ...string[]]>(v: T) => z.enum(v).optional().catch(undefined);
export const FilterSchema = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  role: opt(ROLES),
  state: z.string().trim().regex(/^[A-Z_]{1,40}$/).optional().catch(undefined),
  locked: opt(["yes", "no"] as const),
  mfa: opt(["on", "off"] as const),
  seen: opt(["24h", "7d", "30d", "older", "never"] as const),
  paypal: opt(["none", "linked", "receivable"] as const),
  terms: opt(["ACCEPTED", "DECLINED", "PENDING"] as const),
});
export type IdentityFilter = z.infer<typeof FilterSchema>;
export const parseFilter = (sp: Record<string, string | undefined>): IdentityFilter => FilterSchema.parse(Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== "" && v !== undefined)));

export interface IdentityRow {
  id: string; name: string; email: string; role: Role; persona: string | null; state: string; tier: string;
  lockedUntil: Date | null; mfa: boolean; lastSignIn: Date | null; paypal: "none" | "linked" | "receivable"; terms: "ACCEPTED" | "DECLINED" | "PENDING";
}

export function applyFilter(rows: IdentityRow[], f: IdentityFilter, now: Date): IdentityRow[] {
  const q = f.q?.toLowerCase();
  const age = (d: Date | null) => (d ? now.getTime() - d.getTime() : Infinity);
  const seenOk = (d: Date | null) => {
    switch (f.seen) {
      case "24h": return age(d) <= 24 * HOUR;
      case "7d": return age(d) <= 7 * DAY;
      case "30d": return age(d) <= 30 * DAY;
      case "older": return !!d && age(d) > 30 * DAY;
      case "never": return !d;
      default: return true;
    }
  };
  return rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
    && (!f.role || r.role === f.role)
    && (!f.state || r.state === f.state)
    && (!f.locked || (f.locked === "yes") === Boolean(r.lockedUntil && r.lockedUntil > now))
    && (!f.mfa || (f.mfa === "on") === r.mfa)
    && seenOk(r.lastSignIn)
    && (!f.paypal || r.paypal === f.paypal)
    && (!f.terms || r.terms === f.terms));
}

export async function identityRows(): Promise<IdentityRow[]> {
  const [us, ss, au, pl, tr] = await Promise.all([
    db.select().from(users).orderBy(users.role, users.name),
    db.select({ userId: sessions.userId, at: sql<Date>`max(${sessions.createdAt})` }).from(sessions).groupBy(sessions.userId),
    db.select({ userId: auditChain.target, at: sql<Date>`max(${auditChain.at})` }).from(auditChain).where(inArray(auditChain.action, SIGN_IN_ACTIONS)).groupBy(auditChain.target),
    db.select({ userId: paypalLinks.userId, receivable: paypalLinks.receivable }).from(paypalLinks),
    db.select({ userId: termsDecisions.userId, decision: termsDecisions.decision, id: termsDecisions.id }).from(termsDecisions).where(eq(termsDecisions.version, TERMS_VERSION)).orderBy(termsDecisions.id),
  ]);
  const last = new Map<string, Date>();
  for (const r of [...ss, ...au]) {
    const d = new Date(r.at);
    const prev = last.get(r.userId);
    if (!prev || d > prev) last.set(r.userId, d);
  }
  const pp = new Map<string, "linked" | "receivable">();
  for (const l of pl) if (pp.get(l.userId) !== "receivable") pp.set(l.userId, l.receivable ? "receivable" : "linked");
  const terms = new Map<string, "ACCEPTED" | "DECLINED">();
  for (const t of tr) terms.set(t.userId, t.decision); // ordered by id: the latest decision wins
  return us.map((u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, persona: u.persona, state: u.onboardingState, tier: u.tier,
    lockedUntil: u.lockedUntil, mfa: Boolean(u.mfaSecret), lastSignIn: last.get(u.id) ?? null, paypal: pp.get(u.id) ?? "none", terms: terms.get(u.id) ?? "PENDING",
  }));
}

export async function userTrail(userId: string, limit = 100) {
  return db.select().from(auditChain).where(or(eq(auditChain.target, userId), eq(auditChain.actorId, userId))).orderBy(desc(auditChain.seq)).limit(limit);
}
export async function userById(userId: string) {
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(and(eq(users.id, userId))).limit(1);
  return u ?? null;
}
