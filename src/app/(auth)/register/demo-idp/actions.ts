"use server";
/**
 * F1.1 · demo identity provider, sign-up consent (sandbox only, P9). Issues a one-time authorization code for the demo
 * social account the person typed, through the same issueDemoCode the staff consent screen uses, or denies.
 * The code is bound to the registered redirect path /register/social/callback, the PKCE challenge and the nonce.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertDemoIdp, checkAuthorizeRequest, demoIssuer, issueDemoCode, type AuthorizeRequest } from "@/lib/identity/sso-demo";
import { requestOrigin } from "@/lib/identity/sso-flow";
import { REG_CALLBACK_PATH } from "@/lib/identity/register-social";

const person = z.object({
  name: z.string().trim().min(2).max(80).refine((s) => !/[\u0000-\u001f<>]/.test(s)),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
});

function readRequest(f: FormData): AuthorizeRequest {
  const g = (k: string) => String(f.get(k) ?? "");
  return { clientId: g("client_id"), redirectUri: g("redirect_uri"), state: g("state"), nonce: g("nonce"), codeChallenge: g("code_challenge"), codeChallengeMethod: g("code_challenge_method"), responseType: g("response_type") };
}
const isSignUp = (r: AuthorizeRequest) => { try { return new URL(r.redirectUri).pathname === REG_CALLBACK_PATH; } catch { return false; } };
const back = (m: string) => redirect("/register?error=" + encodeURIComponent(m));

export async function signUpConsent(f: FormData) {
  assertDemoIdp();
  const r = readRequest(f), issuer = demoIssuer(await requestOrigin());
  if (checkAuthorizeRequest(r, issuer) || !isSignUp(r)) back("The demo identity provider refused a malformed sign-up request. Start again.");
  const p = person.safeParse({ name: f.get("name"), email: f.get("email") });
  if (!p.success) back("The demo identity provider needs a name (2 to 80 characters) and a valid e-mail address. Start again.");
  redirect(await issueDemoCode(r, issuer, { email: p.data!.email, name: p.data!.name, groups: [] }));
}

export async function signUpDeny(f: FormData) {
  assertDemoIdp();
  const r = readRequest(f), issuer = demoIssuer(await requestOrigin());
  if (checkAuthorizeRequest(r, issuer) || !isSignUp(r)) redirect("/register");
  const u = new URL(r.redirectUri);
  u.searchParams.set("error", "access_denied"); u.searchParams.set("state", r.state);
  redirect(u.toString());
}
