/**
 * A1–A4 structured outputs. Every model answer is validated against one of these zod schemas
 * by the gateway; anything else is retried once and then refused (never guessed).
 */
import { z } from "zod";

export const ARTIFACT_KINDS = ["IMAGE", "VIDEO", "PDF", "LOG", "LINK", "SIGNATURE", "ORACLE"] as const;
const text = (max: number) => z.string().min(1).max(max);

export const proofSchema = z.object({
  artifacts: z.array(z.object({ kind: z.enum(ARTIFACT_KINDS), min: z.number().int().min(1).max(50), note: z.string().max(200).optional() })).max(10),
  criteria: z.array(text(300)).min(1).max(8),
  gpsRadiusM: z.number().int().positive().max(100_000).optional(),
  oracle: z.string().max(40).optional(),
});

/** A1 Contract Drafter. */
export const draftSchema = z.object({
  blueprintCode: text(64),
  title: text(120),
  milestones: z.array(z.object({
    title: text(160), type: z.enum(["GATE", "PAY"]), day: z.number().int(), bps: z.number().int().min(0).max(10_000),
    proof: proofSchema, lockRule: text(300), disputeRule: text(300),
  })).min(1).max(50),
  assumptions: z.array(text(300)).max(12),
});
export type DraftOut = z.infer<typeof draftSchema>;

/** A2 Criteria Compiler and Linter (one row per criterion id it was given). */
export const compileSchema = z.object({
  results: z.array(z.object({
    id: text(80), verifiable: z.boolean(), reason: text(400),
    rewrite: z.string().max(400).nullable().optional(), riskFlags: z.array(z.string().max(120)).max(5).optional(),
  })).max(200),
});
export type CompileOut = z.infer<typeof compileSchema>;

/** A3 Evidence Verifier. */
export const verifySchema = z.object({
  criteria: z.array(z.object({
    criterion: text(300), verdict: z.enum(["met", "not_met", "unclear"]), confidence: z.number().min(0).max(1), cites: z.array(z.string().max(200)).max(10),
  })).max(20),
  recommendation: z.enum(["approve", "request_fix", "unclear"]),
  summary: text(1200),
  injectionDetected: z.boolean().optional(),
});
export type VerifyOut = z.infer<typeof verifySchema>;

/** A4 Dispute Mediator. */
export const mediateSchema = z.object({
  providerShareBps: z.number().int().min(0).max(10_000),
  findings: z.array(text(500)).max(12),
  missing: z.array(text(300)).max(10),
  confidence: z.number().min(0).max(1),
});
export type MediateOut = z.infer<typeof mediateSchema>;
