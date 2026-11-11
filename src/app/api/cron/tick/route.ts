/**
 * F3.10 · F3.02 Durable timer tick: hold-expiry watchdog (and approval polling), then evidence review timers (F3.06).
 * Sandbox: any signed-in admin or judge, or the cron secret. Production: header x-cron-secret = CRON_SECRET only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sandboxMode } from "@/lib/clock";
import { viewer } from "@/lib/session";
import { runWatchdog } from "@/server/money";
import { NotBuilt } from "@/server/types";
export const dynamic = "force-dynamic";

function secretOk(req: NextRequest) {
  const want = process.env.CRON_SECRET, got = req.headers.get("x-cron-secret");
  if (!want || !got) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function tick(req: NextRequest) {
  let allowed = secretOk(req);
  if (!allowed && sandboxMode()) { const v = await viewer(); allowed = Boolean(v && (v.role === "admin" || v.role === "judge")); }
  if (!allowed) return NextResponse.json({ ok: false, error: "not allowed" }, { status: 401 });
  const ws = req.nextUrl.searchParams.get("workspace") ?? undefined;
  const now = new Date();
  const out: { ok: boolean; at: string; watchdog: unknown; reviewTimers: unknown; notes: string[] } = { ok: true, at: now.toISOString(), watchdog: [], reviewTimers: [], notes: [] };
  try { out.watchdog = (await runWatchdog(now, ws)).actions; }
  catch (e) { out.ok = false; out.notes.push(`watchdog: ${e instanceof Error ? e.message : String(e)}`); }
  try {
    const evidence = await import("@/server/evidence");
    out.reviewTimers = (await evidence.runReviewTimers(now, ws)).actions;
  } catch (e) {
    if (e instanceof NotBuilt) out.notes.push(e.message); else { out.ok = false; out.notes.push(`review timers: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return NextResponse.json(out, { status: out.ok ? 200 : 500 });
}
export const GET = tick;
export const POST = tick;
