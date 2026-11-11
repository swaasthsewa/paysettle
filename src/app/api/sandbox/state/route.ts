/** GET /api/sandbox/state?simId= — F5.06 four-quadrant state of a sim (client, provider, ledger + recon, wire log). Sandbox only (P9). */
import { NextResponse } from "next/server";
import { latestSimFor, playgroundState } from "@/server/playground";
import { fail, guard } from "../_guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const j = await guard(); if (j instanceof NextResponse) return j;
  try {
    const q = new URL(req.url).searchParams.get("simId");
    const simId = q && q.length <= 64 ? q : (await latestSimFor(j.id))?.id ?? null;
    return NextResponse.json({ state: await playgroundState(simId) });
  } catch (e) { return fail(e); }
}
