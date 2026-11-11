"use server";
/**
 * F1.2 MFA enforcer, F1.3 profile, F1.5 PayPal buyer link, sessions and password change — the account's server actions.
 * Every input is checked with zod or the identity rules (src/lib/identity); every change writes an audit row.
 * Secrets: the pending authenticator secret waits in users.profile.mfaPending until the first right code moves it to
 * users.mfa_secret; recovery codes are stored only as hashes and returned to the browser once.
 * P9: a shared demo person (persona picker, sandbox) gets SHARED_DEMO_READ_ONLY from every action that would change them.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, like, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { paypalLinks, recoveryCodes, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { sandboxMode } from "@/lib/clock";
import { newId, sha256 } from "@/lib/ids";
import { COOKIE, SHARED_DEMO_READ_ONLY, requireViewer, sharedDemo, type Viewer } from "@/lib/session";
import { beginEnrolment, confirmEnrolment, MFA_MAX_ATTEMPTS, mfaRequired } from "@/lib/identity/mfa";
import { hashPasswordStrong, verifyPasswordAny } from "@/lib/identity/password";
import { passwordProblems } from "@/lib/identity/policy";
import { buyerLink, profileSchema } from "@/lib/identity/profile";
import { dbRecoveryStore, issueRecoveryCodes, redeemRecoveryCode } from "@/lib/identity/recovery";
import { verifyTotp } from "@/lib/identity/totp";
import type { ActionAnswer } from "@/components/identity/action-form";

type Pending = { secret: string; attempts: number; at: string };
const actor = (v: Viewer) => ({ id: v.id, role: v.role });
const str = (f: FormData, k: string) => { const x = f.get(k); return typeof x === "string" ? x : ""; };
const done = (a: ActionAnswer) => { revalidatePath("/account"); return a; };
const readOnly: ActionAnswer = { ok: false, message: SHARED_DEMO_READ_ONLY };

async function row(id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw new Error("account not found");
  return u;
}
const mergeProfile = (patch: Record<string, unknown>) => sql`${users.profile} || ${JSON.stringify(patch)}::jsonb`;
const dropPending = sql`${users.profile} - 'mfaPending'`;

/* ── F1.3 profile ── */
export async function saveProfile(_p: ActionAnswer | null, f: FormData): Promise<ActionAnswer> {
  const v = await requireViewer();
  if (sharedDemo(v)) return readOnly;
  const r = profileSchema.safeParse({ name: str(f, "name"), currency: str(f, "currency"), timezone: str(f, "timezone"), billingName: str(f, "billingName"), billingCountry: str(f, "billingCountry") });
  if (!r.success) return { ok: false, message: "ERR_103 · The profile is not complete yet, so it was not saved.", problems: [...new Set(r.error.issues.map((i) => i.message))] };
  const { name, ...rest } = r.data;
  await db.update(users).set({ name, profile: mergeProfile({ ...rest, billingName: rest.billingName ?? null }) }).where(eq(users.id, v.id));
  await audit(db, actor(v), "identity.profile_saved", v.id, { currency: rest.currency, timezone: rest.timezone, billingCountry: rest.billingCountry });
  return done({ ok: true, message: `Saved. Amounts show in ${rest.currency} and times in ${rest.timezone}.` });
}

/* ── F1.5 PayPal buyer link (optional: checkout happens in PayPal anyway) ── */
export async function saveBuyerLink(_p: ActionAnswer | null, f: FormData): Promise<ActionAnswer> {
  const v = await requireViewer(["client", "judge"]);
  if (sharedDemo(v)) return readOnly;
  const raw = str(f, "email").trim();
  const [existing] = await db.select().from(paypalLinks).where(and(eq(paypalLinks.userId, v.id), eq(paypalLinks.kind, "buyer"))).limit(1);
  if (!raw) {
    if (existing) await db.delete(paypalLinks).where(eq(paypalLinks.id, existing.id));
    await audit(db, actor(v), "identity.paypal_buyer_unlinked", v.id);
    return done({ ok: true, message: "Removed. You can still fund any tranche: PayPal asks you to sign in when you approve." });
  }
  const r = buyerLink(raw);
  if (!r.ok) return { ok: false, message: r.message };
  if (existing) await db.update(paypalLinks).set(r.values).where(eq(paypalLinks.id, existing.id));
  else await db.insert(paypalLinks).values({ id: newId("pl"), userId: v.id, kind: "buyer", ...r.values });
  await audit(db, actor(v), "identity.paypal_buyer_linked", v.id, { sandbox: sandboxMode() });
  return done({ ok: true, message: `Saved. PayPal will suggest ${r.values.email} when you approve a hold; you can use another account there.` });
}

