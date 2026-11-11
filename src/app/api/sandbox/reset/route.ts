/** POST /api/sandbox/reset {simId} — F5.08 one-click reset to day 0: a fresh sim session (and, on its first step, a fresh workspace). Audit rows are never deleted. Sandbox only (P9). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { playgroundState, resetSim } from "@/server/playground";
import { body, fail, guard } from "../_guard";

export const dynamic = "force-dynamic";
const Body = z.object({ simId: z.string().min(1).max(64) });

export async function POST(req: Request) {
  const j = await guard(); if (j instanceof NextResponse) return j;
  const b = await body(req, Body); if (b instanceof NextResponse) return b;
  try {
    const sim = await resetSim(j, b.simId);
    return NextResponse.json({ simId: sim.id, state: await playgroundState(sim.id) });
  } catch (e) { return fail(e); }
}
