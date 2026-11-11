/**
 * Platform health and scheduled checks (F5.04 hourly audit-chain verifier, F5.01 scheduled recon, F5.03 TTL sweep,
 * F5.02 webhook lag).
 */
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { reconRuns, webhookEvents } from "@/db/schema";
import { controlChecks } from "@/db/schema-control";
import { audit, verifyChain } from "@/lib/audit";
import { liveAvailable } from "@/lib/rails";
import { sandboxMode } from "@/lib/clock";
import { aiStatus } from "../ai";
import { NotBuilt } from "../types";
import { expireDue } from "./dual";
import { runReconcile } from "./recon";
import { SYSTEM } from "./common";

export function paypalMode() {
  if (!liveAvailable()) return { mode: "MOCK" as const, label: "Simulated (no PayPal credentials set)", ok: true };
  const env = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
  return { mode: env === "live" ? ("LIVE" as const) : ("SANDBOX" as const), label: env === "live" ? "PayPal live" : "PayPal Sandbox", ok: env === "sandbox" || !sandboxMode() };
}

export async function aiHealth() {
  try { const s = await aiStatus(); return { built: true, ...s }; }
  catch (e) {
    if (e instanceof NotBuilt) return { built: false, available: false, reason: "The AI module is not built yet; rule-based paths are used.", usedTokensToday: 0, capTokens: 0 };
    return { built: true, available: false, reason: e instanceof Error ? e.message : String(e), usedTokensToday: 0, capTokens: 0 };
  }
}

export async function dbHealth() {
  const t = Date.now();
  try { await db.execute(sql`select 1`); return { ok: true, ms: Date.now() - t }; }
  catch (e) { return { ok: false, ms: Date.now() - t, error: e instanceof Error ? e.message : String(e) }; }
}

export async function webhookHealth(now = new Date()) {
  const counts = await db.select({ state: webhookEvents.state, n: sql<number>`count(*)::int` }).from(webhookEvents).groupBy(webhookEvents.state);
  const [oldest] = await db.select({ at: webhookEvents.receivedAt }).from(webhookEvents).where(eq(webhookEvents.state, "RECEIVED")).orderBy(webhookEvents.receivedAt).limit(1);
  const [last] = await db.select({ at: webhookEvents.receivedAt }).from(webhookEvents).orderBy(desc(webhookEvents.receivedAt)).limit(1);
  const by = Object.fromEntries(counts.map((c) => [c.state, c.n])) as Record<string, number>;
  return { counts: by, total: counts.reduce((a, c) => a + c.n, 0), dead: by.DEAD ?? 0, quarantined: by.QUARANTINED ?? 0, lagMs: oldest ? now.getTime() - oldest.at.getTime() : 0, lastReceivedAt: last?.at ?? null };
}

export async function lastRecon() {
  const [r] = await db.select().from(reconRuns).orderBy(desc(reconRuns.createdAt)).limit(1);
  return r ?? null;
}

export async function lastCheck(kind: "AUDIT_VERIFY" | "RECON" | "DC_EXPIRY") {
  const [r] = await db.select().from(controlChecks).where(eq(controlChecks.kind, kind)).orderBy(desc(controlChecks.at)).limit(1);
  return r ?? null;
}

/** Verify the audit chain, store the result, and page admins (control_checks row + audit entry) when it is broken. */
export async function verifyAndRecord(actor: { id: string | null; role: string | null } = SYSTEM) {
  const v = await verifyChain(db);
  await db.insert(controlChecks).values({ kind: "AUDIT_VERIFY", ok: v.ok, detail: { rows: v.rows, brokenAt: v.brokenAt } });
  await audit(db, actor, v.ok ? "audit.verified" : "audit.chain_broken", "audit_chain", { rows: v.rows, brokenAt: v.brokenAt, page: v.ok ? null : "admins" });
  return v;
}

/** The hourly job: TTL sweep, chain verifier, reconciliation. Safe to repeat (each step is idempotent or append-only). */
export async function hourly() {
  const expired = await expireDue();
  await db.insert(controlChecks).values({ kind: "DC_EXPIRY", ok: true, detail: { expired } });
  const chain = await verifyAndRecord();
  const recon = await runReconcile(null, undefined);
  await db.insert(controlChecks).values({ kind: "RECON", ok: recon.verdict !== "DRIFT", detail: { runId: recon.runId, verdict: recon.verdict } });
  return { expired, chain, recon: { runId: recon.runId, verdict: recon.verdict } };
}
