/**
 * AI tables, additive to schema.ts. Requirement ids: A5 (MCP server: agent tokens, human gate), A7 (cost and safety).
 *
 * agent_tokens     one bearer token per agent session, minted by a signed-in person; only the SHA-256 of the token is stored.
 *                  spend_limit_cents caps what request_funding may ask the human to approve in PayPal; spent_cents counts it.
 * agent_approvals  approve_release never releases money (P3, P4). It records a request here, and the client confirms or
 *                  dismisses it in the app on the milestone screen, with their own session and MFA.
 */
import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const agentTokens = pgTable("agent_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  label: text("label").notNull(),
  tokenHash: text("token_hash").notNull(),
  prefix: text("prefix").notNull(),
  spendLimitCents: bigint("spend_limit_cents", { mode: "number" }).notNull(),
  spentCents: bigint("spent_cents", { mode: "number" }).notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: created(),
}, (t) => [uniqueIndex("agent_tokens_hash").on(t.tokenHash), index("agent_tokens_user").on(t.userId)]);

export const agentApprovals = pgTable("agent_approvals", {
  id: text("id").primaryKey(),
  tokenId: text("token_id").notNull(),
  userId: text("user_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  milestoneId: text("milestone_id").notNull(),
  note: text("note").notNull().default(""),
  state: text("state").$type<"PENDING" | "CONFIRMED" | "DISMISSED">().notNull().default("PENDING"),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: created(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
}, (t) => [index("agent_approvals_ms").on(t.milestoneId, t.state)]);
