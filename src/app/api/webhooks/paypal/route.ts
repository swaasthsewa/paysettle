/** F3.12 · P7 PayPal webhook ingress: raw body stored, signature verified, deduplicated by transmission id. */
import { NextResponse, type NextRequest } from "next/server";
import { ingestPaypalWebhook } from "@/server/money/webhook";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 512_000) return NextResponse.json({ ok: false, state: "REJECTED", note: "body too large" }, { status: 413 });
  const r = await ingestPaypalWebhook(raw, req.headers);
  return NextResponse.json({ ok: r.status === 200, state: r.state, transmissionId: r.transmissionId, note: r.note }, { status: r.status });
}
