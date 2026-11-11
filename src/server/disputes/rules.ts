/**
 * Pure rules, no I/O. F4.01 deadlines and fast track, F4.02 sealed bids and rounds,
 * F4.03 dossier root, F4.05 conflict-of-interest router (180 days), F4.06 two-person threshold, F4.07 split,
 * mediation fee, F4.12 root-cause taxonomy. Routing moved to src/server/mediators/router.ts (scored, explainable).
 */
import { randomBytes } from "node:crypto";
import { sha256 } from "@/lib/ids";
import { HOUR } from "@/lib/clock";
import { converge } from "@/lib/policy";
import { splitDispute, BPS_FULL } from "@/lib/money";
import { legacyCandidate, rankMediators, type CaseHistory } from "../mediators/router";

export const DISPUTABLE_STATES = ["SUBMITTED", "REMEDIATION", "ESCALATED"] as const;
export const MAX_ROUNDS = 3;
/** F4.06: a verdict on more than $5,000 needs a second, different mediator before any money moves. */
export const COSIGN_ABOVE_CENTS = 500_000;
export { COI_DAYS } from "../mediators/router";
/** §6.13 demo default; Finance can set MEDIATION_FEE_CENTS. */
export const mediationFeeCents = () => {
  const n = Number(process.env.MEDIATION_FEE_CENTS ?? 2500);
  return Number.isSafeInteger(n) && n >= 0 ? n : 2500;
};

export const REASONS = {
  QUALITY: "Work does not meet the agreed criteria",
  INCOMPLETE: "Work is incomplete",
  NOT_AS_SPECIFIED: "Delivered something other than what was specified",
  EVIDENCE_DOUBT: "Evidence looks wrong or does not match",
  LATE: "Delivered late",
  MISSED_DEADLINE: "Late-delivery deduction is wrong (provider)",
  UNFAIR_REJECTION: "Rejection is unfair (provider)",
  OTHER: "Other",
} as const;
export type ReasonCode = keyof typeof REASONS;

/** F4.12 root-cause taxonomy, tagged by the mediator (or by the system for Tier 1 agreements). */
export const ROOT_CAUSES = {
  CRITERIA_VAGUE: "Acceptance criteria were vague",
  SCOPE_CHANGE: "Scope changed after signing",
  QUALITY_DEFECT: "Quality defect in the work",
  INCOMPLETE_WORK: "Work left incomplete",
  EVIDENCE_GAP: "Proof spec asked for too little evidence",
  LATE_DELIVERY: "Late delivery",
  CLIENT_DEPENDENCY: "Client input or access was late",
  COMMUNICATION: "Communication breakdown",
  FORCE_MAJEURE: "Force majeure",
  AGREED_TIER1: "Settled by agreement at Tier 1",
} as const;
export type RootCause = keyof typeof ROOT_CAUSES;

export interface Deadlines { tier1Until: Date; vaultUntil: Date; tier3Until: Date; fastTrack: boolean }
/**
 * §6.8: Tier 1 to 48 h, Tier 2 to 96 h, Tier 3 verdict by 144 h. Fast track (24 h per tier) when fewer than 72 h of the
 * tranche's hold window remain (F4.11).
 */
export function deadlines(now: Date, windowEndsAt: Date | null): Deadlines {
  const left = windowEndsAt ? windowEndsAt.getTime() - now.getTime() : Infinity;
  const fastTrack = left < 72 * HOUR;
  const step = fastTrack ? 24 * HOUR : 48 * HOUR;
  const t = now.getTime();
  return { tier1Until: new Date(t + step), vaultUntil: new Date(t + 2 * step), tier3Until: new Date(t + 3 * step), fastTrack };
}

/** Sealed commit: SHA-256 of the value and a random nonce. */
export function sealBid(bps: number, nonce = randomBytes(16).toString("hex")): { commit: string; nonce: string } {
  return { commit: sha256(`${bps}:${nonce}`), nonce };
}
export const verifyCommit = (bps: number, nonce: string, commit: string) => sha256(`${bps}:${nonce}`) === commit;

