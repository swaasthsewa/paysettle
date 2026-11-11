/**
 * Mediator network tables (F4.05 F4.06 F4.07), additive only.
 *  - mediator_profiles: one row per mediator user (status ladder, domains = blueprint codes or domain keys, languages, firm).
 *  - mediator_credentials: licences and accreditations; only the SHA-256 of the file is kept here (bytes in the evidence store).
 *  - mediator_availability: weekly hours, leave window, pause switch.
 *  - mediator_offers: every routing offer with the stored score breakdown ("why this mediator").
 *  - mediator_case_flags: per dispute — co-sign reasons, offer misses, Ops lead queue, the random 5% second review.
 *  - mediator_reviews: ratings by the parties, only after settlement.
 *  - mediator_fees: what PaySettle pays the mediator from its own fee income — never from the held money (P1).
 *  - mediator_applications: the public application form (untrusted input, P11).
 *  - mediator_calibrations: answers to the sealed calibration cases (write-once per attempt).
 */
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { disputes, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const now = (name: string) => ts(name).notNull().defaultNow();

export const MEDIATOR_STATUSES = ["APPLIED", "VERIFYING", "CALIBRATING", "PROBATION", "ACTIVE", "SENIOR", "PAUSED", "REMOVED"] as const;
export type MediatorStatus = (typeof MEDIATOR_STATUSES)[number];

export const mediatorProfiles = pgTable("mediator_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id),
  orgId: text("org_id").notNull(),
  status: text("status").$type<MediatorStatus>().notNull().default("VERIFYING"),
  domains: text("domains").array().notNull().default([]),
  languages: text("languages").array().notNull().default(["en"]),
  timezone: text("timezone").notNull().default("UTC"),
  maxOpen: integer("max_open").notNull().default(4),
  firm: text("firm"),
  bio: text("bio").notNull().default(""),
  declaredConflicts: text("declared_conflicts").array().notNull().default([]),
  verdictCount: integer("verdict_count").notNull().default(0),
  /** share of calibration cases passed on the best attempt, 0–100; null until a first attempt */
  calibrationScore: integer("calibration_score"),
  calibrationAttempts: integer("calibration_attempts").notNull().default(0),
  lastAssignedAt: ts("last_assigned_at"),
  createdAt: now("created_at"),
  updatedAt: now("updated_at"),
}, (t) => [index("mediator_profiles_org").on(t.orgId)]);

export const mediatorCredentials = pgTable("mediator_credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  type: text("type").notNull(),
  issuer: text("issuer").notNull(),
  numberMasked: text("number_masked").notNull(),
  expiresOn: date("expires_on", { mode: "string" }),
  fileSha256: text("file_sha256"),
  fileName: text("file_name"),
  status: text("status").$type<"PENDING" | "VERIFIED" | "REJECTED">().notNull().default("PENDING"),
  verifiedBy: text("verified_by"),
  verifiedAt: ts("verified_at"),
  note: text("note"),
  createdAt: now("created_at"),
}, (t) => [index("mediator_credentials_user").on(t.userId)]);

export const mediatorAvailability = pgTable("mediator_availability", {
  userId: text("user_id").primaryKey().references(() => users.id),
  weeklyHours: integer("weekly_hours").notNull().default(10),
  leaveFrom: date("leave_from", { mode: "string" }),
  leaveTo: date("leave_to", { mode: "string" }),
  paused: boolean("paused").notNull().default(false),
  updatedAt: now("updated_at"),
});

export type OfferAnswer = "ACCEPTED" | "DECLINED" | "EXPIRED";
export const mediatorOffers = pgTable("mediator_offers", {
  id: text("id").primaryKey(),
  disputeId: text("dispute_id").notNull().references(() => disputes.id),
  mediatorId: text("mediator_id").notNull().references(() => users.id),
  /** 1 for the first offer on a dispute, 2 for the next … */
  attempt: integer("attempt").notNull(),
  source: text("source").$type<"ROUTER" | "OPS" | "BACKFILL" | "SELF">().notNull().default("ROUTER"),
  offeredAt: ts("offered_at").notNull(),
  expiresAt: ts("expires_at").notNull(),
  answer: text("answer").$type<OfferAnswer>(),
  answeredAt: ts("answered_at"),
  reason: text("reason"),
  /** the router's full explanation at offer time (src/server/mediators/router.ts ScoreBreakdown) */
  breakdown: jsonb("breakdown").$type<Record<string, unknown>>().notNull(),
}, (t) => [uniqueIndex("mediator_offer_once").on(t.disputeId, t.mediatorId), index("mediator_offers_open").on(t.mediatorId, t.answer)]);

