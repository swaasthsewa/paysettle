import { describe, expect, it } from "vitest";
import { disputeMachine, milestoneMachine, trancheMachine, workspaceMachine } from "./fsm";

describe("state machines", () => {
  it("editing after one signature voids it (back to DRAFT)", () => {
    expect(workspaceMachine.next("PARTIALLY_SIGNED", "edit")).toBe("DRAFT");
  });
  it("cannot sign twice from DRAFT", () => { expect(() => workspaceMachine.next("DRAFT", "countersign")).toThrow(); });
  it("released milestones cannot be disputed (release-final)", () => {
    expect(milestoneMachine.allows("RELEASED", "dispute")).toBe(false);
  });
  it("happy path milestone", () => {
    let s: Parameters<typeof milestoneMachine.next>[0] = "DRAFT";
    for (const e of ["lock", "open", "submit", "approve", "released"] as const) s = milestoneMachine.next(s, e);
    expect(s).toBe("RELEASED");
  });
  it("tranche breaker only from live states", () => {
    expect(trancheMachine.allows("PLANNED", "drift")).toBe(false);
    expect(trancheMachine.next("HELD", "drift")).toBe("BREAKER");
  });
  it("dispute converges or escalates", () => {
    expect(disputeMachine.next("TIER1", "converge")).toBe("AGREED");
    expect(disputeMachine.next(disputeMachine.next("TIER1", "impasse"), "seal")).toBe("TIER3");
  });
  it("every transition target is a declared state", () => {
    for (const m of [workspaceMachine, trancheMachine, milestoneMachine, disputeMachine] as const)
      for (const t of m.transitions) expect((m.states as readonly string[]).includes(t.to)).toBe(true);
  });
});
