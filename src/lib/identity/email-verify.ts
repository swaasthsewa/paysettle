// F1.1 · IDENTITY — confirming that a person controls the e-mail address they registered with.
//
// The link carries a sealed value (HMAC with the identity key, P8): user id, e-mail, a random nonce and an expiry.
// Only the nonce's SHA-256 is stored with the account (users.profile.emailVerify), so a database reader cannot build a
// working link, and making a new link replaces the old nonce (one live link at a time, each usable once).
// Contract invites addressed to the e-mail are linked only after this confirmation (or an identity provider's
// verified e-mail): otherwise anyone could register an invited address and take the counterparty's seat.
import { randomBytes } from "node:crypto";
import { sha256 } from "@/lib/ids";
import { seal, unseal } from "./handshake";

export const VERIFY_PURPOSE = "verify-email";
export const VERIFY_TTL_MS = 24 * 60 * 60_000;
export const VERIFY_PATH = "/register/verify";

export interface VerifyClaim { u: string; e: string; n: string; exp: number }
export interface StoredVerify { nonceHash: string; exp: number; at: string }

/** A new link value and what the account stores for it. */
export function issueVerifyToken(userId: string, email: string, nowMs = Date.now()): { token: string; stored: StoredVerify } {
  const n = randomBytes(18).toString("base64url");
  const exp = nowMs + VERIFY_TTL_MS;
  return { token: seal(VERIFY_PURPOSE, { u: userId, e: email.toLowerCase(), n, exp }), stored: { nonceHash: sha256(n), exp, at: new Date(nowMs).toISOString() } };
}

export const readVerifyToken = (token: string | undefined | null, nowMs = Date.now()) => unseal<VerifyClaim>(VERIFY_PURPOSE, token ?? undefined, nowMs);

export type VerifyCheck = { ok: true } | { ok: false; reason: "invalid" | "expired" | "replaced" | "email_changed" | "already" };

/** Does this (already unsealed) claim match the account as it is now? Pure. */
export function checkVerifyClaim(c: VerifyClaim, account: { id: string; email: string; verifiedAt?: string | null; stored?: StoredVerify | null }, nowMs = Date.now()): VerifyCheck {
  if (c.u !== account.id) return { ok: false, reason: "invalid" };
  if (account.verifiedAt) return { ok: false, reason: "already" };
  if (c.e !== account.email.toLowerCase()) return { ok: false, reason: "email_changed" };
  if (!account.stored || account.stored.nonceHash !== sha256(c.n)) return { ok: false, reason: "replaced" };
  if (account.stored.exp <= nowMs || c.exp <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true };
}

export const VERIFY_MESSAGES: Record<Exclude<VerifyCheck, { ok: true }>["reason"], string> = {
  invalid: "This confirmation link is not valid. Make a new one from your welcome page.",
  expired: "This confirmation link has expired. Make a new one from your welcome page.",
  replaced: "A newer confirmation link was made, so this one no longer works. Use the newest link.",
  email_changed: "The account's e-mail address changed after this link was made. Make a new link.",
  already: "This e-mail address is already confirmed.",
};
