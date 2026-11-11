/**
 * Cross-module service contract. Modules implement these signatures in src/server/<module>/index.ts and
 * call each other ONLY through these exports. Changing a signature changes the contract for every caller.
 */
import type { Role } from "@/db/schema";
export interface Actor { id: string; role: Role; name?: string; requestId?: string }
export class NotBuilt extends Error { constructor(what: string) { super(`${what} is not built yet`); } }
export class DomainError extends Error { constructor(readonly code: string, message: string) { super(message); } }

export interface WorkspaceView {
  id: string; title: string; blueprintCode: string; state: string; revision: number; rail: string; currency: string;
  totalCents: number; feeBps: number; riskScore: number; canonicalHash: string | null;
  client: { id: string; name: string }; provider: { id: string; name: string } | null; inviteEmail: string | null;
  milestones: { id: string; seq: number; code: string; title: string; type: "GATE" | "PAY"; origin: "BASELINE" | "CUSTOM"; active: boolean; targetDay: number; bps: number; amountCents: number; proof: import("@/db/schema").ProofSpec; lockRule: string; disputeRule: string; dependsOn: string[]; trancheIdx: number; state: string; attempts: number; reviewDueAt: Date | null }[];
  clauses: { id: string; category: "SYSTEM" | "BASELINE" | "CUSTOM"; code: string; title: string; body: string; active: boolean; protective: boolean }[];
  tranches: { id: string; idx: number; rail: string; amountCents: number; startDay: number; endDay: number; state: string; approveUrl: string | null; heldAt: Date | null; windowEndsAt: Date | null }[];
  signatures: { role: "client" | "provider"; signerId: string; revNo: number; voided: boolean; at: Date }[];
  violations: { rule: string; code: string; message: string; target?: string }[];
  /** Deadline terms in force for this revision (null when both are off). */
  deadline?: import("@/lib/deadline").DeadlineTerms | null;
  /** Bonus pool funded with each tranche, by tranche id (0 when there is no pool). */
  bonusPools?: Record<string, number>;
}
export type Change =
  | { action: "PRUNE" | "RESTORE"; milestoneCode: string }
  | { action: "APPEND"; milestone: { title: string; type: "GATE" | "PAY"; day: number; bps: number; proof: import("@/db/schema").ProofSpec; lockRule: string; disputeRule: string; afterCode?: string } }
  | { action: "SET_BPS"; shares: Record<string, number> }
  | { action: "SET_DAY"; milestoneCode: string; day: number }
  | { action: "TOGGLE_CLAUSE"; clauseCode: string; active: boolean }
  | { action: "APPEND_CLAUSE"; title: string; body: string; linkedMilestone?: string }
  | { action: "SET_TOTAL"; totalCents: number }
  /** Switch the late deduction / early bonus on or off, or change their parameters (null = both off). */
  | { action: "SET_DEADLINE_TERMS"; terms: import("@/lib/deadline").DeadlineTerms | null };
