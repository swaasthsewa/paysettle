/**
 * F1.8 handshake at sign-in (cookie side). Every sign-in path (password, persona picker, SSO) ends in beginSignIn():
 * with the current terms accepted it starts the session and returns the person's home; otherwise it parks the verified
 * identity in a signed 15-minute handshake cookie and returns /terms-accept. No session exists until the terms are accepted.
 */
import { cookies } from "next/headers";
import type { Role } from "@/db/schema";
import { homeFor, startSession } from "@/lib/session";
import { seal, termsState, unseal } from "./handshake";

export const HANDSHAKE_COOKIE = "ps_handshake";
const PURPOSE = "handshake", TTL_MS = 15 * 60_000;
export interface Pending { u: string; role: Role; mfa: boolean; demo: boolean; via: string; exp: number }

export async function beginSignIn(u: { id: string; role: Role }, p: { mfa: boolean; demo: boolean; via: "password" | "demo" | "sso" | "register" }): Promise<string> {
  if ((await termsState(u.id)) === "ACCEPTED") {
    await startSession(u.id, { mfa: p.mfa, demo: p.demo });
    return homeFor(u.role);
  }
  const v: Pending = { u: u.id, role: u.role, mfa: p.mfa, demo: p.demo, via: p.via, exp: Date.now() + TTL_MS };
  (await cookies()).set(HANDSHAKE_COOKIE, seal(PURPOSE, { ...v }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_MS / 1000 });
  return "/terms-accept";
}

export async function pendingHandshake(): Promise<Pending | null> {
  return unseal<Pending>(PURPOSE, (await cookies()).get(HANDSHAKE_COOKIE)?.value);
}
export async function clearHandshake() { (await cookies()).delete(HANDSHAKE_COOKIE); }
