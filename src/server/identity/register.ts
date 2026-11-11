/**
 * F1.1 self-registration: the account-creating side, shared by the e-mail form and the sandbox demo identity
 * provider. The request side (rate limit, honeypot, cookies, redirects) lives in src/app/(auth)/register/actions.ts.
 *
 *   · the password is hashed with the platform's scrypt format (password.ts) BEFORE the duplicate check, so a new
 *     address and an existing one take the same time to answer (no timing hint about which addresses have accounts);
 *   · a duplicate address answers ERR_101 only (DUPLICATE_MESSAGE); the attempt is audited against the existing
 *     account, without the address (the audit chain is append-only, so no personal data goes into it);
 *   · each registered person gets their own organisation, role client or provider, trust tier "new", onboarding state
 *     PENDING; the profile keeps country, time zone, contract currency (USD, the currency workspaces use today) and
 *     how the account was opened;
 *   · the platform terms (F1.8) are accepted on the form itself and recorded with the same signed record the
 *     handshake page writes (recordTermsDecision: time, IP, browser, version, HMAC), so sign-in finds them accepted;
 *   · an e-mail confirmed by an identity provider counts as confirmed (emailVerifiedAt), which lets invites link.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs, users, type Role } from "@/db/schema";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { recordTermsDecision } from "@/lib/identity/handshake";
import { beginEnrolment, mfaRequired } from "@/lib/identity/mfa";
import { hashPasswordStrong } from "@/lib/identity/password";
import type { Registration } from "@/lib/identity/registration";
import { checkVerifyClaim, issueVerifyToken, readVerifyToken, VERIFY_MESSAGES, type StoredVerify } from "@/lib/identity/email-verify";
import { linkInvites, type InviteLinkResult } from "./invites";

export type Via = "password" | "demo-idp";
export interface NewAccount extends Registration { via: Via; verifiedEmail?: boolean; idp?: { iss: string; sub: string } }
export interface AccountRef { id: string; orgId: string; role: Role; email: string; name: string }
export type RegisterResult =
  | { ok: true; user: AccountRef; invites: InviteLinkResult; mfaPending: boolean }
  | { ok: false; code: "ERR_101" };

export interface RegisterCtx { ip: string; userAgent: string; orgId?: string; now?: Date }

const isUniqueViolation = (e: unknown) => {
  const c = (e as { code?: string; cause?: { code?: string } } | null);
  return c?.code === "23505" || c?.cause?.code === "23505";
};

export async function createAccount(a: NewAccount, ctx: RegisterCtx): Promise<RegisterResult> {
  const now = ctx.now ?? new Date();
  const passwordHash = await hashPasswordStrong(a.password);
  const email = a.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const duplicate = async (targetId: string | null) => {
    await audit(db, { id: null, role: "public" }, "identity.register_duplicate", targetId ?? "users", { via: a.via, incident: "ERR_101" });
    return { ok: false as const, code: "ERR_101" as const };
  };
  if (existing) return duplicate(existing.id);

  const id = newId("u"), orgId = ctx.orgId ?? newId("org");
  /* providers enrol an authenticator straight after registration (F1.2); its secret waits here until the first right code */
  const mfaPending = mfaRequired(a.role) ? { secret: beginEnrolment(email).secret, attempts: 0, at: now.toISOString() } : null;
  const profile: Record<string, unknown> = {
    country: a.country, billingCountry: a.country, timezone: a.timezone, currency: "USD",
    registeredVia: a.via, registeredAt: now.toISOString(),
    ...(a.verifiedEmail ? { emailVerifiedAt: now.toISOString(), emailVerifiedBy: a.via } : {}),
    ...(a.idp ? { idp: { iss: a.idp.iss, sub: a.idp.sub } } : {}),
    ...(a.role === "provider" ? { provider: { country: a.country } } : {}),
    ...(mfaPending ? { mfaPending } : {}),
  };
  try {
    await db.transaction(async (tx) => {
      await tx.insert(orgs).values({ id: orgId, name: a.name.slice(0, 120) });
      await tx.insert(users).values({ id, orgId, email, name: a.name, role: a.role, passwordHash, tier: "new", onboardingState: "PENDING", profile });
      await audit(tx, { id, role: a.role }, "identity.register", id, { role: a.role, country: a.country, timezone: a.timezone, via: a.via, emailVerified: Boolean(a.verifiedEmail) });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return duplicate(null); // two registrations for one address raced: the second one loses the same way
    throw e;
  }
  await recordTermsDecision({ userId: id, role: a.role, decision: "ACCEPTED", ip: ctx.ip, userAgent: ctx.userAgent, at: now });
  const invites = a.verifiedEmail && a.role === "provider" ? await linkInvites(id) : { linked: [], deferred: [] };
  return { ok: true, user: { id, orgId, role: a.role, email, name: a.name }, invites, mfaPending: Boolean(mfaPending) };
}

/* ── e-mail confirmation ── */
const merge = (patch: Record<string, unknown>) => sql`${users.profile} || ${JSON.stringify(patch)}::jsonb`;

/** Make a new confirmation link value for the account (replaces any earlier one). */
export async function startEmailVerification(userId: string, nowMs = Date.now()): Promise<{ token: string } | { already: true }> {
  const [u] = await db.select({ id: users.id, email: users.email, role: users.role, profile: users.profile }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("account not found");
  if ((u.profile as { emailVerifiedAt?: string }).emailVerifiedAt) return { already: true };
  const { token, stored } = issueVerifyToken(u.id, u.email, nowMs);
  await db.update(users).set({ profile: merge({ emailVerify: stored }) }).where(eq(users.id, u.id));
  await audit(db, { id: u.id, role: u.role }, "identity.email_verify_issued", u.id, { expires: new Date(stored.exp).toISOString() });
  return { token };
}

export type ConfirmResult = { ok: true; userId: string; role: Role; invites: InviteLinkResult } | { ok: false; message: string; already?: boolean };

/** Confirm the e-mail behind a link value: one use, current nonce, unchanged address, not expired. Then link invites. */
export async function confirmEmail(token: string, nowMs = Date.now()): Promise<ConfirmResult> {
  const c = readVerifyToken(token, nowMs);
  if (!c) return { ok: false, message: VERIFY_MESSAGES.expired };
  const [u] = await db.select().from(users).where(eq(users.id, c.u)).limit(1);
  if (!u) return { ok: false, message: VERIFY_MESSAGES.invalid };
  const p = u.profile as { emailVerifiedAt?: string; emailVerify?: StoredVerify };
  const check = checkVerifyClaim(c, { id: u.id, email: u.email, verifiedAt: p.emailVerifiedAt, stored: p.emailVerify ?? null }, nowMs);
  if (!check.ok) return { ok: false, message: VERIFY_MESSAGES[check.reason], already: check.reason === "already" };
  /* conditional update: only the request that still sees the same nonce wins, so a link works once */
  const done = await db.update(users).set({ profile: sql`(${users.profile} - 'emailVerify') || ${JSON.stringify({ emailVerifiedAt: new Date(nowMs).toISOString(), emailVerifiedBy: "link" })}::jsonb` })
    .where(sql`${users.id} = ${u.id} and ${users.profile}->'emailVerify'->>'nonceHash' = ${p.emailVerify!.nonceHash}`).returning({ id: users.id });
  if (!done.length) return { ok: false, message: VERIFY_MESSAGES.replaced };
  await audit(db, { id: u.id, role: u.role }, "identity.email_verified", u.id, { via: "link" });
  return { ok: true, userId: u.id, role: u.role, invites: await linkInvites(u.id) };
}
