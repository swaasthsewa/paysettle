/**
 * Money tables, additive only (F3.10, F3.11).
 *  - money_notices: watchdog notices to the client and the provider (day-22 warning, day-25 rollover offer,
 *    day-27 settlement, PayPal dispute holds). dedup_key makes each notice fire once per person.
 *  - release_adjustments, deadline_extensions: deadline penalty and early bonus (below).
 */
import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tranches, users, workspaces, wsMilestones } from "./schema";

export const moneyNotices = pgTable("money_notices", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  trancheId: text("tranche_id").references(() => tranches.id),
  userId: text("user_id").notNull().references(() => users.id),
  kind: text("kind").$type<"WARN" | "OFFER_ROLLOVER" | "SETTLED" | "REFUND_REQUESTED" | "EXTERNAL_DISPUTE" | "REAUTHORIZED" | "CHANGE_ORDER" | "CONTINUATION">().notNull(),
  message: text("message").notNull(),
  dedupKey: text("dedup_key").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("money_notices_dedup").on(t.dedupKey), index("money_notices_user").on(t.userId, t.createdAt)]);

/* ── Deadline penalty and early bonus (F3.07, F3.08, F3.11) ── */

/**
 * The deadline adjustment of one milestone release, fixed before PayPal is called (P2) and never recomputed: a retry
 * moves exactly the amounts stored here. base = the milestone amount; released = base − deduction + bonus.
 * deduction_idem_key is the key of the return that gives the deduction back to the client.
 */
export const releaseAdjustments = pgTable("release_adjustments", {
  id: text("id").primaryKey(),
  milestoneId: text("milestone_id").notNull().references(() => wsMilestones.id),
  trancheId: text("tranche_id").notNull().references(() => tranches.id),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  releaseId: text("release_id").notNull(),
  baseCents: bigint("base_cents", { mode: "number" }).notNull(),
  deductionCents: bigint("deduction_cents", { mode: "number" }).notNull().default(0),
  bonusCents: bigint("bonus_cents", { mode: "number" }).notNull().default(0),
  releasedCents: bigint("released_cents", { mode: "number" }).notNull(),
  timing: text("timing").$type<"ON_TIME" | "LATE" | "EARLY">().notNull(),
  daysLate: integer("days_late").notNull().default(0),
  daysEarly: integer("days_early").notNull().default(0),
  excusedDays: integer("excused_days").notNull().default(0),
  countedDays: integer("counted_days").notNull().default(0),
  reviewExcludedMs: bigint("review_excluded_ms", { mode: "number" }).notNull().default(0),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
  packageId: text("package_id"),
  terms: jsonb("terms").$type<Record<string, unknown>>().notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  deductionIdemKey: text("deduction_idem_key"),
  deductionStatus: text("deduction_status").$type<"NONE" | "PENDING" | "RECORDED" | "COMPLETED" | "FAILED">().notNull().default("NONE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("release_adjustments_ms").on(t.milestoneId), index("release_adjustments_tr").on(t.trancheId)]);

/**
 * Excused days for a milestone's due date. EXTENSION: a dated extension one party asks for and the other signs (both
 * signatures stored, with the time each was given). MEDIATOR_RULING: excused days a mediator ruled, recorded as is.
 */
export const deadlineExtensions = pgTable("deadline_extensions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  milestoneId: text("milestone_id").notNull().references(() => wsMilestones.id),
  kind: text("kind").$type<"EXTENSION" | "MEDIATOR_RULING">().notNull(),
  days: integer("days").notNull(),
  reason: text("reason").notNull(),
  state: text("state").$type<"REQUESTED" | "ACCEPTED" | "DECLINED" | "WITHDRAWN">().notNull().default("REQUESTED"),
  requestedBy: text("requested_by").notNull().references(() => users.id),
  requestedRole: text("requested_role").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  requestSig: text("request_sig").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionSig: text("decision_sig"),
  dueBefore: timestamp("due_before", { withTimezone: true }),
  dueAfter: timestamp("due_after", { withTimezone: true }),
  disputeId: text("dispute_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("deadline_extensions_ms").on(t.milestoneId)]);
