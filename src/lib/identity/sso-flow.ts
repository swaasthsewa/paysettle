/**
 * F1.7 SSO flow glue: picks the IdP (env OIDC_* or, in sandbox only, the demo IdP), keeps state + nonce + PKCE verifier in a
 * sealed 10-minute cookie scoped to /sso, validates the callback, maps the person to a PaySettle staff user, audits the
 * result and hands over to the F1.8 handshake (beginSignIn). The *Core functions take their dependencies as arguments and
 * are what the tests drive end to end against the demo IdP.
 */
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { sandboxMode } from "@/lib/clock";
import { endSession } from "@/lib/session";
import { seal, unseal } from "./handshake";
import { beginSignIn } from "./handshake-session";
import { demoConfig, demoIdpFetch } from "./sso-demo";
import {
  authorizeUrl, decideSsoUser, discover, exchangeCode, fetchJwks, mappedRoles, oidcConfigFromEnv, OidcError, pkce, randomToken, safeEqual, verifyIdToken,
  type FetchFn, type IdClaims, type OidcConfig, type SsoDecision,
} from "./sso";

export const SSO_COOKIE = "ps_sso";
const PURPOSE = "sso-flow", FLOW_TTL_MS = 10 * 60_000;
export interface Flow { state: string; nonce: string; verifier: string; exp: number }

export const appOrigin = (reqUrl: string) => (process.env.APP_URL ?? new URL(reqUrl).origin).replace(/\/+$/, "");
/** The app's public origin inside a server component or action (APP_URL wins over request headers). */
export async function requestOrigin(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
}
export const redirectUriFor = (origin: string) => `${origin}/sso/callback`;
/** SSO is offered when a real IdP is configured, or in the sandbox (demo IdP). */
export const ssoAvailable = () => Boolean(process.env.OIDC_ISSUER?.trim()) || sandboxMode();
export const ssoIsDemo = () => !process.env.OIDC_ISSUER?.trim() && sandboxMode();

export function ssoSetup(origin: string): { cfg: OidcConfig; f: FetchFn } | null {
  const real = oidcConfigFromEnv();
  if (real) return { cfg: real, f: fetch };
  if (!sandboxMode()) return null;
  const cfg = demoConfig(origin);
  return { cfg, f: demoIdpFetch(cfg.issuer) };
}

export async function ssoStartCore(cfg: OidcConfig, f: FetchFn, redirectUri: string): Promise<{ url: string; flow: Flow }> {
  const meta = await discover(cfg.issuer, f);
  const { verifier, challenge } = pkce();
  const flow: Flow = { state: randomToken(24), nonce: randomToken(24), verifier, exp: Date.now() + FLOW_TTL_MS };
  return { url: authorizeUrl(meta, cfg, { state: flow.state, nonce: flow.nonce, challenge, redirectUri }), flow };
}

export async function ssoCallbackCore(cfg: OidcConfig, f: FetchFn, flow: Flow | null, q: { code?: string | null; state?: string | null; error?: string | null }, redirectUri: string): Promise<IdClaims> {
  if (q.error) throw new OidcError("IDP_ERROR", `The identity provider ended the sign-in (${q.error.slice(0, 60)}).`);
  if (!flow) throw new OidcError("FLOW_EXPIRED", "This sign-in started too long ago or in another browser. Start again.");
  if (!q.state || !safeEqual(q.state, flow.state)) throw new OidcError("STATE", "The sign-in response does not belong to this browser.");
  if (!q.code) throw new OidcError("NO_CODE", "The identity provider did not return a code.");
  const meta = await discover(cfg.issuer, f);
  const { idToken } = await exchangeCode(meta, cfg, { code: q.code, verifier: flow.verifier, redirectUri }, f);
  return verifyIdToken(idToken, { issuer: meta.issuer, audience: cfg.clientId, nonce: flow.nonce, jwks: await fetchJwks(meta, f) });
}

/** Matches verified claims to a PaySettle user by email and applies the role mapping. */
export async function resolveSsoUser(cfg: OidcConfig, claims: IdClaims): Promise<{ decision: SsoDecision; email: string }> {
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const [u] = email ? await db.select({ id: users.id, role: users.role, lockedUntil: users.lockedUntil }).from(users).where(eq(users.email, email)).limit(1) : [];
  return { decision: decideSsoUser(claims, mappedRoles(claims, cfg.roleClaim, cfg.roleMap), u ?? null), email };
}

/* ── request-bound wrappers for the /sso routes ── */
export async function startSso(reqUrl: string): Promise<string> {
  const origin = appOrigin(reqUrl);
  const s = ssoSetup(origin);
  if (!s) return "/login?error=" + encodeURIComponent("Staff SSO is not configured on this deployment.");
  const { url, flow } = await ssoStartCore(s.cfg, s.f, redirectUriFor(origin));
  (await cookies()).set(SSO_COOKIE, seal(PURPOSE, { ...flow }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/sso", maxAge: FLOW_TTL_MS / 1000 });
  return url;
}

export async function finishSso(reqUrl: string): Promise<string> {
  const origin = appOrigin(reqUrl), url = new URL(reqUrl);
  const s = ssoSetup(origin);
  if (!s) return "/login?error=" + encodeURIComponent("Staff SSO is not configured on this deployment.");
  const jar = await cookies();
  const flow = unseal<Flow>(PURPOSE, jar.get(SSO_COOKIE)?.value);
  jar.delete({ name: SSO_COOKIE, path: "/sso" });
  const fail = (m: string) => "/login?error=" + encodeURIComponent(m);
  let claims: IdClaims;
  try {
    claims = await ssoCallbackCore(s.cfg, s.f, flow, { code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error") }, redirectUriFor(origin));
  } catch (e) {
    const code = e instanceof OidcError ? e.code : "IDP_UNREACHABLE";
    await audit(db, { id: null, role: null }, "auth.sso_failed", "sso", { code, issuer: s.cfg.issuer, demo: s.cfg.demo });
    return fail(e instanceof OidcError ? `SSO sign-in did not complete: ${e.message}` : "SSO sign-in did not complete: the identity provider could not be reached. Try again.");
  }
  const { decision, email } = await resolveSsoUser(s.cfg, claims);
  if (!decision.ok) {
    await audit(db, { id: null, role: null }, "auth.sso_refused", email || "sso", { incident: "ERR_107", reason: decision.reason, issuer: s.cfg.issuer, sub: claims.sub, demo: s.cfg.demo });
    return fail(decision.message);
  }
  await audit(db, { id: decision.userId, role: decision.role }, "auth.sso_sign_in", decision.userId, { issuer: s.cfg.issuer, sub: claims.sub, mfa: decision.mfa, demo: s.cfg.demo });
  await endSession();
  return beginSignIn({ id: decision.userId, role: decision.role }, { mfa: decision.mfa, demo: false, via: "sso" });
}

