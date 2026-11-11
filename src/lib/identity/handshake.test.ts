/**
 * F1.8 baseline handshake (versioned terms, signed accept/decline records, latest decision wins, sealed cookies) and
 * F1.9 sandbox bypass guard (persona picker refused when PAYSETTLE_ENV=production).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { auditChain, orgs, users } from "@/db/schema";
import { termsDecisions } from "@/db/schema-identity";
import { sandboxMode } from "@/lib/clock";
import { demoSignInGuard, recordTermsDecision, seal, TERMS_VERSION, termsSignature, termsState, unseal, verifyTermsSignature } from "./handshake";

const RUN = Math.random().toString(36).slice(2, 8), ORG = `org_hs_${RUN}`, U = `u_hs_${RUN}`;
beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG, name: "Handshake tests" });
  await db.insert(users).values({ id: U, orgId: ORG, email: `${U}@hs.test`, name: "Hana Handshake", role: "client" });
});
afterAll(async () => { await db.delete(termsDecisions).where(eq(termsDecisions.userId, U)); await db.delete(users).where(inArray(users.id, [U])); });

describe("F1.8 baseline handshake", () => {
  it("F1.8 terms are versioned by date", () => expect(TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  it("F1.8 a person with no decision is PENDING; accept is signed, audited and wins; a later decline wins over it", async () => {
    expect(await termsState(U)).toBe("PENDING");
    const rec = await recordTermsDecision({ userId: U, role: "client", decision: "ACCEPTED", ip: "203.0.113.9", userAgent: "vitest" });
    expect(await termsState(U)).toBe("ACCEPTED");
    const [row] = await db.select().from(termsDecisions).where(eq(termsDecisions.userId, U));
    expect(row).toMatchObject({ version: TERMS_VERSION, decision: "ACCEPTED", ip: "203.0.113.9", userAgent: "vitest", signature: rec.signature });
    expect(verifyTermsSignature({ userId: U, version: row.version, decision: row.decision, ip: row.ip!, userAgent: row.userAgent!, at: row.at }, row.signature)).toBe(true);
    const [a] = await db.select().from(auditChain).where(and(eq(auditChain.target, U), eq(auditChain.action, "identity.terms_accept")));
    expect(a.detail).toMatchObject({ version: TERMS_VERSION });
    await recordTermsDecision({ userId: U, role: "client", decision: "DECLINED", ip: "203.0.113.9", userAgent: "vitest" });
    expect(await termsState(U)).toBe("DECLINED");
    expect(await termsState(U, "1999-01-01")).toBe("PENDING");
  });
  it("F1.8 the signature covers every field: a changed IP, version or decision no longer verifies", () => {
    const r = { userId: "u", version: TERMS_VERSION, decision: "ACCEPTED" as const, ip: "1.2.3.4", userAgent: "ua", at: new Date("2026-11-08T10:00:00Z") };
    const sig = termsSignature(r);
    expect(verifyTermsSignature(r, sig)).toBe(true);
    expect(verifyTermsSignature({ ...r, ip: "5.6.7.8" }, sig)).toBe(false);
    expect(verifyTermsSignature({ ...r, version: "2025-01-01" }, sig)).toBe(false);
    expect(verifyTermsSignature({ ...r, decision: "DECLINED" }, sig)).toBe(false);
  });
  it("F1.8 the handshake cookie is tamper-evident, purpose-bound and expires", () => {
    const t = seal("handshake", { u: "u_x", role: "ops", exp: Date.now() + 60_000 });
    expect(unseal<{ u: string; exp: number }>("handshake", t)?.u).toBe("u_x");
    expect(unseal("sso-flow", t)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "u_admin", role: "admin", exp: Date.now() + 60_000 })).toString("base64url");
    expect(unseal("handshake", `${forged}.${sig}`)).toBeNull();
    expect(unseal("handshake", `${body}.${sig}`, Date.now() + 120_000)).toBeNull();
    expect(unseal("handshake", undefined)).toBeNull();
  });
});

describe("F1.9 sandbox bypass", () => {
  it("F1.9 the persona picker works in the sandbox for seeded personas only", () => {
    expect(sandboxMode()).toBe(true);
    expect(demoSignInGuard({ sandbox: sandboxMode(), persona: "5-ops", exists: true })).toEqual({ ok: true });
    expect(demoSignInGuard({ sandbox: sandboxMode(), persona: null, exists: true }).ok).toBe(false);
    expect(demoSignInGuard({ sandbox: sandboxMode(), persona: "x", exists: false }).ok).toBe(false);
  });
  it("F1.9 demo sign-in is refused when PAYSETTLE_ENV=production", () => {
    const prev = process.env.PAYSETTLE_ENV;
    process.env.PAYSETTLE_ENV = "production";
    try {
      expect(sandboxMode()).toBe(false);
      const g = demoSignInGuard({ sandbox: sandboxMode(), persona: "5-ops", exists: true });
      expect(g).toMatchObject({ ok: false });
      expect(!g.ok && g.message).toMatch(/off in production/);
    } finally { process.env.PAYSETTLE_ENV = prev; }
  });
});
