/**
 * PaySettle data model Money is integer cents; shares are basis points (10,000 = 100%).
 * Immutable tables (revisions, signatures, releases once completed, verdicts, audit_chain) are protected by triggers
 * created in src/db/sql/guards.sql. Every business table carries org_id for row-level security.
 */
import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, index,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const cents = (name: string) => bigint(name, { mode: "number" });

export const ROLES = ["client", "provider", "admin", "ops", "mediator", "finance", "judge", "marketing"] as const;
export type Role = (typeof ROLES)[number];

/* ── identity (Phase 1) ── */
export const orgs = pgTable("orgs", { id: id(), name: text("name").notNull(), demo: boolean("demo").notNull().default(false), createdAt: created() });

export const users = pgTable("users", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").$type<Role>().notNull(),
  passwordHash: text("password_hash"),
  mfaSecret: text("mfa_secret"),
  mfaLastStep: integer("mfa_last_step").notNull().default(0),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  persona: text("persona"),
  tier: text("tier").$type<"platinum" | "standard" | "new" | "probation">().notNull().default("new"),
  onboardingState: text("onboarding_state").notNull().default("PENDING"),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
}, (t) => [uniqueIndex("users_email").on(t.email)]);

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  mfa: boolean("mfa").notNull().default(false),
  demo: boolean("demo").notNull().default(false),
  createdAt: created(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
});

export const recoveryCodes = pgTable("recovery_codes", {
  userId: text("user_id").notNull().references(() => users.id),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.userId, t.codeHash] })]);

export const paypalLinks = pgTable("paypal_links", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id),
  kind: text("kind").$type<"buyer" | "merchant">().notNull(),
  email: text("email"),
  payerId: text("payer_id"),
  merchantId: text("merchant_id"),
  receivable: boolean("receivable").notNull().default(false),
  emailConfirmed: boolean("email_confirmed").notNull().default(false),
  createdAt: created(),
});

/* ── blueprints and negotiation (Phase 2) ── */
export const blueprints = pgTable("blueprints", {
  code: text("code").primaryKey(),
  title: text("title").notNull(),
  vertical: text("vertical").notNull(),
  kind: text("kind").$type<"DIGITAL" | "PHYSICAL_SHOP" | "PHYSICAL_SITE" | "HYBRID">().notNull(),
  summary: text("summary").notNull(),
  recommendedDays: integer("recommended_days").notNull(),
  milestones: jsonb("milestones").$type<BlueprintMilestone[]>().notNull(),
  clauses: jsonb("clauses").$type<BlueprintClause[]>().notNull(),
  version: text("version").notNull().default("1.0.0"),
  active: boolean("active").notNull().default(true),
  depth: text("depth").$type<"full" | "outline">().notNull().default("full"),
});

export interface ProofSpec { artifacts: { kind: "IMAGE" | "VIDEO" | "PDF" | "LOG" | "LINK" | "SIGNATURE" | "ORACLE"; min: number; note?: string }[]; gpsRadiusM?: number; oracle?: string; criteria: string[] }
export interface BlueprintMilestone { code: string; title: string; type: "GATE" | "PAY"; day: number; bps: number; proof: ProofSpec; lockRule: string; disputeRule: string; dependsOn?: string[] }
export interface BlueprintClause { code: string; category: "SYSTEM" | "BASELINE"; title: string; body: string; protective?: boolean }

export const workspaces = pgTable("workspaces", {
  id: id(),
  orgId: text("org_id").notNull().references(() => orgs.id),
  blueprintCode: text("blueprint_code").notNull().references(() => blueprints.code),
  title: text("title").notNull(),
  clientId: text("client_id").notNull().references(() => users.id),
  providerId: text("provider_id").references(() => users.id),
  inviteEmail: text("invite_email"),
  currency: text("currency").notNull().default("USD"),
  totalCents: cents("total_cents").notNull(),
  feeBps: integer("fee_bps").notNull().default(250),
  rail: text("rail").$type<"A1" | "A2" | "B" | "MOCK">().notNull().default("MOCK"),
  state: text("state").notNull().default("DRAFT"),
  revision: integer("revision").notNull().default(1),
  riskScore: integer("risk_score").notNull().default(0),
  canonicalHash: text("canonical_hash"),
  reviewTimeoutRule: text("review_timeout_rule").$type<"ESCALATE" | "DEEMED_APPROVED">().notNull().default("ESCALATE"),
  /** Deadline terms (late deduction, early-finish bonus); null = both off. Part of the canonical hash when set. */
  deadlineTerms: jsonb("deadline_terms").$type<import("@/lib/deadline").DeadlineTerms>(),
  /** Continuation contracts (next period of a retainer, month 2 of a build): the contract this one continues, and its period number (1 = first). */
  parentWorkspaceId: text("parent_workspace_id"),
  periodNo: integer("period_no").notNull().default(1),
  createdAt: created(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const revisions = pgTable("revisions", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  revNo: integer("rev_no").notNull(),
  hash: text("hash").notNull(),
  canonical: jsonb("canonical").notNull(),
  authorId: text("author_id").notNull(),
  change: jsonb("change").$type<{ action: string; target?: string; detail?: unknown }>().notNull(),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.revNo] })]);

