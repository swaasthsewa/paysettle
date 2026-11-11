/**
 * F3.07 F3.08 F3.11 P2 P4 P6 — deadline deduction and early bonus through the money service (DB-backed).
 * Rail A1 on the mock rail (authorize, partial captures, void of the remainder) and Rail B semantics on a simulated rail
 * (captured at funding, payouts, refunds). Ledger invariant, three-way check, idempotency, extensions, review time.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { evidencePackages, refunds, releases, tranches, workspaces } from "@/db/schema";
import { evidenceReviews } from "@/db/schema-evidence";
import { deadlineExtensions, releaseAdjustments } from "@/db/schema-money";
import { audit } from "@/lib/audit";
import { DEADLINE_DEFAULTS, type DeadlineTerms } from "@/lib/deadline";
import { DAY, HOUR } from "@/lib/clock";
import { newId, sha256 } from "@/lib/ids";
import { mockControl } from "@/lib/rails/mock";
import { RailError, type EvidenceDossier, type EvidenceRef, type FundInput, type HoldRef, type HoldState, type MoveRef, type PaypalTxn, type Rail, type ReleaseInput } from "@/lib/rails";
import { FIX_WINDOW_HOURS, REVIEW_HOURS } from "@/server/evidence";
import { decideExtension, recordExcusedDays, requestExtension, withdrawExtension } from "@/server/contracts/deadline";
import { DomainError, type Actor } from "../types";
import { confirmTranche, fundTranche, ledgerFor, releaseMilestone } from "./index";
import { checkInvariant } from "./queries";
import { deadlineFacts, EVIDENCE_FIX_WINDOW_HOURS, EVIDENCE_REVIEW_HOURS } from "./deadline";
import { reconcileTranches } from "./deadline-recon";
import { setTestRail } from "./internal";
import { makeContract, recordApproval, setMilestoneState, setOffset, type Fixture } from "./fixtures";

beforeAll(() => { delete process.env.PAYPAL_CLIENT_ID; process.env.MONEY_RETRY_MS = "0"; });
beforeEach(() => mockControl.reset());
afterEach(() => setTestRail(null));
afterAll(async () => { await pool.end(); });

const TERMS: DeadlineTerms = { late: { ...DEADLINE_DEFAULTS.late, milestones: "ALL" }, early: { ...DEADLINE_DEFAULTS.early, poolCents: 5_000, milestones: "ALL" } };
const client = (f: Fixture): Actor => ({ id: f.clientId, role: "client" });
const provider = (f: Fixture): Actor => ({ id: f.providerId, role: "provider" });
const tranche = async (id: string) => (await db.select().from(tranches).where(eq(tranches.id, id)))[0];

/** Web-MVP-like tranche: M01 day 6 $900, M02 day 11 $1,200, M03 day 17 $1,500, plus a bonus pool. */
async function setup(p: { rail?: "MOCK" | "A1" | "B"; terms?: DeadlineTerms; pool?: number } = {}) {
  const f = await makeContract({ rail: p.rail ?? "A1", milestones: [{ day: 6, amountCents: 90_000 }, { day: 11, amountCents: 120_000 }, { day: 17, amountCents: 150_000 }] });
  const terms = p.terms ?? TERMS;
  await db.update(workspaces).set({ deadlineTerms: terms }).where(eq(workspaces.id, f.workspaceId));
  await db.update(tranches).set({ bonusPoolCents: p.pool ?? terms.early?.poolCents ?? 0 }).where(eq(tranches.id, f.trancheId));
  await setOffset(f.workspaceId, 0);
  const { approveUrl } = await fundTranche(client(f), f.trancheId);
  const token = new URL(approveUrl).searchParams.get("token") ?? undefined;
  await confirmTranche(client(f), f.trancheId, token);
  const t = await tranche(f.trancheId);
  return { f, heldAt: t.heldAt!.getTime() };
}

