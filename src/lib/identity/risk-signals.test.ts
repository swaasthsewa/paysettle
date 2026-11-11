/** F2.02 same-network signal: address normalisation, comparison rules, and the DB helper over existing IP records. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs, users } from "@/db/schema";
import { termsDecisions } from "@/db/schema-identity";
import { recordTermsDecision } from "./handshake";
import { compareNetworks, normaliseIp, sameNetworkSignal } from "./risk-signals";

const now = new Date("2026-11-08T12:00:00Z");
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000);

describe("F2.02 normaliseIp", () => {
  it("F2.02 public IPv4 and IPv6 are comparable; private, loopback, CGNAT, link-local and 'local' are not", () => {
    expect(normaliseIp("203.0.113.9")).toEqual({ kind: 4, ip: "203.0.113.9", net: "203.0.113", label: "203.0.113.x" });
    expect(normaliseIp(" 203.0.113.9:443 ")?.ip).toBe("203.0.113.9");
    expect(normaliseIp("::ffff:198.51.100.4")?.ip).toBe("198.51.100.4");
    expect(normaliseIp("2001:db8:aa:1::5")).toMatchObject({ kind: 6, net: "2001:db8:aa:1", label: "2001:db8:aa:1::/64" });
    expect(normaliseIp("[2001:db8:aa:1::5]:8443")?.kind).toBe(6);
    for (const x of ["local", "", null, "10.0.0.1", "172.20.1.1", "192.168.1.10", "127.0.0.1", "100.64.3.3", "169.254.1.1", "::1", "fe80::1", "fd00::2", "not-an-ip", "999.1.1.1"]) expect(normaliseIp(x)).toBeNull();
  });
});

describe("F2.02 compareNetworks", () => {
  it("F2.02 the same public address within the window is a warning, with a masked label only", () => {
    const s = compareNetworks([{ ip: "203.0.113.9", at: at(3) }], [{ ip: "203.0.113.9", at: at(1) }, { ip: "198.51.100.1", at: at(2) }], { now });
    expect(s).toMatchObject({ level: "same_address", tone: "warn", sharedAddresses: 1, sharedNetworks: 1, networks: ["203.0.113.x"] });
    expect(s.lastSharedAt?.toISOString()).toBe(at(3).toISOString());
    expect(JSON.stringify(s)).not.toContain("203.0.113.9");
  });
  it("F2.02 the same /24 (or /64) but a different address is a weak hint", () => {
    expect(compareNetworks([{ ip: "203.0.113.9", at: at(3) }], [{ ip: "203.0.113.200", at: at(1) }], { now })).toMatchObject({ level: "same_network", tone: "plain", sharedAddresses: 0, sharedNetworks: 1 });
    expect(compareNetworks([{ ip: "2001:db8:aa:1::5", at: at(3) }], [{ ip: "2001:db8:aa:1:ffff::9", at: at(1) }], { now }).level).toBe("same_network");
  });
  it("F2.02 sightings outside the window, private addresses and missing history give no signal", () => {
    expect(compareNetworks([{ ip: "203.0.113.9", at: at(400) }], [{ ip: "203.0.113.9", at: at(1) }], { now }).level).toBe("none");
    expect(compareNetworks([{ ip: "192.168.1.2", at: at(1) }], [{ ip: "192.168.1.2", at: at(1) }], { now })).toMatchObject({ level: "none", summary: expect.stringMatching(/Not enough/) });
    expect(compareNetworks([{ ip: "203.0.113.9", at: at(1) }], [{ ip: "198.51.100.9", at: at(1) }], { now })).toMatchObject({ level: "none", summary: expect.stringMatching(/No shared/) });
  });
});

describe("F2.02 sameNetworkSignal (database)", () => {
  const RUN = Math.random().toString(36).slice(2, 8), ORG = `org_t_sig_${RUN}`, A = `u_sig_a_${RUN}`, B = `u_sig_b_${RUN}`, C = `u_sig_c_${RUN}`;
  beforeAll(async () => {
    await db.insert(orgs).values({ id: ORG, name: "signal tests" });
    await db.insert(users).values([A, B, C].map((id) => ({ id, orgId: ORG, email: `${id}@sig.test`, name: "Signal Person", role: "client" as const })));
    await recordTermsDecision({ userId: A, role: "client", decision: "ACCEPTED", ip: "198.51.100.77", userAgent: "vitest" });
    await recordTermsDecision({ userId: B, role: "provider", decision: "ACCEPTED", ip: "198.51.100.77", userAgent: "vitest" });
    await recordTermsDecision({ userId: C, role: "provider", decision: "ACCEPTED", ip: "local", userAgent: "vitest" });
  });
  afterAll(async () => { await db.delete(termsDecisions).where(inArray(termsDecisions.userId, [A, B, C])); await db.delete(users).where(inArray(users.id, [A, B, C])); });

  it("F2.02 reads the addresses already recorded at terms acceptance; no new collection", async () => {
    expect(await sameNetworkSignal(A, B)).toMatchObject({ level: "same_address", considered: { a: 1, b: 1 } });
    expect((await sameNetworkSignal(A, C)).level).toBe("none");
    expect((await sameNetworkSignal(A, A)).level).toBe("none");
  });
});
