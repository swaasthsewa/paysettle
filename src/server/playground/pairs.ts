/**
 * A12 Pair A vs Pair B (F2.04, F2.05, F5.06, P9). One button in the playground builds two contracts from the
 * classic-car blueprint through the contracts service — each prune, append, re-weighting and date change is a recorded
 * revision — then shows them side by side. Sandbox only. Both contracts are tagged as simulations (sim_workspaces), so
 * the demo people's own screens leave them out. No money moves: the pairs stay unsigned drafts.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { blueprints, users, type BlueprintMilestone } from "@/db/schema";
import { playgroundPairs } from "@/db/schema-evidence";
import { simWorkspaces } from "@/db/schema-sim";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import type { Tier } from "@/lib/policy";
import { DomainError, type WorkspaceView } from "../types";
import * as contracts from "../contracts";
import { PAIR_A, PAIR_B, PAIR_BLUEPRINT, diffPairs, pairAChanges, pairBChanges, type PairDiff } from "./pairs-diff";
import { actorFor, assertSandbox, moduleCall } from "./session";

export interface PairResult { id: string; createdAt: string; revisions: { A: number; B: number }; diff: PairDiff }

async function blueprint() {
  const [bp] = await db.select({ code: blueprints.code, milestones: blueprints.milestones, clauses: blueprints.clauses, recommendedDays: blueprints.recommendedDays }).from(blueprints).where(eq(blueprints.code, PAIR_BLUEPRINT)).limit(1);
  if (!bp) throw new DomainError("BLUEPRINT_MISSING", "The classic-car blueprint is not seeded. Run npm run db:seed.");
  return bp as { code: string; milestones: BlueprintMilestone[]; clauses: { code: string }[]; recommendedDays: number };
}

async function buildOne(cfg: typeof PAIR_A | typeof PAIR_B, pairId: string, changes: ReturnType<typeof pairAChanges>): Promise<string> {
  const client = await actorFor(cfg.client), provider = await actorFor(cfg.provider);
  const id = await moduleCall("contracts", () => contracts.createWorkspace(client, { blueprintCode: PAIR_BLUEPRINT, title: `${cfg.label}: ${cfg.title} (playground ${pairId.slice(-6)})`, totalCents: cfg.totalCents, providerId: provider.id }));
  await db.insert(simWorkspaces).values({ workspaceId: id, simId: pairId }).onConflictDoNothing();
  for (const c of changes) await moduleCall("contracts", () => contracts.applyChange(client, id, c));
  return id;
}

/** Builds Pair A and Pair B for this judge (each call makes a fresh pair; earlier pairs are left as they were). */
export async function buildPairs(judge: { id: string; role: string }): Promise<PairResult> {
  assertSandbox();
  const bp = await blueprint();
  const id = newId("pair");
  const a = await buildOne(PAIR_A, id, pairAChanges(bp.milestones, bp.recommendedDays));
  const b = await buildOne(PAIR_B, id, pairBChanges(bp.milestones));
  await db.insert(playgroundPairs).values({ id, judgeId: judge.id, workspaceA: a, workspaceB: b });
  await audit(db, { id: judge.id, role: judge.role }, "sandbox.pairs_built", id, { blueprint: bp.code, workspaceA: a, workspaceB: b });
  const r = await pairResult(judge, id);
  if (!r) throw new DomainError("PAIR_MISSING", "The pair was built but could not be read back.");
  return r;
}

/** The diff for one pair of this judge, or null. */
export async function pairResult(judge: { id: string }, pairId: string): Promise<PairResult | null> {
  assertSandbox();
  const [p] = await db.select().from(playgroundPairs).where(and(eq(playgroundPairs.id, pairId), eq(playgroundPairs.judgeId, judge.id))).limit(1);
  if (!p) return null;
  const bp = await blueprint();
  const read = async (cfg: typeof PAIR_A | typeof PAIR_B, wsId: string): Promise<WorkspaceView> => contracts.getWorkspace(await actorFor(cfg.client), wsId);
  const [va, vb] = await Promise.all([read(PAIR_A, p.workspaceA), read(PAIR_B, p.workspaceB)]);
  const tierOf = async (userId: string | undefined): Promise<Tier> => {
    if (!userId) return "new";
    const [u] = await db.select({ tier: users.tier }).from(users).where(eq(users.id, userId)).limit(1);
    return (u?.tier ?? "new") as Tier;
  };
  const tiers = { A: await tierOf(va.provider?.id), B: await tierOf(vb.provider?.id) };
  return { id: p.id, createdAt: p.createdAt.toISOString(), revisions: { A: va.revision, B: vb.revision }, diff: diffPairs(bp, va, vb, tiers) };
}

/** This judge account's latest pair, or null. The page does not use it: judges share the account, so it reads the pair id from this browser's cookie (owner.ts). */
export async function latestPairFor(judge: { id: string }): Promise<PairResult | null> {
  assertSandbox();
  const [p] = await db.select({ id: playgroundPairs.id }).from(playgroundPairs).where(eq(playgroundPairs.judgeId, judge.id)).orderBy(desc(playgroundPairs.createdAt)).limit(1);
  if (!p) return null;
  try { return await pairResult(judge, p.id); }
  catch { return null; }
}