/** Records a submission the way the evidence module does (package + audit row with the virtual review deadline). */
async function submit(milestoneId: string, virtualAt: number, attempt = 1, by = "test"): Promise<string> {
  const note = `evidence ${milestoneId} #${attempt} ${virtualAt}`;
  const id = newId("ev");
  await db.insert(evidencePackages).values({ id, milestoneId, attempt, rootHash: sha256(note), files: [], note, state: "SUBMITTED", submittedBy: by });
  await audit(db, { id: by, role: "provider" }, "evidence.submit", milestoneId, { packageId: id, attempt, reviewDueAt: new Date(virtualAt + REVIEW_HOURS * HOUR).toISOString() });
  return id;
}
async function requestFixAt(milestoneId: string, packageId: string, virtualAt: number) {
  await db.update(evidencePackages).set({ state: "FIX_REQUESTED" }).where(eq(evidencePackages.id, packageId));
  await db.insert(evidenceReviews).values({ id: newId("rv"), packageId, milestoneId, decision: "REQUEST_FIX", items: ["fix it"], rootHash: "x".repeat(64) });
  await audit(db, { id: "test", role: "client" }, "evidence.request_fix", milestoneId, { packageId, fixDueAt: new Date(virtualAt + FIX_WINDOW_HOURS * HOUR).toISOString() });
}
async function approveAndRelease(f: Fixture, i: number) {
  const id = f.milestoneIds[i];
  const [pkg] = await db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, id)).orderBy(evidencePackages.attempt);
  if (pkg) await db.update(evidencePackages).set({ state: "APPROVED" }).where(and(eq(evidencePackages.milestoneId, id), eq(evidencePackages.state, "SUBMITTED")));
  await setMilestoneState(id, "APPROVED");
  return releaseMilestone(client(f), id, { kind: "MILESTONE", approvalSig: await recordApproval(id, { by: f.clientId }) });
}
const due = (heldAt: number, day: number) => heldAt + day * DAY;
const adjOf = async (msId: string) => (await db.select().from(releaseAdjustments).where(eq(releaseAdjustments.milestoneId, msId)))[0];

describe("constants shared with the evidence module", () => {
  it("the money module reads the evidence module's review and fix windows", () => {
    expect(EVIDENCE_REVIEW_HOURS).toBe(REVIEW_HOURS);
    expect(EVIDENCE_FIX_WINDOW_HOURS).toBe(FIX_WINDOW_HOURS);
  });
});

