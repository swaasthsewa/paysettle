/**
 * F1.7 Operations SSO: a generic OpenID Connect authorization-code flow with PKCE (S256), built on fetch + node:crypto only.
 *  - Configuration from env: OIDC_ISSUER (discovery at <issuer>/.well-known/openid-configuration), OIDC_CLIENT_ID,
 *    OIDC_CLIENT_SECRET, OIDC_ROLE_CLAIM (dot path, e.g. "groups" or "realm_access.roles") and OIDC_ROLE_MAP (JSON, IdP
 *    value → PaySettle staff role, e.g. {"ps-ops":"ops"}).
 *  - Without OIDC_ISSUER, sandbox mode uses the built-in Demo identity provider (sso-demo.ts); production has no SSO (P9).
 *  - id_token checks: RS256 signature against the IdP's JWKS (createPublicKey from JWK), iss, aud (+ azp when several),
 *    exp / nbf / iat with 60 s skew, and the nonce bound to the browser by the sealed flow cookie.
 *  - RBAC mapping: SSO is for staff roles only (ops, mediator, finance, admin). The person is matched to an existing
 *    PaySettle user by verified email; the IdP must map them to that user's role. Anything else is refused as ERR_107.
 * The fetch function is injectable so the same client runs against a real IdP, the demo IdP in-process, or a test double.
 */
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import type { Role } from "@/db/schema";

export const STAFF_ROLES = ["ops", "mediator", "finance", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const isStaff = (r: string): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r);
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class OidcError extends Error { constructor(readonly code: string, message: string) { super(message); } }

export interface OidcConfig { issuer: string; clientId: string; clientSecret: string; roleClaim: string; roleMap: Record<string, StaffRole>; scopes: string; demo: boolean }
export interface OidcMetadata { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
export type Jwk = { kty: string; kid?: string; alg?: string; use?: string; n?: string; e?: string };
export interface IdClaims { iss: string; sub: string; aud: string | string[]; exp: number; iat?: number; nbf?: number; nonce?: string; azp?: string; email?: string; email_verified?: boolean; name?: string; amr?: string[]; [k: string]: unknown }

/** Parses OIDC_ROLE_MAP; refuses values that are not staff roles so a mis-typed map can never grant client or judge rights. */
export function parseRoleMap(json: string | undefined): Record<string, StaffRole> {
  if (!json) return {};
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new OidcError("CONFIG", "OIDC_ROLE_MAP is not valid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new OidcError("CONFIG", "OIDC_ROLE_MAP must be a JSON object.");
  const out: Record<string, StaffRole> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "string" || !isStaff(v)) throw new OidcError("CONFIG", `OIDC_ROLE_MAP maps "${k}" to "${String(v)}"; only ${STAFF_ROLES.join(", ")} are allowed.`);
    out[k] = v;
  }
  return out;
}

/** Real IdP config from env, or null when OIDC_ISSUER is not set (the caller then decides on the demo IdP). */
export function oidcConfigFromEnv(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  const issuer = env.OIDC_ISSUER?.trim();
  if (!issuer) return null;
  if (!env.OIDC_CLIENT_ID) throw new OidcError("CONFIG", "OIDC_CLIENT_ID is not set.");
  return {
    issuer: issuer.replace(/\/+$/, ""), clientId: env.OIDC_CLIENT_ID, clientSecret: env.OIDC_CLIENT_SECRET ?? "",
    roleClaim: env.OIDC_ROLE_CLAIM || "groups", roleMap: parseRoleMap(env.OIDC_ROLE_MAP), scopes: "openid email profile", demo: false,
  };
}

/* ── PKCE, state, nonce ── */
const b64u = (b: Buffer) => b.toString("base64url");
export const randomToken = (bytes = 32) => b64u(randomBytes(bytes));
export const challengeFor = (verifier: string) => b64u(createHash("sha256").update(verifier).digest());
export function pkce() { const verifier = randomToken(48); return { verifier, challenge: challengeFor(verifier) }; }
export const safeEqual = (a: string, b: string) => { const x = Buffer.from(a ?? ""), y = Buffer.from(b ?? ""); return x.length === y.length && timingSafeEqual(x, y); };

