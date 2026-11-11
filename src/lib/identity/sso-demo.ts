/**
 * F1.7 sandbox fallback: the built-in "Demo identity provider" at /sso/demo-idp. It speaks just enough OpenID Connect
 * (discovery, authorize with PKCE S256, token, JWKS, RS256 id_tokens) for the generic client in sso.ts to run the full flow
 * without a real IdP. Sandbox only (P9): every entry point calls assertDemoIdp(), which refuses in production.
 * Its RSA key is generated on first use and kept in sso_demo_keys; its client secret is derived from the identity key (P8).
 * demoIdpFetch() lets the server-side legs (discovery, token, JWKS) run in-process, so the demo does not depend on the
 * server being able to reach its own public address; the same handler also serves the real HTTP routes.
 */
import { createHmac, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { ssoDemoCodes, ssoDemoKeys } from "@/db/schema-identity";
import { sandboxMode } from "@/lib/clock";
import { sha256 } from "@/lib/ids";
import { identityKey } from "./handshake";
import { challengeFor, safeEqual, type FetchFn, type Jwk, type OidcConfig, type StaffRole } from "./sso";

export const DEMO_CLIENT_ID = "paysettle-demo";
export const DEMO_ROLE_MAP: Record<string, StaffRole> = { "ps-ops": "ops", "ps-mediator": "mediator", "ps-finance": "finance", "ps-admin": "admin" };
export const demoGroupsFor = (role: string) => Object.entries(DEMO_ROLE_MAP).filter(([, r]) => r === role).map(([g]) => g);
export const demoIssuer = (origin: string) => `${origin.replace(/\/+$/, "")}/sso/demo-idp`;
/** Redirect paths registered for the demo client: staff SSO, and (F1.1, sandbox) sign-up with a demo social account. */
export const DEMO_REDIRECT_PATHS = ["/sso/callback", "/register/social/callback"] as const;
/** A directory entry with no PaySettle account, so the demo can show the ERR_107 refusal. */
export const UNKNOWN_PERSON = { email: "sam.taylor@corp.example", name: "Sam Taylor", groups: ["ps-ops"] };
const CODE_TTL_MS = 2 * 60_000, TOKEN_TTL_S = 300;

export class DemoIdpRefused extends Error { constructor() { super("The demo identity provider exists only in the sandbox (P9)."); } }
export function assertDemoIdp() { if (!sandboxMode()) throw new DemoIdpRefused(); }

export const demoClientSecret = () => createHmac("sha256", identityKey()).update("demo-idp-client-secret").digest("base64url");
export function demoConfig(origin: string): OidcConfig {
  assertDemoIdp();
  return { issuer: demoIssuer(origin), clientId: DEMO_CLIENT_ID, clientSecret: demoClientSecret(), roleClaim: "groups", roleMap: DEMO_ROLE_MAP, scopes: "openid email profile", demo: true };
}

/* ── keys ── */
async function demoKey(): Promise<{ kid: string; publicJwk: Jwk; privatePem: string }> {
  assertDemoIdp();
  const [k] = await db.select().from(ssoDemoKeys).orderBy(desc(ssoDemoKeys.createdAt)).limit(1);
  if (k) return { kid: k.kid, publicJwk: k.publicJwk as Jwk, privatePem: k.privatePem };
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as Jwk;
  const kid = "demo-" + sha256(String(jwk.n)).slice(0, 12);
  const pub = { kty: "RSA", n: String(jwk.n), e: String(jwk.e), kid, alg: "RS256", use: "sig" };
  await db.insert(ssoDemoKeys).values({ kid, publicJwk: pub, privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString() }).onConflictDoNothing();
  return demoKey();
}

export function discoveryDoc(issuer: string) {
  return {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
    response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    scopes_supported: ["openid", "email", "profile"], claims_supported: ["sub", "email", "email_verified", "name", "groups", "amr", "nonce"],
  };
}

/* ── authorize: the demo consent page calls this after the person picks who to sign in as ── */
export interface AuthorizeRequest { clientId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string; codeChallengeMethod: string; responseType: string }
export function checkAuthorizeRequest(r: AuthorizeRequest, issuer: string): string | null {
  if (r.responseType !== "code") return "Only response_type=code is supported.";
  if (r.clientId !== DEMO_CLIENT_ID) return "Unknown client_id.";
  if (r.codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(r.codeChallenge)) return "PKCE with S256 is required.";
  if (!r.state || !r.nonce) return "state and nonce are required.";
  let u: URL;
  try { u = new URL(r.redirectUri); } catch { return "redirect_uri is not a URL."; }
  if (u.origin !== new URL(issuer).origin || !(DEMO_REDIRECT_PATHS as readonly string[]).includes(u.pathname)) return "redirect_uri is not registered for this client.";
  return null;
}

export async function issueDemoCode(r: AuthorizeRequest, issuer: string, person: { email: string; name: string; groups: string[] }): Promise<string> {
  assertDemoIdp();
  const bad = checkAuthorizeRequest(r, issuer);
  if (bad) throw new Error(bad);
  const code = randomBytes(24).toString("base64url");
  await db.insert(ssoDemoCodes).values({ codeHash: sha256(code), clientId: r.clientId, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, nonce: r.nonce, email: person.email.toLowerCase(), name: person.name, groups: person.groups, expiresAt: new Date(Date.now() + CODE_TTL_MS) });
  const back = new URL(r.redirectUri);
  back.searchParams.set("code", code); back.searchParams.set("state", r.state); back.searchParams.set("iss", issuer);
  return back.toString();
}

/* ── token ── */
const err = (status: number, error: string, description: string) => Response.json({ error, error_description: description }, { status, headers: { "cache-control": "no-store" } });
function clientCreds(req: Request, form: URLSearchParams): { id: string; secret: string } {
  const h = req.headers.get("authorization");
  if (h?.startsWith("Basic ")) {
    const [id, secret] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
    return { id: decodeURIComponent(id ?? ""), secret: decodeURIComponent(secret ?? "") };
  }
  return { id: form.get("client_id") ?? "", secret: form.get("client_secret") ?? "" };
}

async function token(req: Request, issuer: string): Promise<Response> {
  const form = new URLSearchParams(await req.text());
  if (form.get("grant_type") !== "authorization_code") return err(400, "unsupported_grant_type", "Only authorization_code is supported.");
  const c = clientCreds(req, form);
  if (c.id !== DEMO_CLIENT_ID || !safeEqual(c.secret, demoClientSecret())) return err(401, "invalid_client", "Client authentication failed.");
  const code = form.get("code") ?? "", verifier = form.get("code_verifier") ?? "";
  const [row] = await db.update(ssoDemoCodes).set({ used: true })
    .where(and(eq(ssoDemoCodes.codeHash, sha256(code)), eq(ssoDemoCodes.used, false), gt(ssoDemoCodes.expiresAt, new Date()))).returning();
  if (!row) return err(400, "invalid_grant", "The code is unknown, used or expired.");
  if (row.clientId !== c.id || row.redirectUri !== form.get("redirect_uri")) return err(400, "invalid_grant", "The code was issued for a different client or redirect_uri.");
  if (!verifier || !safeEqual(challengeFor(verifier), row.codeChallenge)) return err(400, "invalid_grant", "PKCE verification failed.");
  const now = Math.floor(Date.now() / 1000);
  const idToken = await signDemoToken({ iss: issuer, sub: "demo|" + sha256(row.email).slice(0, 20), aud: c.id, iat: now, exp: now + TOKEN_TTL_S, nonce: row.nonce, email: row.email, email_verified: true, name: row.name, groups: row.groups, amr: ["pwd", "otp"] });
  return Response.json({ access_token: randomBytes(24).toString("base64url"), token_type: "Bearer", expires_in: TOKEN_TTL_S, id_token: idToken }, { headers: { "cache-control": "no-store" } });
}

export async function signDemoToken(claims: Record<string, unknown>): Promise<string> {
  const k = await demoKey();
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: k.kid })).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), k.privatePem).toString("base64url")}`;
}

/** Serves discovery, JWKS and token for `issuer`; null when the URL is not one of them. */
export async function demoIdpHandle(req: Request, issuer: string): Promise<Response | null> {
  if (!sandboxMode()) return err(404, "not_found", "The demo identity provider exists only in the sandbox.");
  const path = new URL(req.url).pathname, base = new URL(issuer).pathname;
  if (path === `${base}/.well-known/openid-configuration` && req.method === "GET") return Response.json(discoveryDoc(issuer));
  if (path === `${base}/jwks` && req.method === "GET") return Response.json({ keys: [(await demoKey()).publicJwk] });
  if (path === `${base}/token` && req.method === "POST") return token(req, issuer);
  return null;
}

/** fetch() that answers the demo IdP's server-side endpoints in-process and passes anything else through. */
export function demoIdpFetch(issuer: string, fallback: FetchFn = fetch): FetchFn {
  return async (input, init) => {
    if (input.startsWith(issuer + "/")) {
      const r = await demoIdpHandle(new Request(input, init), issuer);
      if (r) return r;
    }
    return fallback(input, init);
  };
}
