// F1 overviews · tests: where the money is for one tranche, and the plain stage of a contract.
import { describe, expect, it } from "vitest";
import { addMoney, contractStage, trancheMoney, zero } from "./money-view";

describe("F1 overview money view", () => {
  it("F1 an unfunded tranche of a sealed contract is waiting; of a draft, nothing", () => {
    expect(trancheMoney({ amountCents: 600_000, state: "PLANNED" }, { releasedGross: 0, refunded: 0, voided: 0 }, true)).toEqual({ ...zero(), waitingCents: 600_000 });
    expect(trancheMoney({ amountCents: 600_000, state: "AWAITING_APPROVAL" }, { releasedGross: 0, refunded: 0, voided: 0 }, false)).toEqual(zero());
  });
  it("F1 held = funded − released gross − returned", () => {
    expect(trancheMoney({ amountCents: 600_000, state: "PARTIALLY_RELEASED" }, { releasedGross: 210_000, refunded: 0, voided: 0 }, true))
      .toEqual({ heldCents: 390_000, releasedCents: 210_000, returnedCents: 0, waitingCents: 0 });
  });
  it("F1 a closed tranche holds nothing; refunds and voids read as returned", () => {
    expect(trancheMoney({ amountCents: 500_000, state: "CLOSED" }, { releasedGross: 450_000, refunded: 0, voided: 50_000 }, true))
      .toEqual({ heldCents: 0, releasedCents: 450_000, returnedCents: 50_000, waitingCents: 0 });
    expect(addMoney({ heldCents: 1, releasedCents: 2, returnedCents: 3, waitingCents: 4 }, { heldCents: 10, releasedCents: 20, returnedCents: 30, waitingCents: 40 })).toEqual({ heldCents: 11, releasedCents: 22, returnedCents: 33, waitingCents: 44 });
  });
  it("F1 contract stage: live, waiting for funding, completed, negotiating", () => {
    expect(contractStage("LOCKED", ["HELD", "PLANNED"]).key).toBe("LIVE");
    expect(contractStage("LOCKED", ["PLANNED"]).key).toBe("SEALED");
    expect(contractStage("LOCKED", ["CLOSED", "CLOSED"]).key).toBe("DONE");
    expect(contractStage("DRAFT", []).label).toBe("Negotiating");
  });
});
