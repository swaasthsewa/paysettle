/** POST /api/sandbox/step — F5.06 step runner: run the next step, a named step, or all remaining steps of this browser's own run. Sandbox only (P9). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { playgroundState, runAll, runNext } from "@/server/playground";
import { assertOwnSim } from "@/server/playground/owner";
import { body, fail, guard, originOf } from "../_guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const Body = z.object({ simId: z.string().min(1).max(64), all: z.boolean().optional(), stepId: z.string().max(40).optional() });

export async function POST(req: Request) {
  const j = await guard(); if (j instanceof NextResponse) return j;
  const b = await body(req, Body); if (b instanceof NextResponse) return b;
  try {
    await assertOwnSim(b.simId);
    const baseUrl = originOf(req);
    const results = b.all ? await runAll(j, b.simId, { baseUrl }) : [await runNext(j, b.simId, { baseUrl, stepId: b.stepId })].filter((x) => x !== null);
    return NextResponse.json({ results, state: await playgroundState(b.simId) });
  } catch (e) { return fail(e); }
}
