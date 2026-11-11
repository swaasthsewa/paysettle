/**
 * F3.07 F3.08 P6 — deadline terms (pure): rounding, caps, grace, pool exhaustion, excused days, review time excluded,
 * release split, pool allocation, the reconciliation view; and policy rules R11 / R12 (src/lib/policy.ts).
 */
import { describe, expect, it } from "vitest";
import {
  DAY_MS, DEADLINE_DEFAULTS, HOUR_MS, adjustmentFor, allocatePool, maxBonusCents, measure, mergeIntervals, normalizeTerms, overlapMs,
  releaseSplit, timingLabel, wholeDays, withDeadlineAdjustments, type DeadlineTerms,
} from "./deadline";
import { RISK_FORMULA, checkPolicy, riskScore, type PMilestone, type PWorkspace } from "./policy";

const late = (o: Partial<NonNullable<DeadlineTerms["late"]>> = {}): DeadlineTerms => ({ late: { ...DEADLINE_DEFAULTS.late, milestones: "ALL", ...o }, early: null });
const early = (o: Partial<NonNullable<DeadlineTerms["early"]>> = {}): DeadlineTerms => ({ late: null, early: { ...DEADLINE_DEFAULTS.early, poolCents: 10_000, milestones: "ALL", ...o } });
const pay = (code: string, amountCents: number) => ({ code, type: "PAY" as const, amountCents });
const T0 = Date.UTC(2026, 10, 1, 9, 0, 0);
const facts = (lateMs: number, review: { from: number; to: number }[] = [], excusedDays = 0) => measure({ dueAt: T0, acceptedAt: T0 + lateMs, review, excusedDays });

describe("days and intervals", () => {
  it("days are whole days to the nearest day, integers only", () => {
    expect(wholeDays(0)).toBe(0);
    expect(wholeDays(-5)).toBe(0);
    expect(wholeDays(11 * HOUR_MS + 59 * 60_000)).toBe(0);
    expect(wholeDays(12 * HOUR_MS)).toBe(1);
    expect(wholeDays(2 * DAY_MS + 5_000)).toBe(2);
    expect(wholeDays(3 * DAY_MS - 60_000)).toBe(3);
    expect(() => wholeDays(1.5)).toThrow(TypeError);
  });
  it("review intervals merge and are clipped to [due, accepted]", () => {
    expect(mergeIntervals([{ from: 5, to: 9 }, { from: 1, to: 3 }, { from: 2, to: 6 }, { from: 7, to: 7 }])).toEqual([{ from: 1, to: 9 }]);
    expect(overlapMs([{ from: 0, to: 10 }, { from: 20, to: 30 }], 5, 25)).toBe(10);
    expect(overlapMs([{ from: 0, to: 10 }], 10, 10)).toBe(0);
  });
  it("F3.07 time under client review never counts; remediation time does", () => {
    // due at T0; attempt 1 submitted on time-ish (T0 + 1 h), client reviewed it for 2 days, then asked for a fix;
    // the fix took 1 day (remediation counts); accepted submission at T0 + 1 h + 2 d + 1 d = 3 days (and 1 h) after due.
    const review = [{ from: T0 + HOUR_MS, to: T0 + HOUR_MS + 2 * DAY_MS }];
    const l = facts(HOUR_MS + 3 * DAY_MS, review);
    expect(l.reviewExcludedMs).toBe(2 * DAY_MS);
    expect(l.daysLate).toBe(1); // 3 d 1 h − 2 d review = 1 d 1 h → 1 day
    // review before the due date does not shift anything
    expect(facts(2 * DAY_MS, [{ from: T0 - 5 * DAY_MS, to: T0 - 3 * DAY_MS }]).daysLate).toBe(2);
  });
});

