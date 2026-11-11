import { describe, expect, it } from "vitest";
import { checkPolicy, converge, riskScore, trancheOf, watchdogPlan, type PWorkspace, type PMilestone } from "./policy";
import { splitByBps } from "./money";

const ms = (code: string, day: number, bps: number, type: "PAY" | "GATE" = "PAY"): PMilestone => ({ code, type, day, bps, amountCents: 0, active: true, proof: { artifacts: [{ kind: "PDF", min: 1 }], criteria: ["x"] }, lockRule: "Client approves", disputeRule: "72 h fix", dependsOn: [] });
function ws(list: PMilestone[], total = 600_000): PWorkspace {
  const pay = list.filter((m) => m.type === "PAY");
  const amts = splitByBps(total, pay.map((m) => m.bps));
  pay.forEach((m, i) => (m.amountCents = amts[i]));
  return { totalCents: total, rail: "A1", milestones: list, clauses: [{ category: "SYSTEM", code: "S1", body: "PayPal hold applies", active: true, protective: true }], providerPayable: true };
}

describe("policy gate", () => {
  it("a well-formed contract passes", () => {
    expect(checkPolicy(ws([ms("A", 2, 0, "GATE"), ms("B", 8, 3000), ms("C", 15, 3000), ms("D", 24, 4000)]))).toEqual([]);
  });
  it("R01 sum must be 100%", () => {
    const w = ws([ms("A", 5, 3000), ms("B", 10, 3000), ms("C", 20, 3000)]);
    expect(checkPolicy(w).map((v) => v.code)).toContain("SUM_NOT_100");
  });
  it("R04 front-loading", () => {
    const codes = checkPolicy(ws([ms("A", 1, 6000), ms("B", 10, 2000), ms("C", 20, 2000)])).map((v) => v.code);
    expect(codes).toContain("FRONT_LOADED");
  });
  it("R05 paid milestone needs proof", () => {
    const m = ms("B", 10, 5000); m.proof = { artifacts: [], criteria: [] };
    expect(checkPolicy(ws([ms("A", 5, 2500), m, ms("C", 20, 2500)])).map((v) => v.code)).toContain("MISSING_PROOF_SPEC");
  });
  it("R07 contradiction scanner", () => {
    const w = ws([ms("A", 5, 3000), ms("B", 10, 3000), ms("C", 20, 4000)]);
    w.clauses.push({ category: "CUSTOM", code: "C1", body: "Final 10% paid in cash on the side", active: true, protective: false });
    expect(checkPolicy(w).map((v) => v.code)).toContain("CLAUSE_CONTRADICTION");
  });
  it("tranching splits a 60-day project into three", () => {
    const list = [1, 10, 26, 27, 40, 52, 53, 60].map((d, i) => ms(`M${i}`, d, 0));
    expect(trancheOf(list, "A1")).toEqual([1, 1, 1, 2, 2, 2, 3, 3]);
  });
  it("risk score bands and threshold", () => {
    const w = ws([ms("A", 5, 3000), ms("B", 10, 3000), ms("C", 20, 4000)], 1_500_000);
    expect(riskScore(w, "probation").score).toBeGreaterThan(riskScore(w, "platinum").score);
  });
  it("watchdog differs per rail; blind bids converge within 5 points", () => {
    expect(watchdogPlan("A1")[0].action).toBe("REAUTHORIZE_IF_NEEDED");
    expect(watchdogPlan("B")[0].day).toBe(22);
    expect(converge(7000, 7400)).toBe(7200);
    expect(converge(3000, 8500)).toBeNull();
  });
});
