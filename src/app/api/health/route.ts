import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { liveAvailable } from "@/lib/rails";
export const dynamic = "force-dynamic";
export async function GET() {
  let database = "ok";
  try { await db.execute(sql`select 1`); } catch { database = "down"; }
  return NextResponse.json({ ok: database === "ok", database, paypal: liveAvailable() ? "sandbox-credentials" : "mock", env: process.env.PAYSETTLE_ENV ?? "sandbox" }, { status: database === "ok" ? 200 : 503 });
}
