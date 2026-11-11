/**
 * A5 · POST /api/mcp/token (sandbox only, P9): the signed-in person mints a bearer token for their agent.
 * Body (optional): { label, spendLimitCents, ttlHours }. The token is returned once; only its hash is stored.
 * GET lists the person's tokens (no secrets).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { viewer } from "@/lib/session";
import { sandboxMode } from "@/lib/clock";
import { listAgentTokens, mintAgentToken } from "@/server/ai/agent";
import { DomainError } from "@/server/types";
export const dynamic = "force-dynamic";

const body = z.object({ label: z.string().max(60).optional(), spendLimitCents: z.number().int().min(0).max(10_000_000).optional(), ttlHours: z.number().int().min(1).max(720).optional() }).strict();

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host")); } catch { return false; }
}

export async function POST(req: Request) {
  if (!sandboxMode()) return NextResponse.json({ error: "Agent tokens are a sandbox feature in this build." }, { status: 403 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const v = await viewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) { try { raw = JSON.parse(text); } catch { return NextResponse.json({ error: "Body is not JSON." }, { status: 400 }); } }
  const parsed = body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  try {
    const t = await mintAgentToken({ id: v.id, role: v.role, requestId: req.headers.get("x-request-id") ?? undefined }, parsed.data);
    const base = (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/+$/, "");
    return NextResponse.json({ ...t, mcpUrl: `${base}/api/mcp`, note: "Shown once. Use it as: Authorization: Bearer <token>." }, { status: 201 });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    throw e;
  }
}

export async function GET() {
  const v = await viewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return NextResponse.json({ tokens: await listAgentTokens(v.id) });
}