export interface BidLite { round: number; role: "client" | "provider"; providerShareBps: number }
/** The round now open: the first of 1..3 that does not have both bids; null when all three are complete. */
export function openRound(bids: BidLite[]): number | null {
  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const roles = new Set(bids.filter((b) => b.round === r).map((b) => b.role));
    if (!(roles.has("client") && roles.has("provider"))) return r;
  }
  return null;
}
/** Outcome of a complete round: midpoint when the provider's ask minus the client's offer is at most 5 points. */
export function roundOutcome(bids: BidLite[], round: number): { complete: boolean; settledBps: number | null } {
  const c = bids.find((b) => b.round === round && b.role === "client");
  const p = bids.find((b) => b.round === round && b.role === "provider");
  if (!c || !p) return { complete: false, settledBps: null };
  return { complete: true, settledBps: converge(c.providerShareBps, p.providerShareBps) };
}

export function assertBps(bps: number) {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > BPS_FULL) throw new RangeError("share must be a whole number of basis points from 0 to 10,000");
}

/** F4.07: refund rounds half up toward the client; release is the rest, so the two always add up to the frozen amount. */
export function splitWithFee(amountCents: number, providerShareBps: number, tier: 1 | 3, fault?: "CLIENT" | "PROVIDER" | "SHARED") {
  const s = splitDispute(amountCents, providerShareBps);
  return { ...s, fee: tier === 3 ? feeSplit(mediationFeeCents(), fault) : { basis: "SHARED" as const, totalCents: 0, clientCents: 0, providerCents: 0 } };
}

/** §6.13: the party at fault pays the flat fee; shared fault or force majeure splits it 50/50 (odd cent to the provider). */
export function feeSplit(totalCents: number, fault?: "CLIENT" | "PROVIDER" | "SHARED") {
  if (fault === "CLIENT") return { basis: "CLIENT" as const, totalCents, clientCents: totalCents, providerCents: 0 };
  if (fault === "PROVIDER") return { basis: "PROVIDER" as const, totalCents, clientCents: 0, providerCents: totalCents };
  const clientCents = Math.floor(totalCents / 2);
  return { basis: "SHARED" as const, totalCents, clientCents, providerCents: totalCents - clientCents };
}

/** F4.03: dossier root = SHA-256 over the evidence package roots (attempt order) then the rebuttal hashes (time order). */
export function dossierRoot(evidenceRoots: string[], rebuttalHashes: string[]): string {
  return sha256(["evidence", ...evidenceRoots, "rebuttals", ...rebuttalHashes].join("\n"));
}

export type { CaseHistory } from "../mediators/router";
/** F4.05 conflict of interest (180 days) — lives with the mediator router; re-exported for existing callers. */
export { conflicted } from "../mediators/router";
/**
 * F4.05 legacy pool (an organisation with no mediator network profiles): every mediator is an active generalist, so the
 * router's score ties and the order falls to its tie-break — least recently assigned first (never assigned first),
 * then id. Conflicted mediators and the parties themselves are excluded. Null when nobody is free of conflict.
 */
export function pickMediator(pool: string[], history: CaseHistory[], parties: string[], now: Date): string | null {
  const last = new Map<string, number>();
  for (const h of history) if (h.mediatorId) last.set(h.mediatorId, Math.max(last.get(h.mediatorId) ?? 0, h.at.getTime()));
  const cands = pool.map((id) => legacyCandidate(id, 0, last.has(id) ? new Date(last.get(id)!) : null));
  return rankMediators(cands, { blueprintCode: "", parties: parties.map((id) => ({ id })), history, now }).ranked[0]?.id ?? null;
}

export const fmtHours = (ms: number) => {
  if (ms <= 0) return "passed";
  const h = Math.floor(ms / HOUR), m = Math.floor((ms % HOUR) / 60_000);
  return h >= 48 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${m} min`;
};
