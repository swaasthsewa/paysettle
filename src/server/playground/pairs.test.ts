/**
 * A12 Pair A vs Pair B (F2.04 Append-and-Prune, F2.05 risk, F2.06 amounts, F2.07 tranches, P9): the change
 * lists are sound on their own, and the playground button builds both contracts through the contracts service.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { blueprints, type BlueprintMilestone } from "@/db/schema";
import { simWorkspaces } from "@/db/schema-sim";
import { checkPolicy } from "@/lib/policy";
import { CLASSIC_CAR } from "@/data/blueprints/physical";
import { NotBuilt } from "../types";
import * as contracts from "../contracts";
import { PAIR_A, PAIR_B, pairAChanges, pairBChanges, scaleDay } from "./pairs-diff";
import { buildPairs, latestPairFor, pairResult } from "./pairs";
import { SandboxOnly } from "./session";

const JUDGE = { id: "u_judge", role: "judge" };
const prevEnv = process.env.PAYSETTLE_ENV;
afterEach(() => { if (prevEnv === undefined) delete process.env.PAYSETTLE_ENV; else process.env.PAYSETTLE_ENV = prevEnv; });
const bp = CLASSIC_CAR.milestones as BlueprintMilestone[];

describe("A12 change lists (pure)", () => {
  it("A12: Pair A prunes three steps, appends three, compresses to 18 days and still adds up to 100%", () => {
    const ch = pairAChanges(bp, CLASSIC_CAR.recommendedDays);
    const pruned = ch.filter((c) => c.action === "PRUNE").map((c) => (c as { milestoneCode: string }).milestoneCode);
    expect(pruned).toEqual(["M07", "M10", "M17"]);
    const appended = ch.filter((c) => c.action === "APPEND").map((c) => (c as Extract<typeof c, { action: "APPEND" }>).milestone);
    expect(appended).toHaveLength(3);
    const kept = bp.filter((m) => !pruned.includes(m.code) && m.type === "PAY").reduce((s, m) => s + m.bps, 0);
    expect(kept + appended.reduce((s, m) => s + m.bps, 0)).toBe(10_000);
    expect(Math.max(...ch.filter((c) => c.action === "SET_DAY").map((c) => (c as { day: number }).day))).toBe(PAIR_A.days);
    expect(scaleDay(26, 26, 18)).toBe(18);
    expect(scaleDay(1, 26, 18)).toBe(1);
  });
  it("A12: Pair B puts M06 at 35%, the other payments add up to 65%, and appends eight checkpoints up to day 28", () => {
    const ch = pairBChanges(bp);
    const shares = (ch.find((c) => c.action === "SET_BPS") as { shares: Record<string, number> }).shares;
    expect(shares.M06).toBe(3500);
    expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBe(10_000);
    const cps = ch.filter((c) => c.action === "APPEND").map((c) => (c as Extract<typeof c, { action: "APPEND" }>).milestone);
    expect(cps).toHaveLength(8);
    expect(cps.every((m) => m.type === "GATE" && m.bps === 0 && m.proof.artifacts.some((a) => a.min > 0))).toBe(true);
    expect(ch).toContainEqual({ action: "SET_DAY", milestoneCode: "M20", day: PAIR_B.days });
  });
});

const probe = { id: "u_probe_nobody", role: "marketing" as const };
const contractsBuilt = await contracts.getWorkspace(probe, "ws_probe_none").then(() => true, (e) => !(e instanceof NotBuilt));
const seeded = (await db.select({ code: blueprints.code }).from(blueprints).where(eq(blueprints.code, "UC_CLASSIC_CAR"))).length > 0;

describe("A12 Pair A vs Pair B in the playground", () => {
  it("A12 P9: building pairs is sandbox only", async () => {
    process.env.PAYSETTLE_ENV = "production";
    await expect(buildPairs(JUDGE)).rejects.toBeInstanceOf(SandboxOnly);
    await expect(latestPairFor(JUDGE)).rejects.toBeInstanceOf(SandboxOnly);
  });

  it.skipIf(!contractsBuilt || !seeded)("A12: two contracts from one blueprint, built by recorded revisions, diffed side by side", async () => {
    const r = await buildPairs(JUDGE);
    const [a, b] = r.diff.sides;
    expect(a).toMatchObject({ key: "A", totalCents: PAIR_A.totalCents, days: 18 });
    expect(b).toMatchObject({ key: "B", totalCents: PAIR_B.totalCents, days: 28 });
    expect(a.pruned.map((p) => p.code)).toEqual(["M07", "M10", "M17"]);
    expect(a.appended).toHaveLength(3);
    expect(b.appended).toHaveLength(8);
    expect(b.appended.every((x) => x.type === "GATE")).toBe(true);
    expect(r.revisions.A).toBeGreaterThan(10);
    expect(r.revisions.B).toBeGreaterThan(10);
    const m06 = r.diff.rows.find((x) => x.code === "M06")!;
    expect(m06.b).toMatchObject({ bps: 3500, amountCents: 507_500, changed: ["bps"] });
    expect(m06.a?.amountCents).toBe(60_000);
    expect(r.diff.rows.find((x) => x.code === "M17")?.a?.active).toBe(false);
    expect(b.tranches.length).toBeGreaterThanOrEqual(2);
    expect(a.tranches).toHaveLength(1);
    expect(a.risk).not.toBe(b.risk);
    for (const s of [a, b]) expect(Math.round(s.riskParts.reduce((t, x) => t + x.points, 0))).toBe(s.risk);
    expect(b.clausesOff).toContain("Registration and inspection");
    expect(a.clausesAdded).toContain("No irreversible changes");
    // only the "provider can be paid" check may remain: the shape of both contracts passes the policy gate
    for (const s of [a, b]) expect(s.violations.filter((v) => v.rule !== "R08")).toEqual([]);
    for (const s of [a, b]) {
      const v = await contracts.getWorkspace({ id: s.key === "A" ? PAIR_A.client : PAIR_B.client, role: "client" }, s.workspaceId);
      const ok = checkPolicy({ totalCents: v.totalCents, rail: v.rail as "A1", milestones: v.milestones.map((m) => ({ code: m.code, type: m.type, day: m.targetDay, bps: m.bps, amountCents: m.amountCents, active: m.active, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn })), clauses: v.clauses, providerPayable: true });
      expect(ok).toEqual([]);
      expect(await db.select().from(simWorkspaces).where(eq(simWorkspaces.workspaceId, s.workspaceId))).toHaveLength(1);
    }
    expect((await contracts.listWorkspaces({ id: PAIR_A.client, role: "client" })).map((w) => w.id)).not.toContain(a.workspaceId);
    expect((await latestPairFor(JUDGE))?.id).toBe(r.id);
    expect(await pairResult({ id: "u_someone_else" }, r.id)).toBeNull();
  }, 60_000);
});