/* ── F1.2 authenticator enrolment ── */
export async function startMfa(): Promise<ActionAnswer> {
  const v = await requireViewer();
  if (sharedDemo(v)) return readOnly; /* an authenticator on a shared person would lock every other judge out of signing */
  const u = await row(v.id);
  if (u.mfaSecret) return { ok: false, message: "An authenticator app is already on for this account." };
  const e = beginEnrolment(u.email);
  const pending: Pending = { secret: e.secret, attempts: 0, at: new Date().toISOString() };
  await db.update(users).set({ profile: mergeProfile({ mfaPending: pending }) }).where(eq(users.id, v.id));
  await audit(db, actor(v), "identity.mfa_enrol_started", v.id);
  return done({ ok: true, message: "Add the key to your authenticator app, then type the six-digit code it shows." });
}

export async function cancelMfa(): Promise<void> {
  const v = await requireViewer();
  if (sharedDemo(v)) return;
  await db.update(users).set({ profile: dropPending }).where(eq(users.id, v.id));
  await audit(db, actor(v), "identity.mfa_enrol_cancelled", v.id);
  revalidatePath("/account");
}

export async function confirmMfa(_p: ActionAnswer | null, f: FormData): Promise<ActionAnswer> {
  const v = await requireViewer();
  if (sharedDemo(v)) return readOnly;
  const u = await row(v.id);
  const pending = (u.profile as { mfaPending?: Pending }).mfaPending;
  if (!pending?.secret) return { ok: false, message: "Start again: there is no authenticator waiting to be confirmed." };
  const r = confirmEnrolment({ secret: pending.secret, code: str(f, "code"), atMs: Date.now(), lastStep: u.mfaLastStep, attempts: pending.attempts });
  if (!r.ok) {
    if (r.locked) {
      await db.update(users).set({ profile: dropPending }).where(eq(users.id, v.id));
      await audit(db, actor(v), "identity.mfa_locked", v.id, { incident: "ERR_102", attempts: r.attempts });
      return done({ ok: false, message: `ERR_102 · ${MFA_MAX_ATTEMPTS} wrong codes in a row. This set-up was discarded and the attempt was logged for security. Start again with a new key.` });
    }
    await db.update(users).set({ profile: mergeProfile({ mfaPending: { ...pending, attempts: r.attempts } }) }).where(eq(users.id, v.id));
    const why = r.reason === "format" ? "Type the six digits your app shows, without letters." : r.reason === "used" ? "That code was already used. Wait for the next one." : "That code does not match. Check the time on your device and try the newest code.";
    return { ok: false, message: why, problems: r.reason === "format" ? undefined : [`${MFA_MAX_ATTEMPTS - r.attempts} tries left before this set-up is discarded.`] };
  }
  const codes = await db.transaction(async (tx) => {
    await tx.update(users).set({ mfaSecret: pending.secret, mfaLastStep: r.step, profile: sql`${users.profile} - 'mfaPending'` }).where(eq(users.id, v.id));
    const c = await issueRecoveryCodes(dbRecoveryStore(tx), v.id);
    await audit(tx, actor(v), "identity.mfa_enabled", v.id, { recoveryCodes: c.length });
    return c;
  });
  return done({ ok: true, message: "Authenticator on. From now on, signing in with a password asks for a code.", codes });
}

/** Check a current authenticator code (or, where allowed, a recovery code) for a sensitive change. Moves the last used step. */
async function secondFactor(v: Viewer, code: string, allowRecovery: boolean): Promise<string | null> {
  const u = await row(v.id);
  if (!u.mfaSecret) return "The authenticator app is not on.";
  const clean = code.replace(/\s+/g, "");
  if (/^\d{6}$/.test(clean)) {
    const r = verifyTotp(u.mfaSecret, clean, Date.now(), u.mfaLastStep);
    if (!r.ok) return r.reason === "used" ? "That code was already used. Wait for the next one." : "That code does not match.";
    await db.update(users).set({ mfaLastStep: r.step }).where(eq(users.id, v.id));
    return null;
  }
  if (!allowRecovery) return "Type the six-digit code from your authenticator app.";
  const r = await redeemRecoveryCode(dbRecoveryStore(db), v.id, clean, new Date());
  if (!r.ok) return "That recovery code is not valid, or it was already used.";
  await audit(db, actor(v), "identity.recovery_code_used", v.id, { remaining: r.remaining });
  return null;
}