export const mediatorCaseFlags = pgTable("mediator_case_flags", {
  disputeId: text("dispute_id").primaryKey().references(() => disputes.id),
  verdictId: text("verdict_id"),
  /** why the verdict needs a second signature: HIGH_VALUE (above $5,000) and/or PROBATION (signer's first 5 verdicts) */
  cosignReasons: text("cosign_reasons").array().notNull().default([]),
  signerTier: text("signer_tier"),
  misses: integer("misses").notNull().default(0),
  opsQueueAt: ts("ops_queue_at"),
  opsQueueReason: text("ops_queue_reason"),
  secondReview: boolean("second_review").notNull().default(false),
  secondReviewOutcome: text("second_review_outcome").$type<"AGREE" | "DISAGREE">(),
  secondReviewerId: text("second_reviewer_id"),
  secondReviewNote: text("second_review_note"),
  secondReviewAt: ts("second_review_at"),
  createdAt: now("created_at"),
  updatedAt: now("updated_at"),
});

export const mediatorReviews = pgTable("mediator_reviews", {
  id: text("id").primaryKey(),
  disputeId: text("dispute_id").notNull().references(() => disputes.id),
  mediatorId: text("mediator_id").notNull(),
  raterId: text("rater_id").notNull(),
  raterRole: text("rater_role").$type<"client" | "provider">().notNull(),
  score: integer("score").notNull(),
  comment: text("comment").notNull().default(""),
  createdAt: now("created_at"),
}, (t) => [uniqueIndex("mediator_review_once").on(t.disputeId, t.raterRole), index("mediator_reviews_med").on(t.mediatorId)]);

export const mediatorFees = pgTable("mediator_fees", {
  id: text("id").primaryKey(),
  disputeId: text("dispute_id").notNull().references(() => disputes.id),
  mediatorId: text("mediator_id").notNull(),
  verdictId: text("verdict_id").notNull(),
  role: text("role").$type<"VERDICT" | "COSIGN">().notNull(),
  tier: text("tier").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  basis: text("basis").notNull(),
  status: text("status").$type<"ACCRUED" | "PAID">().notNull().default("ACCRUED"),
  createdAt: now("created_at"),
}, (t) => [uniqueIndex("mediator_fee_once").on(t.disputeId, t.mediatorId, t.role)]);

export const mediatorApplications = pgTable("mediator_applications", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  domains: text("domains").array().notNull(),
  languages: text("languages").array().notNull(),
  timezone: text("timezone").notNull(),
  firm: text("firm"),
  credentials: text("credentials").notNull(),
  conflicts: text("conflicts").notNull().default(""),
  weeklyHours: integer("weekly_hours").notNull(),
  status: text("status").$type<"NEW" | "APPROVED" | "REJECTED">().notNull().default("NEW"),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  note: text("note"),
  userId: text("user_id"),
  createdAt: now("created_at"),
}, (t) => [index("mediator_applications_status").on(t.status)]);

export const mediatorCalibrations = pgTable("mediator_calibrations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  attempt: integer("attempt").notNull(),
  caseId: text("case_id").notNull(),
  shareBps: integer("share_bps").notNull(),
  rootCause: text("root_cause").notNull(),
  withinPoints: boolean("within_points").notNull(),
  rootOk: boolean("root_ok").notNull(),
  passed: boolean("passed").notNull(),
  createdAt: now("created_at"),
}, (t) => [uniqueIndex("mediator_calibration_once").on(t.userId, t.attempt, t.caseId)]);