describe("F3.07 F3.08 Rail A1 on the mock rail", () => {
  it("P2 P6 fund with pool → late deduction → early bonus → on time → void of deduction + unused pool; ledger and recon balance", async () => {
    const { f, heldAt } = await setup();
    const tr0 = await tranche(f.trancheId);
    expect(mockControl.txns().find((x) => x.type === "AUTHORIZATION")?.amountCents).toBe(365_000); // milestones + pool, one authorization
    let led = await ledgerFor(f.trancheId);
    expect(led.map((e) => [e.type, e.amountCents])).toEqual([["HOLD", 360_000], ["BONUS_POOL", 5_000]]);
    expect(led[1].paypalRef).toBe(tr0.authorizationId);

    // M01 due day 6, accepted submission 2 days (and an hour) late: 1 grace day → 1 counted day × 50 bps × $900 = $4.50
    await submit(f.milestoneIds[0], due(heldAt, 6) + 2 * DAY + HOUR);
    const preview = await deadlineFacts(f.milestoneIds[0]);
    expect(preview?.basis).toBe("IN_REVIEW");
    expect(preview?.adjustment).toMatchObject({ timing: "LATE", daysLate: 2, countedLateDays: 1, deductionCents: 450 });
    const r1 = await approveAndRelease(f, 0);
    expect(r1).toMatchObject({ feeCents: 2_239, netCents: 87_311 }); // fee on $895.50 released: 2,238.75 → 2,239
    expect(await adjOf(f.milestoneIds[0])).toMatchObject({ timing: "LATE", daysLate: 2, countedDays: 1, deductionCents: 450, bonusCents: 0, releasedCents: 89_550, deductionStatus: "RECORDED" });

    // M02 due day 11, accepted 3 days early: 3 × 25 bps × $1,200 = $9.00 from the pool
    await setOffset(f.workspaceId, 8 * 24);
    await submit(f.milestoneIds[1], due(heldAt, 11) - 3 * DAY + HOUR);
    const r2 = await approveAndRelease(f, 1);
    expect(r2).toMatchObject({ feeCents: 3_022, netCents: 117_878 }); // fee on $1,209.00: 3,022.5 → 3,022 (half to even)
    expect(await adjOf(f.milestoneIds[1])).toMatchObject({ timing: "EARLY", daysEarly: 3, bonusCents: 900, releasedCents: 120_900 });

    // M03 on time: the last capture is not final; the remainder ($4.50 deduction + $41.00 unused pool) is voided
    await submit(f.milestoneIds[2], due(heldAt, 17) - 2 * HOUR);
    await approveAndRelease(f, 2);
    expect(await adjOf(f.milestoneIds[2])).toMatchObject({ timing: "ON_TIME", deductionCents: 0, bonusCents: 0, releasedCents: 150_000 });
    expect(mockControl.txns().filter((x) => x.type === "CAPTURE").map((x) => x.amountCents)).toEqual([89_550, 120_900, 150_000]);
    expect(mockControl.txns().filter((x) => x.type === "VOID").map((x) => x.amountCents)).toEqual([4_550]);
    const t = await tranche(f.trancheId);
    expect(t.state).toBe("CLOSED");

    led = await ledgerFor(f.trancheId);
    const sum = (k: string) => led.filter((e) => e.type === k).reduce((s, e) => s + e.amountCents, 0);
    expect(sum("LATE_DEDUCTION")).toBe(450);
    expect(sum("EARLY_BONUS")).toBe(900);
    expect(sum("POOL_RETURN")).toBe(4_100);
    expect(sum("RELEASE") + sum("FEE")).toBe(360_450);
    expect(led.find((e) => e.type === "POOL_RETURN")?.paypalRef).toBe(`void:${t.authorizationId}`);
    const inv = await checkInvariant(f.trancheId);
    expect(inv.checks.filter((c) => !c.ok)).toEqual([]);
    expect(inv.balance).toMatchObject({ held: 360_000, bonuses: 900, released: 360_450, returned: 450, remaining: 0, pool: { held: 5_000, paid: 900, returned: 4_100, remaining: 0 } });
    expect((await db.select().from(refunds).where(eq(refunds.trancheId, f.trancheId))).every((r) => r.status === "COMPLETED")).toBe(true);

    // three-way check: contract ↔ ledger ↔ (mock) PayPal — zero drift
    const [line] = await reconcileTranches([f.trancheId], { txns: mockControl.txns(), kind: "mock", now: new Date(Date.now() + 60_000) });
    expect(line.issues).toEqual([]);
    expect(line.status).toBe("MATCHED");
  });

  it("F3.07 P2 a repeated release moves nothing more and the adjustment is fixed once", async () => {
    const { f, heldAt } = await setup();
    await submit(f.milestoneIds[0], due(heldAt, 6) + 4 * DAY);
    const a = await approveAndRelease(f, 0);
    const again = await releaseMilestone(client(f), f.milestoneIds[0], { kind: "MILESTONE", approvalSig: (await db.select().from(releases).where(eq(releases.milestoneId, f.milestoneIds[0])))[0].approvalSig });
    expect(again.releaseId).toBe(a.releaseId);
    expect(mockControl.txns().filter((x) => x.type === "CAPTURE")).toHaveLength(1);
    expect(await db.select().from(releaseAdjustments).where(eq(releaseAdjustments.milestoneId, f.milestoneIds[0]))).toHaveLength(1);
    expect((await ledgerFor(f.trancheId)).filter((e) => e.type === "LATE_DEDUCTION")).toHaveLength(1);
    const adj = await adjOf(f.milestoneIds[0]);
    expect(adj.deductionCents).toBe(1_350); // 4 days late − 1 grace = 3 × 50 bps × $900
    expect(adj.deductionIdemKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("P4 deadline terms change nothing about authority: no signed approval, no release, no adjustment", async () => {
    const { f, heldAt } = await setup();
    await submit(f.milestoneIds[0], due(heldAt, 6));
    await setMilestoneState(f.milestoneIds[0], "APPROVED");
    await expect(releaseMilestone(client(f), f.milestoneIds[0], { kind: "MILESTONE", approvalSig: "made-up" })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(await db.select().from(releaseAdjustments).where(eq(releaseAdjustments.milestoneId, f.milestoneIds[0]))).toHaveLength(0);
    expect(mockControl.txns().filter((x) => x.type === "CAPTURE")).toHaveLength(0);
  });

  it("F3.08 pool exhaustion: the second early milestone gets what is left, never more", async () => {
    const { f, heldAt } = await setup({ pool: 1_000 });
    await submit(f.milestoneIds[0], due(heldAt, 6) - 3 * DAY);
    await approveAndRelease(f, 0); // wants 75 bps × $900 = $6.75
    await submit(f.milestoneIds[1], due(heldAt, 11) - 3 * DAY);
    await approveAndRelease(f, 1); // wants $9.00, $3.25 left
    expect(await adjOf(f.milestoneIds[0])).toMatchObject({ bonusCents: 675 });
    const second = await adjOf(f.milestoneIds[1]);
    expect(second).toMatchObject({ bonusCents: 325 });
    expect(second.detail).toMatchObject({ bonusWantedCents: 900, limitedByPool: true });
    await submit(f.milestoneIds[2], due(heldAt, 17) - 5 * DAY);
    await approveAndRelease(f, 2);
    expect(await adjOf(f.milestoneIds[2])).toMatchObject({ timing: "EARLY", bonusCents: 0 });
    const inv = await checkInvariant(f.trancheId);
    expect(inv.ok).toBe(true);
    expect(inv.balance.pool).toEqual({ held: 1_000, paid: 1_000, returned: 0, remaining: 0 });
    expect((await tranche(f.trancheId)).state).toBe("CLOSED");
    expect(mockControl.txns().filter((x) => x.type === "VOID")).toHaveLength(0); // nothing left in the authorization: the last capture was final
  });

  it("F3.07 time under client review is excluded; remediation counts", async () => {
    const { f, heldAt } = await setup();
    const d = due(heldAt, 6);
    const p1 = await submit(f.milestoneIds[0], d + HOUR, 1);
    await requestFixAt(f.milestoneIds[0], p1, d + HOUR + 2 * DAY); // two days in review
    await submit(f.milestoneIds[0], d + HOUR + 3 * DAY, 2); // one day of remediation
    await approveAndRelease(f, 0);
    const a = await adjOf(f.milestoneIds[0]);
    expect(a).toMatchObject({ daysLate: 1, countedDays: 0, deductionCents: 0 }); // 3 d 1 h late − 2 d review = 1 day, inside the grace day
    expect(a.reviewExcludedMs).toBe(2 * DAY);
  });
});

describe("F3.07 extensions and mediator rulings", () => {
  it("an extension both parties sign excuses its days; the other party answers; withdraw and decline", async () => {
    const { f, heldAt } = await setup();
    await expect(requestExtension(client(f), f.milestoneIds[0], { days: 0, reason: "need time" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const x1 = await requestExtension(provider(f), f.milestoneIds[0], { days: 2, reason: "Supplier delay on fonts" });
    await expect(requestExtension(client(f), f.milestoneIds[0], { days: 1, reason: "second one" })).rejects.toMatchObject({ code: "ALREADY_REQUESTED" });
    await expect(decideExtension(provider(f), x1, "accept")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await withdrawExtension(provider(f), x1);
    const x2 = await requestExtension(provider(f), f.milestoneIds[0], { days: 3, reason: "Client changed the brief on day 2" });
    await decideExtension(client(f), x2, "accept");
    const x3 = await requestExtension(provider(f), f.milestoneIds[0], { days: 5, reason: "More time please" });
    await decideExtension(client(f), x3, "decline");
    const rows = await db.select().from(deadlineExtensions).where(eq(deadlineExtensions.milestoneId, f.milestoneIds[0]));
    expect(rows.map((r) => r.state).sort()).toEqual(["ACCEPTED", "DECLINED", "WITHDRAWN"]);
    const acc = rows.find((r) => r.state === "ACCEPTED")!;
    expect(acc.requestSig).toMatch(/^[0-9a-f]{64}$/);
    expect(acc.decisionSig).toMatch(/^[0-9a-f]{64}$/);
    expect(acc.dueAfter!.getTime() - acc.dueBefore!.getTime()).toBe(3 * DAY);
    // 5 days late − 3 excused − 1 grace = 1 counted day
    await submit(f.milestoneIds[0], due(heldAt, 6) + 5 * DAY);
    await approveAndRelease(f, 0);
    expect(await adjOf(f.milestoneIds[0])).toMatchObject({ daysLate: 5, excusedDays: 3, countedDays: 1, deductionCents: 450 });
    await expect(requestExtension(provider(f), f.milestoneIds[0], { days: 1, reason: "too late now" })).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("a mediator ruling is recorded as excused days; parties cannot record one", async () => {
    const { f, heldAt } = await setup();
    await expect(recordExcusedDays(client(f), f.milestoneIds[1], { days: 2, reason: "ruling says so" })).rejects.toBeInstanceOf(DomainError);
    const ops: Actor = { id: `u_ops_${f.orgId.slice(-8)}`, role: "ops" };
    await db.insert((await import("@/db/schema")).users).values({ id: ops.id, orgId: f.orgId, email: `${ops.id}@test.invalid`, name: "Test Ops", role: "ops" });
    await recordExcusedDays(ops, f.milestoneIds[0], { days: 2, reason: "Mediator ruled the client's access delay excuses two days" });
    await submit(f.milestoneIds[0], due(heldAt, 6) + 3 * DAY);
    await approveAndRelease(f, 0);
    expect(await adjOf(f.milestoneIds[0])).toMatchObject({ daysLate: 3, excusedDays: 2, countedDays: 0, deductionCents: 0 });
  });
});

/* ── Rail B semantics: captured at funding, payouts per milestone, refunds of the captured payment ── */
class SimulatedRailB implements Rail {
  readonly id = "B" as const;
  orders = new Map<string, { amount: number; captureId: string }>();
  payouts: { amount: number; payout?: number; key: string }[] = [];
  refundsDone: { amount: number; key: string }[] = [];
  private seen = new Map<string, unknown>();
  private once<T>(k: string, fn: () => T): T { if (this.seen.has(k)) return this.seen.get(k) as T; const r = fn(); this.seen.set(k, r); return r; }
  async fund(i: FundInput): Promise<HoldRef> { return this.once(i.idemKey, () => { const id = "BSIM-" + i.idemKey.slice(0, 8); this.orders.set(id, { amount: i.amountCents, captureId: "BCAP-" + i.idemKey.slice(0, 8) }); return { orderId: id, approveUrl: `https://sim.invalid/approve?token=${id}` }; }); }
  async confirm(orderId: string): Promise<HoldState> { const o = this.orders.get(orderId)!; return { status: "COMPLETED", captureId: o.captureId, heldCents: 0, capturedCents: o.amount }; }
  async release(i: ReleaseInput): Promise<MoveRef> { return this.once(i.idemKey, () => { this.payouts.push({ amount: i.amountCents, payout: i.payoutCents, key: i.idemKey }); return { id: "BPAY-" + i.idemKey.slice(0, 8), status: "COMPLETED" as const }; }); }
  async refund(_c: string, amountCents: number, _cur: string, key: string): Promise<MoveRef> { return this.once(key, () => { this.refundsDone.push({ amount: amountCents, key }); return { id: "BREF-" + key.slice(0, 8), status: "COMPLETED" as const }; }); }
  async voidRemainder(): Promise<void> { throw new RailError("STATE", "Rail B has no authorization to void"); }
  async extend(a: string) { return { authorizationId: a }; }
  async status(orderId: string): Promise<HoldState> { return this.confirm(orderId); }
  async transactions(): Promise<PaypalTxn[]> { return []; }
  async provideEvidence(disputeId: string, _d: EvidenceDossier, key: string): Promise<EvidenceRef> { return this.once(key, () => ({ id: `BEV-${disputeId}`, status: "SUBMITTED" as const })); }
}

describe("F3.07 F3.08 Rail B semantics (simulated delayed-disbursement rail)", () => {
  it("payout = gross − deduction + bonus; the deduction is refunded at once; the unused pool is refunded at close", async () => {
    const railB = new SimulatedRailB();
    setTestRail((t) => (t.rail === "B" ? railB : null));
    const { f, heldAt } = await setup({ rail: "B" });
    expect([...railB.orders.values()][0].amount).toBe(365_000);
    await submit(f.milestoneIds[0], due(heldAt, 6) + 3 * DAY); // 2 counted days → 100 bps × $900 = $9.00
    await approveAndRelease(f, 0);
    expect(railB.payouts[0]).toMatchObject({ amount: 89_100 });
    expect(railB.refundsDone).toEqual([expect.objectContaining({ amount: 900 })]);
    expect(await adjOf(f.milestoneIds[0])).toMatchObject({ deductionStatus: "COMPLETED", deductionCents: 900 });
    await submit(f.milestoneIds[1], due(heldAt, 11) - 4 * DAY); // 100 bps (cap) × $1,200 = $12.00
    await approveAndRelease(f, 1);
    expect(railB.payouts[1]).toMatchObject({ amount: 121_200 });
    await submit(f.milestoneIds[2], due(heldAt, 17));
    await approveAndRelease(f, 2);
    expect(railB.payouts.map((p) => p.amount)).toEqual([89_100, 121_200, 150_000]);
    expect(railB.refundsDone.map((r) => r.amount)).toEqual([900, 3_800]); // deduction, then the unused pool ($50 − $12)
    const t = await tranche(f.trancheId);
    expect(t.state).toBe("CLOSED");
    const led = await ledgerFor(f.trancheId);
    expect(led.find((e) => e.type === "LATE_DEDUCTION")?.paypalRef).toMatch(/^BREF-/);
    expect(led.find((e) => e.type === "POOL_RETURN")?.paypalRef).toMatch(/^BREF-/);
    const inv = await checkInvariant(f.trancheId);
    expect(inv.checks.filter((c) => !c.ok)).toEqual([]);
    expect(inv.balance.pool).toEqual({ held: 5_000, paid: 1_200, returned: 3_800, remaining: 0 });
  });
});