/* ── discovery, authorize, token ── */
async function json(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new OidcError("IDP_HTTP", `${what} answered ${res.status}.`);
  try { return (await res.json()) as Record<string, unknown>; } catch { throw new OidcError("IDP_HTTP", `${what} did not return JSON.`); }
}
export async function discover(issuer: string, f: FetchFn = fetch): Promise<OidcMetadata> {
  const doc = await json(await f(`${issuer}/.well-known/openid-configuration`, { headers: { accept: "application/json" } }), "Discovery");
  if (doc.issuer !== issuer) throw new OidcError("ISSUER", "The identity provider's discovery document names a different issuer.");
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) if (typeof doc[k] !== "string") throw new OidcError("DISCOVERY", `Discovery is missing ${k}.`);
  return doc as unknown as OidcMetadata;
}

export function authorizeUrl(meta: OidcMetadata, cfg: OidcConfig, p: { state: string; nonce: string; challenge: string; redirectUri: string }): string {
  const u = new URL(meta.authorization_endpoint);
  u.search = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: p.redirectUri, scope: cfg.scopes, state: p.state, nonce: p.nonce, code_challenge: p.challenge, code_challenge_method: "S256" }).toString();
  return u.toString();
}

export async function exchangeCode(meta: OidcMetadata, cfg: OidcConfig, p: { code: string; verifier: string; redirectUri: string }, f: FetchFn = fetch): Promise<{ idToken: string }> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, code_verifier: p.verifier, client_id: cfg.clientId });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (cfg.clientSecret) headers.authorization = "Basic " + Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString("base64");
  const r = await json(await f(meta.token_endpoint, { method: "POST", headers, body: body.toString() }), "The token endpoint");
  if (typeof r.id_token !== "string") throw new OidcError("NO_ID_TOKEN", "The identity provider did not return an id_token.");
  return { idToken: r.id_token };
}

export async function fetchJwks(meta: OidcMetadata, f: FetchFn = fetch): Promise<Jwk[]> {
  const r = await json(await f(meta.jwks_uri, { headers: { accept: "application/json" } }), "JWKS");
  if (!Array.isArray(r.keys)) throw new OidcError("JWKS", "The JWKS has no keys.");
  return r.keys as Jwk[];
}

/* ── id_token validation ── */
const part = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Record<string, unknown>;
export function verifyIdToken(token: string, o: { issuer: string; audience: string; nonce: string; jwks: Jwk[]; now?: number; skewS?: number }): IdClaims {
  const [h, p, s, extra] = token.split(".");
  if (!h || !p || !s || extra !== undefined) throw new OidcError("TOKEN_FORMAT", "The id_token is not a signed JWT.");
  let header: Record<string, unknown>, claims: IdClaims;
  try { header = part(h); claims = part(p) as IdClaims; } catch { throw new OidcError("TOKEN_FORMAT", "The id_token could not be read."); }
  if (header.alg !== "RS256") throw new OidcError("TOKEN_ALG", `id_token algorithm ${String(header.alg)} is not accepted (RS256 only).`);
  const rsa = o.jwks.filter((k) => k.kty === "RSA" && (!k.use || k.use === "sig"));
  const key = header.kid ? rsa.find((k) => k.kid === header.kid) : rsa.length === 1 ? rsa[0] : undefined;
  if (!key?.n || !key.e) throw new OidcError("TOKEN_KEY", "No signing key in the JWKS matches the id_token.");
  const pub = createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" });
  if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), pub, Buffer.from(s, "base64url"))) throw new OidcError("TOKEN_SIGNATURE", "The id_token signature is not valid.");
  const now = Math.floor((o.now ?? Date.now()) / 1000), skew = o.skewS ?? 60;
  if (claims.iss !== o.issuer) throw new OidcError("TOKEN_ISS", "The id_token was issued by a different identity provider.");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(o.audience)) throw new OidcError("TOKEN_AUD", "The id_token is meant for a different application.");
  if (aud.length > 1 && claims.azp !== o.audience) throw new OidcError("TOKEN_AUD", "The id_token's authorised party is a different application.");
  if (typeof claims.exp !== "number" || claims.exp + skew < now) throw new OidcError("TOKEN_EXPIRED", "The id_token has expired.");
  if (typeof claims.nbf === "number" && claims.nbf - skew > now) throw new OidcError("TOKEN_EARLY", "The id_token is not valid yet.");
  if (typeof claims.iat === "number" && claims.iat - skew > now) throw new OidcError("TOKEN_EARLY", "The id_token was issued in the future.");
  if (typeof claims.nonce !== "string" || !safeEqual(claims.nonce, o.nonce)) throw new OidcError("TOKEN_NONCE", "The id_token nonce does not match this sign-in.");
  if (typeof claims.sub !== "string" || !claims.sub) throw new OidcError("TOKEN_SUB", "The id_token has no subject.");
  return claims;
}

