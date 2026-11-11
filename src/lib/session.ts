/**
 * Sessions (pattern, see REUSE.md): a random token in an httpOnly cookie, only its
 * hash stored; idle 60 min, absolute 12 h. Demo sign-in (persona picker) exists only in sandbox mode (P9).
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "@/db/client";
import { sessions, users, type Role } from "@/db/schema";
import { sha256 } from "./ids";
import { sandboxMode } from "./clock";
import { rateLimitKey } from "./net";

export const COOKIE = "ps_session";
const IDLE_MS = 60 * 60_000, ABS_MS = 12 * 60 * 60_000;
export interface Viewer { id: string; orgId: string; name: string; email: string; role: Role; persona: string | null; demo: boolean; mfa: boolean; tier: string }

/*
 * P9 shared demo: in the sandbox, a persona-picker session is one of many judges signed in as the same seeded person, so
 * it may use the person but not change their settings (profile, PayPal links, authenticator, password, other sessions).
 */
export const SHARED_DEMO_READ_ONLY = "Shared demo person: settings are read-only.";
export const sharedDemo = (v: Pick<Viewer, "demo">): boolean => v.demo && sandboxMode();

export async function startSession(userId: string, p: { mfa: boolean; demo: boolean }) {
  if (p.demo && !sandboxMode()) throw new Error("demo sign-in is sandbox-only (P9)");
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, mfa: p.mfa, demo: p.demo, endsAt: new Date(Date.now() + ABS_MS) });
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: ABS_MS / 1000 });
}

export async function viewer(): Promise<Viewer | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const now = new Date();
  const [row] = await db.select({ s: sessions, u: users }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.endsAt, now))).limit(1);
  if (!row || now.getTime() - row.s.lastSeenAt.getTime() > IDLE_MS) return null;
  if (now.getTime() - row.s.lastSeenAt.getTime() > 60_000) await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.tokenHash, row.s.tokenHash));
  const u = row.u;
  return { id: u.id, orgId: u.orgId, name: u.name, email: u.email, role: u.role, persona: u.persona, demo: row.s.demo, mfa: row.s.mfa, tier: u.tier };
}

export async function requireViewer(roles?: Role[]): Promise<Viewer> {
  const v = await viewer();
  if (!v) redirect("/login");
  if (roles && !roles.includes(v.role)) redirect(homeFor(v.role));
  return v;
}

export async function endSession() {
  const jar = await cookies(); const token = jar.get(COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(COOKIE);
}

export const homeFor = (r: Role) => ({ client: "/client", provider: "/provider", admin: "/admin", ops: "/ops", mediator: "/mediator", finance: "/finance", judge: "/playground", marketing: "/marketing" })[r];
export async function clientInfo() { const h = await headers(); return { ip: rateLimitKey(h), userAgent: h.get("user-agent") ?? "" }; }
