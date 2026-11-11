/**
 * Change orders on locked contracts (F2.13) and their signatures. Additive only.
 *  - change_orders: one proposed amendment (add, change or remove milestones that have not started). Its canonical
 *    document (the amended contract plus the money plan) and hash are fixed when proposed; both parties sign that hash.
 *    Applied, it becomes the next contract revision. Content columns are final (guard in src/db/sql/guards.sql);
 *    only the state, the decision fields and the per-tranche return statuses move.
 *  - change_order_signatures: append-only, one per party (same HMAC scheme as contract signatures).
 */
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users, workspaces } from "./schema";

export type ChangeOrderState = "PROPOSED" | "AWAITING_OPS" | "APPLIED" | "DECLINED" | "WITHDRAWN" | "RETURNED" | "SUPERSEDED";

/** One return to the client a change order needs (one per held tranche), with the key stored before PayPal is called (P2). */
export interface ChangeOrderReturn { trancheIdx: number; trancheId: string; amountCents: number; items: { milestoneCode: string | null; amountCents: number }[]; idemKey: string; status: "PENDING" | "DONE" | "FAILED"; refundId?: string; error?: string }

export const changeOrders = pgTable("change_orders", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  no: integer("no").notNull(),
  baseRevNo: integer("base_rev_no").notNull(),
  baseHash: text("base_hash").notNull(),
  revNo: integer("rev_no").notNull(),
  proposedBy: text("proposed_by").notNull().references(() => users.id),
  proposedRole: text("proposed_role").$type<"client" | "provider">().notNull(),
  note: text("note").notNull(),
  items: jsonb("items").$type<unknown[]>().notNull(),
  canonical: jsonb("canonical").notNull(),
  hash: text("hash").notNull(),
  diff: jsonb("diff").$type<Record<string, unknown>>().notNull(),
  money: jsonb("money").$type<Record<string, unknown>>().notNull(),
  totalFromCents: bigint("total_from_cents", { mode: "number" }).notNull(),
  totalToCents: bigint("total_to_cents", { mode: "number" }).notNull(),
  risk: integer("risk").notNull(),
  riskParts: jsonb("risk_parts").$type<Record<string, number>>().notNull().default({}),
  violations: jsonb("violations").$type<{ rule: string; code: string; message: string; target?: string }[]>().notNull().default([]),
  /** Set when this change order moves milestones into a continuation contract (Build 2). */
  continuationId: text("continuation_id"),
  state: text("state").$type<ChangeOrderState>().notNull().default("PROPOSED"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  returns: jsonb("returns").$type<ChangeOrderReturn[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("change_orders_no").on(t.workspaceId, t.no), index("change_orders_ws").on(t.workspaceId, t.state)]);

export const changeOrderSignatures = pgTable("change_order_signatures", {
  id: text("id").primaryKey(),
  changeOrderId: text("change_order_id").notNull().references(() => changeOrders.id),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  revNo: integer("rev_no").notNull(),
  hash: text("hash").notNull(),
  signerId: text("signer_id").notNull().references(() => users.id),
  role: text("role").$type<"client" | "provider">().notNull(),
  signature: text("signature").notNull(),
  mfa: boolean("mfa").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("change_order_signature_once").on(t.changeOrderId, t.role)]);
