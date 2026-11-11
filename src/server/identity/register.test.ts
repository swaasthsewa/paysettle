/**
 * F1.1 self-registration · F1.2 provider MFA pending · F1.8 terms recorded · F2.02 invite linking — DB-backed tests.
 * Every test makes its own organisation and people with unique ids (org_t_… is a test organisation, src/lib/sim.ts).
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { auditChain, orgs, revisions, signatures, users, workspaces } from "@/db/schema";
import { termsDecisions } from "@/db/schema-identity";
import { newId } from "@/lib/ids";
import { fixedWindow } from "@/lib/identity/rate-limit";
import { TERMS_VERSION, termsState } from "@/lib/identity/handshake";
import { verifyPasswordAny } from "@/lib/identity/password";
import { DUPLICATE_MESSAGE } from "@/lib/identity/registration";
import { issueVerifyToken } from "@/lib/identity/email-verify";
import { checkAuthorizeRequest, demoConfig, demoIdpFetch, issueDemoCode } from "@/lib/identity/sso-demo";
import { REG_CALLBACK_PATH, REG_IDP_PATH, socialCallbackCore, socialStartCore } from "@/lib/identity/register-social";
import { canonicalHash } from "@/lib/canonical";
import { createWorkspace, getWorkspace, signatureFor } from "@/server/contracts";
import { canonicalDoc } from "@/server/contracts/core";
import { confirmEmail, createAccount, startEmailVerification } from "./register";
import { linkInvites, nextAfterRegistration, openInvites } from "./invites";
import { gateRegistration } from "./limits";

afterAll(async () => { await pool.end(); });

const tag = () => newId("t").slice(2, 14);
const ctx = (t: string) => ({ ip: "203.0.113.20", userAgent: "vitest-reg", orgId: `org_t_reg_${t}_${Math.random().toString(36).slice(2, 6)}` });
const base = (t: string, o: Partial<{ role: "client" | "provider"; email: string; name: string }> = {}) => ({
  name: o.name ?? "Rita Registrant", email: o.email ?? `rita_${t}@reg.test`, password: "Lantern-orbit-cactus-77", role: o.role ?? ("client" as const),
  country: "IN" as const, timezone: "Asia/Kolkata", via: "password" as const,
});

async function clientWithInvite(email: string) {
  const t = tag(), orgId = `org_t_${t}`;
  await db.insert(orgs).values({ id: orgId, name: `reg invite ${t}` });
  const c = { id: `u_c_${t}`, role: "client" as const };
  await db.insert(users).values({ id: c.id, orgId, email: `c_${t}@reg.test`, name: "Invite Client", role: "client", tier: "standard" });
  const wsId = await createWorkspace(c, { blueprintCode: "UC_WEB_MVP", title: "Invited booking app", totalCents: 600_000, inviteEmail: email });
  return { c, wsId };
}

describe("F1.1 createAccount", () => {
  it("F1.1 creates a PENDING account in its own organisation, hashes the password, records the terms (F1.8) and audits without the e-mail", async () => {
    const t = tag(), c = ctx(t);
    const r = await createAccount(base(t, { email: `  RITA_${t}@Reg.Test ` }), c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [u] = await db.select().from(users).where(eq(users.id, r.user.id));
    expect(u).toMatchObject({ orgId: c.orgId, email: `rita_${t}@reg.test`, role: "client", onboardingState: "PENDING", tier: "new", mfaSecret: null });
    expect(u.passwordHash).toMatch(/^scrypt\$/);
    expect(await verifyPasswordAny("Lantern-orbit-cactus-77", u.passwordHash!)).toBe(true);
    expect(u.profile).toMatchObject({ country: "IN", billingCountry: "IN", timezone: "Asia/Kolkata", currency: "USD", registeredVia: "password" });
    expect((u.profile as Record<string, unknown>).emailVerifiedAt).toBeUndefined();
    expect(await termsState(u.id)).toBe("ACCEPTED");
    const [td] = await db.select().from(termsDecisions).where(eq(termsDecisions.userId, u.id));
    expect(td).toMatchObject({ version: TERMS_VERSION, ip: "203.0.113.20", userAgent: "vitest-reg" });
    const [a] = await db.select().from(auditChain).where(and(eq(auditChain.target, u.id), eq(auditChain.action, "identity.register")));
    expect(a.detail).toMatchObject({ role: "client", country: "IN", via: "password", emailVerified: false });
    expect(JSON.stringify(a.detail)).not.toContain("@");
    expect(await nextAfterRegistration(u.id)).toBe("/register/welcome");
  });

  it("F1.1 F1.2 a provider gets a pending authenticator set-up and a provider profile seeded with the country", async () => {
    const t = tag();
    const r = await createAccount(base(t, { role: "provider", email: `prov_${t}@reg.test` }), ctx(t));
    expect(r.ok && r.mfaPending).toBe(true);
    if (!r.ok) return;
    const [u] = await db.select().from(users).where(eq(users.id, r.user.id));
    const p = u.profile as { mfaPending?: { secret: string; attempts: number }; provider?: { country: string } };
    expect(p.mfaPending?.secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(p.mfaPending?.attempts).toBe(0);
    expect(p.provider).toEqual({ country: "IN" });
  });

  it("F1.1 ERR_101 duplicate e-mail (any spelling): one account only, the answer does not describe the account, attempt audited", async () => {
    const t = tag();
    const first = await createAccount(base(t), ctx(t));
    expect(first.ok).toBe(true);
    const again = await createAccount(base(t, { email: `Rita_${t}@REG.test`, role: "provider", name: "Someone Else" }), ctx(t));
    expect(again).toEqual({ ok: false, code: "ERR_101" });
    expect(DUPLICATE_MESSAGE).toMatch(/^ERR_101 · /);
    expect(DUPLICATE_MESSAGE).toMatch(/sign in/i);
    expect(DUPLICATE_MESSAGE).not.toMatch(/already (has|have) an account|is registered|exists/i);
    const rows = await db.select().from(users).where(eq(users.email, `rita_${t}@reg.test`));
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("client");
    const [a] = await db.select().from(auditChain).where(and(eq(auditChain.target, rows[0].id), eq(auditChain.action, "identity.register_duplicate")));
    expect(a.detail).toMatchObject({ incident: "ERR_101" });
  });
});

describe("F1.1 rate limit", () => {
  it("F1.1 10 posts per address per 10 minutes and 5 per e-mail per hour; the window resets", () => {
    const l = { ip: fixedWindow(10, 600_000), email: fixedWindow(5, 3_600_000), social: fixedWindow(1, 1), resend: fixedWindow(1, 1) };
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(gateRegistration("198.51.100.7", "probe@reg.test", t0 + i, l).ok).toBe(true);
    const sixth = gateRegistration("198.51.100.7", "PROBE@reg.test", t0 + 6, l);
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.message).toMatch(/Try again in \d+ minutes?/);
    for (let i = 0; i < 4; i++) expect(gateRegistration("198.51.100.7", `other${i}@reg.test`, t0 + 10 + i, l).ok).toBe(true);
    expect(gateRegistration("198.51.100.7", "fresh@reg.test", t0 + 20, l).ok).toBe(false); // 11th from this address
    expect(gateRegistration("198.51.100.8", "fresh@reg.test", t0 + 21, l).ok).toBe(true); // another address is separate
    expect(gateRegistration("198.51.100.7", "fresh2@reg.test", t0 + 600_001, l).ok).toBe(true); // window over
  });
});

describe("F1.1 e-mail confirmation", () => {
  it("F1.1 a link works once, the newest link wins, a changed address or a forged value is refused", async () => {
    const t = tag();
    const r = await createAccount(base(t), ctx(t));
    if (!r.ok) throw new Error("create failed");
    const one = await startEmailVerification(r.user.id);
    const two = await startEmailVerification(r.user.id);
    if (!("token" in one) || !("token" in two)) throw new Error("no token");
    expect((await confirmEmail(one.token)).ok).toBe(false); // replaced by the newer link
    expect((await confirmEmail(two.token + "x")).ok).toBe(false); // forged
    const ok = await confirmEmail(two.token);
    expect(ok.ok).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.id, r.user.id));
    expect((u.profile as { emailVerifiedAt?: string }).emailVerifiedAt).toBeTruthy();
    expect((u.profile as { emailVerify?: unknown }).emailVerify).toBeUndefined();
    const reuse = await confirmEmail(two.token);
    expect(reuse).toMatchObject({ ok: false, already: true });
    expect(await startEmailVerification(r.user.id)).toEqual({ already: true });
    const other = issueVerifyToken(r.user.id, "someone-else@reg.test");
    expect((await confirmEmail(other.token)).ok).toBe(false);
  });
});

describe("F2.02 invite shadow profile", () => {
  it("F2.02 a provider registering with an UNCONFIRMED invited e-mail is not linked until the e-mail is confirmed; then a new revision links them", async () => {
    const t = tag(), email = `invited_${t}@reg.test`;
    const { c, wsId } = await clientWithInvite(email);
    const before = await getWorkspace(c, wsId);
    expect(before.provider).toBeNull();
    expect((await openInvites(email.toUpperCase())).map((w) => w.id)).toContain(wsId);

    const r = await createAccount(base(t, { role: "provider", email }), ctx(t));
    if (!r.ok) throw new Error("create failed");
    expect(r.invites.linked).toEqual([]);
    const [still] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(still.providerId).toBeNull();
    expect((await linkInvites(r.user.id)).linked).toEqual([]); // not confirmed → nothing

    const tok = await startEmailVerification(r.user.id);
    if (!("token" in tok)) throw new Error("no token");
    const done = await confirmEmail(tok.token);
    expect(done.ok && done.invites.linked.map((l) => l.id)).toEqual([wsId]);

    const [w] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(w).toMatchObject({ providerId: r.user.id, inviteEmail: null, revision: before.revision + 1 });
    const [rev] = await db.select().from(revisions).where(eq(revisions.workspaceId, wsId)).orderBy(desc(revisions.revNo)).limit(1);
    expect(rev.revNo).toBe(w.revision);
    expect(rev.hash).toBe(w.canonicalHash);
    expect(rev.change).toMatchObject({ action: "ATTACH_PROVIDER", target: r.user.id });
    expect((rev.canonical as { providerId: string }).providerId).toBe(r.user.id);
    expect(canonicalHash(rev.canonical)).toBe(rev.hash);
    const view = await getWorkspace({ id: r.user.id, role: "provider" }, wsId); // the provider can now open the room
    expect(view.provider?.id).toBe(r.user.id);
    expect(await nextAfterRegistration(r.user.id)).toBe(`/contracts/${wsId}?joined=1`);
    const [a] = await db.select().from(auditChain).where(and(eq(auditChain.target, wsId), eq(auditChain.action, "identity.invite_linked")));
    expect(a.actorId).toBe(r.user.id);
    expect((await linkInvites(r.user.id)).linked).toEqual([]); // idempotent: nothing left to link
  });

  it("F2.02 an identity-provider-confirmed e-mail links at registration; a client signature on the old revision is voided", async () => {
    const t = tag(), email = `idp_${t}@reg.test`;
    const { c, wsId } = await clientWithInvite(email);
    const v = await getWorkspace(c, wsId);
    /* an invited contract stays DRAFT (no payable provider yet), so a client signature is put in place directly */
    await db.insert(signatures).values({ id: newId("sig"), workspaceId: wsId, revNo: v.revision, hash: v.canonicalHash!, signerId: c.id, role: "client", signature: signatureFor(wsId, v.revision, v.canonicalHash!, c.id, "client"), mfa: false, ip: "203.0.113.5", userAgent: "vitest" });
    const r = await createAccount({ ...base(t, { role: "provider", email }), via: "demo-idp", verifiedEmail: true, idp: { iss: "http://ps.test/sso/demo-idp", sub: "demo|x" } }, ctx(t));
    if (!r.ok) throw new Error("create failed");
    expect(r.invites.linked.map((l) => l.id)).toEqual([wsId]);
    const live = await db.select().from(signatures).where(eq(signatures.workspaceId, wsId));
    expect(live).toHaveLength(1);
    expect(live[0].voidedAtRev).toBe(v.revision + 1);
    const [u] = await db.select().from(users).where(eq(users.id, r.user.id));
    expect(u.profile).toMatchObject({ registeredVia: "demo-idp", emailVerifiedBy: "demo-idp", idp: { sub: "demo|x" } });
  });

  it("F2.02 a client registering with an invited e-mail is never linked as the provider; a changed contract format defers instead of writing a wrong hash", async () => {
    const t = tag(), email = `cli_inv_${t}@reg.test`;
    const { wsId } = await clientWithInvite(email);
    const r = await createAccount({ ...base(t, { role: "client", email }), verifiedEmail: true }, ctx(t));
    if (!r.ok) throw new Error("create failed");
    expect(r.invites.linked).toEqual([]);
    const [w] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    expect(w.providerId).toBeNull();

    /* safety net: a stored hash this code cannot rebuild → deferred, nothing written */
    const t2 = tag(), email2 = `defer_${t2}@reg.test`;
    const inv = await clientWithInvite(email2);
    await db.update(workspaces).set({ canonicalHash: "0".repeat(64) }).where(eq(workspaces.id, inv.wsId));
    const p = await createAccount({ ...base(t2, { role: "provider", email: email2 }), verifiedEmail: true }, ctx(t2));
    if (!p.ok) throw new Error("create failed");
    expect(p.invites).toEqual({ linked: [], deferred: [{ id: inv.wsId, reason: "hash_mismatch" }] });
    const [w2] = await db.select().from(workspaces).where(eq(workspaces.id, inv.wsId));
    expect(w2.providerId).toBeNull();
    expect(typeof canonicalDoc).toBe("function");
  });
});

