/** F2.03 polling endpoint for the live negotiation room: the workspace's current revision stamp (no contract content). */
import { NextResponse } from "next/server";
import { viewer } from "@/lib/session";
import { revisionStamp } from "@/server/contracts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const v = await viewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const s = await revisionStamp({ id: v.id, role: v.role }, id);
    return NextResponse.json(s, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
    if (code === "NOT_FOUND") return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (code === "FORBIDDEN") return NextResponse.json({ error: "Not a party to this contract." }, { status: 403 });
    throw e;
  }
}
