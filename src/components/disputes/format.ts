/** Shared labels and formatting for dispute screens. F4.01–F4.12. Client-safe (no server imports). */
import { formatCents } from "@/lib/money";

export const money = (c: number, cur = "USD") => formatCents(c, cur);
export const pctOf = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
const DTF = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
export const when = (d: Date | string | null | undefined) => (d ? `${DTF.format(new Date(d))} UTC` : "—");

export function left(now: Date, at: Date): string {
  const ms = new Date(at).getTime() - new Date(now).getTime();
  if (ms <= 0) return "passed";
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 48 ? `${Math.floor(h / 24)} d ${h % 24} h left` : `${h} h ${m} min left`;
}

export const DISPUTE_STATE: Record<string, { label: string; chip: string }> = {
  TIER1: { label: "Tier 1 · sealed offers", chip: "warn" },
  AGREED: { label: "Agreed at Tier 1", chip: "ok" },
  TIER2: { label: "Tier 2 · evidence vault", chip: "warn" },
  TIER3: { label: "Tier 3 · with a mediator", chip: "risk" },
  EXECUTING: { label: "Settling", chip: "plain" },
  RESOLVED: { label: "Resolved", chip: "ok" },
  SUPERSEDED: { label: "Taken over by a PayPal dispute", chip: "danger" },
};
export const disputeState = (s: string) => DISPUTE_STATE[s] ?? { label: s, chip: "plain" };

/** Money-state class for a milestone (globals.css .state.*). */
export function msClass(state: string): string {
  if (state === "RELEASED" || state === "SETTLED_BY_VERDICT") return "released";
  if (state === "DISPUTED") return "disputed";
  if (state === "REFUNDED") return "refunded";
  if (state === "DRAFT") return "draft";
  return "held";
}
export const MS_LABEL: Record<string, string> = {
  DRAFT: "Draft", LOCKED: "Locked", OPEN: "In progress", SUBMITTED: "Proof submitted", REMEDIATION: "Being fixed", APPROVED: "Approved",
  RELEASED: "Paid", DISPUTED: "Frozen — in dispute", ESCALATED: "With Ops", SETTLED_BY_VERDICT: "Settled by verdict", REFUNDED: "Returned to client",
};
export const LEG_LABEL: Record<string, string> = { PENDING: "Waiting", IN_FLIGHT: "Sending", DONE: "Done", FAILED: "Stopped — will retry", SKIPPED: "Not needed (zero)" };
export const legChip = (s: string) => (s === "DONE" ? "ok" : s === "FAILED" ? "danger" : s === "SKIPPED" ? "plain" : "warn");

export const EVENT_LABEL: Record<string, string> = {
  "dispute.open": "Dispute opened — milestone frozen", "dispute.bid": "Sealed offer made", "dispute.agreed": "Offers met — agreed",
  "dispute.impasse": "No agreement after 3 rounds", "dispute.tier1_timeout": "Tier 1 time ran out", "dispute.skip_to_vault": "Moved on to the vault",
  "dispute.rebuttal": "Added to the vault", "dispute.vault_lock": "Side of the vault locked", "dispute.seal": "Vault sealed, case offered to a mediator",
  "dispute.extension": "Late evidence allowed", "dispute.dossier_amended": "Dossier amended with late evidence", "dispute.verdict": "Verdict signed",
  "dispute.cosign": "Verdict co-signed", "dispute.execute": "Settlement started", "dispute.leg1_done": "Leg 1 — refund done", "dispute.leg1_failed": "Leg 1 — refund stopped",
  "dispute.leg2_done": "Leg 2 — release done", "dispute.leg2_failed": "Leg 2 — release stopped", "dispute.terminated": "Unstarted milestones returned",
  "dispute.terminate_failed": "Returning unstarted milestones stopped", "dispute.resolved": "Resolved", "dispute.superseded": "PayPal dispute took over",
  "mediator.offer": "Case offered to a mediator", "mediator.offer_accepted": "Mediator accepted the case", "mediator.offer_declined": "Mediator declined the case",
  "mediator.offer_expired": "Offer ran out of time", "mediator.ops_queue": "Sent to the Ops lead for assignment", "mediator.cosign_required": "Second signature required",
  "mediator.second_review_flagged": "Picked for a random second review", "mediator.second_review": "Second review recorded", "mediator.review": "A party rated the mediator",
  "mediator.fee_accrued": "Mediator fee recorded (paid by PaySettle)",
};
