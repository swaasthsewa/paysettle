/**
 * Identity gap tables (F1.7 operations SSO, F1.8 baseline handshake, F3.05 oracle attestations). Additive only.
 *  - terms_decisions: every accept/decline of the platform terms, with IP, user agent and an HMAC over the record (F1.8).
 *  - sso_demo_keys / sso_demo_codes: the sandbox-only "Demo identity provider" (F1.7, P9). Its private key is a demo
 *    key that signs nothing but demo id_tokens; production refuses the demo IdP before these tables are read.
 *  - oracle_attestations: append-only results of external oracle checks and Ops counter-verification (F3.05).
 */
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const termsDecisions = pgTable("terms_decisions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  version: text("version").notNull(),
  decision: text("decision").$type<"ACCEPTED" | "DECLINED">().notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  signature: text("signature").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("terms_user_version").on(t.userId, t.version)]);

export const ssoDemoKeys = pgTable("sso_demo_keys", {
  kid: text("kid").primaryKey(),
  publicJwk: jsonb("public_jwk").$type<Record<string, string>>().notNull(),
  privatePem: text("private_pem").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ssoDemoCodes = pgTable("sso_demo_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  nonce: text("nonce").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  groups: jsonb("groups").$type<string[]>().notNull().default([]),
  used: boolean("used").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const oracleAttestations = pgTable("oracle_attestations", {
  id: text("id").primaryKey(),
  milestoneId: text("milestone_id").notNull(),
  attempt: integer("attempt").notNull(),
  rootHash: text("root_hash").notNull(),
  oracle: text("oracle").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  result: jsonb("result").$type<{ status: string; detail: string; source: string }>().notNull(),
  level: text("level").$type<"ok" | "warn" | "fail">().notNull(),
  mode: text("mode").$type<"LIVE" | "SIMULATED" | "MANUAL_PENDING" | "MANUAL">().notNull(),
  tries: integer("tries").notNull().default(1),
  supersedes: text("supersedes"),
  verifiedBy: text("verified_by"),
  signature: text("signature").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("oracle_att_ms").on(t.milestoneId, t.attempt)]);
