// Requirements: F2.01, F2.04, F2.06, F2.07, F2.08, F2.09 — every blueprint passes the policy gate as shipped.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPolicy, RAIL_CAP_DAYS, type PClause, type PMilestone, type PWorkspace } from "@/lib/policy";
import { BPS_FULL, splitByBps } from "@/lib/money";
import type { BlueprintDef } from "./digital";
import { SYSTEM_CLAUSES } from "./system";
import { PHYSICAL_BLUEPRINTS } from "./physical";
import { HYBRID_BLUEPRINTS } from "./hybrid";
import { OUTLINE_BLUEPRINTS } from "./outlines";
import { BLUEPRINTS } from "./index";

const FULL = [...PHYSICAL_BLUEPRINTS, ...HYBRID_BLUEPRINTS];
const ALL: BlueprintDef[] = [...FULL, ...OUTLINE_BLUEPRINTS];

/** Banned phrases are read from tools/copy-lint.mjs so the two lists cannot drift apart (P10). */
function bannedPhrases(): RegExp[] {
  const src = readFileSync(path.resolve(__dirname, "../../../tools/copy-lint.mjs"), "utf8");
  const m = src.match(/const BANNED = \[([\s\S]*?)\];/);
  if (!m) throw new Error("BANNED list not found in tools/copy-lint.mjs");
  return [...m[1].matchAll(/\/((?:\\\/|[^/])+)\/([a-z]*)/g)].map((x) => new RegExp(x[1], x[2]));
}

function workspaceOf(b: BlueprintDef, totalCents = 1_000_000): PWorkspace {
  const pay = b.milestones.filter((m) => m.type === "PAY");
  const amounts = splitByBps(totalCents, pay.map((m) => m.bps));
  const amt = new Map(pay.map((m, i) => [m.code, amounts[i]]));
  const milestones: PMilestone[] = b.milestones.map((m) => ({
    code: m.code, type: m.type, day: m.day, bps: m.bps, amountCents: amt.get(m.code) ?? 0, active: true,
    proof: { artifacts: m.proof.artifacts.map((a) => ({ kind: a.kind, min: a.min })), oracle: m.proof.oracle, criteria: m.proof.criteria },
    lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn ?? [],
  }));
  const clauses: PClause[] = [...SYSTEM_CLAUSES, ...b.clauses].map((c) => ({ category: c.category, code: c.code, body: c.body, active: true, protective: !!c.protective }));
  return { totalCents, rail: "A1", milestones, clauses, providerPayable: true };
}

