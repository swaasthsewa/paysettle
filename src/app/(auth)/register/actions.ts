"use server";
/**
 * F1.1 self-registration · F1.2 MFA for providers · F1.8 terms on the form · F2.02 invite linking.
 * Request side of /register: rate limit and honeypot (as the waitlist), zod + password policy (readRegistration), the
 * sandbox-only demo identity provider identity (sealed cookie), then createAccount (src/server/identity/register.ts).
 * Afterwards: providers go to the authenticator step (no session until it is done outside the sandbox); everyone else
 * signs in through the same beginSignIn every sign-in path uses, and lands in their invited contract's room or on the
 * welcome page.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { rateLimitKey } from "@/lib/net";
import { clientInfo, endSession } from "@/lib/session";
import { TERMS_VERSION } from "@/lib/identity/handshake";
import { beginSignIn } from "@/lib/identity/handshake-session";
import { DUPLICATE_MESSAGE, readRegistration, type FieldErrors } from "@/lib/identity/registration";
import { clearSocialIdentity, socialIdentity } from "@/lib/identity/register-social";
import { parkRegistration } from "@/lib/identity/register-session";
import { createAccount } from "@/server/identity/register";
import { issueConfirmationLink } from "@/server/identity/confirm-link";
import { nextAfterRegistration } from "@/server/identity/invites";
import { gateRegistration } from "@/server/identity/limits";

export interface RegAnswer { ok: boolean; message: string; errors?: FieldErrors; values?: Record<string, string> }

const KEEP = ["name", "email", "role", "country", "timezone"] as const;

export async function register(_prev: RegAnswer | null, form: FormData): Promise<RegAnswer> {
  const input: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") input[k] = v.slice(0, 2_000);
  const values = Object.fromEntries(KEEP.map((k) => [k, input[k] ?? ""]));

  const social = input.via === "demo-idp" ? await socialIdentity() : null;
  if (input.via === "demo-idp" && !social) return { ok: false, message: "The demo identity provider sign-in expired or was not finished. Start it again, or register with e-mail.", values };

  const gate = gateRegistration(rateLimitKey(await headers()), social?.email ?? input.email ?? null, Date.now());
  if (!gate.ok) return { ok: false, message: gate.message, values };

  const read = readRegistration(input, { termsVersion: TERMS_VERSION, fixedEmail: social?.email });
  /* a robot that filled the hidden field is told all went well; nothing is stored */
  if (read.ok && read.robot) return { ok: true, message: "Thank you. Your registration was received." };
  if (!read.ok) return { ok: false, message: "Some details need another look. The fields with a problem are listed below.", errors: read.errors, values };

  const { ip, userAgent } = await clientInfo();
  const r = await createAccount({ ...read.data, via: social ? "demo-idp" : "password", verifiedEmail: Boolean(social), idp: social ? { iss: social.iss, sub: social.sub } : undefined }, { ip, userAgent });
  if (!r.ok) return { ok: false, message: DUPLICATE_MESSAGE, errors: { email: [DUPLICATE_MESSAGE] }, values };

  if (social) await clearSocialIdentity();
  else await issueConfirmationLink(r.user.id);

  if (r.mfaPending) {
    await parkRegistration(r.user.id);
    redirect("/register/mfa");
  }
  await endSession();
  const to = await beginSignIn({ id: r.user.id, role: r.user.role }, { mfa: false, demo: false, via: "register" });
  redirect(to === "/terms-accept" ? to : await nextAfterRegistration(r.user.id));
}
