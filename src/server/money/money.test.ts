/**
 * Money module tests (DB-backed, MockRail): F3.01, F3.02, F3.07, F3.08, F3.10, F3.11, F4.08.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { auditChain, ledgerEntries, refunds, releases, tranches, wsMilestones } from "@/db/schema";
import { moneyNotices } from "@/db/schema-money";
import { mockControl } from "@/lib/rails/mock";
import { RailError, type FundInput, type HoldState, type Rail } from "@/lib/rails";
import { DomainError, type Actor } from "../types";
import { confirmTranche, fundTranche, ledgerFor, releaseMilestone, returnToClient, rollover, runWatchdog } from "./index";
import { checkInvariant } from "./queries";
import { setTestRail } from "./internal";
import { makeContract, recordApproval, recordVerdict, setMilestoneState, setOffset, type Fixture } from "./fixtures";

beforeAll(() => { delete process.env.PAYPAL_CLIENT_ID; process.env.MONEY_RETRY_MS = "0"; });
beforeEach(() => mockControl.reset());
afterAll(async () => { await pool.end(); });

const client = (f: Fixture): Actor => ({ id: f.clientId, role: "client" });
const mediator: Actor = { id: "u_med", role: "mediator" };
const tranche = async (id: string) => (await db.select().from(tranches).where(eq(tranches.id, id)))[0];
const milestone = async (id: string) => (await db.select().from(wsMilestones).where(eq(wsMilestones.id, id)))[0];
const captures = () => mockControl.txns().filter((t) => t.type === "CAPTURE");

async function funded(ms: { day: number; amountCents: number; type?: "GATE" | "PAY" }[], rail: "MOCK" | "A1" = "MOCK") {
  const f = await makeContract({ milestones: ms, rail });
  const { approveUrl } = await fundTranche(client(f), f.trancheId);
  const token = new URL(approveUrl).searchParams.get("token")!;
  await confirmTranche(client(f), f.trancheId, token);
  return f;
}
async function approveAndRelease(f: Fixture, i: number) {
  await setMilestoneState(f.milestoneIds[i], "APPROVED");
  return releaseMilestone(client(f), f.milestoneIds[i], { kind: "MILESTONE", approvalSig: await recordApproval(f.milestoneIds[i], { by: f.clientId }) });
}

describe("F3.01 F3.02 fund and confirm", () => {
  it("F3.01 only the client of a locked contract can fund; the mock approval link returns to our handler", async () => {
    const f = await makeContract({ milestones: [{ day: 3, amountCents: 85_000 }, { day: 8, amountCents: 212_500 }, { day: 14, amountCents: 255_000 }] });
    await expect(fundTranche({ id: f.providerId, role: "provider" }, f.trancheId)).rejects.toBeInstanceOf(DomainError);
    const { approveUrl } = await fundTranche(client(f), f.trancheId);
    expect(approveUrl).toContain(`/api/paypal/return?tranche=${f.trancheId}`);
    expect(approveUrl).toContain("token=MOCKORD-");
    const t = await tranche(f.trancheId);
    expect(t.state).toBe("AWAITING_APPROVAL");
    expect((await fundTranche(client(f), f.trancheId)).approveUrl).toBe(approveUrl); // repeat click = same order
  });

  it("F3.02 confirm writes one HOLD entry, starts the 29-day window and opens the first milestone (idempotent)", async () => {
    const f = await funded([{ day: 3, amountCents: 85_000 }, { day: 8, amountCents: 212_500 }, { day: 14, amountCents: 255_000 }]);
    await confirmTranche(null, f.trancheId); // webhook arriving after the return page: no-op
    const t = await tranche(f.trancheId);
    expect(t.state).toBe("HELD");
    expect(t.authorizationId).toMatch(/^MOCKAUTH-/);
    expect(Math.round((t.windowEndsAt!.getTime() - t.heldAt!.getTime()) / 86_400_000)).toBe(29);
    const led = await ledgerFor(f.trancheId);
    expect(led.filter((e) => e.type === "HOLD")).toHaveLength(1);
    expect(led[0]).toMatchObject({ debit: `paypal:hold:${f.trancheId}`, credit: `client:${f.clientId}`, amountCents: 552_500 });
    expect((await milestone(f.milestoneIds[0])).state).toBe("OPEN");
    expect((await milestone(f.milestoneIds[1])).state).toBe("LOCKED");
  });
});

describe("F3.07 F3.08 F3.11 release", () => {
  it("F3.11 fund → confirm → release × n → close keeps the ledger balanced (PRD §6.3 fees)", async () => {
    const f = await funded([{ day: 3, amountCents: 85_000 }, { day: 8, amountCents: 212_500 }, { day: 14, amountCents: 255_000 }]);
    const r1 = await approveAndRelease(f, 0);
    expect(r1).toMatchObject({ feeCents: 2_125, netCents: 82_875 });
    expect((await milestone(f.milestoneIds[1])).state).toBe("OPEN"); // sequential unlock
    expect((await tranche(f.trancheId)).state).toBe("PARTIALLY_RELEASED");
    const r2 = await approveAndRelease(f, 1);
    expect(r2.feeCents).toBe(5_312); // 5,312.5 → half-even
    await approveAndRelease(f, 2);
    expect((await tranche(f.trancheId)).state).toBe("CLOSED");
    const inv = await checkInvariant(f.trancheId);
    expect(inv.ok).toBe(true);
    expect(inv.balance).toMatchObject({ held: 552_500, released: 552_500, returned: 0, remaining: 0 });
    const caps = captures();
    expect(caps.map((c) => c.amountCents)).toEqual([85_000, 212_500, 255_000]);
    const rel = await db.select().from(releases).where(eq(releases.trancheId, f.trancheId));
    expect(rel.every((r) => r.status === "COMPLETED")).toBe(true);
  });

  it("F3.07 releasing the same milestone twice (even concurrently) is one payout", async () => {
    const f = await funded([{ day: 3, amountCents: 50_000 }, { day: 8, amountCents: 50_000 }, { day: 14, amountCents: 50_000 }]);
    await setMilestoneState(f.milestoneIds[0], "APPROVED");
    const approvalSig = await recordApproval(f.milestoneIds[0], { by: f.clientId });
    const call = () => releaseMilestone(client(f), f.milestoneIds[0], { kind: "MILESTONE", approvalSig });
    const [a, b] = await Promise.all([call(), call()]);
    const c = await call();
    expect(a.releaseId).toBe(b.releaseId);
    expect(c.releaseId).toBe(a.releaseId);
    expect(captures()).toHaveLength(1);
    expect(await db.select().from(releases).where(eq(releases.milestoneId, f.milestoneIds[0]))).toHaveLength(1);
    expect((await ledgerFor(f.trancheId)).filter((e) => e.type === "RELEASE")).toHaveLength(1);
  });

  it("F3.07 P4 a release without a signed approval is refused", async () => {
    const f = await funded([{ day: 3, amountCents: 50_000 }, { day: 8, amountCents: 50_000 }, { day: 14, amountCents: 50_000 }]);
    await setMilestoneState(f.milestoneIds[0], "APPROVED");
    await expect(releaseMilestone(client(f), f.milestoneIds[0], { kind: "MILESTONE", approvalSig: " " })).rejects.toThrow(/signed approval/);
    expect(captures()).toHaveLength(0);
  });

  it("F3.07 P4 a made-up approval signature is refused: APPROVAL_REQUIRED, no release row, no capture", async () => {
    const f = await funded([{ day: 3, amountCents: 50_000 }, { day: 8, amountCents: 50_000 }, { day: 14, amountCents: 50_000 }]);
    await setMilestoneState(f.milestoneIds[0], "APPROVED");
    for (const fake of ["seed-demo-approval:" + f.milestoneIds[0], "sig:" + f.milestoneIds[0], "0".repeat(64)]) {
      await expect(releaseMilestone(client(f), f.milestoneIds[0], { kind: "MILESTONE", approvalSig: fake })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    }
    // a real approval for a different milestone does not authorise this one
    const other = await recordApproval(f.milestoneIds[1], { by: f.clientId });
    await expect(releaseMilestone(client(f), f.milestoneIds[0], { kind: "MILESTONE", approvalSig: other })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(await db.select().from(releases).where(eq(releases.milestoneId, f.milestoneIds[0]))).toHaveLength(0);
    expect(captures()).toHaveLength(0);
  });

  it("F3.07 P4 the deemed-approval signature recorded by the review timer authorises the release", async () => {
    const f = await funded([{ day: 3, amountCents: 40_000 }, { day: 8, amountCents: 40_000 }]);
    await setMilestoneState(f.milestoneIds[0], "APPROVED");
    const sig = await recordApproval(f.milestoneIds[0], { decision: "DEEMED_APPROVED" });
    const r = await releaseMilestone(client(f), f.milestoneIds[0], { kind: "MILESTONE", approvalSig: sig });
    expect(r.netCents).toBe(39_000);
    expect(captures()).toHaveLength(1);
  });

  it("F4.08 P4 a verdict release needs the dispute's signed verdict, not any string", async () => {
    const f = await funded([{ day: 3, amountCents: 30_000 }, { day: 8, amountCents: 30_000 }]);
    await setMilestoneState(f.milestoneIds[1], "DISPUTED");
    await expect(releaseMilestone(mediator, f.milestoneIds[1], { kind: "VERDICT", amountCents: 10_000, approvalSig: "verdict-sig" })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    const clientSig = await recordApproval(f.milestoneIds[1], { by: f.clientId }); // a client approval is not a verdict
    await expect(releaseMilestone(mediator, f.milestoneIds[1], { kind: "VERDICT", amountCents: 10_000, approvalSig: clientSig })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(captures()).toHaveLength(0);
  });

  it("F3.08 an injected release_503 is retried with the same idempotency key", async () => {
    const f = await funded([{ day: 3, amountCents: 40_000 }, { day: 8, amountCents: 40_000 }, { day: 14, amountCents: 40_000 }]);
    mockControl.inject("release_503");
    const r = await approveAndRelease(f, 0);
    const [row] = await db.select().from(releases).where(eq(releases.id, r.releaseId));
    expect(row.status).toBe("COMPLETED");
    expect(captures()).toHaveLength(1);
    expect(row.paypalRef).toBe(captures()[0].id);
    const tried = await db.select().from(auditChain).where(and(eq(auditChain.action, "money.release"), eq(auditChain.target, f.milestoneIds[0])));
    expect(tried).toHaveLength(1);
    expect((tried[0].detail as { idemKey: string }).idemKey).toBe(row.idemKey);
  });
});

describe("F4.08 returns", () => {
  it("F4.08 a return never exceeds what is held; the last remainder is voided and the ledger balances", async () => {
    const f = await funded([{ day: 3, amountCents: 30_000 }, { day: 8, amountCents: 30_000 }, { day: 14, amountCents: 30_000 }]);
    await expect(returnToClient(mediator, f.trancheId, 90_001, "too much", "k-too-much")).rejects.toThrow(/never exceed/);
    await approveAndRelease(f, 0);
    await expect(returnToClient(mediator, f.trancheId, 60_001, "too much", "k-too-much-2")).rejects.toThrow(/never exceed/);
    const r1 = await returnToClient(mediator, f.trancheId, 20_000, "verdict refund leg", `k1-${f.trancheId}`);
    const again = await returnToClient(mediator, f.trancheId, 20_000, "verdict refund leg", `k1-${f.trancheId}`);
    expect(again.refundId).toBe(r1.refundId);
    const [rec] = await db.select().from(refunds).where(eq(refunds.id, r1.refundId));
    expect(rec.status).toBe("RECORDED"); // Rail A: still authorized, never captured
    await returnToClient(mediator, f.trancheId, 40_000, "terminate remainder", `k2-${f.trancheId}`);
    expect(mockControl.txns().filter((t) => t.type === "VOID")).toHaveLength(1);
    expect((await tranche(f.trancheId)).state).toBe("CLOSED");
    const inv = await checkInvariant(f.trancheId);
    expect(inv.ok).toBe(true);
    expect(inv.balance).toMatchObject({ held: 90_000, released: 30_000, returned: 60_000, remaining: 0 });
    await expect(returnToClient(mediator, f.trancheId, 1, "after close", `k3-${f.trancheId}`)).rejects.toThrow(/never exceed/);
  });

  it("F4.08 the client cannot return money to themselves", async () => {
    const f = await funded([{ day: 3, amountCents: 30_000 }, { day: 8, amountCents: 30_000 }, { day: 14, amountCents: 30_000 }]);
    await expect(returnToClient(client(f), f.trancheId, 100, "self", "k-self")).rejects.toThrow(/verdict|Operations/);
  });

  it("F4.08 a verdict release after the refund leg uses final capture and closes the tranche", async () => {
    const f = await funded([{ day: 3, amountCents: 30_000 }, { day: 8, amountCents: 30_000 }, { day: 14, amountCents: 30_000 }]);
    await approveAndRelease(f, 0); await approveAndRelease(f, 1);
    await setMilestoneState(f.milestoneIds[2], "DISPUTED");
    await returnToClient(mediator, f.trancheId, 12_000, "verdict refund leg", `leg1-${f.trancheId}`);
    const r = await releaseMilestone(mediator, f.milestoneIds[2], { kind: "VERDICT", amountCents: 18_000, approvalSig: await recordVerdict(f.milestoneIds[2], { refundCents: 12_000, releaseCents: 18_000 }) });
    expect(r.feeCents).toBe(450);
    expect((await milestone(f.milestoneIds[2])).state).toBe("SETTLED_BY_VERDICT");
    expect((await tranche(f.trancheId)).state).toBe("CLOSED");
    expect((await checkInvariant(f.trancheId)).ok).toBe(true);
  });
});

describe("F3.10 watchdog and rollover", () => {
  it("F3.10 day 22 / 25 / 27 actions fire once each on the virtual clock; day 27 returns unstarted money", async () => {
    const f = await funded([{ day: 3, amountCents: 30_000 }, { day: 8, amountCents: 30_000 }, { day: 14, amountCents: 30_000 }, { day: 20, amountCents: 10_000 }]);
    await approveAndRelease(f, 0);
    await setMilestoneState(f.milestoneIds[1], "SUBMITTED"); // under review at day 27 → carried into a re-fund tranche
    const now = () => new Date();
    await setOffset(f.workspaceId, 22 * 24 + 1);
    const a22 = (await runWatchdog(now(), f.workspaceId)).actions.map((a) => a.action);
    expect(a22).toEqual(["REAUTHORIZE_IF_NEEDED", "WARN"]);
    expect((await runWatchdog(now(), f.workspaceId)).actions).toEqual([]);
    expect((await tranche(f.trancheId)).reauthorized).toBe(true);
    const warns = await db.select().from(moneyNotices).where(and(eq(moneyNotices.trancheId, f.trancheId), eq(moneyNotices.kind, "WARN")));
    expect(warns).toHaveLength(2); // client and provider
    await setOffset(f.workspaceId, 25 * 24 + 1);
    expect((await runWatchdog(now(), f.workspaceId)).actions.map((a) => a.action)).toEqual(["OFFER_ROLLOVER"]);
    expect((await runWatchdog(now(), f.workspaceId)).actions).toEqual([]);
    await setOffset(f.workspaceId, 27 * 24 + 1);
    expect((await runWatchdog(now(), f.workspaceId)).actions.map((a) => a.action)).toEqual(["SETTLE"]);
    expect((await runWatchdog(now(), f.workspaceId)).actions).toEqual([]);
    const t = await tranche(f.trancheId);
    expect(t.state).toBe("CLOSED");
    expect(t.warned).toEqual(expect.arrayContaining(["WARN", "OFFER_ROLLOVER", "SETTLE"]));
    expect((await milestone(f.milestoneIds[2])).state).toBe("REFUNDED");
    expect((await milestone(f.milestoneIds[3])).state).toBe("REFUNDED");
    const carried = await milestone(f.milestoneIds[1]);
    expect(carried.state).toBe("SUBMITTED");
    expect(carried.trancheIdx).toBe(2);
    const [t2] = await db.select().from(tranches).where(and(eq(tranches.workspaceId, f.workspaceId), eq(tranches.idx, 2)));
    expect(t2).toMatchObject({ state: "PLANNED", amountCents: 30_000 });
    const inv = await checkInvariant(f.trancheId);
    expect(inv.ok).toBe(true);
    expect(inv.balance).toMatchObject({ held: 100_000, released: 30_000, returned: 70_000, remaining: 0 });
    expect(mockControl.txns().filter((x) => x.type === "VOID")).toHaveLength(1);
  });

  it("F3.10 rollover returns the unfinished part and plans a new tranche for the buyer to approve", async () => {
    const f = await funded([{ day: 3, amountCents: 30_000 }, { day: 8, amountCents: 30_000 }, { day: 14, amountCents: 30_000 }]);
    await approveAndRelease(f, 0);
    const { newTrancheId } = await rollover({ id: f.providerId, role: "provider" }, f.trancheId);
    expect((await rollover(client(f), f.trancheId)).newTrancheId).toBe(newTrancheId);
    const old = await tranche(f.trancheId), next = await tranche(newTrancheId);
    expect(old.state).toBe("ROLLED_OVER");
    expect(next).toMatchObject({ state: "PLANNED", idx: 2, amountCents: 60_000 });
    expect((await checkInvariant(f.trancheId)).ok).toBe(true);
    const { approveUrl } = await fundTranche(client(f), newTrancheId);
    await confirmTranche(null, newTrancheId, new URL(approveUrl).searchParams.get("token")!);
    expect((await milestone(f.milestoneIds[1])).state).toBe("OPEN");
    await approveAndRelease(f, 1); await approveAndRelease(f, 2);
    expect((await tranche(newTrancheId)).state).toBe("CLOSED");
    expect((await checkInvariant(newTrancheId)).ok).toBe(true);
  });
});

describe("F3.11 ledger shape", () => {
  it("F3.11 every entry is integer cents with a debit and a credit account", async () => {
    const f = await funded([{ day: 3, amountCents: 33_333 }, { day: 8, amountCents: 33_333 }, { day: 14, amountCents: 33_334 }]);
    await approveAndRelease(f, 0);
    const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.trancheId, f.trancheId));
    for (const r of rows) { expect(Number.isSafeInteger(r.amountCents)).toBe(true); expect(r.debit).not.toBe(r.credit); }
    expect(rows.map((r) => r.type).sort()).toEqual(["FEE", "HOLD", "RELEASE"]);
  });
});

describe("F3.02 a PayPal order that no longer exists", () => {
  it("F3.02 the watchdog puts the tranche back to unfunded once; the next funding is a fresh order with its own key", async () => {
    const keys: string[] = [];
    let n = 0;
    const gone = new Set<string>();
    /* a PayPal-like rail: the first order is unknown to PayPal by the time the watchdog polls it (404 RESOURCE_NOT_FOUND) */
    const rail = {
      id: "A1",
      async fund(i: FundInput) { keys.push(i.idemKey); n += 1; const id = `DEAD-${n}-${i.trancheId.slice(-6)}`; if (n === 1) gone.add(id); return { orderId: id, approveUrl: `https://sim.invalid/approve?token=${id}` }; },
      async status(orderId: string): Promise<HoldState> {
        if (gone.has(orderId)) throw new RailError("BUG", `PayPal 404 INVALID_RESOURCE_ID on /v2/checkout/orders/${orderId}`, { name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] });
        return { status: "CREATED", heldCents: 0, capturedCents: 0 };
      },
    } as unknown as Rail;
    const f = await makeContract({ milestones: [{ day: 3, amountCents: 40_000 }], rail: "A1" });
    setTestRail((t) => (t.id === f.trancheId ? rail : null));
    try {
      const first = await fundTranche(client(f), f.trancheId);
      expect((await tranche(f.trancheId)).state).toBe("AWAITING_APPROVAL");
      const w = await runWatchdog(new Date(), f.workspaceId);
      expect(w.actions).toContainEqual({ trancheId: f.trancheId, action: "ORDER_GONE" });
      const t = await tranche(f.trancheId);
      expect(t).toMatchObject({ state: "PLANNED", paypalOrderId: null, approveUrl: null });
      const audits = await db.select().from(auditChain).where(eq(auditChain.target, f.trancheId));
      expect(audits.filter((a) => a.action === "money.order_refused")).toHaveLength(1);
      // funding again does not hand back the dead link: a new order under a new idempotency key
      const second = await fundTranche(client(f), f.trancheId);
      expect(second.approveUrl).not.toBe(first.approveUrl);
      expect(new Set(keys).size).toBe(2);
      // the live order is simply still waiting: no error, nothing dropped
      expect((await runWatchdog(new Date(), f.workspaceId)).actions).toEqual([]);
      expect((await tranche(f.trancheId)).state).toBe("AWAITING_APPROVAL");
      expect((await db.select().from(auditChain).where(eq(auditChain.target, f.trancheId))).filter((a) => a.action === "money.watchdog_error")).toHaveLength(0);
    } finally { setTestRail(null); }
  });
});
