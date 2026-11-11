/**
 * F1.8 baseline handshake and F1.9 sandbox bypass guard.
 *
 * F1.8: every person accepts the platform terms (versioned by TERMS_VERSION) once before any workspace opens. Each decision
 * (accept or decline) is stored with time, IP, user agent, version and an HMAC over those fields, and audited. Until the
 * current version is accepted, sign-in does not start a session: the signed-in identity is parked in a short-lived signed
 * handshake cookie (handshake-session.ts) and the person is sent to /terms-accept. Declining starts no session.
 * F1.9: the persona picker (no-password demo sign-in) is a sandbox-only bypass (P9); demoSignInGuard is the one rule the
 * login action applies, kept pure so it is tested directly with PAYSETTLE_ENV=production.
 * P8: the HMAC key is SIGNING_KEY; only sandbox mode falls back to a key derived from the database address.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, type Db, type Tx } from "@/db/client";
import { termsDecisions } from "@/db/schema-identity";
import type { Role } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canonical } from "@/lib/canonical";
import { sandboxMode } from "@/lib/clock";
import { sha256 } from "@/lib/ids";

export const TERMS_VERSION = "2026-11-08";
/** The points the handshake page shows; the full text lives on /terms. */
export const TERMS_POINTS = [
  "Money for each milestone is held in PayPal and released only after the client approves it or a mediator decides a dispute.",
  "Evidence you upload is hashed and kept with the contract; both parties and, in a dispute, the mediator can see it.",
  "AI suggestions are advice only. People approve, sign and decide; the AI never moves money.",
  "Disputes follow the contract's dispute rules: a fix window first, a mediator's signed verdict last.",
  "Every change is written to a tamper-evident audit trail that you can ask to see.",
] as const;

/* ── keys and sealed values ── */
export function identityKey(): string {
  const k = process.env.SIGNING_KEY;
  if (k) return k;
  if (!sandboxMode()) throw new Error("SIGNING_KEY is not set (P8)");
  return sha256("paysettle-sandbox-identity-key:" + (process.env.DATABASE_URL ?? "local"));
}
const hmac = (purpose: string, data: string) => createHmac("sha256", identityKey()).update(purpose + "\n" + data).digest("base64url");
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** A tamper-evident cookie value: base64url(JSON) + "." + HMAC. `exp` (ms epoch) is required and checked on open. */
export function seal(purpose: string, value: Record<string, unknown> & { exp: number }): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return body + "." + hmac(purpose, body);
}
export function unseal<T extends { exp: number }>(purpose: string, token: string | undefined, now = Date.now()): T | null {
  if (!token) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined || !safeEq(sig, hmac(purpose, body))) return null;
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return typeof v.exp === "number" && v.exp > now ? v : null;
  } catch { return null; }
}

/* ── F1.8 terms records ── */
export interface TermsRecord { userId: string; version: string; decision: "ACCEPTED" | "DECLINED"; ip: string; userAgent: string; at: Date }
export const termsSignature = (r: TermsRecord) => hmac("terms", canonical({ userId: r.userId, version: r.version, decision: r.decision, ip: r.ip, userAgent: r.userAgent, at: r.at.toISOString() }));
export const verifyTermsSignature = (r: TermsRecord, sig: string) => safeEq(termsSignature(r), sig);

export type TermsState = "ACCEPTED" | "DECLINED" | "PENDING";
/** The person's latest decision on `version`; PENDING when there is none. */
export async function termsState(userId: string, version = TERMS_VERSION, q: Db | Tx = db): Promise<TermsState> {
  const [r] = await q.select({ d: termsDecisions.decision }).from(termsDecisions).where(and(eq(termsDecisions.userId, userId), eq(termsDecisions.version, version))).orderBy(desc(termsDecisions.id)).limit(1);
  return r?.d ?? "PENDING";
}

export async function recordTermsDecision(p: { userId: string; role: Role | string; decision: "ACCEPTED" | "DECLINED"; ip: string; userAgent: string; version?: string; at?: Date }, q: Db = db) {
  const rec: TermsRecord = { userId: p.userId, version: p.version ?? TERMS_VERSION, decision: p.decision, ip: p.ip.slice(0, 64), userAgent: p.userAgent.slice(0, 300), at: p.at ?? new Date() };
  rec.at = new Date(Math.floor(rec.at.getTime() / 1000) * 1000); // second precision, so the stored timestamp re-verifies exactly
  const signature = termsSignature(rec);
  await q.transaction(async (tx) => {
    await tx.insert(termsDecisions).values({ ...rec, signature });
    await audit(tx, { id: p.userId, role: String(p.role) }, p.decision === "ACCEPTED" ? "identity.terms_accept" : "identity.terms_decline", p.userId, { version: rec.version, ip: rec.ip, signature: signature.slice(0, 16) });
  });
  return { ...rec, signature };
}

/* ── F1.9 sandbox bypass ── */
export type GuardResult = { ok: true } | { ok: false; message: string };
/** The persona picker signs in without a password, so it exists only in sandbox mode (P9) and only for seeded personas. */
export function demoSignInGuard(p: { sandbox: boolean; persona: string | null | undefined; exists: boolean }): GuardResult {
  if (!p.sandbox) return { ok: false, message: "Demo sign-in is off in production. Sign in with your email or with SSO." };
  if (!p.exists || !p.persona) return { ok: false, message: "Unknown person." };
  return { ok: true };
}