describe("F1.1 demo identity provider sign-up (sandbox, P9)", () => {
  const origin = "http://ps.test";
  it("F1.1 full OIDC code + PKCE flow through the demo IdP returns a verified identity for the sign-up form", async () => {
    const cfg = demoConfig(origin), f = demoIdpFetch(cfg.issuer);
    const { url, flow } = await socialStartCore(cfg, f, origin);
    const u = new URL(url);
    expect(u.pathname).toBe(REG_IDP_PATH);
    expect(new URL(u.searchParams.get("redirect_uri")!).pathname).toBe(REG_CALLBACK_PATH);
    const req = { clientId: u.searchParams.get("client_id")!, redirectUri: u.searchParams.get("redirect_uri")!, state: u.searchParams.get("state")!, nonce: u.searchParams.get("nonce")!, codeChallenge: u.searchParams.get("code_challenge")!, codeChallengeMethod: "S256", responseType: "code" };
    const back = new URL(await issueDemoCode(req, cfg.issuer, { email: "New.Person@Social.Example", name: "New Person", groups: [] }));
    const id = await socialCallbackCore(cfg, f, flow, { code: back.searchParams.get("code"), state: back.searchParams.get("state") }, origin);
    expect(id).toMatchObject({ email: "new.person@social.example", name: "New Person", iss: cfg.issuer });
    expect(id.sub).toMatch(/^demo\|/);
    await expect(socialCallbackCore(cfg, f, flow, { code: back.searchParams.get("code"), state: back.searchParams.get("state") }, origin)).rejects.toMatchObject({ code: "IDP_HTTP" }); // code used once
    await expect(socialCallbackCore(cfg, f, flow, { code: "x", state: "forged" }, origin)).rejects.toMatchObject({ code: "STATE" });
    await expect(socialCallbackCore(cfg, f, null, { code: "x", state: "y" }, origin)).rejects.toMatchObject({ code: "FLOW_EXPIRED" });
  });

  it("F1.1 the demo client accepts exactly two redirect paths on its own origin", () => {
    const cfg = demoConfig(origin);
    const req = (redirectUri: string) => ({ clientId: "paysettle-demo", redirectUri, state: "s", nonce: "n", codeChallenge: "a".repeat(43), codeChallengeMethod: "S256", responseType: "code" });
    expect(checkAuthorizeRequest(req(`${origin}${REG_CALLBACK_PATH}`), cfg.issuer)).toBeNull();
    expect(checkAuthorizeRequest(req(`${origin}/sso/callback`), cfg.issuer)).toBeNull();
    expect(checkAuthorizeRequest(req(`${origin}/register/welcome`), cfg.issuer)).toMatch(/redirect_uri/);
    expect(checkAuthorizeRequest(req(`https://evil.example${REG_CALLBACK_PATH}`), cfg.issuer)).toMatch(/redirect_uri/);
  });

  it("F1.1 P9 outside the sandbox the demo IdP refuses", async () => {
    const prev = process.env.PAYSETTLE_ENV;
    process.env.PAYSETTLE_ENV = "production";
    try { expect(() => demoConfig(origin)).toThrow(/sandbox/); } finally { process.env.PAYSETTLE_ENV = prev; }
  });
});

describe("F1.1 server action surface", () => {
  it("F1.1 the registration action files expose only the intended actions (no helper that takes a user id)", async () => {
    expect(Object.keys(await import("@/app/(auth)/register/actions")).sort()).toEqual(["register"]);
    expect(Object.keys(await import("@/app/(auth)/register/mfa/actions")).sort()).toEqual(["confirmRegMfa", "finishRegMfa", "restartRegMfa"]);
    expect(Object.keys(await import("@/app/(auth)/register/welcome/actions")).sort()).toEqual(["resendConfirmation"]);
    expect(Object.keys(await import("@/app/(auth)/register/verify/actions")).sort()).toEqual(["confirmEmailAction"]);
    expect(Object.keys(await import("@/app/(auth)/register/demo-idp/actions")).sort()).toEqual(["signUpConsent", "signUpDeny"]);
  });
});
