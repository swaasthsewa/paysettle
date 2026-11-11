/**
 * Judge Playground tables, additive to schema.ts. Requirement ids: F5.06 (four-quadrant playground, API wire view),
 * F5.07 (time machine), F5.08 (chaos injector, reset). Sandbox only (P9): nothing writes here outside sandbox mode.
 *
 * sim_progress  one row per sim session: the status of every scenario step and a small bag of ids carried between steps.
 * sim_events    the "wire log" of a sim: rail calls, webhook posts, MCP calls, ledger rows, time jumps and faults, in order.
 */
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type SimStepStatus = "done" | "waiting" | "error" | "skipped";
export interface SimStepRecord { status: SimStepStatus; detail: string; at: string; simDay: number; ms: number; link?: string }

export const simProgress = pgTable("sim_progress", {
  simId: text("sim_id").primaryKey(),
  steps: jsonb("steps").$type<Record<string, SimStepRecord>>().notNull().default({}),
  bag: jsonb("bag").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SimEventKind = "step" | "rail" | "webhook" | "mcp" | "ledger" | "state" | "time" | "fault";

export const simEvents = pgTable("sim_events", {
  id: serial("id").primaryKey(),
  simId: text("sim_id").notNull(),
  step: text("step").notNull(),
  kind: text("kind").$type<SimEventKind>().notNull(),
  request: text("request").notNull(),
  response: text("response").notNull(),
  ok: boolean("ok").notNull().default(true),
  simOffsetHours: integer("sim_offset_hours").notNull().default(0),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sim_events_sim").on(t.simId, t.id)]);
