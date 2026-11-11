/**
 * F1.1 · registration abuse limits (same in-memory fixed-window limiter as the waitlist, src/lib/identity/rate-limit.ts).
 *   · per client address (rightmost X-Forwarded-For hop, src/lib/net.ts): 10 registration posts per 10 minutes
 *   · per e-mail address: 5 posts per hour, so one address cannot be probed from many networks quickly
 *   · demo identity provider sign-up starts: 10 per 10 minutes per address
 *   · new confirmation links: 3 per 10 minutes per account
 * One server process (the hackathon deployment); several instances need a shared store.
 */
import { fixedWindow, type Limiter } from "@/lib/identity/rate-limit";

const g = globalThis as unknown as { __psRegLimits?: { ip: Limiter; email: Limiter; social: Limiter; resend: Limiter } };
export const regLimits = (g.__psRegLimits ??= {
  ip: fixedWindow(10, 10 * 60_000),
  email: fixedWindow(5, 60 * 60_000),
  social: fixedWindow(10, 10 * 60_000),
  resend: fixedWindow(3, 10 * 60_000),
});

export type Gate = { ok: true } | { ok: false; retryAfterS: number; message: string };
const minutes = (s: number) => Math.max(1, Math.ceil(s / 60));
export const limitMessage = (retryAfterS: number) => `Too many attempts. Try again in ${minutes(retryAfterS)} minute${minutes(retryAfterS) === 1 ? "" : "s"}.`;

/** Count one registration post from `ip` (and for `email`, when one was typed). Both windows are counted. */
export function gateRegistration(ip: string, email: string | null, nowMs: number, l = regLimits): Gate {
  const a = l.ip.hit(ip, nowMs);
  const b = email ? l.email.hit(email.trim().toLowerCase(), nowMs) : { ok: true, retryAfterS: 0 };
  if (a.ok && b.ok) return { ok: true };
  const wait = Math.max(a.retryAfterS, b.retryAfterS);
  return { ok: false, retryAfterS: wait, message: limitMessage(wait) };
}

export function gateOne(l: Limiter, key: string, nowMs: number): Gate {
  const r = l.hit(key, nowMs);
  return r.ok ? { ok: true } : { ok: false, retryAfterS: r.retryAfterS, message: limitMessage(r.retryAfterS) };
}
