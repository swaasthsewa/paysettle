/** POST /api/sandbox/reset {simId} — F5.08 one-click reset to day 0: a fresh sim session (and, on its first step, a fresh workspace). Audit rows are never deleted. Only this browser's own run; the fresh run replaces it in the ps_sim cookie. Sandbox only (P9). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { playgroundState, resetSim } from "@/server/playground";
import { assertOwnSim, holdSim } from "@/server/playground/owner";
import { body, fail, guard } from "../_guard";

export const dynamic = "force-dynamic";
const Body = z.object({ simId: z.string().min(1).max(64) });

export async function POST(req: Request) {
  const j = await guard(); if (j instanceof NextResponse) return j;
  const b = await body(req, Body); if (b instanceof NextResponse) return b;
  try {
    await assertOwnSim(b.simId);
    const sim = await resetSim(j, b.simId);
    await holdSim(sim.id);
    return NextResponse.json({ simId: sim.id, state: await playgroundState(sim.id) });
  } catch (e) { return fail(e); }
}