/* ── RBAC mapping ── */
export function claimAt(claims: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), claims);
}
/** Every staff role the IdP's role claim maps to (a person can sit in several groups). */
export function mappedRoles(claims: Record<string, unknown>, roleClaim: string, roleMap: Record<string, StaffRole>): StaffRole[] {
  const v = claimAt(claims, roleClaim);
  const values = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : [];
  return [...new Set(values.filter((x): x is string => typeof x === "string").map((x) => roleMap[x]).filter((r): r is StaffRole => !!r))];
}

export const ERR_107 = "ERR_107";
export type SsoDecision =
  | { ok: true; userId: string; role: StaffRole; mfa: boolean }
  | { ok: false; reason: "EMAIL_MISSING" | "NO_STAFF_ROLE" | "UNKNOWN_STAFF" | "NOT_STAFF" | "ROLE_MISMATCH" | "LOCKED"; message: string };
const REFUSE: Record<Exclude<SsoDecision, { ok: true }>["reason"], string> = {
  EMAIL_MISSING: "the identity provider did not send a verified email address",
  NO_STAFF_ROLE: "your identity provider groups do not map to a PaySettle staff role",
  UNKNOWN_STAFF: "no PaySettle staff account uses this email address",
  NOT_STAFF: "SSO is for operations staff; clients and providers sign in with email",
  ROLE_MISMATCH: "your identity provider role does not match the role on your PaySettle account",
  LOCKED: "this account is paused after too many attempts",
};
export const refusalMessage = (reason: keyof typeof REFUSE) => `${ERR_107} · SSO sign-in refused: ${REFUSE[reason]}. Ask a PaySettle administrator to check your access.`;

/** The pure decision after a valid id_token: who this is in PaySettle, or why not. */
export function decideSsoUser(claims: IdClaims, roles: StaffRole[], user: { id: string; role: Role; lockedUntil: Date | null } | null, now = new Date()): SsoDecision {
  const no = (reason: Exclude<SsoDecision, { ok: true }>["reason"]): SsoDecision => ({ ok: false, reason, message: refusalMessage(reason) });
  if (typeof claims.email !== "string" || !claims.email || claims.email_verified === false) return no("EMAIL_MISSING");
  if (!roles.length) return no("NO_STAFF_ROLE");
  if (!user) return no("UNKNOWN_STAFF");
  if (!isStaff(user.role)) return no("NOT_STAFF");
  if (!roles.includes(user.role)) return no("ROLE_MISMATCH");
  if (user.lockedUntil && user.lockedUntil > now) return no("LOCKED");
  const amr = Array.isArray(claims.amr) ? claims.amr : [];
  return { ok: true, userId: user.id, role: user.role, mfa: amr.some((m) => ["mfa", "otp", "hwk", "swk", "fido", "totp"].includes(String(m))) };
}
