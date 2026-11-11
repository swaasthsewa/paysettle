/**
 * Representment and blueprint-publishing tables, additive only (F4.10 representment, F5.03 blueprint publishing through four-eyes).
 *  - representments: one row per PayPal dispute. PaySettle builds an evidence dossier (signed contract hash, approvals,
 *    evidence roots and file hashes, timeline) and sends it to PayPal through the rail. The idempotency key is stored
 *    here before the call (P2); status says where the submission is.
 *  - blueprint_releases: the publish/withdraw history of each blueprint. A row is written only when a second person
 *    approved the change (dual_control id kept), so the catalogue never changes on one person's say-so.
 */
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export type RepresentmentStatus = "PENDING" | "SUBMITTED" | "NOT_ELIGIBLE" | "FAILED";
export interface DossierDocMeta { name: string; contentType: string; bytes: number; sha256: string }

export const representments = pgTable("representments", {
  id: text("id").primaryKey(),
  disputeId: text("dispute_id").notNull(),
  transmissionId: text("transmission_id"),
  workspaceId: text("workspace_id").notNull(),
  trancheIds: jsonb("tranche_ids").$type<string[]>().notNull().default([]),
  reason: text("reason"),
  rail: text("rail").notNull(),
  status: text("status").$type<RepresentmentStatus>().notNull().default("PENDING"),
  idemKey: text("idem_key").notNull(),
  dossierHash: text("dossier_hash"),
  dossier: jsonb("dossier").$type<Record<string, unknown>>(),
  documents: jsonb("documents").$type<DossierDocMeta[]>().notNull().default([]),
  railRef: text("rail_ref"),
  note: text("note"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
}, (t) => [uniqueIndex("representments_dispute").on(t.disputeId), index("representments_ws").on(t.workspaceId), index("representments_status").on(t.status)]);

export const blueprintReleases = pgTable("blueprint_releases", {
  id: text("id").primaryKey(),
  blueprintCode: text("blueprint_code").notNull(),
  action: text("action").$type<"PUBLISH" | "WITHDRAW">().notNull(),
  fromVersion: text("from_version").notNull(),
  toVersion: text("to_version").notNull(),
  note: text("note").notNull(),
  dualControlId: text("dual_control_id").notNull(),
  initiatorId: text("initiator_id").notNull(),
  approverId: text("approver_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("blueprint_releases_dc").on(t.dualControlId), index("blueprint_releases_code").on(t.blueprintCode, t.createdAt)]);