describe("F3.07 late deduction", () => {
  it("grace days are not charged; 50 bps per counted day; half-even rounding via src/lib/money", () => {
    expect(adjustmentFor(late(), pay("M02", 90_000), facts(DAY_MS), 0)).toMatchObject({ timing: "LATE", daysLate: 1, countedLateDays: 0, deductionCents: 0 });
    expect(adjustmentFor(late(), pay("M02", 90_000), facts(2 * DAY_MS), 0)).toMatchObject({ countedLateDays: 1, deductionBps: 50, deductionCents: 450 });
    // 50 bps of 4,100 cents = 20.5 → half to even → 20; of 4,300 = 21.5 → 22
    expect(adjustmentFor(late(), pay("M02", 4_100), facts(2 * DAY_MS), 0).deductionCents).toBe(20);
    expect(adjustmentFor(late(), pay("M02", 4_300), facts(2 * DAY_MS), 0).deductionCents).toBe(22);
  });
  it("the cap holds however late; gates and other milestones are untouched", () => {
    const a = adjustmentFor(late(), pay("M02", 200_000), facts(40 * DAY_MS), 0);
    expect(a).toMatchObject({ countedLateDays: 39, deductionBps: 1000, deductionCents: 20_000 });
    expect(adjustmentFor(late(), { code: "M01", type: "GATE", amountCents: 0 }, facts(9 * DAY_MS), 0).deductionCents).toBe(0);
    expect(adjustmentFor(late({ milestones: ["M03"] }), pay("M02", 200_000), facts(9 * DAY_MS), 0).deductionCents).toBe(0);
    expect(adjustmentFor(null, pay("M02", 200_000), facts(9 * DAY_MS), 0)).toMatchObject({ timing: "LATE", deductionCents: 0 });
  });
  it("excused days (signed extension or mediator ruling) reduce the counted days", () => {
    expect(adjustmentFor(late(), pay("M02", 100_000), facts(5 * DAY_MS, [], 3), 0)).toMatchObject({ daysLate: 5, excusedDays: 3, countedLateDays: 1, deductionCents: 500 });
    expect(adjustmentFor(late(), pay("M02", 100_000), facts(5 * DAY_MS, [], 9), 0)).toMatchObject({ countedLateDays: 0, deductionCents: 0 });
  });
});

describe("F3.08 early bonus and the pool", () => {
  it("needs the minimum days early; 25 bps a day; capped at 1% per milestone", () => {
    expect(adjustmentFor(early(), pay("M03", 120_000), facts(-DAY_MS), 99_999)).toMatchObject({ timing: "EARLY", daysEarly: 1, bonusCents: 0 });
    expect(adjustmentFor(early(), pay("M03", 120_000), facts(-3 * DAY_MS), 99_999)).toMatchObject({ countedEarlyDays: 3, bonusBps: 75, bonusCents: 900 });
    expect(adjustmentFor(early(), pay("M03", 120_000), facts(-10 * DAY_MS), 99_999)).toMatchObject({ bonusBps: 100, bonusCents: 1_200 });
  });
  it("the pool limits the bonus and is never negative", () => {
    const a = adjustmentFor(early(), pay("M03", 120_000), facts(-3 * DAY_MS), 400);
    expect(a).toMatchObject({ bonusWantedCents: 900, bonusCents: 400, limitedByPool: true });
    expect(adjustmentFor(early(), pay("M03", 120_000), facts(-3 * DAY_MS), 0).bonusCents).toBe(0);
    expect(adjustmentFor(early(), pay("M03", 120_000), facts(-3 * DAY_MS), -50).bonusCents).toBe(0);
  });
  it("release split: fee on what is released only (gross − deduction + bonus)", () => {
    expect(releaseSplit(90_000, 450, 0, 250)).toEqual({ releasedCents: 89_550, feeCents: 2_239, netCents: 87_311 }); // 2,238.75 → 2,239
    expect(releaseSplit(120_000, 0, 900, 250)).toEqual({ releasedCents: 120_900, feeCents: 3_022, netCents: 117_878 }); // 3,022.5 → 3,022 (even)
    expect(() => releaseSplit(100, 101, 0, 250)).toThrow(RangeError);
    expect(() => releaseSplit(100, 0.5, 0, 250)).toThrow(TypeError);
  });
  it("the pool is split over tranches by their largest bonus (so a covering pool covers each tranche)", () => {
    const m = [{ idx: 1, amountCents: 300_000, maxBonusCents: 3_000 }, { idx: 2, amountCents: 300_000, maxBonusCents: 1_000 }];
    const a = allocatePool(6_000, m);
    expect(a.get(1)! + a.get(2)!).toBe(6_000);
    expect(a.get(1)).toBeGreaterThanOrEqual(3_000);
    expect(a.get(2)).toBeGreaterThanOrEqual(1_000);
    expect([...allocatePool(1_001, [{ idx: 1, amountCents: 1, maxBonusCents: 0 }, { idx: 2, amountCents: 1, maxBonusCents: 0 }]).values()].reduce((x, y) => x + y)).toBe(1_001);
  });
  it("labels and normalised terms", () => {
    expect(timingLabel({ timing: "LATE", daysLate: 2, daysEarly: 0 })).toBe("2 days late");
    expect(timingLabel({ timing: "EARLY", daysLate: 0, daysEarly: 1 })).toBe("1 day early");
    expect(timingLabel({ timing: "ON_TIME", daysLate: 0, daysEarly: 0 })).toBe("On time");
    expect(normalizeTerms({ late: null, early: null })).toBeNull();
    expect(normalizeTerms(late({ milestones: ["M03", "M02", "M03"] }))?.late?.milestones).toEqual(["M02", "M03"]);
  });
});

