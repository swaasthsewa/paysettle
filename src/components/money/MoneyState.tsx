/** F3.11 Money state chip: one colour per place the money is (held teal, released green, disputed amber, returned slate). */
import "@/styles/money.css";

const MAP: Record<string, { cls: "held" | "released" | "disputed" | "refunded" | "draft"; label: string }> = {
  PLANNED: { cls: "draft", label: "Not funded yet" },
  AWAITING_APPROVAL: { cls: "draft", label: "Waiting for PayPal approval" },
  HELD: { cls: "held", label: "Held in PayPal" },
  PARTIALLY_RELEASED: { cls: "held", label: "Held · partly released" },
  SETTLING: { cls: "held", label: "Settling" },
  ROLLED_OVER: { cls: "refunded", label: "Rolled over" },
  CLOSED: { cls: "released", label: "Closed" },
  BREAKER: { cls: "disputed", label: "Paused by reconciliation" },
  COMPLETED: { cls: "released", label: "Paid" },
  IN_FLIGHT: { cls: "held", label: "Paying" },
  PENDING: { cls: "draft", label: "Pending" },
  FAILED: { cls: "disputed", label: "Failed — will retry" },
  RECORDED: { cls: "refunded", label: "Returned (not captured)" },
  RELEASED: { cls: "released", label: "Released" },
  APPROVED: { cls: "held", label: "Approved" },
  SETTLED_BY_VERDICT: { cls: "released", label: "Settled by verdict" },
  REFUNDED: { cls: "refunded", label: "Returned to client" },
  DISPUTED: { cls: "disputed", label: "Disputed" },
  ESCALATED: { cls: "disputed", label: "Escalated" },
  OPEN: { cls: "held", label: "Open" },
  LOCKED: { cls: "draft", label: "Locked" },
  SUBMITTED: { cls: "held", label: "In review" },
  REMEDIATION: { cls: "disputed", label: "Fix requested" },
  HOLD: { cls: "held", label: "Hold" }, RELEASE: { cls: "released", label: "Release" }, FEE: { cls: "draft", label: "Fee" },
  REFUND: { cls: "refunded", label: "Refund" }, VOID: { cls: "refunded", label: "Void" },
};

export function moneyStateLabel(state: string) { return MAP[state]?.label ?? state.toLowerCase().replace(/_/g, " "); }

export function MoneyState({ state, label }: { state: string; label?: string }) {
  const m = MAP[state] ?? { cls: "draft" as const, label: moneyStateLabel(state) };
  return <span className={`state ${m.cls}`} data-state={state}>{label ?? m.label}</span>;
}
