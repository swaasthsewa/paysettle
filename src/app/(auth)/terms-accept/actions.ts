"use server";
/**
 * F1.8 baseline handshake actions. Accept → signed record + session starts. Decline → signed record, no session, and the
 * person is signed out with a message (features stay closed until they accept).
 * P9: a shared demo person (persona picker, sandbox) who declines is signed out, but no DECLINED record is written: the
 * same seeded person is used by every judge, and one judge's refusal must not stand for the others.
 */
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { clientInfo, endSession, homeFor, sharedDemo, startSession, viewer } from "@/lib/session";
import { recordTermsDecision, TERMS_VERSION } from "@/lib/identity/handshake";
import { clearHandshake, pendingHandshake } from "@/lib/identity/handshake-session";

async function who() {
  const p = await pendingHandshake();
  if (p) {
    const [u] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, p.u)).limit(1);
    return u ? { id: u.id, role: u.role, demo: p.demo, pending: p } : null;
  }
  const v = await viewer();
  return v ? { id: v.id, role: v.role, demo: v.demo, pending: null } : null;
}

export async function acceptTerms(f: FormData) {
  const w = await who();
  if (!w) redirect("/login?error=" + encodeURIComponent("Your sign-in expired before the terms were accepted. Sign in again."));
  if (String(f.get("version") ?? "") !== TERMS_VERSION) redirect("/terms-accept?error=" + encodeURIComponent("The terms changed while this page was open. Read the current version."));
  if (f.get("agree") !== "on") redirect("/terms-accept?error=" + encodeURIComponent("Tick the box to confirm you have read the terms."));
  const { ip, userAgent } = await clientInfo();
  await recordTermsDecision({ userId: w.id, role: w.role, decision: "ACCEPTED", ip, userAgent });
  if (w.pending) {
    await endSession();
    await startSession(w.id, { mfa: w.pending.mfa, demo: w.pending.demo });
    await clearHandshake();
    await audit(db, { id: w.id, role: w.role }, "auth.handshake_complete", w.id, { via: w.pending.via, version: TERMS_VERSION });
  }
  redirect(homeFor(w.role));
}

export async function declineTerms() {
  const w = await who();
  if (w && !sharedDemo(w)) {
    const { ip, userAgent } = await clientInfo();
    await recordTermsDecision({ userId: w.id, role: w.role, decision: "DECLINED", ip, userAgent });
  }
  await clearHandshake();
  await endSession();
  redirect("/login?error=" + encodeURIComponent("You declined the platform terms, so you were signed out and contracts, funding and payouts stay closed. Sign in again and accept them whenever you are ready."));
}
