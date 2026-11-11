/**
 * GET /api/sandbox/state?simId= — F5.06 four-quadrant state of this browser's own run (client, provider, ledger + recon,
 * wire log). The run comes from the ps_sim cookie; a simId that is not that run is refused. Sandbox only (P9).
 */
import { NextResponse } from "next/server";
import { playgroundState } from "@/server/playground";
import { NotYourRun, heldSim, ownsRun } from "@/server/playground/owner";
import { fail, guard } from "../_guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const j = await guard(); if (j instanceof NextResponse) return j;
  try {
    const held = await heldSim();
    const q = new URL(req.url).searchParams.get("simId");
    if (q && !ownsRun(held, q)) throw new NotYourRun();
    return NextResponse.json({ state: await playgroundState(held) });
  } catch (e) { return fail(e); }
}
