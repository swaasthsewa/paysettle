/** State machines as data (framework pattern, see REUSE.md). */
export interface Transition<S extends string, E extends string> { from: S | S[]; event: E; to: S }
export class Machine<S extends string, E extends string> {
  constructor(readonly name: string, readonly states: readonly S[], readonly transitions: Transition<S, E>[]) {}
  next(from: S, event: E): S {
    const t = this.transitions.find((x) => x.event === event && (Array.isArray(x.from) ? x.from.includes(from) : x.from === from));
    if (!t) throw new IllegalTransition(this.name, from, event);
    return t.to;
  }
  allows(from: S, event: E) { try { this.next(from, event); return true; } catch { return false; } }
  events(from: S): E[] { return [...new Set(this.transitions.filter((t) => (Array.isArray(t.from) ? t.from.includes(from) : t.from === from)).map((t) => t.event))]; }
}
export class IllegalTransition extends Error {
  constructor(machine: string, from: string, event: string) { super(`${machine}: '${event}' is not allowed from '${from}'`); }
}

export const workspaceMachine = new Machine("workspace",
  ["DRAFT", "READY_TO_SIGN", "PARTIALLY_SIGNED", "SIGNED", "PENDING_OPS", "LOCKED", "ABANDONED"] as const,
  [
    { from: ["DRAFT", "READY_TO_SIGN"], event: "edit", to: "DRAFT" },
    { from: "DRAFT", event: "gate_pass", to: "READY_TO_SIGN" },
    { from: "READY_TO_SIGN", event: "gate_fail", to: "DRAFT" },
    { from: "READY_TO_SIGN", event: "sign", to: "PARTIALLY_SIGNED" },
    { from: "PARTIALLY_SIGNED", event: "edit", to: "DRAFT" },
    { from: "PARTIALLY_SIGNED", event: "countersign", to: "SIGNED" },
    { from: "SIGNED", event: "needs_ops", to: "PENDING_OPS" },
    { from: ["SIGNED", "PENDING_OPS"], event: "clear", to: "LOCKED" },
    { from: "PENDING_OPS", event: "return", to: "DRAFT" },
    { from: ["DRAFT", "READY_TO_SIGN", "PARTIALLY_SIGNED"], event: "abandon", to: "ABANDONED" },
  ]);

export const trancheMachine = new Machine("tranche",
  ["PLANNED", "AWAITING_APPROVAL", "HELD", "PARTIALLY_RELEASED", "ROLLED_OVER", "SETTLING", "CLOSED", "BREAKER"] as const,
  [
    { from: "PLANNED", event: "fund", to: "AWAITING_APPROVAL" },
    { from: "AWAITING_APPROVAL", event: "confirm", to: "HELD" },
    { from: "AWAITING_APPROVAL", event: "expire", to: "PLANNED" },
    { from: ["HELD", "PARTIALLY_RELEASED"], event: "release", to: "PARTIALLY_RELEASED" },
    { from: ["HELD", "PARTIALLY_RELEASED"], event: "rollover", to: "ROLLED_OVER" },
    { from: ["HELD", "PARTIALLY_RELEASED"], event: "settle", to: "SETTLING" },
    { from: ["HELD", "PARTIALLY_RELEASED", "SETTLING", "ROLLED_OVER"], event: "close", to: "CLOSED" },
    { from: ["HELD", "PARTIALLY_RELEASED", "SETTLING"], event: "drift", to: "BREAKER" },
    { from: "BREAKER", event: "clear", to: "PARTIALLY_RELEASED" },
  ]);

export const milestoneMachine = new Machine("milestone",
  ["DRAFT", "LOCKED", "OPEN", "SUBMITTED", "REMEDIATION", "APPROVED", "RELEASED", "DISPUTED", "ESCALATED", "SETTLED_BY_VERDICT", "REFUNDED"] as const,
  [
    { from: "DRAFT", event: "lock", to: "LOCKED" },
    { from: "LOCKED", event: "open", to: "OPEN" },
    { from: ["OPEN", "REMEDIATION"], event: "submit", to: "SUBMITTED" },
    { from: "SUBMITTED", event: "approve", to: "APPROVED" },
    { from: "SUBMITTED", event: "request_fix", to: "REMEDIATION" },
    { from: ["SUBMITTED", "REMEDIATION", "ESCALATED"], event: "dispute", to: "DISPUTED" },
    { from: "SUBMITTED", event: "timeout_escalate", to: "ESCALATED" },
    { from: "SUBMITTED", event: "timeout_deemed", to: "APPROVED" },
    { from: "ESCALATED", event: "approve", to: "APPROVED" },
    { from: "APPROVED", event: "released", to: "RELEASED" },
    { from: "DISPUTED", event: "verdict_executed", to: "SETTLED_BY_VERDICT" },
    { from: ["LOCKED", "OPEN"], event: "refund_unstarted", to: "REFUNDED" },
  ]);

export const disputeMachine = new Machine("dispute",
  ["TIER1", "AGREED", "TIER2", "TIER3", "EXECUTING", "RESOLVED", "SUPERSEDED"] as const,
  [
    { from: "TIER1", event: "converge", to: "AGREED" },
    { from: "TIER1", event: "impasse", to: "TIER2" },
    { from: "TIER2", event: "seal", to: "TIER3" },
    { from: ["AGREED", "TIER3"], event: "execute", to: "EXECUTING" },
    { from: "EXECUTING", event: "done", to: "RESOLVED" },
    { from: ["TIER1", "TIER2", "TIER3"], event: "external_dispute", to: "SUPERSEDED" },
  ]);
