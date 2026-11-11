/**
 * PayPal webhook ingress (F3.12, P7; PRD §7.3). Store the raw event keyed by paypal-transmission-id (duplicates are a
 * 200 no-op), verify the signature with PayPal, then apply it. Failures land in state DEAD with the error text; replay is
 * the control plane's job (it calls processWebhookEvent with the stored transmission id).
 * F4.10: CUSTOMER.DISPUTE.CREATED blocks releases on the tranche, supersedes the internal PaySettle dispute on its
 * milestones, then sends the evidence dossier to PayPal (representment, through the rail with a stored key — P1, P2).
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { disputes, releases, refunds, tranches, webhookEvents, wsMilestones } from "@/db/schema";
import { audit } from "@/lib/audit";
import { sandboxMode } from "@/lib/clock";
import { pp } from "@/lib/rails/paypal";
import { representDispute, type RailResolver } from "@/server/representment";
import { confirmTranche } from "./index";
import { SYSTEM, loadTranche, loadWorkspace, notify, railOf } from "./internal";

/** F4.10: the rail that holds a tranche's money — the one representment sends evidence through. */
export const representmentRail: RailResolver = async (trancheId) => railOf(await loadTranche(db, trancheId));

export interface PaypalEvent { id?: string; event_type?: string; resource_type?: string; resource?: Record<string, unknown>; summary?: string; create_time?: string }
export interface IngestResult { status: number; state: "PROCESSED" | "DUPLICATE" | "QUARANTINED" | "DEAD" | "REJECTED"; transmissionId?: string; note?: string }

const H = ["paypal-transmission-id", "paypal-transmission-time", "paypal-transmission-sig", "paypal-cert-url", "paypal-auth-algo", "x-paysettle-sim"] as const;

export async function ingestPaypalWebhook(raw: string, headers: Headers): Promise<IngestResult> {
  const transmissionId = headers.get("paypal-transmission-id")?.trim();
  if (!transmissionId) return { status: 400, state: "REJECTED", note: "missing paypal-transmission-id" };
  let event: PaypalEvent;
  try { event = JSON.parse(raw) as PaypalEvent; } catch { return { status: 400, state: "REJECTED", transmissionId, note: "body is not JSON" }; }
  const kept: Record<string, string> = {};
  for (const h of H) { const v = headers.get(h); if (v) kept[h] = v; }
  const type = String(event.event_type ?? "UNKNOWN");
  const resourceId = typeof event.resource?.id === "string" ? (event.resource.id as string) : null;
  const inserted = await db.insert(webhookEvents).values({ transmissionId, type, resourceId, verified: false, payload: { event, headers: kept, raw }, state: "RECEIVED" })
    .onConflictDoNothing().returning({ id: webhookEvents.transmissionId });
  if (!inserted.length) {
    await audit(db, SYSTEM, "webhook.duplicate", transmissionId, { type });
    return { status: 200, state: "DUPLICATE", transmissionId };
  }
  const verified = await verify(headers, event);
  await db.update(webhookEvents).set({ verified: verified.ok, state: verified.ok ? "RECEIVED" : "QUARANTINED", error: verified.ok ? null : verified.note }).where(eq(webhookEvents.transmissionId, transmissionId));
  await audit(db, SYSTEM, "webhook.received", transmissionId, { type, verified: verified.ok, via: verified.via });
  if (!verified.ok) return { status: 400, state: "QUARANTINED", transmissionId, note: verified.note };
  const state = await processWebhookEvent(transmissionId);
  return { status: 200, state: state === "PROCESSED" ? "PROCESSED" : "DEAD", transmissionId };
}

