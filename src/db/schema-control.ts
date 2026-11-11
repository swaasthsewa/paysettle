/**
 * Control-plane tables (F5.01, F5.03, F5.04, F5.05, F2.12). Additive only: the core tables
 * (recon_runs, dual_control, flags, audit_chain, webhook_events) live in schema.ts; these hold the detail behind them.
 */
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** F3.11/F5.x: platform fee per vertical in basis points (default 250). Changes are audited. */
export const feeSchedule = pgTable("fee_schedule", {
  vertical: text("vertical").primaryKey(),
  feeBps: integer("fee_bps").notNull().default(250),
  note: text("note"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface PlaneA { contractCents: number; trancheCents: number; openCents: number }
export interface PlaneB { holdCents: number; releaseCents: number; feeCents: number; returnedCents: number; remainingCents: number; entries: number }
export interface PlaneC { available: boolean; source: string; authorizedCents: number; capturedCents: number; returnedCents: number; txns: number }

/** F5.01: one line per tranche per reconciliation run — the three planes side by side. */
export const reconLines = pgTable("recon_lines", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull(),
  trancheId: text("tranche_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  status: text("status").$type<"MATCHED" | "IN_FLIGHT" | "DRIFT" | "UNAVAILABLE">().notNull(),
  planeA: jsonb("plane_a").$type<PlaneA>().notNull(),
  planeB: jsonb("plane_b").$type<PlaneB>().notNull(),
  planeC: jsonb("plane_c").$type<PlaneC>().notNull(),
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  trippedBreaker: boolean("tripped_breaker").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("recon_lines_run").on(t.runId), index("recon_lines_tranche").on(t.trancheId)]);

/** F5.03: what happened when a four-eyes request was decided (executed, vetoed, expired, failed). */
export const dualControlOutcomes = pgTable("dual_control_outcomes", {
  dualControlId: text("dual_control_id").primaryKey(),
  decision: text("decision").$type<"EXECUTED" | "VETOED" | "EXPIRED" | "FAILED">().notNull(),
  decidedBy: text("decided_by"),
  ok: boolean("ok").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/** F5.04: results of the hourly audit-chain verifier (and other scheduled checks). A broken chain pages admins. */
export const controlChecks = pgTable("control_checks", {
  id: serial("id").primaryKey(),
  kind: text("kind").$type<"AUDIT_VERIFY" | "RECON" | "DC_EXPIRY">().notNull(),
  ok: boolean("ok").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  acknowledgedBy: text("acknowledged_by"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("control_checks_kind").on(t.kind, t.at)]);
