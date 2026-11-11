/** A7 · GET /api/ai/status: is AI available, which model, today's token use against the cap. Signed-out callers see availability only. */
import { NextResponse } from "next/server";
import { aiStatus } from "@/server/ai";
import { viewer } from "@/lib/session";
export const dynamic = "force-dynamic";
export async function GET() {
  const s = await aiStatus();
  const v = await viewer();
  if (!v) return NextResponse.json({ available: s.available, reason: s.reason });
  return NextResponse.json(s);
}
