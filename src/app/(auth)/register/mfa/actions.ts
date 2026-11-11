"use server";
/**
 * F1.1, F1.2 · the authenticator step of registration. The account waits in the sealed registration-step cookie
 * (no session). Same rules as Account & security: the first right code switches the app on (its step becomes the last
 * used step, so it cannot be replayed), ten recovery codes are shown once and stored only as hashes, five wrong codes
 * discard the set-up (ERR_102). Continue starts the session through beginSignIn; skipping is allowed in the sandbox only (P9).
 */
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { sandboxMode } from "@/lib/clock";
import { endSession } from "@/lib/session";
import { beginSignIn } from "@/lib/identity/handshake-session";
import { beginEnrolment, confirmEnrolment, MFA_MAX_ATTEMPTS } from "@/lib/identity/mfa";
import { dbRecoveryStore, issueRecoveryCodes } from "@/lib/identity/recovery";
import { clearParkedRegistration, parkedRegistration } from "@/lib/identity/register-session";
import { nextAfterRegistration } from "@/server/identity/invites";
import type { ActionAnswer } from "@/components/identity/action-form";

type Pending = { secret: string; attempts: number; at: string };
const EXPIRED = "Your registration step expired. Sign in with your e-mail and password to continue; the authenticator set-up is on Account & security.";

async function parked() {
  const s = await parkedRegistration();
  if (!s) return null;
  const [u] = await db.select().from(users).where(eq(users.id, s.u)).limit(1);
  return u ?? null;
}

export async function confirmRegMfa(_p: ActionAnswer | null, f: FormData): Promise<ActionAnswer> {
  const u = await parked();
  if (!u) return { ok: false, message: EXPIRED };
  if (u.mfaSecret) return { ok: true, message: "The authenticator app is already on. Continue below." };
  const pending = (u.profile as { mfaPending?: Pending }).mfaPending;
  if (!pending?.secret) return { ok: false, message: "There is no set-up waiting. Use “Start again with a new key”." };
  const code = String(f.get("code") ?? "");
  const r = confirmEnrolment({ secret: pending.secret, code, atMs: Date.now(), lastStep: u.mfaLastStep, attempts: pending.attempts });
  const actor = { id: u.id, role: u.role };
  if (!r.ok) {
    if (r.locked) {
      await db.update(users).set({ profile: sql`${users.profile} - 'mfaPending'` }).where(eq(users.id, u.id));
      await audit(db, actor, "identity.mfa_locked", u.id, { incident: "ERR_102", attempts: r.attempts, step: "registration" });
      return { ok: false, message: `ERR_102 · ${MFA_MAX_ATTEMPTS} wrong codes in a row. This set-up was discarded and the attempt was logged for security. Start again with a new key.` };
    }
    await db.update(users).set({ profile: sql`${users.profile} || ${JSON.stringify({ mfaPending: { ...pending, attempts: r.attempts } })}::jsonb` }).where(eq(users.id, u.id));
    const why = r.reason === "format" ? "Type the six digits your app shows, without letters." : r.reason === "used" ? "That code was already used. Wait for the next one." : "That code does not match. Check the time on your device and try the newest code.";
    return { ok: false, message: why, problems: r.reason === "format" ? undefined : [`${MFA_MAX_ATTEMPTS - r.attempts} tries left before this set-up is discarded.`] };
  }
  const codes = await db.transaction(async (tx) => {
    await tx.update(users).set({ mfaSecret: pending.secret, mfaLastStep: r.step, profile: sql`${users.profile} - 'mfaPending'` }).where(eq(users.id, u.id));
    const c = await issueRecoveryCodes(dbRecoveryStore(tx), u.id);
    await audit(tx, actor, "identity.mfa_enabled", u.id, { recoveryCodes: c.length, step: "registration" });
    return c;
  });
  return { ok: true, message: "Authenticator on. Save the recovery codes below, then continue.", codes };
}

export async function restartRegMfa(): Promise<void> {
  const u = await parked();
  if (!u) redirect("/login?error=" + encodeURIComponent(EXPIRED));
  if (!u.mfaSecret) {
    const pending: Pending = { secret: beginEnrolment(u.email).secret, attempts: 0, at: new Date().toISOString() };
    await db.update(users).set({ profile: sql`${users.profile} || ${JSON.stringify({ mfaPending: pending })}::jsonb` }).where(eq(users.id, u.id));
    await audit(db, { id: u.id, role: u.role }, "identity.mfa_enrol_started", u.id, { step: "registration" });
  }
  redirect("/register/mfa");
}

export async function finishRegMfa(f: FormData): Promise<void> {
  const u = await parked();
  if (!u) redirect("/login?error=" + encodeURIComponent(EXPIRED));
  const skip = f.get("skip") === "1";
  if (!u.mfaSecret) {
    if (!skip || !sandboxMode()) redirect("/register/mfa?error=" + encodeURIComponent("Set up the authenticator app first: providers need it to sign in."));
    await audit(db, { id: u.id, role: u.role }, "identity.mfa_skipped", u.id, { sandbox: true, step: "registration" });
  }
  await clearParkedRegistration();
  await endSession();
  const to = await beginSignIn({ id: u.id, role: u.role }, { mfa: Boolean(u.mfaSecret), demo: false, via: "register" });
  redirect(to === "/terms-accept" ? to : await nextAfterRegistration(u.id));
}