export const wsMilestones = pgTable("ws_milestones", {
  id: id(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  seq: integer("seq").notNull(),
  code: text("code").notNull(),
  origin: text("origin").$type<"BASELINE" | "CUSTOM">().notNull(),
  active: boolean("active").notNull().default(true),
  prunedBy: text("pruned_by"),
  type: text("type").$type<"GATE" | "PAY">().notNull(),
  title: text("title").notNull(),
  targetDay: integer("target_day").notNull(),
  bps: integer("bps").notNull(),
  amountCents: cents("amount_cents").notNull().default(0),
  proof: jsonb("proof").$type<ProofSpec>().notNull(),
  lockRule: text("lock_rule").notNull(),
  disputeRule: text("dispute_rule").notNull(),
  dependsOn: jsonb("depends_on").$type<string[]>().notNull().default([]),
  trancheIdx: integer("tranche_idx").notNull().default(1),
  state: text("state").notNull().default("DRAFT"),
  attempts: integer("attempts").notNull().default(0),
  reviewDueAt: timestamp("review_due_at", { withTimezone: true }),
  /** Continuation contracts: the parent milestone this one was moved from (the parent removes it by a change order). */
  carriedFrom: text("carried_from"),
}, (t) => [index("ws_ms_ws").on(t.workspaceId, t.seq)]);

export const wsClauses = pgTable("ws_clauses", {
  id: id(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  category: text("category").$type<"SYSTEM" | "BASELINE" | "CUSTOM">().notNull(),
  code: text("code").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  active: boolean("active").notNull().default(true),
  protective: boolean("protective").notNull().default(false),
  linkedMilestone: text("linked_milestone"),
  byUser: text("by_user"),
}, (t) => [check("system_clause_active", sql`NOT (${t.category} = 'SYSTEM' AND ${t.active} = false)`)]);

export const signatures = pgTable("signatures", {
  id: id(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  revNo: integer("rev_no").notNull(),
  hash: text("hash").notNull(),
  signerId: text("signer_id").notNull().references(() => users.id),
  role: text("role").$type<"client" | "provider">().notNull(),
  signature: text("signature").notNull(),
  mfa: boolean("mfa").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  voidedAtRev: integer("voided_at_rev"),
  createdAt: created(),
});

/* ── funding, evidence, release (Phase 3) ── */
export const tranches = pgTable("tranches", {
  id: id(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  idx: integer("idx").notNull(),
  rail: text("rail").$type<"A1" | "A2" | "B" | "MOCK">().notNull(),
  amountCents: cents("amount_cents").notNull(),
  startDay: integer("start_day").notNull(),
  endDay: integer("end_day").notNull(),
  state: text("state").notNull().default("PLANNED"),
  paypalOrderId: text("paypal_order_id"),
  authorizationId: text("authorization_id"),
  captureId: text("capture_id"),
  approveUrl: text("approve_url"),
  heldAt: timestamp("held_at", { withTimezone: true }),
  windowEndsAt: timestamp("window_ends_at", { withTimezone: true }),
  reauthorized: boolean("reauthorized").notNull().default(false),
  warned: jsonb("warned").$type<string[]>().notNull().default([]),
  /** Early-finish bonus pool funded with this tranche (authorized together with amountCents; unused part returned at close). */
  bonusPoolCents: cents("bonus_pool_cents").notNull().default(0),
  /** Cents that signed change orders took out of this hold and returned to the client (contract plane of reconciliation). */
  amendedOutCents: cents("amended_out_cents").notNull().default(0),
}, (t) => [uniqueIndex("tranche_ws_idx").on(t.workspaceId, t.idx)]);

export const evidencePackages = pgTable("evidence_packages", {
  id: id(),
  milestoneId: text("milestone_id").notNull().references(() => wsMilestones.id),
  attempt: integer("attempt").notNull(),
  rootHash: text("root_hash").notNull(),
  files: jsonb("files").$type<{ name: string; kind: string; size: number; sha256: string; url?: string; exif?: Record<string, unknown> }[]>().notNull(),
  signals: jsonb("signals").$type<{ code: string; level: "ok" | "warn" | "fail"; detail: string }[]>().notNull().default([]),
  verifier: jsonb("verifier").$type<Record<string, unknown>>(),
  note: text("note"),
  state: text("state").notNull().default("SUBMITTED"),
  submittedBy: text("submitted_by").notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("evidence_attempt").on(t.milestoneId, t.attempt)]);

export const releases = pgTable("releases", {
  id: id(),
  milestoneId: text("milestone_id").notNull().references(() => wsMilestones.id),
  trancheId: text("tranche_id").notNull().references(() => tranches.id),
  idemKey: text("idem_key").notNull(),
  kind: text("kind").$type<"MILESTONE" | "VERDICT">().notNull().default("MILESTONE"),
  grossCents: cents("gross_cents").notNull(),
  feeCents: cents("fee_cents").notNull(),
  netCents: cents("net_cents").notNull(),
  paypalRef: text("paypal_ref"),
  status: text("status").$type<"PENDING" | "IN_FLIGHT" | "COMPLETED" | "FAILED">().notNull().default("PENDING"),
  approvedBy: text("approved_by").notNull(),
  approvalSig: text("approval_sig").notNull(),
  createdAt: created(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("release_idem").on(t.idemKey), uniqueIndex("release_once").on(t.milestoneId, t.kind)]);

export const refunds = pgTable("refunds", {
  id: id(),
  trancheId: text("tranche_id").notNull().references(() => tranches.id),
  idemKey: text("idem_key").notNull(),
  amountCents: cents("amount_cents").notNull(),
  reason: text("reason").notNull(),
  paypalRef: text("paypal_ref"),
  status: text("status").notNull().default("PENDING"),
  createdAt: created(),
}, (t) => [uniqueIndex("refund_idem").on(t.idemKey)]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: serial("id").primaryKey(),
  trancheId: text("tranche_id").notNull().references(() => tranches.id),
  milestoneId: text("milestone_id"),
  /** Adds LATE_DEDUCTION, EARLY_BONUS, BONUS_POOL (pool funded with the hold) and POOL_RETURN (unused pool back). */
  type: text("type").$type<"HOLD" | "RELEASE" | "FEE" | "REFUND" | "VOID" | "LATE_DEDUCTION" | "EARLY_BONUS" | "BONUS_POOL" | "POOL_RETURN">().notNull(),
  debit: text("debit").notNull(),
  credit: text("credit").notNull(),
  amountCents: cents("amount_cents").notNull(),
  paypalRef: text("paypal_ref"),
  at: created(),
});

/* ── disputes (Phase 4) ── */
export const disputes = pgTable("disputes", {
  id: id(),
  milestoneId: text("milestone_id").notNull().references(() => wsMilestones.id),
  openedBy: text("opened_by").notNull(),
  reason: text("reason").notNull(),
  narrative: text("narrative").notNull(),
  amountCents: cents("amount_cents").notNull(),
  tier: integer("tier").notNull().default(1),
  state: text("state").notNull().default("TIER1"),
  tier1Until: timestamp("tier1_until", { withTimezone: true }).notNull(),
  vaultUntil: timestamp("vault_until", { withTimezone: true }).notNull(),
  mediatorId: text("mediator_id"),
  cosignerId: text("cosigner_id"),
  dossierRoot: text("dossier_root"),
  aiProposal: jsonb("ai_proposal").$type<Record<string, unknown>>(),
  createdAt: created(),
}, (t) => [uniqueIndex("dispute_ms").on(t.milestoneId)]);

export const bids = pgTable("bids", {
  id: id(),
  disputeId: text("dispute_id").notNull().references(() => disputes.id),
  round: integer("round").notNull(),
  role: text("role").$type<"client" | "provider">().notNull(),
  commit: text("commit").notNull(),
  providerShareBps: integer("provider_share_bps").notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("bid_once").on(t.disputeId, t.round, t.role)]);

export const rebuttals = pgTable("rebuttals", {
  id: id(),
  disputeId: text("dispute_id").notNull().references(() => disputes.id),
  byUser: text("by_user").notNull(),
  role: text("role").notNull(),
  kind: text("kind").notNull(),
  sha256: text("sha256").notNull(),
  narrative: text("narrative").notNull(),
  annotations: jsonb("annotations").$type<{ fileSha: string; box: [number, number, number, number]; clause?: string; comment: string }[]>().notNull().default([]),
  createdAt: created(),
});

export const verdicts = pgTable("verdicts", {
  id: id(),
  disputeId: text("dispute_id").notNull().references(() => disputes.id),
  origin: text("origin").$type<"TIER1" | "TIER3">().notNull(),
  mediatorId: text("mediator_id"),
  cosignerId: text("cosigner_id"),
  providerShareBps: integer("provider_share_bps").notNull(),
  refundCents: cents("refund_cents").notNull(),
  releaseCents: cents("release_cents").notNull(),
  findings: text("findings").notNull(),
  rootCause: text("root_cause").notNull(),
  disposition: text("disposition").$type<"RESUME" | "TERMINATE">().notNull(),
  fault: text("fault").$type<"CLIENT" | "PROVIDER" | "SHARED">(),
  leg1: text("leg1").notNull().default("PENDING"),
  leg2: text("leg2").notNull().default("PENDING"),
  signature: text("signature").notNull(),
  createdAt: created(),
}, (t) => [uniqueIndex("verdict_once").on(t.disputeId)]);

/* ── control plane (Phase 5) ── */
export const webhookEvents = pgTable("webhook_events", {
  transmissionId: text("transmission_id").primaryKey(),
  type: text("type").notNull(),
  resourceId: text("resource_id"),
  verified: boolean("verified").notNull(),
  payload: jsonb("payload").notNull(),
  state: text("state").$type<"RECEIVED" | "PROCESSED" | "DUPLICATE" | "QUARANTINED" | "DEAD">().notNull().default("RECEIVED"),
  error: text("error"),
  receivedAt: created(),
});

export const reconRuns = pgTable("recon_runs", {
  id: id(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  matched: integer("matched").notNull().default(0),
  inFlight: integer("in_flight").notNull().default(0),
  exceptions: jsonb("exceptions").$type<{ trancheId: string; plane: string; expected: number; actual: number; note: string }[]>().notNull().default([]),
  verdict: text("verdict").$type<"CLEAN" | "IN_FLIGHT" | "DRIFT">().notNull(),
  createdAt: created(),
});

export const dualControl = pgTable("dual_control", {
  id: id(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  payload: jsonb("payload").notNull(),
  reason: text("reason").notNull(),
  initiatorId: text("initiator_id").notNull(),
  approverId: text("approver_id"),
  state: text("state").$type<"AWAITING" | "EXECUTED" | "VETOED" | "EXPIRED">().notNull().default("AWAITING"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: created(),
}, (t) => [check("four_eyes", sql`${t.approverId} IS NULL OR ${t.approverId} <> ${t.initiatorId}`)]);

export const auditChain = pgTable("audit_chain", {
  seq: serial("seq").primaryKey(),
  actorId: text("actor_id"),
  actorRole: text("actor_role"),
  action: text("action").notNull(),
  target: text("target").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  requestId: text("request_id"),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  at: created(),
});

export const aiCalls = pgTable("ai_calls", {
  id: id(),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
  inputHash: text("input_hash").notNull(),
  output: jsonb("output"),
  ok: boolean("ok").notNull(),
  latencyMs: integer("latency_ms").notNull().default(0),
  createdAt: created(),
});

export const simSessions = pgTable("sim_sessions", {
  id: id(),
  judgeId: text("judge_id"),
  scenario: text("scenario").notNull(),
  workspaceId: text("workspace_id"),
  clockOffsetHours: integer("clock_offset_hours").notNull().default(0),
  mode: text("mode").$type<"LIVE" | "MOCK">().notNull().default("MOCK"),
  faults: jsonb("faults").$type<string[]>().notNull().default([]),
  createdAt: created(),
});

export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  note: text("note"),
  createdAt: created(),
}, (t) => [uniqueIndex("waitlist_email").on(t.email)]);

export const flags = pgTable("flags", { key: text("key").primaryKey(), on: boolean("on").notNull(), note: text("note"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`) });
