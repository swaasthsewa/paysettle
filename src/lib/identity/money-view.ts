// F1 role overviews · the pure money view of one tranche and the plain stage of one contract (see overview.ts).
// Integer cents only (P6).
export const UNFUNDED = new Set(["PLANNED", "AWAITING_APPROVAL"]);
export const OPEN_DISPUTE = new Set(["TIER1", "TIER2", "TIER3", "AGREED", "EXECUTING"]);

export interface Money { heldCents: number; releasedCents: number; returnedCents: number; waitingCents: number }
export const zero = (): Money => ({ heldCents: 0, releasedCents: 0, returnedCents: 0, waitingCents: 0 });

export function trancheMoney(
  t: { amountCents: number; state: string },
  movedOut: { releasedGross: number; refunded: number; voided: number },
  contractSealed: boolean,
): Money {
  if (UNFUNDED.has(t.state)) return { ...zero(), waitingCents: contractSealed ? t.amountCents : 0 };
  const returned = movedOut.refunded + movedOut.voided;
  const held = t.state === "CLOSED" ? 0 : Math.max(0, t.amountCents - movedOut.releasedGross - returned);
  return { heldCents: held, releasedCents: movedOut.releasedGross, returnedCents: returned, waitingCents: 0 };
}
export const addMoney = (a: Money, b: Money): Money => ({ heldCents: a.heldCents + b.heldCents, releasedCents: a.releasedCents + b.releasedCents, returnedCents: a.returnedCents + b.returnedCents, waitingCents: a.waitingCents + b.waitingCents });

/** A plain label for a contract's stage. A sealed contract whose tranches are all closed reads as completed. */
export function contractStage(state: string, trancheStates: string[]): { key: string; label: string } {
  if (state === "LOCKED") {
    if (trancheStates.length && trancheStates.every((s) => s === "CLOSED")) return { key: "DONE", label: "Completed" };
    if (trancheStates.some((s) => !UNFUNDED.has(s) && s !== "CLOSED")) return { key: "LIVE", label: "Live: money held in PayPal" };
    return { key: "SEALED", label: "Signed: waiting for funding" };
  }
  return ({
    DRAFT: { key: "DRAFT", label: "Negotiating" }, READY_TO_SIGN: { key: "SIGN", label: "Ready to sign" }, PARTIALLY_SIGNED: { key: "SIGN", label: "Waiting for a signature" },
    SIGNED: { key: "SIGN", label: "Signed" }, PENDING_OPS: { key: "OPS", label: "With Ops for clearance" }, ABANDONED: { key: "ABANDONED", label: "Abandoned" },
  } as Record<string, { key: string; label: string }>)[state] ?? { key: state, label: state };
}
export const STAGE_ORDER = ["LIVE", "SEALED", "SIGN", "OPS", "DRAFT", "DONE", "ABANDONED"];

