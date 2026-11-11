/**
 * F4.02 F4.06 F4.07 F4.08 — disputes module end-to-end with the real money module on the MockRail (no mocks): a funded tranche,
 * a Tier 1 agreement and a Tier 3 verdict each settle in two legs, and the ledger matches the split to the cent.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { ledgerEntries, users, verdicts, wsMilestones } from "@/db/schema";
import { mockControl } from "@/lib/rails/mock";
import { splitDispute } from "@/lib/money";
import type { Actor } from "../types";
import { confirmTranche, fundTranche } from "../money";
import { makeContract, setMilestoneState } from "../money/fixtures";
import { issueVerdict, lockVault, openDispute, placeBid, skipToVault } from "./index";

beforeAll(() => { delete process.env.PAYPAL_CLIENT_ID; process.env.MONEY_RETRY_MS = "0"; });
beforeEach(() => mockControl.reset());
afterAll(async () => { await pool.end(); });

async function fundedDispute(amountCents: number) {
  const f = await makeContract({ milestones: [{ day: 3, amountCents }, { day: 8, amountCents: 100_000 }, { day: 12, amountCents: 100_000 }] });
  const c: Actor = { id: f.clientId, role: "client" }, p: Actor = { id: f.providerId, role: "provider" };
  const { approveUrl } = await fundTranche(c, f.trancheId);
  await confirmTranche(c, f.trancheId, new URL(approveUrl).searchParams.get("token")!);
  await setMilestoneState(f.milestoneIds[0], "SUBMITTED");
  return { f, c, p, id: await openDispute(c, f.milestoneIds[0], "QUALITY", "The work does not meet the criteria we agreed.") };
}
const ledger = async (trancheId: string, milestoneId?: string) => (await db.select().from(ledgerEntries).where(eq(ledgerEntries.trancheId, trancheId))).filter((e) => !milestoneId || e.milestoneId === milestoneId || e.milestoneId === null);

describe("disputes × money (MockRail)", () => {
  it("F4.02/F4.08 a Tier 1 agreement refunds then releases, through the money module", async () => {
    const { f, c, p, id } = await fundedDispute(200_000);
    await placeBid(c, id, 7000);
    expect(await placeBid(p, id, 7400)).toEqual({ settled: true, shareBps: 7200 });
    const [v] = await db.select().from(verdicts).where(eq(verdicts.disputeId, id));
    expect([v.leg1, v.leg2]).toEqual(["DONE", "DONE"]);
    const s = splitDispute(200_000, 7200);
    const led = await ledger(f.trancheId);
    expect(led.filter((e) => e.type === "REFUND" || e.type === "VOID").reduce((a, e) => a + e.amountCents, 0)).toBe(s.refundCents);
    const rel = led.filter((e) => e.type === "RELEASE" && e.milestoneId === f.milestoneIds[0]).reduce((a, e) => a + e.amountCents, 0);
    const fee = led.filter((e) => e.type === "FEE" && e.milestoneId === f.milestoneIds[0]).reduce((a, e) => a + e.amountCents, 0);
    expect(rel + fee).toBe(s.releaseCents);
    const [m] = await db.select().from(wsMilestones).where(and(eq(wsMilestones.id, f.milestoneIds[0])));
    expect(m.state).toBe("SETTLED_BY_VERDICT");
  });

  it("F4.06/F4.07 a Tier 3 verdict executes through the money module", async () => {
    const { f, c, p, id } = await fundedDispute(150_001);
    const med: Actor = { id: `u_med_${f.orgId.slice(-10)}`, role: "mediator" };
    await db.insert(users).values({ id: med.id, orgId: f.orgId, email: `${med.id}@test.invalid`, name: "Test Mediator", role: "mediator" });
    await skipToVault(c, id); await lockVault(c, id); await lockVault(p, id);
    await issueVerdict(med, id, { providerShareBps: 5000, findings: "Half of the criteria are met by the evidence on file.", rootCause: "CRITERIA_VAGUE", disposition: "RESUME", fault: "SHARED" });
    const [v] = await db.select().from(verdicts).where(eq(verdicts.disputeId, id));
    expect(v.mediatorId).toBe(med.id);
    expect([v.refundCents, v.releaseCents]).toEqual([75_001, 75_000]); // odd cent to the buyer leg
    expect([v.leg1, v.leg2]).toEqual(["DONE", "DONE"]);
  });
});
