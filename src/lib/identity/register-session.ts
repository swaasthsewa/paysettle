/**
 * F1.1, F1.2 · the step between "account created" and "signed in" for a new provider: the authenticator app must be
 * set up before the first session outside the sandbox (MFA enforcement as at sign-in, F1.2). Until then the new
 * account id waits in a sealed 30-minute cookie on /register, like the F1.8 handshake cookie waits for the terms; no
 * session exists. The sandbox lets the person skip the step (P9), as sign-in does there.
 */
import { cookies } from "next/headers";
import { seal, unseal } from "./handshake";

export const REG_STEP_COOKIE = "ps_reg_step";
const PURPOSE = "register-step", TTL_MS = 30 * 60_000;
export interface RegStep { u: string; exp: number }

export async function parkRegistration(userId: string) {
  (await cookies()).set(REG_STEP_COOKIE, seal(PURPOSE, { u: userId, exp: Date.now() + TTL_MS }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/register", maxAge: TTL_MS / 1000 });
}
export async function parkedRegistration(): Promise<RegStep | null> {
  return unseal<RegStep>(PURPOSE, (await cookies()).get(REG_STEP_COOKIE)?.value);
}
export async function clearParkedRegistration() { (await cookies()).delete({ name: REG_STEP_COOKIE, path: "/register" }); }

/* ── sandbox outbox: where a confirmation link is shown when no e-mail is sent (sandbox only) ── */
export const OUTBOX_COOKIE = "ps_reg_outbox";
const OUTBOX_PURPOSE = "register-outbox", OUTBOX_TTL_MS = 60 * 60_000;
export interface Outbox { u: string; link: string; exp: number }
export async function putOutbox(userId: string, link: string) {
  (await cookies()).set(OUTBOX_COOKIE, seal(OUTBOX_PURPOSE, { u: userId, link, exp: Date.now() + OUTBOX_TTL_MS }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/register", maxAge: OUTBOX_TTL_MS / 1000 });
}
export async function readOutbox(userId: string): Promise<string | null> {
  const o = unseal<Outbox>(OUTBOX_PURPOSE, (await cookies()).get(OUTBOX_COOKIE)?.value);
  return o && o.u === userId ? o.link : null;
}
export async function clearOutbox() { (await cookies()).delete({ name: OUTBOX_COOKIE, path: "/register" }); }
