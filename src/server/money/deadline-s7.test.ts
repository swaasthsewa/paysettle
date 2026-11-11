/**
 * F5.06 — playground scenario S7 "Late and early" end to end on the mock rail: Web MVP with a bonus pool, M02
 * delivered two days late (deduction), M03 three days early (bonus), three-way check with zero drift.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { tranches, workspaces, wsMilestones } from "@/db/schema";
import { releaseAdjustments } from "@/db/schema-money";
import { SCENARIOS, runAll } from "../playground/scenarios";
import { createSim, getSim } from "../playground/session";
import { checkInvariant } from "./queries";

const JUDGE = { id: "u_judge", role: "judge" };
beforeAll(() => { delete process.env.PAYPAL_CLIENT_ID; process.env.MONEY_RETRY_MS = "0"; });
afterAll(async () => { await pool.end(); });

describe("F5.06 scenario S7 late and early", () => {
  it("S7: steps are named and explained", () => {
    const s = SCENARIOS.S7;
    expect(s.steps.map((x) => x.id)).toEqual(["create", "terms", "sign", "fund", "gate", "late", "early", "recon"]);
    for (const st of s.steps) { expect(st.label.length).toBeGreaterThan(3); expect(st.explain.length).toBeGreaterThanOrEqual(10); }
  });

  it("S7: pool funded with the hold, −$4.50 on M02, +$9.00 on M03, zero drift", async () => {
    const sim = await createSim(JUDGE, "S7", "MOCK");
    const results = await runAll(JUDGE, sim.id, { budgetMs: 60_000 });
    const bad = results.filter((r) => r.outcome.status === "error" || r.outcome.status === "waiting").map((b) => `${b.stepId}: ${b.outcome.detail}`);
    expect(bad).toEqual([]);
    expect(results).toHaveLength(SCENARIOS.S7.steps.length);
    const s = await getSim(sim.id);
    const [w] = await db.select().from(workspaces).where(eq(workspaces.id, s.workspaceId!));
    expect(w.deadlineTerms?.early?.poolCents).toBe(12_000);
    const [t] = await db.select().from(tranches).where(eq(tranches.workspaceId, w.id));
    expect(t.bonusPoolCents).toBeGreaterThan(0);
    const ms = await db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, w.id));
    const id = (code: string) => ms.find((m) => m.code === code)!.id;
    const adj = await db.select().from(releaseAdjustments).where(eq(releaseAdjustments.workspaceId, w.id));
    expect(adj.find((a) => a.milestoneId === id("M02"))).toMatchObject({ timing: "LATE", daysLate: 2, countedDays: 1, deductionCents: 450, releasedCents: 89_550 });
    expect(adj.find((a) => a.milestoneId === id("M03"))).toMatchObject({ timing: "EARLY", daysEarly: 3, bonusCents: 900, releasedCents: 120_900 });
    expect(results.find((r) => r.stepId === "recon")?.outcome.detail).toMatch(/zero drift/);
    expect((await checkInvariant(t.id)).checks.filter((c) => !c.ok)).toEqual([]);
  }, 90_000);
});
