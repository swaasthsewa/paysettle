/**
 * F1.1 · "Continue with demo identity provider" on /register — sandbox only (P9).
 *
 * It reuses the built-in demo identity provider (sso-demo.ts) and the generic OpenID Connect client (sso.ts) end to
 * end: authorization code + PKCE S256, state and nonce bound to this browser by a sealed cookie, the token exchange,
 * and the RS256 id_token checked against the demo IdP's JWKS. Only the consent screen differs from staff SSO: instead
 * of the company directory it shows a "demo social account" (name and e-mail the person types), because a person
 * signing up has no staff account to pick.
 *
 * The verified identity (e-mail with email_verified, name, issuer, subject) is parked in a sealed 20-minute cookie on
 * /register; the registration form then asks only for what the IdP does not know (role, country, time zone, a
 * password for e-mail sign-in later) and the account is created with the e-mail already confirmed.
 * Production: every entry point refuses (assertDemoIdp / sandboxMode), and /register shows no button.
 */
import { cookies } from "next/headers";
import { sandboxMode } from "@/lib/clock";
import { seal, unseal } from "./handshake";
import { demoConfig, demoIdpFetch } from "./sso-demo";
import { OidcError, type FetchFn, type IdClaims, type OidcConfig } from "./sso";
import { appOrigin, ssoCallbackCore, ssoStartCore, type Flow } from "./sso-flow";

export const REG_CALLBACK_PATH = "/register/social/callback";
export const REG_IDP_PATH = "/register/demo-idp";
export const REG_FLOW_COOKIE = "ps_reg_flow";
export const REG_ID_COOKIE = "ps_reg_idp";
const FLOW_PURPOSE = "reg-social-flow", ID_PURPOSE = "reg-social-id";
const FLOW_TTL_MS = 10 * 60_000, ID_TTL_MS = 20 * 60_000;

export interface SocialIdentity { email: string; name: string; iss: string; sub: string; exp: number }

export const socialAvailable = () => sandboxMode();
export const regRedirectUri = (origin: string) => `${origin}${REG_CALLBACK_PATH}`;

/** The authorize address on the sign-up consent screen, with the same OIDC parameters the IdP's own screen takes. */
export async function socialStartCore(cfg: OidcConfig, f: FetchFn, origin: string): Promise<{ url: string; flow: Flow }> {
  const { url, flow } = await ssoStartCore(cfg, f, regRedirectUri(origin));
  const u = new URL(url);
  u.pathname = REG_IDP_PATH;
  return { url: u.toString(), flow };
}

/** Callback checks (state, code, token, id_token) then the claims a sign-up needs. Throws OidcError. */
export async function socialCallbackCore(cfg: OidcConfig, f: FetchFn, flow: Flow | null, q: { code?: string | null; state?: string | null; error?: string | null }, origin: string, now = Date.now()): Promise<SocialIdentity> {
  const claims: IdClaims = await ssoCallbackCore(cfg, f, flow, q, regRedirectUri(origin));
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || claims.email_verified !== true) throw new OidcError("EMAIL_MISSING", "the identity provider did not send a verified e-mail address");
  const name = typeof claims.name === "string" ? claims.name.trim().slice(0, 80) : "";
  return { email, name, iss: claims.iss, sub: claims.sub, exp: now + ID_TTL_MS };
}

/* ── request-bound wrappers ── */
const cookieOpts = (maxAgeS: number) => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/register", maxAge: maxAgeS });

export async function startSocial(reqUrl: string): Promise<string> {
  if (!socialAvailable()) return "/register?error=" + encodeURIComponent("Sign-up with the demo identity provider exists only in the sandbox.");
  const origin = appOrigin(reqUrl);
  const cfg = demoConfig(origin);
  const { url, flow } = await socialStartCore(cfg, demoIdpFetch(cfg.issuer), origin);
  (await cookies()).set(REG_FLOW_COOKIE, seal(FLOW_PURPOSE, { ...flow }), cookieOpts(FLOW_TTL_MS / 1000));
  return url;
}

export async function finishSocial(reqUrl: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (!socialAvailable()) return { ok: false, code: "SANDBOX_ONLY", message: "Sign-up with the demo identity provider exists only in the sandbox." };
  const origin = appOrigin(reqUrl), url = new URL(reqUrl);
  const cfg = demoConfig(origin);
  const jar = await cookies();
  const flow = unseal<Flow>(FLOW_PURPOSE, jar.get(REG_FLOW_COOKIE)?.value);
  jar.delete({ name: REG_FLOW_COOKIE, path: "/register" });
  try {
    const id = await socialCallbackCore(cfg, demoIdpFetch(cfg.issuer), flow, { code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error") }, origin);
    jar.set(REG_ID_COOKIE, seal(ID_PURPOSE, { ...id }), cookieOpts(ID_TTL_MS / 1000));
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e instanceof OidcError ? e.code : "IDP_UNREACHABLE", message: e instanceof OidcError ? e.message : "the identity provider could not be reached" };
  }
}

/** The verified identity waiting on this browser, if any (sandbox only). */
export async function socialIdentity(): Promise<SocialIdentity | null> {
  if (!socialAvailable()) return null;
  return unseal<SocialIdentity>(ID_PURPOSE, (await cookies()).get(REG_ID_COOKIE)?.value);
}
export async function clearSocialIdentity() { (await cookies()).delete({ name: REG_ID_COOKIE, path: "/register" }); }