async function verify(headers: Headers, event: PaypalEvent): Promise<{ ok: boolean; via: string; note?: string }> {
  if (sandboxMode() && headers.get("x-paysettle-sim") === "1") return { ok: true, via: "sandbox-simulation" };
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return { ok: false, via: "none", note: "PAYPAL_WEBHOOK_ID is not set, so the signature cannot be verified" };
  try {
    const r = await pp<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: headers.get("paypal-auth-algo"), cert_url: headers.get("paypal-cert-url"), transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"), transmission_time: headers.get("paypal-transmission-time"), webhook_id: webhookId, webhook_event: event,
    });
    return r.verification_status === "SUCCESS" ? { ok: true, via: "paypal-verify" } : { ok: false, via: "paypal-verify", note: `verification_status ${r.verification_status ?? "missing"}` };
  } catch (e) {
    return { ok: false, via: "paypal-verify", note: `verification call failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Applies a stored, verified event. Safe to call again (replay): every effect is idempotent. */
export async function processWebhookEvent(transmissionId: string): Promise<"PROCESSED" | "DEAD" | "QUARANTINED"> {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.transmissionId, transmissionId)).limit(1);
  if (!row) throw new Error(`unknown webhook ${transmissionId}`);
  if (!row.verified) return "QUARANTINED";
  const event = ((row.payload as { event?: PaypalEvent }).event ?? (row.payload as PaypalEvent));
  try {
    const note = await apply(event, transmissionId);
    await db.update(webhookEvents).set({ state: "PROCESSED", error: note ?? null }).where(eq(webhookEvents.transmissionId, transmissionId));
    await audit(db, SYSTEM, "webhook.processed", transmissionId, { type: row.type, note });
    return "PROCESSED";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(webhookEvents).set({ state: "DEAD", error: msg.slice(0, 1000) }).where(eq(webhookEvents.transmissionId, transmissionId));
    await audit(db, SYSTEM, "webhook.dead", transmissionId, { type: row.type, error: msg.slice(0, 300) });
    return "DEAD";
  }
}

/** Every string anywhere in the resource (ids of orders, authorizations, captures, transactions, custom ids). */
function idsIn(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") { if (v.length >= 6 && v.length <= 64 && !v.includes(" ")) out.add(v); }
  else if (Array.isArray(v)) v.forEach((x) => idsIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => idsIn(x, out));
  return out;
}
async function trancheMatching(ids: string[]) {
  if (!ids.length) return [];
  const direct = await db.select().from(tranches).where(or(inArray(tranches.id, ids), inArray(tranches.paypalOrderId, ids), inArray(tranches.authorizationId, ids), inArray(tranches.captureId, ids)));
  const viaRel = await db.select({ t: tranches }).from(releases).innerJoin(tranches, eq(tranches.id, releases.trancheId)).where(inArray(releases.paypalRef, ids));
  const all = new Map([...direct, ...viaRel.map((x) => x.t)].map((t) => [t.id, t]));
  return [...all.values()];
}

async function apply(e: PaypalEvent, transmissionId: string): Promise<string | undefined> {
  const res = e.resource ?? {};
  const rid = typeof res.id === "string" ? res.id : undefined;
  switch (e.event_type) {
    case "CHECKOUT.ORDER.APPROVED": {
      if (!rid) throw new Error("order id missing");
      const [t] = await db.select().from(tranches).where(eq(tranches.paypalOrderId, rid)).limit(1);
      if (!t) throw new Error(`no tranche for order ${rid}`);
      await confirmTranche(null, t.id, rid);
      return `confirmed tranche ${t.id}`;
    }
    case "PAYMENT.CAPTURE.COMPLETED": {
      if (!rid) throw new Error("capture id missing");
      const done = await db.update(releases).set({ status: "COMPLETED", completedAt: new Date() }).where(sql`${releases.paypalRef} = ${rid} AND ${releases.status} = 'IN_FLIGHT'`).returning({ id: releases.id });
      if (done.length) return `release ${done[0].id} completed`;
      const orderId = ((res.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids?.order_id);
      const [t] = orderId ? await db.select().from(tranches).where(eq(tranches.paypalOrderId, orderId)).limit(1) : [];
      if (t && t.state === "AWAITING_APPROVAL") { await confirmTranche(null, t.id, orderId); return `confirmed tranche ${t.id} (Rail B capture)`; }
      return "capture already recorded";
    }
    case "PAYMENT.CAPTURE.REFUNDED": {
      if (!rid) throw new Error("refund id missing");
      const done = await db.update(refunds).set({ status: "COMPLETED" }).where(sql`${refunds.paypalRef} = ${rid} AND ${refunds.status} <> 'COMPLETED'`).returning({ id: refunds.id });
      if (done.length) return `return ${done[0].id} completed`;
      const [known] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.paypalRef, rid)).limit(1);
      if (known) return "refund already recorded";
      await audit(db, SYSTEM, "money.external_refund", rid, { note: "refund made outside PaySettle; reconciliation will flag it", resource: res });
      return "refund not made by PaySettle (left for reconciliation)";
    }
    case "PAYMENT.AUTHORIZATION.VOIDED": {
      if (!rid) throw new Error("authorization id missing");
      const [t] = await db.select().from(tranches).where(eq(tranches.authorizationId, rid)).limit(1);
      if (!t) throw new Error(`no tranche for authorization ${rid}`);
      const [ours] = await db.select({ id: refunds.id }).from(refunds).where(eq(refunds.paypalRef, `void:${rid}`)).limit(1);
      if (ours) return "void already recorded";
      await db.update(tranches).set({ warned: sql`${tranches.warned} || '["EXTERNAL_VOID"]'::jsonb` }).where(sql`${tranches.id} = ${t.id} AND NOT (${tranches.warned} @> '["EXTERNAL_VOID"]'::jsonb)`);
      await audit(db, SYSTEM, "money.external_void", t.id, { authorizationId: rid });
      return "authorization voided outside PaySettle (flagged)";
    }
    case "CUSTOMER.DISPUTE.CREATED": {
      const disputeId = typeof res.dispute_id === "string" ? res.dispute_id : rid;
      const ts = await trancheMatching([...idsIn(res)]);
      if (!ts.length) throw new Error("no tranche matches the disputed transaction");
      for (const t of ts) {
        const r = await db.update(tranches).set({ warned: sql`${tranches.warned} || '["EXTERNAL_DISPUTE"]'::jsonb` })
          .where(sql`${tranches.id} = ${t.id} AND NOT (${tranches.warned} @> '["EXTERNAL_DISPUTE"]'::jsonb)`).returning({ id: tranches.id });
        if (r.length) {
          const w = await loadWorkspace(db, t.workspaceId);
          await notify(db, w, t.id, "EXTERNAL_DISPUTE", `A PayPal dispute was opened on “${w.title}” (tranche ${t.idx}). PaySettle pauses all releases on this tranche until PayPal resolves it.`, `extdispute:${t.id}`);
          await audit(db, SYSTEM, "money.external_dispute", t.id, { disputeId, reason: res.reason });
        }
      }
      /* F4.10: an internal dispute on a milestone of these tranches gives way to PayPal's (the disputes module's rule) */
      const superseded = await supersedeInternal(ts.map((t) => ({ workspaceId: t.workspaceId, idx: t.idx })), disputeId ?? transmissionId);
      /* F4.10: representment — the dossier goes to PayPal through the rail that holds the money */
      let rep = "";
      if (disputeId) {
        const row = await representDispute({ disputeId, reason: typeof res.reason === "string" ? res.reason : null, transmissionId, trancheIds: ts.map((t) => t.id) }, representmentRail);
        rep = `; evidence dossier ${row.status.toLowerCase().replace("_", " ")}${row.lastError ? ` (${row.lastError.slice(0, 120)})` : ""}`;
      }
      return `releases blocked on ${ts.map((t) => t.id).join(", ")}${superseded ? `; ${superseded} internal dispute(s) superseded` : ""}${rep}`;
    }
    default:
      return `ignored ${e.event_type ?? "event"}`;
  }
}

/** Supersedes open PaySettle disputes on the milestones of the given tranches. Returns how many changed. */
async function supersedeInternal(list: { workspaceId: string; idx: number }[], externalRef: string): Promise<number> {
  const ms = await db.select({ id: wsMilestones.id }).from(wsMilestones).innerJoin(disputes, eq(disputes.milestoneId, wsMilestones.id))
    .where(or(...list.map((t) => and(eq(wsMilestones.workspaceId, t.workspaceId), eq(wsMilestones.trancheIdx, t.idx)))));
  if (!ms.length) return 0;
  const { supersedeByExternal } = await import("@/server/disputes");
  let n = 0;
  for (const m of ms) if (await supersedeByExternal(m.id, `paypal:${externalRef}`)) n += 1;
  return n;
}
