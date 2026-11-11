/**
 * F1.7 Operations SSO with RBAC mapping: OIDC id_token validation (RS256 via JWKS, iss, aud, exp, nonce), role mapping,
 * ERR_107 refusals, and the full authorization-code + PKCE flow against the sandbox demo identity provider (in-process),
 * which production refuses (P9).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs, users } from "@/db/schema";
import {
  decideSsoUser, discover, mappedRoles, oidcConfigFromEnv, OidcError, parseRoleMap, refusalMessage, verifyIdToken, type IdClaims, type Jwk,
} from "./sso";
import { assertDemoIdp, checkAuthorizeRequest, demoConfig, demoIdpFetch, demoIdpHandle, DEMO_ROLE_MAP, issueDemoCode, signDemoToken, UNKNOWN_PERSON } from "./sso-demo";
import { redirectUriFor, resolveSsoUser, ssoCallbackCore, ssoStartCore } from "./sso-flow";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...(publicKey.export({ format: "jwk" }) as Jwk), kid: "k1", use: "sig" };
const ISS = "https://idp.example.com", AUD = "paysettle", NONCE = "n-123";
const now = () => Math.floor(Date.now() / 1000);
function jwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "k1" }, key = privateKey) {
  const h = Buffer.from(JSON.stringify(header)).toString("base64url"), p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key).toString("base64url")}`;
}
const good = (o: Record<string, unknown> = {}) => ({ iss: ISS, aud: AUD, sub: "s1", iat: now(), exp: now() + 300, nonce: NONCE, email: "olivia@corp.example", email_verified: true, groups: ["ps-ops"], ...o });
const check = (t: string) => verifyIdToken(t, { issuer: ISS, audience: AUD, nonce: NONCE, jwks: [JWK] });
const code = (fn: () => unknown) => { try { fn(); return "none"; } catch (e) { return e instanceof OidcError ? e.code : "other"; } };

describe("F1.7 id_token validation", () => {
  it("F1.7 accepts a correctly signed RS256 token from the configured issuer", () => {
    expect(check(jwt(good())).email).toBe("olivia@corp.example");
  });
  it("F1.7 rejects a bad signature, an unknown kid, and alg none / HS256", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(code(() => check(jwt(good(), undefined, other)))).toBe("TOKEN_SIGNATURE");
    expect(code(() => check(jwt(good(), { alg: "RS256", kid: "nope" })))).toBe("TOKEN_KEY");
    const [, p] = jwt(good()).split(".");
    expect(code(() => check(`${Buffer.from('{"alg":"none"}').toString("base64url")}.${p}.`))).toBe("TOKEN_FORMAT");
    expect(code(() => check(`${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${p}.c2ln`))).toBe("TOKEN_ALG");
  });
  it("F1.7 rejects wrong iss, wrong aud, multi-aud without azp, expired, future iat and a nonce mismatch", () => {
    expect(code(() => check(jwt(good({ iss: "https://evil.example" }))))).toBe("TOKEN_ISS");
    expect(code(() => check(jwt(good({ aud: "someone-else" }))))).toBe("TOKEN_AUD");
    expect(code(() => check(jwt(good({ aud: [AUD, "x"] }))))).toBe("TOKEN_AUD");
    expect(code(() => check(jwt(good({ aud: [AUD, "x"], azp: AUD }))))).toBe("none");
    expect(code(() => check(jwt(good({ exp: now() - 120 }))))).toBe("TOKEN_EXPIRED");
    expect(code(() => check(jwt(good({ iat: now() + 600 }))))).toBe("TOKEN_EARLY");
    expect(code(() => check(jwt(good({ nonce: "replayed" }))))).toBe("TOKEN_NONCE");
  });
});

describe("F1.7 RBAC mapping", () => {
  it("F1.7 OIDC_ROLE_MAP accepts only staff roles", () => {
    expect(parseRoleMap('{"ps-ops":"ops","fin":"finance"}')).toEqual({ "ps-ops": "ops", fin: "finance" });
    expect(() => parseRoleMap('{"x":"client"}')).toThrow(/only ops, mediator, finance, admin/);
    expect(() => parseRoleMap('{"x":"judge"}')).toThrow();
    expect(() => parseRoleMap("not json")).toThrow(/not valid JSON/);
  });
  it("F1.7 reads env config and maps nested, array and space-separated claims", () => {
    const cfg = oidcConfigFromEnv({ OIDC_ISSUER: "https://idp.example.com/", OIDC_CLIENT_ID: "c", OIDC_CLIENT_SECRET: "s", OIDC_ROLE_CLAIM: "realm.roles", OIDC_ROLE_MAP: '{"ps-ops":"ops"}' });
    expect(cfg).toMatchObject({ issuer: "https://idp.example.com", clientId: "c", roleClaim: "realm.roles", demo: false });
    expect(oidcConfigFromEnv({})).toBeNull();
    expect(mappedRoles({ realm: { roles: ["ps-ops", "other"] } }, "realm.roles", { "ps-ops": "ops" })).toEqual(["ops"]);
    expect(mappedRoles({ groups: "ps-ops ps-finance" }, "groups", DEMO_ROLE_MAP).sort()).toEqual(["finance", "ops"]);
    expect(mappedRoles({ groups: ["nothing"] }, "groups", DEMO_ROLE_MAP)).toEqual([]);
  });
  it("F1.7 ERR_107: unknown staff email, unmapped groups, non-staff account, role mismatch and lock are refused", () => {
    const c = good() as IdClaims;
    const ops = { id: "u1", role: "ops" as const, lockedUntil: null };
    expect(decideSsoUser(c, ["ops"], ops)).toMatchObject({ ok: true, userId: "u1", role: "ops" });
    expect(decideSsoUser({ ...c, amr: ["pwd", "otp"] }, ["ops"], ops)).toMatchObject({ ok: true, mfa: true });
    const r = decideSsoUser(c, ["ops"], null);
    expect(r).toMatchObject({ ok: false, reason: "UNKNOWN_STAFF" });
    expect(!r.ok && r.message).toMatch(/^ERR_107 · /);
    expect(decideSsoUser(c, [], ops)).toMatchObject({ ok: false, reason: "NO_STAFF_ROLE" });
    expect(decideSsoUser(c, ["ops"], { ...ops, role: "client" })).toMatchObject({ ok: false, reason: "NOT_STAFF" });
    expect(decideSsoUser(c, ["finance"], ops)).toMatchObject({ ok: false, reason: "ROLE_MISMATCH" });
    expect(decideSsoUser(c, ["ops"], { ...ops, lockedUntil: new Date(Date.now() + 60_000) })).toMatchObject({ ok: false, reason: "LOCKED" });
    expect(decideSsoUser({ ...c, email_verified: false }, ["ops"], ops)).toMatchObject({ ok: false, reason: "EMAIL_MISSING" });
    expect(refusalMessage("UNKNOWN_STAFF")).toContain("ERR_107");
  });
  it("F1.7 discovery must name the configured issuer", async () => {
    const f = async () => Response.json({ issuer: "https://other.example", authorization_endpoint: "a", token_endpoint: "t", jwks_uri: "j" });
    await expect(discover(ISS, f)).rejects.toMatchObject({ code: "ISSUER" });
  });
});

describe("F1.7 full flow against the demo identity provider (sandbox)", () => {
  const RUN = Math.random().toString(36).slice(2, 8), ORG = `org_sso_${RUN}`, OPS = `u_sso_ops_${RUN}`, CLI = `u_sso_cli_${RUN}`;
  const origin = "http://ps.test", redirectUri = redirectUriFor(origin);
  beforeAll(async () => {
    await db.insert(orgs).values({ id: ORG, name: "SSO tests" });
    await db.insert(users).values([{ id: OPS, orgId: ORG, email: `ops-${RUN}@sso.test`, name: "Olive Ops", role: "ops" }, { id: CLI, orgId: ORG, email: `cli-${RUN}@sso.test`, name: "Cleo Client", role: "client" }]);
  });
  afterAll(async () => { await db.delete(users).where(inArray(users.id, [OPS, CLI])); });

  async function run(person: { email: string; name: string; groups: string[] }, tamper: { verifier?: string; state?: string } = {}) {
    const cfg = demoConfig(origin), f = demoIdpFetch(cfg.issuer);
    const { url, flow } = await ssoStartCore(cfg, f, redirectUri);
    const u = new URL(url);
    expect(u.pathname).toBe("/sso/demo-idp/authorize");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    const req = { clientId: u.searchParams.get("client_id")!, redirectUri: u.searchParams.get("redirect_uri")!, state: u.searchParams.get("state")!, nonce: u.searchParams.get("nonce")!, codeChallenge: u.searchParams.get("code_challenge")!, codeChallengeMethod: "S256", responseType: "code" };
    const back = new URL(await issueDemoCode(req, cfg.issuer, person));
    const claims = await ssoCallbackCore(cfg, f, { ...flow, verifier: tamper.verifier ?? flow.verifier }, { code: back.searchParams.get("code"), state: tamper.state ?? back.searchParams.get("state") }, redirectUri);
    return { cfg, claims, f, back };
  }

  it("F1.7 a staff email with the matching IdP group signs in as that user, MFA from amr", async () => {
    const { cfg, claims } = await run({ email: `OPS-${RUN}@sso.test`, name: "Olive Ops", groups: ["ps-ops"] });
    expect(claims.iss).toBe(cfg.issuer);
    const r = await resolveSsoUser(cfg, claims);
    expect(r.decision).toEqual({ ok: true, userId: OPS, role: "ops", mfa: true });
  });
  it("F1.7 ERR_107 for an email with no PaySettle account and for a client account", async () => {
    const a = await run(UNKNOWN_PERSON);
    expect((await resolveSsoUser(a.cfg, a.claims)).decision).toMatchObject({ ok: false, reason: "UNKNOWN_STAFF" });
    const b = await run({ email: `cli-${RUN}@sso.test`, name: "Cleo", groups: ["ps-ops"] });
    expect((await resolveSsoUser(b.cfg, b.claims)).decision).toMatchObject({ ok: false, reason: "NOT_STAFF" });
  });
  it("F1.7 a wrong PKCE verifier, a foreign state and a reused code are refused", async () => {
    await expect(run({ email: `ops-${RUN}@sso.test`, name: "O", groups: ["ps-ops"] }, { verifier: "x".repeat(64) })).rejects.toMatchObject({ code: "IDP_HTTP" });
    await expect(run({ email: `ops-${RUN}@sso.test`, name: "O", groups: ["ps-ops"] }, { state: "forged" })).rejects.toMatchObject({ code: "STATE" });
    const { cfg, f, back } = await run({ email: `ops-${RUN}@sso.test`, name: "O", groups: ["ps-ops"] });
    const body = new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code")!, redirect_uri: redirectUri, code_verifier: "v".repeat(64), client_id: cfg.clientId, client_secret: cfg.clientSecret });
    const again = await f(`${cfg.issuer}/token`, { method: "POST", body: body.toString() });
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("invalid_grant");
  });
  it("F1.7 the demo IdP checks client, PKCE method and redirect_uri, and signs tokens the client verifies", async () => {
    const cfg = demoConfig(origin);
    const base = { clientId: "paysettle-demo", redirectUri, state: "s", nonce: "n", codeChallenge: "a".repeat(43), codeChallengeMethod: "S256", responseType: "code" };
    expect(checkAuthorizeRequest(base, cfg.issuer)).toBeNull();
    expect(checkAuthorizeRequest({ ...base, redirectUri: "https://evil.example/sso/callback" }, cfg.issuer)).toMatch(/redirect_uri/);
    expect(checkAuthorizeRequest({ ...base, codeChallengeMethod: "plain" }, cfg.issuer)).toMatch(/PKCE/);
    expect(checkAuthorizeRequest({ ...base, clientId: "other" }, cfg.issuer)).toMatch(/client_id/);
    const jwks = (await (await demoIdpFetch(cfg.issuer)(`${cfg.issuer}/jwks`)).json()).keys as Jwk[];
    const t = await signDemoToken({ iss: cfg.issuer, aud: cfg.clientId, sub: "x", exp: now() + 60, nonce: "n" });
    expect(verifyIdToken(t, { issuer: cfg.issuer, audience: cfg.clientId, nonce: "n", jwks }).sub).toBe("x");
  });
  it("F1.7 P9 the demo identity provider is refused when PAYSETTLE_ENV=production", async () => {
    const prev = process.env.PAYSETTLE_ENV;
    process.env.PAYSETTLE_ENV = "production";
    try {
      expect(() => assertDemoIdp()).toThrow(/sandbox/);
      expect(() => demoConfig(origin)).toThrow();
      const r = await demoIdpHandle(new Request("http://ps.test/sso/demo-idp/jwks"), "http://ps.test/sso/demo-idp");
      expect(r?.status).toBe(404);
    } finally { process.env.PAYSETTLE_ENV = prev; }
  });
});
