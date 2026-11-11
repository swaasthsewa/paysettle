/**
 * Evidence tables, additive only (F3.04, F3.06, F3.07, F3.09); A7, F3.03, A6 and A12 are added below.
 *  - workspace_sites: optional site location per workspace, used for the EXIF GPS distance signal (F3.04).
 *  - evidence_reviews: every client decision on a package (approve with signature, fix request, third rejection, deemed approval).
 *  - evidence_notifications: reminders and notices raised by the review timers (F3.06); dedup_key makes each fire once.
 */
import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { evidencePackages, workspaces, wsMilestones } from "./schema";

export const workspaceSites = pgTable("workspace_sites", {
  workspaceId: text("workspace_id").primaryKey().references(() => workspaces.id),
  label: text("label").notNull().default("Site"),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReviewDecision = "APPROVE" | "REQUEST_FIX" | "THIRD_REJECTION" | "DEEMED_APPROVED" | "ESCALATED";
export const evidenceReviews = pgTable("evidence_reviews", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => evidencePackages.id),
  milestoneId: text("milestone_id").notNull().references(() => wsMilestones.id),
  decision: text("decision").$type<ReviewDecision>().notNull(),
  items: jsonb("items").$type<string[]>().notNull().default([]),
  rootHash: text("root_hash").notNull(),
  signature: text("signature"),
  byUser: text("by_user"),
  mfa: text("mfa").$type<"verified" | "sandbox-skip" | "system">(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("evidence_reviews_ms").on(t.milestoneId)]);

export const evidenceNotifications = pgTable("evidence_notifications", {
  id: text("id").primaryKey(),
  dedupKey: text("dedup_key").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  milestoneId: text("milestone_id").notNull().references(() => wsMilestones.id),
  toUserId: text("to_user_id"),
  toRole: text("to_role"),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [uniqueIndex("evidence_notifications_dedup").on(t.dedupKey), index("evidence_notifications_to").on(t.toUserId)]);

/* ── Additive: A7 duplicate-photo check, F3.03 out-of-sequence override, A6 tamper demo, A12 pairs ── */

/**
 * A7: one row per stored image of an evidence package — exact SHA-256 plus a 64-bit difference hash (dHash, signed bigint).
 * `photographic` is false for flat graphics (screens, wireframes, 1-pixel test images); only photographs are compared.
 * Rows follow their package, milestone and workspace on delete (test fixtures clean up through the parent rows).
 */
export const evidencePhotoHashes = pgTable("evidence_photo_hashes", {
  packageId: text("package_id").notNull().references(() => evidencePackages.id, { onDelete: "cascade" }),
  milestoneId: text("milestone_id").notNull().references(() => wsMilestones.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sha256: text("sha256").notNull(),
  name: text("name").notNull(),
  dhash: bigint("dhash", { mode: "bigint" }),
  photographic: boolean("photographic").notNull().default(false),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.packageId, t.sha256] }), index("evidence_photo_hashes_sha").on(t.sha256), index("evidence_photo_hashes_ws").on(t.workspaceId)]);

/**
 * F3.03: a client-signed permission for the provider to submit a later milestone before its prerequisites are settled.
 * Payout amounts are unchanged; only the order is relaxed. REQUESTED (by the provider) → GRANTED (client signature) or
 * DECLINED; a GRANTED override can be REVOKED by the client until the provider submits.
 */
export type OverrideStatus = "REQUESTED" | "GRANTED" | "DECLINED" | "REVOKED";
export const sequenceOverrides = pgTable("sequence_overrides", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  milestoneId: text("milestone_id").notNull().references(() => wsMilestones.id, { onDelete: "cascade" }),
  skipped: jsonb("skipped").$type<string[]>().notNull().default([]),
  status: text("status").$type<OverrideStatus>().notNull(),
  reason: text("reason").notNull().default(""),
  requestedBy: text("requested_by"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  canonicalHash: text("canonical_hash"),
  signature: text("signature"),
  mfa: text("mfa").$type<"verified" | "sandbox-skip">(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sequence_overrides_ms").on(t.milestoneId)]);

/**
 * A6 "Try to cheat" (sandbox only): a scratch copy of one simulation's audit-chain rows. The real audit_chain is append-only
 * (trigger, P5) and is never edited; the demo edits this copy and verifies it against the real chain's later rows.
 */
export const sandboxAuditCopies = pgTable("sandbox_audit_copies", {
  simId: text("sim_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  seq: integer("seq").notNull(),
  actorId: text("actor_id"),
  actorRole: text("actor_role"),
  action: text("action").notNull(),
  target: text("target").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  tampered: text("tampered"),
}, (t) => [primaryKey({ columns: [t.simId, t.seq] })]);

/** A12: one "Pair A vs Pair B" build in the playground (two contracts from the classic-car blueprint). */
export const playgroundPairs = pgTable("playground_pairs", {
  id: text("id").primaryKey(),
  judgeId: text("judge_id").notNull(),
  workspaceA: text("workspace_a").notNull(),
  workspaceB: text("workspace_b").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("playground_pairs_judge").on(t.judgeId)]);