describe("F5.01 reconciliation view of the new ledger kinds", () => {
  it("the pool is a contract line funded with the tranche; bonus is internal; deduction and pool return are returns", () => {
    const at = new Date();
    const v = withDeadlineAdjustments({
      tranche: { amountCents: 10_000 },
      milestones: [{ amountCents: 4_000, state: "RELEASED", type: "PAY", active: true }, { amountCents: 6_000, state: "OPEN", type: "PAY", active: true }],
      ledger: [
        { type: "HOLD", amountCents: 10_000, paypalRef: "AUTH", milestoneId: null, at }, { type: "BONUS_POOL", amountCents: 500, paypalRef: "AUTH", milestoneId: null, at },
        { type: "EARLY_BONUS", amountCents: 100, paypalRef: "CAP", milestoneId: "m1", at }, { type: "RELEASE", amountCents: 3_998, paypalRef: "CAP", milestoneId: "m1", at },
        { type: "FEE", amountCents: 102, paypalRef: "CAP", milestoneId: "m1", at }, { type: "LATE_DEDUCTION", amountCents: 20, paypalRef: "recorded:r1", milestoneId: "m2", at },
        { type: "POOL_RETURN", amountCents: 50, paypalRef: "REFUND-9", milestoneId: null, at },
      ],
    }, 500);
    expect(v.tranche.amountCents).toBe(10_500);
    expect(v.ledger.map((e) => e.type)).toEqual(["HOLD", "HOLD", "RELEASE", "FEE", "VOID", "REFUND"]);
    expect(v.milestones.slice(2)).toEqual([{ amountCents: 150, state: "RELEASED", type: "PAY", active: true }, { amountCents: 350, state: "OPEN", type: "PAY", active: true }]);
    const plain = { tranche: { amountCents: 1 }, milestones: [], ledger: [{ type: "HOLD", amountCents: 1, paypalRef: null, milestoneId: null, at }] };
    expect(withDeadlineAdjustments(plain, 0)).toBe(plain);
  });
});

/* ── policy R11 / R12 ── */
const ms = (days: number[], amounts: number[]): PMilestone[] => days.map((d, i) => ({ code: `M0${i + 1}`, type: "PAY", day: d, bps: 0, amountCents: amounts[i], active: true, proof: { artifacts: [{ kind: "PDF", min: 1 }], criteria: ["x"] }, lockRule: "l", disputeRule: "d", dependsOn: [] }));
const ws = (deadline: DeadlineTerms | null, total = 600_000): PWorkspace => {
  const m = ms([6, 11, 17], [180_000, 180_000, 240_000]);
  m.forEach((x, i) => (x.bps = [3000, 3000, 4000][i]));
  return { totalCents: total, rail: "MOCK", milestones: m, clauses: [], providerPayable: true, deadline };
};
const rules = (w: PWorkspace) => checkPolicy(w).filter((v) => v.rule === "R11" || v.rule === "R12").map((v) => v.code);

describe("F2.05 policy rules R11 and R12", () => {
  it("R11 R12: defaults pass; both off adds nothing", () => {
    expect(rules(ws(null))).toEqual([]);
    expect(rules(ws(late()))).toEqual([]);
    expect(rules(ws(early({ poolCents: 6_000 })))).toEqual([]);
  });
  it("R11: cap above 20%, no grace day, cap reached after day 27", () => {
    expect(rules(ws(late({ capBps: 2500 })))).toContain("LATE_CAP_TOO_HIGH");
    expect(rules(ws(late({ graceDays: 0 })))).toContain("NO_GRACE_DAY");
    expect(rules(ws(late({ rateBps: 25, capBps: 1000, graceDays: 1 })))).toContain("LATE_CAP_UNREACHABLE"); // 1 + 40 days
    expect(rules(ws(late({ milestones: ["M09"] })))).toContain("LATE_SCOPE_UNKNOWN");
  });
  it("R12: pool above 15%, pool smaller than the largest bonus, no pool", () => {
    expect(rules(ws(early({ poolCents: 90_001 })))).toContain("POOL_TOO_LARGE");
    expect(rules(ws(early({ poolCents: 90_000 })))).not.toContain("POOL_TOO_LARGE");
    // largest bonus: 1% of each milestone (6, 11 and 17 days are all ≥ 4 days × 25 bps) = 6,000 cents
    expect(maxBonusCents(early(), ms([6, 11, 17], [180_000, 180_000, 240_000]).map((m) => ({ ...m, trancheIdx: 1, maxEarlyDays: m.day })))).toBe(6_000);
    expect(rules(ws(early({ poolCents: 5_999 })))).toContain("POOL_TOO_SMALL");
    expect(rules(ws(early({ poolCents: 0 })))).toContain("POOL_NOT_FUNDED");
  });
  it("red team 17: the published risk formula is what riskScore uses", () => {
    expect(RISK_FORMULA.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1, 10);
    const w = ws(null, 700_000);
    const r = riskScore(w, "new");
    expect(r.score).toBe(Math.round(100 * RISK_FORMULA.reduce((s, f) => s + f.weight * r.parts[f.key], 0)));
  });
});
