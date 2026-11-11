/** F2.03 F2.10 F2.11 — state chips for contracts, milestones and tranches, plus small shared labels. */
import "@/styles/contracts.css";

const WS: Record<string, { b: string; label: string }> = {
  DRAFT: { b: "plain", label: "Draft" },
  READY_TO_SIGN: { b: "ok", label: "Ready to sign" },
  PARTIALLY_SIGNED: { b: "warn", label: "Signed by one party" },
  SIGNED: { b: "ok", label: "Signed by both" },
  PENDING_OPS: { b: "risk", label: "With Operations" },
  LOCKED: { b: "grad", label: "Locked" },
  ABANDONED: { b: "none", label: "Abandoned" },
};
export const wsStateLabel = (s: string) => WS[s]?.label ?? s;
export function WsChip({ state }: { state: string }) {
  const m = WS[state] ?? { b: "plain", label: state };
  return <span className="chip" data-b={m.b}>{m.label}</span>;
}

const MS: Record<string, { b: string; label: string }> = {
  DRAFT: { b: "plain", label: "Draft" }, LOCKED: { b: "plain", label: "Waiting" }, OPEN: { b: "ok", label: "Open" },
  SUBMITTED: { b: "warn", label: "Submitted" }, REMEDIATION: { b: "warn", label: "Fix requested" }, APPROVED: { b: "ok", label: "Approved" },
  RELEASED: { b: "grad", label: "Released" }, DISPUTED: { b: "danger", label: "Disputed" }, ESCALATED: { b: "risk", label: "Escalated" },
  SETTLED_BY_VERDICT: { b: "plain", label: "Settled by verdict" }, REFUNDED: { b: "plain", label: "Returned to client" },
};
export function MsChip({ state }: { state: string }) {
  const m = MS[state] ?? { b: "plain", label: state };
  return <span className="chip" data-b={m.b}>{m.label}</span>;
}

/** Tranche money state uses the fixed money colours (held teal, released green, disputed amber, refunded slate). */
const TR: Record<string, { cls: string; label: string }> = {
  PLANNED: { cls: "draft", label: "Planned — not funded" }, AWAITING_APPROVAL: { cls: "draft", label: "Waiting for PayPal approval" },
  HELD: { cls: "held", label: "Held in PayPal" }, PARTIALLY_RELEASED: { cls: "released", label: "Partly released" },
  ROLLED_OVER: { cls: "refunded", label: "Rolled over" }, SETTLING: { cls: "held", label: "Settling" },
  CLOSED: { cls: "released", label: "Closed" }, BREAKER: { cls: "disputed", label: "Paused for checks" },
};
export function TrancheChip({ state }: { state: string }) {
  const m = TR[state] ?? { cls: "draft", label: state };
  return <span className={`state ${m.cls}`}>{m.label}</span>;
}

export const railLabel = (r: string) => ({ A1: "PayPal hold (A1)", A2: "PayPal platform hold (A2)", B: "PayPal delayed disbursement (B)", MOCK: "Simulated PayPal (mock)" })[r] ?? r;
export const kindLabel = (k: string) => ({ DIGITAL: "Digital", PHYSICAL_SHOP: "Physical (shop)", PHYSICAL_SITE: "Physical (site)", HYBRID: "Hybrid" })[k] ?? k;
export const artifactLabel = (k: string) => ({ IMAGE: "photo", VIDEO: "video", PDF: "PDF", LOG: "log", LINK: "link", SIGNATURE: "signature", ORACLE: "oracle check" })[k] ?? k.toLowerCase();
