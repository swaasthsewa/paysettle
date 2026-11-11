/**
 * A2 · POST /api/ai/compile: lint milestone criteria live from the contract editor (signed-in only).
 * Body: { items: [{ code, title, criteria: string[] }] }. Returns AiResult rows, one per criterion, code `${code}#${n}`.
 * Without AI the rule-based linter still answers (available: false, model: "rules"). Advisory only (P3): writes nothing but ai_calls.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { compileCriteria } from "@/server/ai";
import { viewer } from "@/lib/session";
export const dynamic = "force-dynamic";

const body = z.object({
  items: z.array(z.object({ code: z.string().min(1).max(40), title: z.string().max(200).default(""), criteria: z.array(z.string().max(500)).max(12) })).min(1).max(60),
});
const hits = new Map<string, number[]>();
function limited(userId: string): boolean {
  const now = Date.now(), list = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  list.push(now); hits.set(userId, list);
  return list.length > 30;
}

export async function POST(req: Request) {
  const v = await viewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (limited(v.id)) return NextResponse.json({ error: "Too many checks in a minute; wait a moment." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  return NextResponse.json(await compileCriteria(parsed.data.items));
}
