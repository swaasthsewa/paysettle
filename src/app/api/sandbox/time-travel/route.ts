/**
 * POST /api/sandbox/time-travel {simId, hours} or {simId, toDay} — F5.07 time machine. Adds hours to the sim clock (0–720 h total,
 * forward only), then runs the hold watchdog and review timers for the sim's workspace. Simulated time only; sandbox only (P9).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSim, hoursToDay, playgroundState, timeTravel } from "@/server/playground";
import { assertOwnSim } from "@/server/playground/owner";
import { body, fail, guard } from "../_guard";

export const dynamic = "force-dynamic";
const Body = z.object({ simId: z.string().min(1).max(64), hours: z.number().int().min(1).max(720).optional(), toDay: z.number().int().min(0).max(30).optional() })
  .refine((b) => (b.hours === undefined) !== (b.toDay === undefined), { message: "Give either hours or toDay" });

export async function POST(req: Request) {
  const j = await guard(); if (j instanceof NextResponse) return j;
  const b = await body(req, Body); if (b instanceof NextResponse) return b;
  try {
    await assertOwnSim(b.simId);
    const hours = b.hours ?? hoursToDay(await getSim(b.simId), b.toDay!);
    const result = await timeTravel(j, b.simId, hours);
    return NextResponse.json({ result, state: await playgroundState(b.simId) });
  } catch (e) { return fail(e); }
}
