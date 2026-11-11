/** POST /api/sandbox/faults {simId, fault} — F5.08 chaos injector (PayPal 503, duplicate/chargeback webhook, ledger drift, spoofed/valid photo). Sandbox only (P9). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { FAULTS, injectFault, playgroundState } from "@/server/playground";
import { assertOwnSim } from "@/server/playground/owner";
import { body, fail, guard, originOf } from "../_guard";

export const dynamic = "force-dynamic";
const Body = z.object({ simId: z.string().min(1).max(64), fault: z.enum(FAULTS) });

export async function POST(req: Request) {
  const j = await guard(); if (j instanceof NextResponse) return j;
  const b = await body(req, Body); if (b instanceof NextResponse) return b;
  try {
    await assertOwnSim(b.simId);
    const outcome = await injectFault(j, b.simId, b.fault, { baseUrl: originOf(req) });
    return NextResponse.json({ outcome, state: await playgroundState(b.simId) });
  } catch (e) { return fail(e); }
}
