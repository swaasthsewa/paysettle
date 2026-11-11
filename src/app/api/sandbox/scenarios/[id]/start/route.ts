/** POST /api/sandbox/scenarios/{id}/start — F5.06: start a sim session for scenario S1–S6 in Live or Mock mode. Sandbox only (P9). */
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSim, playgroundState, scenarioOf } from "@/server/playground";
import { body, fail, guard } from "../../../_guard";

export const dynamic = "force-dynamic";
const Body = z.object({ mode: z.enum(["LIVE", "MOCK"]).default("MOCK") });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const j = await guard(); if (j instanceof NextResponse) return j;
  const b = await body(req, Body); if (b instanceof NextResponse) return b;
  try {
    const { id } = await params;
    scenarioOf(id);
    const sim = await createSim(j, id, b.mode);
    return NextResponse.json({ simId: sim.id, mode: sim.mode, state: await playgroundState(sim.id) });
  } catch (e) { return fail(e); }
}
