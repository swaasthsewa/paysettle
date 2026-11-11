/**
 * A5 · MCP endpoint (Streamable HTTP, JSON-RPC 2.0, JSON responses; no SSE stream is offered, so GET answers 405).
 * Auth: Authorization: Bearer psa_… (an agent token minted by a signed-in person at POST /api/mcp/token).
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { resolveAgentToken } from "@/server/ai/agent";
import { handleMcp } from "@/server/ai/mcp";
import { realServices } from "@/server/ai/mcp-services";
export const dynamic = "force-dynamic";

const calls = new Map<string, number[]>();
const LIMIT_PER_MIN = 120;
const unauthorized = () => NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or invalid agent token. Mint one in the app: Account → AI & agents." } }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="paysettle-mcp"' } });

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const p = await resolveAgentToken(bearer);
  if (!p) return unauthorized();
  const now = Date.now(), list = (calls.get(p.tokenId) ?? []).filter((t) => now - t < 60_000);
  list.push(now); calls.set(p.tokenId, list);
  if (list.length > LIMIT_PER_MIN) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "Rate limit: at most 120 calls a minute per token." } }, { status: 429 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }); }
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const appUrl = (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/+$/, "");
  const r = await handleMcp(body, { actor: { ...p.actor, requestId }, tokenId: p.tokenId, spendLimitCents: p.spendLimitCents, spentCents: p.spentCents, appUrl }, realServices);
  const isInit = !Array.isArray(body) && (body as { method?: string })?.method === "initialize";
  const headers: Record<string, string> = isInit ? { "Mcp-Session-Id": `${p.tokenId}.${randomUUID()}` } : {};
  if (r.status === 202) return new Response(null, { status: 202, headers });
  return NextResponse.json(r.body, { status: r.status, headers });
}

export async function GET() {
  return new Response("This MCP server answers POST requests with JSON; it does not open an event stream.", { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() { return new Response(null, { status: 204 }); }
