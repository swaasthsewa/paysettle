/**
 * Tests: F5.06, P9 demo quality: playground simulations and test organisations stay out of the real
 * personas' default views; F3.11: gate milestones are not receipts or payouts; waitlist: rate-limit key;
 * reason clauses without double periods.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { users, wsMilestones } from "@/db/schema";
import { simWorkspaces } from "@/db/schema-sim";
import { mockControl } from "@/lib/rails/mock";
import { reasonClause } from "@/lib/ai/gateway";
import { rateLimitKey } from "@/lib/net";
import { excludeSimAlias, isTestOrgId } from "@/lib/sim";
import { loadOverview } from "@/lib/identity/overview";
import { listWorkspaces } from "@/server/contracts";
import { confirmTranche, fundTranche, releaseMilestone } from "@/server/money";
import { makeContract, recordApproval, type Fixture } from "@/server/money/fixtures";
import { payoutsFor, radar, receiptsFor } from "@/server/money/queries";

beforeAll(() => { delete process.env.PAYPAL_CLIENT_ID; process.env.MONEY_RETRY_MS = "0"; });
beforeEach(() => mockControl.reset());
afterAll(async () => { await pool.end(); });

async function funded(f: Fixture) {
  const c = { id: f.clientId, role: "client" as const };
  const { approveUrl } = await fundTranche(c, f.trancheId);
  await confirmTranche(c, f.trancheId, new URL(approveUrl).searchParams.get("token")!);
}
async function release(f: Fixture, i: number) {
  await db.update(wsMilestones).set({ state: "APPROVED" }).where(eq(wsMilestones.id, f.milestoneIds[i]));
  return releaseMilestone({ id: f.clientId, role: "client" }, f.milestoneIds[i], { kind: "MILESTONE", approvalSig: await recordApproval(f.milestoneIds[i], { by: f.clientId }) });
}

describe("sim and test data stay out of default views", () => {
  it("F5.06 a playground workspace is hidden from the persona's contract list, overview, receipts, payouts and the radar", async () => {
    // two contracts between the same demo-org people; one is tagged as a playground simulation
    const real = await makeContract({ orgId: "org_demo", milestones: [{ day: 3, amountCents: 20_000 }, { day: 8, amountCents: 20_000 }], title: "Sim filter real contract" });
    const sim = await makeContract({ orgId: "org_demo", clientId: real.clientId, providerId: real.providerId, milestones: [{ day: 3, amountCents: 30_000 }, { day: 8, amountCents: 30_000 }], title: "Sim filter playground contract" });
    await db.insert(simWorkspaces).values({ workspaceId: sim.workspaceId, simId: "sim_b11" });
    await funded(real); await funded(sim);
    await release(real, 0); await release(sim, 0);
    const client = { id: real.clientId, role: "client" as const };
    const [cu] = await db.select().from(users).where(eq(users.id, real.clientId));

    const listed = (await listWorkspaces(client)).map((w) => w.id);
    expect(listed).toContain(real.workspaceId);
    expect(listed).not.toContain(sim.workspaceId);
    expect((await listWorkspaces(client, { sim: "only" })).map((w) => w.id)).toEqual([sim.workspaceId]);

    const ov = await loadOverview({ id: cu.id, email: cu.email, role: "client" });
    expect(ov.contracts.map((c) => c.id)).toEqual([real.workspaceId]);

    expect((await receiptsFor(real.clientId)).map((r) => r.workspace.id)).toEqual([real.workspaceId]);
    expect((await payoutsFor(real.providerId)).map((r) => r.workspace.id)).toEqual([real.workspaceId]);

    const ids = (await radar()).map((r) => r.workspaceId);
    expect(ids).toContain(real.workspaceId);
    expect(ids).not.toContain(sim.workspaceId);
    expect((await radar(true)).map((r) => r.workspaceId)).toContain(sim.workspaceId);
  });

  it("F5.06 a person in a test organisation still sees their own test contracts; staff views hide test orgs", async () => {
    const f = await makeContract({ milestones: [{ day: 3, amountCents: 10_000 }] }); // org_test_money_*
    expect((await listWorkspaces({ id: f.clientId, role: "client" })).map((w) => w.id)).toContain(f.workspaceId);
    await funded(f);
    expect((await radar()).map((r) => r.workspaceId)).not.toContain(f.workspaceId);
  });

  it("F5.06 test-org ids and the raw SQL filter", () => {
    expect(isTestOrgId("org_test_money_ab")).toBe(true);
    expect(isTestOrgId("org_t_x1")).toBe(true);
    expect(isTestOrgId("org_t9_x1")).toBe(true);
    expect(isTestOrgId("org_demo")).toBe(false);
    expect(isTestOrgId(null)).toBe(false);
    expect(() => excludeSimAlias("w; drop table x")).toThrow();
  });
});

describe("receipts and payouts", () => {
  it("F3.11 a gate's zero-amount release is not listed as a receipt or payout", async () => {
    const f = await makeContract({ milestones: [{ code: "M01", type: "GATE", day: 1, amountCents: 0 }, { code: "M02", day: 3, amountCents: 40_000 }] });
    await funded(f);
    await release(f, 0); await release(f, 1);
    const lines = (await receiptsFor(f.clientId))[0].lines;
    expect(lines.map((l) => l.code)).toEqual(["M02"]);
    expect(lines.every((l) => l.grossCents > 0)).toBe(true);
    expect((await payoutsFor(f.providerId))[0].lines.map((l) => l.code)).toEqual(["M02"]);
  });
});

describe("small fixes", () => {
  const h = (xff?: string) => ({ get: (k: string) => (k === "x-forwarded-for" ? xff ?? null : null) });
  it("P11 the rate-limit key is the rightmost X-Forwarded-For hop (the one the hosting proxy adds), else 'local'", () => {
    expect(rateLimitKey(h("1.2.3.4"))).toBe("1.2.3.4");
    expect(rateLimitKey(h("6.6.6.6, 9.9.9.9"))).toBe("9.9.9.9"); // a client-forged left hop cannot change the key
    expect(rateLimitKey(h("spoof-1, spoof-2,  203.0.113.7 "))).toBe("203.0.113.7");
    expect(rateLimitKey(h())).toBe("local");
    expect(rateLimitKey(h(" , "))).toBe("local");
  });
  it("A3 reasonClause drops the closing period so the caller's sentence ends once", () => {
    expect(reasonClause("No AI key is configured (AI_API_KEY is not set).")).toBe("No AI key is configured (AI_API_KEY is not set)");
    expect(`AI unavailable — ${reasonClause("Timed out.. ")}.`).toBe("AI unavailable — Timed out.");
    expect(reasonClause(undefined)).toBe("");
  });
});
