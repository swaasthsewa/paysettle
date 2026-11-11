"use server";
/**
 * Playground extras: A6 "Try to cheat" on a simulation's audit chain and A12 Pair A vs Pair B.
 * Sandbox only (P9), judges and platform admins only, zod-validated input. The services re-check the sim scope, and each
 * action works only on the run this browser holds (ps_sim cookie), so judges sharing one account never touch each other's.
 */
import { z } from "zod";
import { sandboxMode } from "@/lib/clock";
import { viewer } from "@/lib/session";
import { DomainError } from "@/server/types";
import { PLAYGROUND_ROLES, playgroundState, type PlaygroundState } from "@/server/playground";
import { attemptDirectAuditEditForDemo, copySimAudit, repairSimAuditForDemo, tamperSimAuditCopyForDemo, verifySimAuditCopy, type TamperState } from "@/server/playground/tamper";
import { buildPairs, type PairResult } from "@/server/playground/pairs";
import { assertOwnSim, holdPair, holdSim } from "@/server/playground/owner";

export type ExtrasResult<T> = { ok: true; data: T; message?: string } | { ok: false; message: string };

const SimId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Unknown session.");
const Tamper = z.object({ simId: SimId, mode: z.enum(["edit", "rehash"]), seq: z.number().int().positive().optional() });

async function judge() {
  if (!sandboxMode()) throw new DomainError("SANDBOX_ONLY", "The Judge Playground is not available in production.");
  const v = await viewer();
  if (!v) throw new DomainError("SIGNED_OUT", "Sign in as the judge to use the playground.");
  if (!PLAYGROUND_ROLES.includes(v.role)) throw new DomainError("FORBIDDEN", "The playground is for judges and platform admins.");
  return { id: v.id, role: v.role };
}
async function run<T>(fn: () => Promise<T>, message?: (d: T) => string): Promise<ExtrasResult<T>> {
  try { const data = await fn(); return { ok: true, data, message: message?.(data) }; }
  catch (e) {
    if (e instanceof DomainError || e instanceof z.ZodError) return { ok: false, message: e instanceof z.ZodError ? e.issues[0]?.message ?? "Bad input." : e.message };
    console.error("[playground extras]", e);
    return { ok: false, message: "The playground hit an unexpected error. Nothing real changed; try Reset." };
  }
}

/** Copies this simulation's audit rows and verifies them (fresh copy, nothing edited). */
export async function auditCopyAction(simId: string): Promise<ExtrasResult<TamperState>> {
  return run(async () => { await judge(); const id = SimId.parse(simId); await assertOwnSim(id); await copySimAudit(id); return verifySimAuditCopy(id); });
}

/** Step 1: a direct UPDATE on the real chain (always rolled back), then the verifier. */
export async function directEditAction(simId: string): Promise<ExtrasResult<{ attempt: { seq: number; refused: boolean; message: string }; state: TamperState }>> {
  return run(async () => { const j = await judge(); const id = SimId.parse(simId); await assertOwnSim(id); const attempt = await attemptDirectAuditEditForDemo(j, id); return { attempt, state: await verifySimAuditCopy(id) }; });
}

/** Step 2 + 3: edit one copied row (optionally re-hash it) and run the verifier. */
export async function tamperAction(input: { simId: string; mode: "edit" | "rehash"; seq?: number }): Promise<ExtrasResult<{ change: string; state: TamperState }>> {
  return run(async () => {
    const j = await judge();
    const p = Tamper.parse(input);
    await assertOwnSim(p.simId);
    const t = await tamperSimAuditCopyForDemo(j, p.simId, { mode: p.mode, seq: p.seq });
    return { change: t.change, state: await verifySimAuditCopy(p.simId) };
  });
}

/** Step 4: drop the copy and re-run the scenario reset (fresh simulation at day 0). */
export async function repairAction(simId: string): Promise<ExtrasResult<PlaygroundState>> {
  return run(async () => {
    const j = await judge(); const id = SimId.parse(simId);
    await assertOwnSim(id);
    const fresh = await repairSimAuditForDemo(j, id);
    await holdSim(fresh.id);
    return playgroundState(fresh.id);
  });
}

/** A12: build Pair A and Pair B from the classic-car blueprint and return the side-by-side diff. */
export async function buildPairsAction(): Promise<ExtrasResult<PairResult>> {
  return run(async () => { const r = await buildPairs(await judge()); await holdPair(r.id); return r; });
}
