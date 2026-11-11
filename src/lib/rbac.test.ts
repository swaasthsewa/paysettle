import { describe, expect, it } from "vitest";
import { can, canWrite, grant, PERMISSIONS, ROLE_ORDER } from "./rbac";

describe("rbac matrix", () => {
  it("every permission has a grant for every role", () => {
    for (const p of PERMISSIONS) for (const r of ROLE_ORDER) expect(["Y", "R", "own", "case", "agg", "-"]).toContain(grant(r, p));
  });
  it("only clients approve releases; only mediators (and sandbox judges) sign verdicts", () => {
    expect(ROLE_ORDER.filter((r) => canWrite(r, "release.approve"))).toEqual(["client", "judge"]);
    expect(ROLE_ORDER.filter((r) => canWrite(r, "dispute.verdict"))).toEqual(["mediator", "judge"]);
  });
  it("providers cannot fund or approve; finance cannot sign contracts", () => {
    expect(can("provider", "hold.fund")).toBe(false);
    expect(can("provider", "release.approve")).toBe(false);
    expect(can("finance", "contract.sign")).toBe(false);
  });
  it("judge rights vanish in production", () => {
    const prev = process.env.PAYSETTLE_ENV; process.env.PAYSETTLE_ENV = "production";
    expect(can("judge", "sandbox.time_travel")).toBe(false);
    process.env.PAYSETTLE_ENV = prev;
  });
});
