// F1.2 · IDENTITY — enrolling an authenticator app. Pure: the caller passes the time and stores the result.
//
//   begin   a new secret, the otpauth:// address for apps that read a QR code, and the key in groups of four
//           for typing by hand (no QR library is needed: every authenticator app accepts the typed key)
//   confirm the first code from the app turns the second factor on; the step it matched becomes the last used
//           step, so the same code can never be replayed at sign-in
//   lock    after 5 wrong codes the pending enrolment is discarded and the attempt is logged as an incident (ERR_102)
import type { Role } from "@/db/schema";
import { newTotpSecret, otpauthUri, verifyTotp } from "./totp";

export const MFA_ISSUER = "PaySettle";
export const MFA_MAX_ATTEMPTS = 5;
/** Roles that must use an authenticator app outside the sandbox (F1.2: providers and every operational role). */
export const MFA_ROLES: readonly Role[] = ["provider", "admin", "ops", "mediator", "finance"];
export const mfaRequired = (role: Role) => MFA_ROLES.includes(role);

/** The key as people type it: groups of four, separated by spaces. */
export const keyGroups = (secretBase32: string) => secretBase32.replace(/=+$/, "").match(/.{1,4}/g)?.join(" ") ?? "";

export interface Enrolment { secret: string; uri: string; groups: string }
export function beginEnrolment(account: string, secret: string = newTotpSecret()): Enrolment {
  return { secret, uri: otpauthUri({ secretBase32: secret, account, issuer: MFA_ISSUER }), groups: keyGroups(secret) };
}

export type ConfirmResult =
  | { ok: true; step: number }
  | { ok: false; reason: "format" | "wrong" | "used"; attempts: number; locked: boolean };

/** Check the code that should switch the second factor on. `attempts` is how many wrong codes came before this one. */
export function confirmEnrolment(p: { secret: string; code: string; atMs: number; lastStep?: number; attempts: number }): ConfirmResult {
  const r = verifyTotp(p.secret, p.code, p.atMs, p.lastStep ?? 0);
  if (r.ok) return { ok: true, step: r.step };
  /* a code typed in the wrong shape is not counted as a guess */
  const attempts = r.reason === "format" ? p.attempts : p.attempts + 1;
  return { ok: false, reason: r.reason, attempts, locked: attempts >= MFA_MAX_ATTEMPTS };
}