describe("F2.01 blueprint library", () => {
  it("F2.01 ships 5 full and 13 outline blueprints with unique codes across the whole library", () => {
    expect(FULL.map((b) => b.code).sort()).toEqual(["UC_CLASSIC_CAR", "UC_HOME_ROOFING", "UC_INTERIOR_MILLWORK", "UC_TELECOM_TOWER", "UC_TRAVEL_TOUR"]);
    expect(OUTLINE_BLUEPRINTS).toHaveLength(13);
    // Same object may appear in both lists once the blueprints are registered in index.ts; dedupe by identity, then codes must be unique.
    const library = [...new Set([...ALL, ...BLUEPRINTS])];
    expect(new Set(library.map((b) => b.code)).size).toBe(library.length);
    for (const b of ALL) expect(b.code).toMatch(/^UC_[A-Z0-9_]+$/);
  });

  it("F2.04 full blueprints have 8–20 milestones and 3–5 clauses with a protective one; outlines have 5–8", () => {
    for (const b of FULL) {
      expect(b.depth, b.code).toBe("full");
      expect(b.milestones.length, b.code).toBeGreaterThanOrEqual(8);
      expect(b.milestones.length, b.code).toBeLessThanOrEqual(20);
      expect(b.clauses.length, b.code).toBeGreaterThanOrEqual(3);
      expect(b.clauses.length, b.code).toBeLessThanOrEqual(5);
      expect(b.clauses.some((c) => c.protective), b.code).toBe(true);
      expect(b.milestones.some((m) => m.type === "GATE"), b.code).toBe(true);
    }
    for (const b of OUTLINE_BLUEPRINTS) {
      expect(b.depth, b.code).toBe("outline");
      expect(b.milestones.length, b.code).toBeGreaterThanOrEqual(5);
      expect(b.milestones.length, b.code).toBeLessThanOrEqual(8);
    }
  });

  it("P10 banned-phrase list is read from copy-lint and is not empty", () => {
    const list = bannedPhrases();
    expect(list.length).toBeGreaterThanOrEqual(8);
    expect(list.some((r) => r.test(["risk", "free"].join("-")))).toBe(true); // built at runtime so copy-lint does not flag this file
  });

  it("F2.05 the policy check used here does catch a broken blueprint", () => {
    const broken = { ...ALL[0], milestones: ALL[0].milestones.map((m, i) => (i === 1 ? { ...m, bps: m.bps + 1 } : m)) };
    expect(checkPolicy(workspaceOf(broken)).map((v) => v.code)).toContain("SUM_NOT_100");
  });

  it("F2.08 site and shop blueprints set a GPS radius on photo proof", () => {
    const radius = (code: string) => ALL.find((b) => b.code === code)!.milestones.map((m) => m.proof.gpsRadiusM).filter(Boolean);
    expect(radius("UC_INTERIOR_MILLWORK")).toContain(300);
    expect(radius("UC_CLASSIC_CAR")).toContain(200);
    for (const b of ALL.filter((x) => x.kind === "PHYSICAL_SITE" || x.kind === "PHYSICAL_SHOP"))
      expect(b.milestones.some((m) => (m.proof.gpsRadiusM ?? 0) > 0), b.code).toBe(true);
  });

  describe.each(ALL.map((b) => [b.code, b] as const))("%s", (_code, b) => {
    it("F2.04 milestone codes are unique and dependsOn points to earlier milestones", () => {
      const seen = new Set<string>();
      for (const m of b.milestones) {
        expect(seen.has(m.code), m.code).toBe(false);
        for (const d of m.dependsOn ?? []) expect(seen.has(d), `${m.code} → ${d}`).toBe(true);
        seen.add(m.code);
      }
    });

    it("F2.06 payment shares add up to exactly 10,000 bps; GATEs carry 0", () => {
      expect(b.milestones.filter((m) => m.type === "PAY").reduce((a, m) => a + m.bps, 0)).toBe(BPS_FULL);
      for (const m of b.milestones) {
        expect(Number.isInteger(m.bps), m.code).toBe(true);
        if (m.type === "GATE") expect(m.bps, m.code).toBe(0);
        else expect(m.bps, m.code).toBeGreaterThan(0);
      }
    });

    it("F2.07 days ascend within recommendedDays ≤ 26 (one tranche)", () => {
      expect(b.recommendedDays).toBeLessThanOrEqual(RAIL_CAP_DAYS.A1);
      let prev = 0;
      for (const m of b.milestones) {
        expect(m.day, m.code).toBeGreaterThanOrEqual(Math.max(1, prev));
        expect(m.day, m.code).toBeLessThanOrEqual(b.recommendedDays);
        prev = m.day;
      }
    });

    it("F2.08 every PAY milestone names a concrete artifact (min > 0) or an oracle, plus criteria", () => {
      for (const m of b.milestones) {
        expect(m.proof.criteria.length, m.code).toBeGreaterThan(0);
        if (m.type === "PAY") expect(m.proof.artifacts.some((a) => a.min > 0) || !!m.proof.oracle, m.code).toBe(true);
      }
    });

    it("F2.09 every milestone has a lock rule and a dispute rule", () => {
      for (const m of b.milestones) {
        expect(m.lockRule.trim().length, m.code).toBeGreaterThan(0);
        expect(m.disputeRule.trim().length, m.code).toBeGreaterThan(0);
      }
    });

    it("F2.05 passes checkPolicy with $10,000 on rail A1 and zero violations", () => {
      expect(checkPolicy(workspaceOf(b))).toEqual([]);
    });

    it("P10 contains no banned phrases", () => {
      const text = JSON.stringify(b);
      for (const re of bannedPhrases()) expect(re.test(text), String(re)).toBe(false);
    });
  });
});
