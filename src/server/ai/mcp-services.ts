/**
 * A5 · Real bindings for the MCP tools: other modules are reached only through their src/server/<module>/index.ts exports.
 * Blueprint search reads the published blueprints table (read-only).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { blueprints } from "@/db/schema";
import { audit } from "@/lib/audit";
import { rankBlueprints } from "@/lib/ai/rules";
import * as contracts from "../contracts";
import * as money from "../money";
import * as evidence from "../evidence";
import * as disputes from "../disputes";
import { draftContract } from "./index";
import { createAgentApproval, releaseSpend, reserveSpend } from "./agent";
import type { McpServices } from "./mcp";

export const realServices: McpServices = {
  async searchBlueprints({ query, vertical, maxDays }) {
    const rows = await db.select().from(blueprints).where(eq(blueprints.active, true));
    const lite = rows.map((r) => ({ code: r.code, title: r.title, vertical: r.vertical, kind: r.kind, summary: r.summary, recommendedDays: r.recommendedDays, milestones: r.milestones }));
    const ranked = new Map(rankBlueprints(query ?? "", lite).map((r) => [r.code, r.score]));
    return lite
      .filter((b) => !vertical || `${b.vertical} ${b.kind}`.toLowerCase().includes(vertical.toLowerCase()))
      .filter((b) => !maxDays || b.recommendedDays <= maxDays)
      .map((b) => ({ code: b.code, title: b.title, vertical: b.vertical, kind: b.kind, recommendedDays: b.recommendedDays, summary: b.summary, milestones: b.milestones.length, score: ranked.get(b.code) ?? 0 }))
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 10);
  },
  draftContract,
  createWorkspace: contracts.createWorkspace,
  applyChange: contracts.applyChange,
  getWorkspace: contracts.getWorkspace,
  fundTranche: money.fundTranche,
  submitEvidence: evidence.submitEvidence,
  openDispute: disputes.openDispute,
  reserveSpend,
  releaseSpend,
  createApproval: createAgentApproval,
  async audit(a, action, target, detail) { await audit(db, { id: a.id, role: a.role, requestId: a.requestId }, action, target, detail); },
};
