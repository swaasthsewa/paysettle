/** Hourly control-plane job (F5.04 hourly verifier, F5.01 scheduled recon, F5.03 TTL sweep). Cron secret or an admin session. */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { viewer } from "@/lib/session";
import { hourly } from "@/server/control/health";

export const dynamic = "force-dynamic";

function secretOk(req: Request) {
  const want = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!want || !got) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!secretOk(req)) {
    const v = await viewer();
    if (!v || v.role !== "admin") return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const r = await hourly();
  return NextResponse.json({ expired: r.expired, chain: r.chain, recon: r.recon }, { status: r.chain.ok ? 200 : 500 });
}
