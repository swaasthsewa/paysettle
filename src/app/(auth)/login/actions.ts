"use server";
// F1.9 sandbox bypass (persona picker refused outside the sandbox, rule in demoSignInGuard) · F1.8 every sign-in ends in the terms handshake.
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { endSession } from "@/lib/session";
import { sandboxMode } from "@/lib/clock";
import { verifyPasswordAny } from "@/lib/identity/password";
import { verifyTotp } from "@/lib/identity/totp";
import { dbRecoveryStore, redeemRecoveryCode } from "@/lib/identity/recovery";
import { demoSignInGuard } from "@/lib/identity/handshake";
import { beginSignIn } from "@/lib/identity/handshake-session";

const LOCK_AFTER = 5, LOCK_MIN = 60;

export async function demoSignIn(f: FormData) {
  const id = String(f.get("userId") ?? "");
  const [u] = sandboxMode() ? await db.select().from(users).where(eq(users.id, id)).limit(1) : [];
  const g = demoSignInGuard({ sandbox: sandboxMode(), persona: u?.persona, exists: Boolean(u) });
  if (!g.ok || !u) redirect("/login?error=" + encodeURIComponent(g.ok ? "Unknown person." : g.message));
  await endSession();
  const to = await beginSignIn(u, { mfa: true, demo: true, via: "demo" });
  await audit(db, { id: u.id, role: u.role }, "auth.demo_sign_in", u.id);
  redirect(to);
}

export async function passwordSignIn(f: FormData) {
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  const pw = String(f.get("password") ?? ""), code = String(f.get("code") ?? "");
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const fail = (m: string) => redirect("/login?error=" + encodeURIComponent(m));
  if (!u || !u.passwordHash) return fail("Email or password is not right.");
  if (u.lockedUntil && u.lockedUntil > new Date()) return fail("This account is paused after too many attempts. Try again later.");
  if (!(await verifyPasswordAny(pw, u.passwordHash))) {
    const n = u.failedLogins + 1;
    await db.update(users).set({ failedLogins: n, lockedUntil: n >= LOCK_AFTER ? new Date(Date.now() + LOCK_MIN * 60_000) : null }).where(eq(users.id, u.id));
    await audit(db, { id: u.id, role: u.role }, "auth.failed", u.id, { attempts: n });
    return fail("Email or password is not right.");
  }
  const needsMfa = ["provider", "admin", "ops", "mediator", "finance"].includes(u.role);
  let mfa = false;
  if (u.mfaSecret) {
    const clean = code.replace(/\s+/g, "");
    if (/^\d{6}$/.test(clean)) {
      const r = verifyTotp(u.mfaSecret, clean, Date.now(), u.mfaLastStep);
      if (!r.ok) return fail("The authenticator code is not right.");
      await db.update(users).set({ mfaLastStep: r.step }).where(eq(users.id, u.id));
    } else {
      const r = await redeemRecoveryCode(dbRecoveryStore(db), u.id, clean, new Date());
      if (!r.ok) return fail("The authenticator code is not right.");
      await audit(db, { id: u.id, role: u.role }, "identity.recovery_code_used", u.id, { remaining: r.remaining });
    }
    mfa = true;
  } else if (needsMfa && !sandboxMode()) return fail("This role needs an authenticator app. Ask an administrator to set it up.");
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
  await endSession();
  const to = await beginSignIn(u, { mfa, demo: false, via: "password" });
  await audit(db, { id: u.id, role: u.role }, "auth.sign_in", u.id, { mfa });
  redirect(to);
}
