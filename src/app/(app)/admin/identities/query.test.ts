/** F1.10 Identity auditor: access (admin, ops only), tolerant filter parsing, every filter, live rows and per-user trail. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs, paypalLinks, ROLES, users } from "@/db/schema";
import { termsDecisions } from "@/db/schema-identity";
import { audit } from "@/lib/audit";
import { DAY } from "@/lib/clock";
import { recordTermsDecision } from "@/lib/identity/handshake";
import { applyFilter, auditorAccess, identityRows, parseFilter, userTrail, type IdentityRow } from "./query";

const now = new Date("2026-11-08T12:00:00Z");
const row = (o: Partial<IdentityRow>): IdentityRow => ({ id: "u", name: "N", email: "n@x", role: "client", persona: null, state: "ACTIVE", tier: "new", lockedUntil: null, mfa: false, lastSignIn: null, paypal: "none", terms: "PENDING", ...o });
const ROWS = [
  row({ id: "u_a", name: "Alex Admin", email: "alex@admin.demo", role: "admin", mfa: true, lastSignIn: new Date(now.getTime() - 3600_000), terms: "ACCEPTED" }),
  row({ id: "u_p", name: "Arjun Rao", email: "arjun@provider.demo", role: "provider", state: "PROVIDER_VALIDATED", paypal: "receivable", lastSignIn: new Date(now.getTime() - 3 * DAY) }),
  row({ id: "u_l", name: "Locked Lou", email: "lou@x.demo", role: "client", lockedUntil: new Date(now.getTime() + 600_000), paypal: "linked", lastSignIn: new Date(now.getTime() - 40 * DAY), terms: "DECLINED" }),
  row({ id: "u_n", name: "Noor", email: "noor@provider.demo", role: "provider", state: "SUBMITTED" }),
];
const ids = (f: Record<string, string>) => applyFilter(ROWS, parseFilter(f), now).map((r) => r.id);

describe("F1.10 identity auditor access", () => {
  it("F1.10 only admin and ops may open it", () => {
    expect(ROLES.filter(auditorAccess)).toEqual(["admin", "ops"]);
  });
});

describe("F1.10 filters", () => {
  it("F1.10 junk filter values are ignored rather than failing the page", () => {
    expect(parseFilter({ role: "emperor", mfa: "maybe", state: "<script>", q: "  arj " })).toEqual({ q: "arj" });
  });
  it("F1.10 search, role, state, locked, MFA, last sign-in, PayPal and terms", () => {
    expect(ids({ q: "ARJUN" })).toEqual(["u_p"]);
    expect(ids({ q: "provider.demo" })).toEqual(["u_p", "u_n"]);
    expect(ids({ role: "provider" })).toEqual(["u_p", "u_n"]);
    expect(ids({ state: "SUBMITTED" })).toEqual(["u_n"]);
    expect(ids({ locked: "yes" })).toEqual(["u_l"]);
    expect(ids({ locked: "no" })).toEqual(["u_a", "u_p", "u_n"]);
    expect(ids({ mfa: "on" })).toEqual(["u_a"]);
    expect(ids({ seen: "24h" })).toEqual(["u_a"]);
    expect(ids({ seen: "7d" })).toEqual(["u_a", "u_p"]);
    expect(ids({ seen: "older" })).toEqual(["u_l"]);
    expect(ids({ seen: "never" })).toEqual(["u_n"]);
    expect(ids({ paypal: "receivable" })).toEqual(["u_p"]);
    expect(ids({ paypal: "none" })).toEqual(["u_a", "u_n"]);
    expect(ids({ terms: "DECLINED" })).toEqual(["u_l"]);
    expect(ids({ role: "provider", paypal: "none" })).toEqual(["u_n"]);
  });
});

describe("F1.10 live data", () => {
  const RUN = Math.random().toString(36).slice(2, 8), ORG = `org_ida_${RUN}`, U = `u_ida_${RUN}`, A = `u_idaa_${RUN}`;
  beforeAll(async () => {
    await db.insert(orgs).values({ id: ORG, name: "Auditor tests" });
    await db.insert(users).values([{ id: U, orgId: ORG, email: `${U}@t.local`, name: "Ida Provider", role: "provider", mfaSecret: "JBSWY3DPEHPK3PXP" }, { id: A, orgId: ORG, email: `${A}@t.local`, name: "Ada Admin", role: "admin" }]);
    await db.insert(paypalLinks).values({ id: `pl_${U}`, userId: U, kind: "merchant", merchantId: "M1", receivable: true });
    await audit(db, { id: U, role: "provider" }, "auth.sign_in", U, { mfa: true });
    await audit(db, { id: A, role: "admin" }, "identity.provider_validated", U, {});
    await audit(db, { id: U, role: "provider" }, "contract.sign", "ws_unrelated", {});
    await recordTermsDecision({ userId: U, role: "provider", decision: "ACCEPTED", ip: "t", userAgent: "t" });
  });
  afterAll(async () => {
    await db.delete(termsDecisions).where(eq(termsDecisions.userId, U));
    await db.delete(paypalLinks).where(eq(paypalLinks.userId, U));
    await db.delete(users).where(inArray(users.id, [U, A]));
  });
  it("F1.10 rows carry MFA, last sign-in from the audit chain, PayPal status and terms", async () => {
    const r = (await identityRows()).find((x) => x.id === U)!;
    expect(r).toMatchObject({ role: "provider", mfa: true, paypal: "receivable", terms: "ACCEPTED" });
    expect(r.lastSignIn && Date.now() - r.lastSignIn.getTime()).toBeLessThan(60_000);
    expect((await identityRows()).find((x) => x.id === A)).toMatchObject({ mfa: false, paypal: "none", terms: "PENDING", lastSignIn: null });
  });
  it("F1.10 the per-user trail has rows where the user is actor or target, newest first", async () => {
    const t = await userTrail(U);
    expect(t.map((x) => x.action)).toEqual(["identity.terms_accept", "contract.sign", "identity.provider_validated", "auth.sign_in"]);
    expect(t.find((x) => x.action === "identity.provider_validated")?.actorId).toBe(A);
  });
});
