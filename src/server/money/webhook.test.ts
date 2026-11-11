/**
 * Webhook ingress tests (F3.12, P7): dedupe by transmission id, quarantine of unverified events, effects.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { tranches, webhookEvents } from "@/db/schema";
import { mockControl } from "@/lib/rails/mock";
import { newId } from "@/lib/ids";
import { confirmTranche, fundTranche, ledgerFor, releaseMilestone } from "./index";
import { ingestPaypalWebhook } from "./webhook";
import { makeContract, recordApproval, setMilestoneState } from "./fixtures";

beforeAll(() => { delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_WEBHOOK_ID; process.env.MONEY_RETRY_MS = "0"; });
beforeEach(() => mockControl.reset());
afterAll(async () => { await pool.end(); });

const hdr = (id: string, sim = true) => new Headers({ "paypal-transmission-id": id, "content-type": "application/json", ...(sim ? { "x-paysettle-sim": "1" } : {}) });
const ms3 = [{ day: 3, amountCents: 20_000 }, { day: 8, amountCents: 20_000 }, { day: 14, amountCents: 20_000 }];

describe("F3.12 webhook ingress", () => {
  it("F3.12 a duplicate transmission id is a 200 no-op; CHECKOUT.ORDER.APPROVED confirms the hold once", async () => {
    const f = await makeContract({ milestones: ms3 });
    const { approveUrl } = await fundTranche({ id: f.clientId, role: "client" }, f.trancheId);
    const orderId = new URL(approveUrl).searchParams.get("token")!;
    const tid = newId("wh");
    const body = JSON.stringify({ id: "WH-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: orderId, status: "APPROVED" } });
    const first = await ingestPaypalWebhook(body, hdr(tid));
    expect(first).toMatchObject({ status: 200, state: "PROCESSED" });
    const second = await ingestPaypalWebhook(body, hdr(tid));
    expect(second).toMatchObject({ status: 200, state: "DUPLICATE" });
    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.transmissionId, tid));
    expect(row).toMatchObject({ state: "PROCESSED", verified: true, type: "CHECKOUT.ORDER.APPROVED" });
    expect((await db.select().from(tranches).where(eq(tranches.id, f.trancheId)))[0].state).toBe("HELD");
    expect((await ledgerFor(f.trancheId)).filter((e) => e.type === "HOLD")).toHaveLength(1);
  });

  it("F3.12 P7 an event that cannot be verified is quarantined with 400 and has no effect", async () => {
    const f = await makeContract({ milestones: ms3 });
    const { approveUrl } = await fundTranche({ id: f.clientId, role: "client" }, f.trancheId);
    const orderId = new URL(approveUrl).searchParams.get("token")!;
    const tid = newId("wh");
    const r = await ingestPaypalWebhook(JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: orderId } }), hdr(tid, false));
    expect(r).toMatchObject({ status: 400, state: "QUARANTINED" });
    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.transmissionId, tid));
    expect(row).toMatchObject({ state: "QUARANTINED", verified: false });
    expect((await db.select().from(tranches).where(eq(tranches.id, f.trancheId)))[0].state).toBe("AWAITING_APPROVAL");
    expect((await ingestPaypalWebhook("{}", new Headers())).status).toBe(400);
  });

  it("F3.12 F4.10 CUSTOMER.DISPUTE.CREATED blocks releases on that tranche", async () => {
    const f = await makeContract({ milestones: ms3 });
    const { approveUrl } = await fundTranche({ id: f.clientId, role: "client" }, f.trancheId);
    await confirmTranche(null, f.trancheId, new URL(approveUrl).searchParams.get("token")!);
    const [t] = await db.select().from(tranches).where(eq(tranches.id, f.trancheId));
    const r = await ingestPaypalWebhook(JSON.stringify({ event_type: "CUSTOMER.DISPUTE.CREATED", resource: { id: "PP-D-1234", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", disputed_transactions: [{ seller_transaction_id: t.authorizationId }] } }), hdr(newId("wh")));
    expect(r.state).toBe("PROCESSED");
    await setMilestoneState(f.milestoneIds[0], "APPROVED");
    await expect(releaseMilestone({ id: f.clientId, role: "client" }, f.milestoneIds[0], { kind: "MILESTONE", approvalSig: await recordApproval(f.milestoneIds[0], { by: f.clientId }) })).rejects.toThrow(/PayPal dispute/);
    expect(mockControl.txns().filter((x) => x.type === "CAPTURE")).toHaveLength(0);
  });

  it("F3.12 an event for an unknown order goes to the dead-letter state with the error text", async () => {
    const tid = newId("wh");
    const r = await ingestPaypalWebhook(JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "NO-SUCH-ORDER" } }), hdr(tid));
    expect(r.state).toBe("DEAD");
    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.transmissionId, tid));
    expect(row.state).toBe("DEAD");
    expect(row.error).toMatch(/no tranche/);
  });
});
