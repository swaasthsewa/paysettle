/**
 * Dispute tables, additive. F4.01 freeze record and deadlines, F4.02 bid nonces, F4.03 vault locks and
 * rebuttal files (write-once), F4.07 mediation fee record, F4.08 leg keys, F4.09 termination refunds,
 * F4.12 dispute rate per blueprint milestone code (view, flagged above 8%).
 */
import { sql } from "drizzle-orm";
import { bigint, boolean, customType, integer, jsonb, pgTable, pgView, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { disputes, bids } from "./schema";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const cents = (name: string) => bigint(name, { mode: "number" });

/** One row per dispute: what the core table has no column for. */
export const disputeMeta = pgTable("dispute_meta", {
  disputeId: text("dispute_id").primaryKey().references(() => disputes.id),
  workspaceId: text("workspace_id").notNull(),
  trancheId: text("tranche_id"),
  openedRole: text("opened_role").notNull(),
  fastTrack: boolean("fast_track").notNull().default(false),
  tier3Until: timestamp("tier3_until", { withTimezone: true }).notNull(),
  vaultLocks: jsonb("vault_locks").$type<string[]>().notNull().default([]),
  vaultExtendedUntil: timestamp("vault_extended_until", { withTimezone: true }),
  skippedBy: text("skipped_by"),
  frozenDependants: jsonb("frozen_dependants").$type<string[]>().notNull().default([]),
  leg1Key: text("leg1_key"),
  leg2Key: text("leg2_key"),
  leg1Ref: text("leg1_ref"),
  leg2Ref: text("leg2_ref"),
  legError: text("leg_error"),
  terminated: jsonb("terminated").$type<{ milestoneId: string; code: string; amountCents: number; key: string; status: "PENDING" | "DONE" | "FAILED"; ref?: string }[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Nonce behind each sealed bid commit (commit = sha256(`${bps}:${nonce}`)); lets anyone re-check a revealed bid. */
export const bidNonces = pgTable("dispute_bid_nonces", {
  bidId: text("bid_id").primaryKey().references(() => bids.id),
  nonce: text("nonce").notNull(),
});

/** Rebuttal uploads, write-once (F4.03). Untrusted content (P11): served only as an image or a download, never inline HTML. */
export const disputeFiles = pgTable("dispute_files", {
  disputeId: text("dispute_id").notNull().references(() => disputes.id),
  sha256: text("sha256").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  size: integer("size").notNull(),
  bytes: bytea("bytes").notNull(),
  byUser: text("by_user").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.disputeId, t.sha256] })]);

/** Mediation fee (F4.07): Tier 3 only, charged to the party at fault or split 50/50. Recorded here; collection is Finance's. */
export const disputeFees = pgTable("dispute_fees", {
  disputeId: text("dispute_id").primaryKey().references(() => disputes.id),
  verdictId: text("verdict_id").notNull(),
  basis: text("basis").$type<"CLIENT" | "PROVIDER" | "SHARED">().notNull(),
  totalCents: cents("total_cents").notNull(),
  clientCents: cents("client_cents").notNull(),
  providerCents: cents("provider_cents").notNull(),
  status: text("status").notNull().default("RECORDED"),
  note: text("note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** F4.12: dispute rate per blueprint milestone code (baseline milestones that left draft). Flagged above 8%. */
export const disputeRateByCode = pgView("dispute_rate_by_code", {
  orgId: text("org_id").notNull(),
  blueprintCode: text("blueprint_code").notNull(),
  milestoneCode: text("milestone_code").notNull(),
  milestones: integer("milestones").notNull(),
  disputes: integer("disputes").notNull(),
  rateBps: integer("rate_bps").notNull(),
  flagged: boolean("flagged").notNull(),
}).as(sql`
  SELECT w.org_id AS org_id, w.blueprint_code AS blueprint_code, m.code AS milestone_code,
         count(*)::int AS milestones, count(d.id)::int AS disputes,
         (count(d.id) * 10000 / greatest(count(*), 1))::int AS rate_bps,
         (count(d.id) * 100 > 8 * count(*)) AS flagged
  FROM ws_milestones m
  JOIN workspaces w ON w.id = m.workspace_id
  LEFT JOIN disputes d ON d.milestone_id = m.id
  WHERE m.active AND m.origin = 'BASELINE' AND m.state <> 'DRAFT'
  GROUP BY w.org_id, w.blueprint_code, m.code`);