export async function regenerateCodes(_p: ActionAnswer | null, f: FormData): Promise<ActionAnswer> {
  const v = await requireViewer();
  if (sharedDemo(v)) return readOnly;
  const problem = await secondFactor(v, str(f, "code"), false);
  if (problem) return { ok: false, message: problem };
  const codes = await issueRecoveryCodes(dbRecoveryStore(db), v.id);
  await audit(db, actor(v), "identity.recovery_codes_reissued", v.id, { count: codes.length });
  return done({ ok: true, message: "New codes made. Every earlier code stopped working.", codes });
}

export async function disableMfa(_p: ActionAnswer | null, f: FormData): Promise<ActionAnswer> {
  const v = await requireViewer();
  if (sharedDemo(v)) return readOnly;
  if (mfaRequired(v.role) && !sandboxMode()) return { ok: false, message: "Your role needs an authenticator app, so it cannot be switched off. Make new recovery codes instead, or ask an administrator." };
  const problem = await secondFactor(v, str(f, "code"), true);
  if (problem) return { ok: false, message: problem };
  await db.transaction(async (tx) => {
    await tx.update(users).set({ mfaSecret: null }).where(eq(users.id, v.id));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, v.id));
    await audit(tx, actor(v), "identity.mfa_disabled", v.id, { sandbox: sandboxMode() });
  });
  return done({ ok: true, message: mfaRequired(v.role) ? "Authenticator off (sandbox only). Your role needs it again before production." : "Authenticator off. Recovery codes were deleted." });
}

/* ── sessions ── */
async function currentHash() { const t = (await cookies()).get(COOKIE)?.value; return t ? sha256(t) : null; }

export async function endOneSession(f: FormData): Promise<void> {
  const v = await requireViewer();
  if (sharedDemo(v)) return; /* the other sessions of a shared person are other judges */
  const ref = str(f, "ref");
  if (!/^[a-f0-9]{16}$/.test(ref)) return;
  const mine = await currentHash();
  if (mine?.startsWith(ref)) return; /* this device signs out with Sign out, so the person is never left on a dead page */
  const gone = await db.delete(sessions).where(and(eq(sessions.userId, v.id), like(sessions.tokenHash, `${ref}%`))).returning({ h: sessions.tokenHash });
  if (gone.length) await audit(db, actor(v), "identity.session_ended", v.id, { ref });
  revalidatePath("/account");
}

export async function endOtherSessions(): Promise<void> {
  const v = await requireViewer();
  if (sharedDemo(v)) return;
  const mine = await currentHash();
  if (!mine) return;
  const gone = await db.delete(sessions).where(and(eq(sessions.userId, v.id), ne(sessions.tokenHash, mine))).returning({ h: sessions.tokenHash });
  await audit(db, actor(v), "identity.sessions_ended", v.id, { count: gone.length });
  revalidatePath("/account");
}

/* ── password ── */
export async function changePassword(_p: ActionAnswer | null, f: FormData): Promise<ActionAnswer> {
  const v = await requireViewer();
  if (sharedDemo(v)) return readOnly;
  const u = await row(v.id);
  const current = str(f, "current"), next = str(f, "next"), again = str(f, "again");
  if (u.passwordHash && !(await verifyPasswordAny(current, u.passwordHash))) {
    await audit(db, actor(v), "identity.password_change_refused", v.id, { reason: "current" });
    return { ok: false, message: "The current password is not right." };
  }
  const problems = passwordProblems(next, { email: u.email, name: u.name });
  if (next !== again) problems.push("The two new passwords are not the same.");
  if (problems.length) return { ok: false, message: "Pick a different new password.", problems };
  const hash = await hashPasswordStrong(next);
  const mine = await currentHash();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: hash, failedLogins: 0, lockedUntil: null }).where(eq(users.id, v.id));
    if (mine) await tx.delete(sessions).where(and(eq(sessions.userId, v.id), ne(sessions.tokenHash, mine)));
    await audit(tx, actor(v), "identity.password_changed", v.id, { otherSessionsEnded: true });
  });
  return done({ ok: true, message: "Password changed. Every other session was signed out." });
}
