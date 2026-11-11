/**
 * F2.13 — change orders on locked contracts, DB-backed with the mock rail: propose → both sign → new revision; money
 * only through the money module (new PLANNED tranche funded with fundTranche/confirmTranche; reductions returned with
 * returnFunds); three-way reconciliation stays CLEAN after an increasing and after a decreasing change order.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db, pool, type Tx } from "@/db/client";
import { auditChain, evidencePackages, ledgerEntries, orgs, paypalLinks, refunds, revisions, signatures, tranches, users, workspaces, wsClauses, wsMilestones } from "@/db/schema";
import { changeOrders } from "@/db/schema-amend";
import { moneyNotices } from "@/db/schema-money";
import { mockControl } from "@/lib/rails/mock";
import { newId } from "@/lib/ids";
import { confirmTranche, fundTranche, releaseMilestone } from "../money";
import { checkInvariant } from "../money/queries";
import { recordApproval } from "../money/fixtures";
import { runReconcile } from "../control/recon";
import { DomainError, type Actor } from "../types";
import { createWorkspace, getWorkspace, getWorkspaceDetail, sign } from "./index";
import { changeOrderQueue, changeOrderRoom, clearChangeOrder, declineChangeOrder, proposeChangeOrder, signChangeOrder } from "./change-orders";
import type { CoItem } from "./change-core";

beforeAll(() => { delete process.env.PAYPAL_CLIENT_ID; process.env.MONEY_RETRY_MS = "0"; });
beforeEach(() => mockControl.reset());
afterAll(async () => { await pool.end(); });

class Rollback extends Error {}
async function recon(trancheIds: string[]) {
  let out: Awaited<ReturnType<typeof runReconcile>> | null = null;
  try { await db.transaction(async (tx: Tx) => { out = await runReconcile(null, undefined, { dbx: tx, trancheIds }); throw new Rollback(); }); }
  catch (e) { if (!(e instanceof Rollback)) throw e; }
  const r = out! as Awaited<ReturnType<typeof runReconcile>>;
  expect(r.lines.length).toBe(trancheIds.length); // every tranche asked for was actually compared
  expect(r.lines.every((l) => l.status === "MATCHED")).toBe(true);
  return r;
}
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof DomainError ? e.code : String(e); } };
const proof = { artifacts: [{ kind: "PDF" as const, min: 1 }], criteria: ["Pages are live and linked from the menu"] };
const addPay = (title: string, day: number, amountCents: number): CoItem => ({ action: "ADD", milestone: { title, type: "PAY", day, amountCents, proof, lockRule: "Client approves the pages.", disputeRule: "Missing pages fixed within 72 hours." } });

async function people(tier: "platinum" | "standard" | "new" | "probation" = "platinum") {
  const tag = newId("t").slice(2, 14);
  const orgId = `org_t_${tag}`;
  await db.insert(orgs).values({ id: orgId, name: `test ${tag}` });
  const c: Actor = { id: `u_c_${tag}`, role: "client" }, p: Actor = { id: `u_p_${tag}`, role: "provider" }, o: Actor = { id: `u_o_${tag}`, role: "ops" }, x: Actor = { id: `u_x_${tag}`, role: "client" };
  await db.insert(users).values([
    { id: c.id, orgId, email: `c_${tag}@test.example`, name: "Test Client", role: "client", tier: "standard" },
    { id: p.id, orgId, email: `p_${tag}@test.example`, name: "Test Provider", role: "provider", tier },
    { id: o.id, orgId, email: `o_${tag}@test.example`, name: "Test Ops", role: "ops", tier: "standard" },
    { id: x.id, orgId, email: `x_${tag}@test.example`, name: "Other Client", role: "client", tier: "standard" },
  ]);
  await db.insert(paypalLinks).values({ id: `pl_${tag}`, userId: p.id, kind: "merchant", email: `p_${tag}@business.example.com`, receivable: true, emailConfirmed: true });
  return { c, p, o, x };
}
/** A UC_WEB_MVP contract ($6,000: M02 900, M03 1,200, M04 1,500, M05 900, M06 900, M07 600) signed and locked; optionally tranche 1 funded. */
async function locked(fund: boolean, tier: "platinum" | "probation" = "platinum") {
  const ppl = await people(tier);
  const id = await createWorkspace(ppl.c, { blueprintCode: "UC_WEB_MVP", title: "Booking app", totalCents: 600_000, providerId: ppl.p.id });
  let v = await getWorkspace(ppl.c, id);
  v = await sign(ppl.c, id, v.revision, v.canonicalHash!);
  v = await sign(ppl.p, id, v.revision, v.canonicalHash!);
  expect(v.state).toBe("LOCKED");
  if (fund) await fundAndHold(ppl.c, v.tranches[0].id);
  return { ...ppl, id };
}
async function fundAndHold(c: Actor, trancheId: string) {
  const { approveUrl } = await fundTranche(c, trancheId);
  await confirmTranche(c, trancheId, new URL(approveUrl).searchParams.get("token") ?? undefined);
}
const room = (a: Actor, id: string) => changeOrderRoom(a, id);
async function bothSign(first: Actor, second: Actor, coId: string) {
  const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, coId));
  expect((await signChangeOrder(first, coId, co.hash)).state).toBe("PROPOSED");
  return signChangeOrder(second, coId, co.hash);
}
const trs = async (id: string) => db.select().from(tranches).where(eq(tranches.workspaceId, id)).orderBy(asc(tranches.idx));
const msBy = async (id: string, c: string) => (await db.select().from(wsMilestones).where(and(eq(wsMilestones.workspaceId, id), eq(wsMilestones.code, c))))[0];

describe("F2.13 change orders", () => {
  it("increasing: added milestone goes to a new PLANNED tranche, funded on the mock rail; revision, signatures, audit; recon CLEAN", async () => {
    const { c, p, o, id } = await locked(true);
    const coId = await proposeChangeOrder(p, id, { items: [addPay("Content and marketing pages", 25, 120_000)], note: "Client asked for marketing pages in the last week." });
    const r = await room(c, id);
    expect(r.open?.id).toBe(coId);
    expect(r.open?.lines).toEqual(["+$1,200.00 to fund as tranche 2 (C01); the client approves it in PayPal as usual."]);
    expect(r.openStale).toBeNull();
    expect((await room(o, id)).open?.id).toBe(coId); // Operations can view
    // until both have signed, the contract runs on the old terms
    expect((await getWorkspace(c, id)).revision).toBe(1);
    expect((await bothSign(p, c, coId)).state).toBe("APPLIED");

    const v = await getWorkspace(c, id);
    expect(v.revision).toBe(2);
    expect(v.totalCents).toBe(720_000);
    expect(v.milestones.find((m) => m.code === "C01")).toMatchObject({ trancheIdx: 2, amountCents: 120_000, state: "LOCKED", origin: "CUSTOM" });
    expect(v.milestones.filter((m) => m.active && m.type === "PAY").reduce((s, m) => s + m.bps, 0)).toBe(10_000);
    expect(v.milestones.find((m) => m.code === "M02")!.amountCents).toBe(90_000); // untouched cents stay exact
    const [rev] = await db.select().from(revisions).where(and(eq(revisions.workspaceId, id), eq(revisions.revNo, 2)));
    expect(rev.change).toMatchObject({ action: "CHANGE_ORDER", target: "CO1" });
    expect(rev.hash).toBe(v.canonicalHash);
    expect((rev.canonical as { amends: { baseRevNo: number } }).amends.baseRevNo).toBe(1);
    const sigs = await db.select().from(signatures).where(and(eq(signatures.workspaceId, id), eq(signatures.revNo, 2)));
    expect(sigs.map((s) => s.role).sort()).toEqual(["client", "provider"]);
    expect(sigs.every((s) => s.hash === v.canonicalHash && /^[0-9a-f]{64}$/.test(s.signature))).toBe(true);
    const acts = (await db.select({ action: auditChain.action }).from(auditChain).where(eq(auditChain.target, id))).map((x) => x.action);
    expect(acts).toEqual(expect.arrayContaining(["contract.change_order_proposed", "contract.change_order_signed", "contract.change_order_applied"]));
    expect((await getWorkspaceDetail(c, id)).revisions[0]).toMatchObject({ revNo: 2 });
    // the other party was notified of the proposal; both of the result
    const notes = await db.select().from(moneyNotices).where(and(eq(moneyNotices.workspaceId, id), eq(moneyNotices.kind, "CHANGE_ORDER")));
    expect(notes.some((n) => n.userId === c.id && /waiting for your review/.test(n.message))).toBe(true);
    expect(notes.some((n) => n.userId === p.id && /waiting for your review/.test(n.message))).toBe(false);

    const [t1, t2] = await trs(id);
    expect(t2).toMatchObject({ idx: 2, state: "PLANNED", amountCents: 120_000 });
    await fundAndHold(c, t2.id); // the existing fund → PayPal approval flow; nothing is charged automatically
    expect((await trs(id))[1].state).toBe("HELD");
    const rc = await recon([t1.id, t2.id]);
    expect(rc.verdict).toBe("CLEAN");
    for (const t of [t1, t2]) expect((await checkInvariant(t.id)).ok).toBe(true);
  });

  it("decreasing: a reduction and a removal in a held tranche go back to the client; ledger balanced; recon CLEAN before and after a release", async () => {
    const { c, p, id } = await locked(true);
    const items: CoItem[] = [{ action: "EDIT", milestoneCode: "M06", amountCents: 50_000 }, { action: "REMOVE", milestoneCode: "M07" }];
    const coId = await proposeChangeOrder(c, id, { items, note: "Feature B was dropped; the last check-in is no longer needed." });
    expect((await room(p, id)).open?.lines).toEqual(["$1,000.00 goes back to the client's PayPal from tranche 1."]);
    expect((await bothSign(c, p, coId)).state).toBe("APPLIED");
    const v = await getWorkspace(c, id);
    expect(v.totalCents).toBe(500_000);
    expect(v.milestones.find((m) => m.code === "M07")!.active).toBe(false);
    const [t1] = await trs(id);
    expect(t1.amountCents).toBe(600_000); // what PayPal holds does not change; the return records the difference
    expect(t1.amendedOutCents).toBe(100_000);
    const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, coId));
    expect(co.returns).toHaveLength(1);
    expect(co.returns[0]).toMatchObject({ status: "DONE", amountCents: 100_000 });
    const led = await db.select().from(ledgerEntries).where(eq(ledgerEntries.trancheId, t1.id));
    expect(led.filter((e) => e.type === "VOID").reduce((s, e) => s + e.amountCents, 0)).toBe(100_000);
    const [ret] = await db.select().from(refunds).where(eq(refunds.idemKey, co.returns[0].idemKey));
    expect(ret.status).toBe("RECORDED"); // Rail A: stays authorized, voided with the last remainder
    expect((await checkInvariant(t1.id)).ok).toBe(true);
    expect((await recon([t1.id])).verdict).toBe("CLEAN");

    // a later release on the same hold still reconciles
    const m2 = await msBy(id, "M02");
    await db.update(wsMilestones).set({ state: "APPROVED" }).where(eq(wsMilestones.id, m2.id));
    await releaseMilestone(c, m2.id, { kind: "MILESTONE", approvalSig: await recordApproval(m2.id, { by: c.id }) });
    expect((await checkInvariant(t1.id)).ok).toBe(true);
    expect((await recon([t1.id])).verdict).toBe("CLEAN");
    // settling the change order again is a no-op (same idempotency key)
    const { settleChangeOrder } = await import("../money");
    await settleChangeOrder(c, coId);
    expect((await db.select().from(refunds).where(eq(refunds.trancheId, t1.id))).length).toBe(1);
  });

  it("an increase on a held milestone moves it to a new tranche (OPEN goes back to LOCKED); recon CLEAN", async () => {
    const { c, p, id } = await locked(true);
    // after funding, M01 (information step) is open; open M02 by finishing M01 the way the evidence module would
    await db.update(wsMilestones).set({ state: "RELEASED" }).where(and(eq(wsMilestones.workspaceId, id), eq(wsMilestones.code, "M01")));
    await db.update(wsMilestones).set({ state: "OPEN" }).where(and(eq(wsMilestones.workspaceId, id), eq(wsMilestones.code, "M02")));
    const coId = await proposeChangeOrder(p, id, { items: [{ action: "EDIT", milestoneCode: "M02", amountCents: 110_000 }], note: "The booking flow now includes payments." });
    expect((await bothSign(p, c, coId)).state).toBe("APPLIED");
    const m2 = await msBy(id, "M02");
    expect(m2).toMatchObject({ trancheIdx: 2, amountCents: 110_000, state: "LOCKED" });
    const [t1, t2] = await trs(id);
    expect(t1.amendedOutCents).toBe(90_000);
    expect(t2).toMatchObject({ state: "PLANNED", amountCents: 110_000 });
    expect((await recon([t1.id])).verdict).toBe("CLEAN");
    await fundAndHold(c, t2.id);
    expect((await msBy(id, "M02")).state).toBe("OPEN"); // opens again once funded
    expect((await recon([t1.id, t2.id])).verdict).toBe("CLEAN");
  });

  it("a milestone in an unfunded tranche just changes, and the tranche can then be funded for the new amount", async () => {
    const { c, p, id } = await locked(false);
    const coId = await proposeChangeOrder(c, id, { items: [{ action: "EDIT", milestoneCode: "M05", amountCents: 70_000, day: 22 }], note: "Hotel upgrade dropped from the tour." });
    expect((await room(p, id)).open?.lines).toEqual(["Tranche 1 is not funded yet: it changes from $6,000.00 to $5,800.00."]);
    expect((await bothSign(c, p, coId)).state).toBe("APPLIED");
    const [t1] = await trs(id);
    expect(t1.amountCents).toBe(580_000);
    await fundAndHold(c, t1.id);
    expect((await recon([t1.id])).verdict).toBe("CLEAN");
  });

  it("frozen milestones cannot be touched; money changes wait while a tranche waits for PayPal approval", async () => {
    const { c, p, id } = await locked(false);
    await db.update(wsMilestones).set({ state: "SUBMITTED" }).where(and(eq(wsMilestones.workspaceId, id), eq(wsMilestones.code, "M03")));
    expect(await code(proposeChangeOrder(c, id, { items: [{ action: "EDIT", milestoneCode: "M03", day: 12 }], note: "Move the date." }))).toBe("MILESTONE_FROZEN");
    const m1 = await msBy(id, "M01"); // OPEN, but with evidence submitted: frozen too
    await db.insert(evidencePackages).values({ id: newId("ev"), milestoneId: m1.id, attempt: 1, rootHash: "r", files: [], state: "SUBMITTED", submittedBy: p.id });
    expect(await code(proposeChangeOrder(c, id, { items: [{ action: "REMOVE", milestoneCode: "M01" }], note: "Drop the kickoff." }))).toBe("MILESTONE_FROZEN");
    const [t1] = await trs(id);
    await fundTranche(c, t1.id); // AWAITING_APPROVAL
    expect(await code(proposeChangeOrder(c, id, { items: [{ action: "REMOVE", milestoneCode: "M07" }], note: "Drop the last step." }))).toBe("TRANCHE_BUSY");
    // terms-only changes still work (no money moves)
    const coId = await proposeChangeOrder(p, id, { items: [{ action: "EDIT", milestoneCode: "M04", proof: { artifacts: proof.artifacts, criteria: ["Feature B ships instead of feature A"] } }], note: "Feature changed midway." });
    expect((await room(c, id)).open?.lines).toEqual(["No money moves: only the terms change."]);
    expect((await bothSign(p, c, coId)).state).toBe("APPLIED");
    expect((await msBy(id, "M04")).proof.criteria).toEqual(["Feature B ships instead of feature A"]);
  });

  it("signing rules: parties only, the signed hash, once per party, one open change order; decline and withdraw", async () => {
    const { c, p, o, x, id } = await locked(false);
    expect(await code(proposeChangeOrder(o, id, { items: [{ action: "REMOVE", milestoneCode: "M07" }], note: "Operations tries." }))).toBe("FORBIDDEN");
    expect(await code(proposeChangeOrder(x, id, { items: [{ action: "REMOVE", milestoneCode: "M07" }], note: "Stranger tries." }))).toBe("FORBIDDEN");
    expect(await code(proposeChangeOrder(c, id, { items: [], note: "Nothing at all." }))).toBe("INVALID_INPUT");
    const coId = await proposeChangeOrder(c, id, { items: [{ action: "REMOVE", milestoneCode: "M07" }], note: "Drop the last step." });
    expect(await code(proposeChangeOrder(p, id, { items: [{ action: "REMOVE", milestoneCode: "M06" }], note: "A second one." }))).toBe("ALREADY_OPEN");
    const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, coId));
    expect(await code(signChangeOrder(c, coId, "0".repeat(64)))).toBe("REVISION_MISMATCH");
    expect(await code(signChangeOrder(o, coId, co.hash))).toBe("FORBIDDEN");
    await signChangeOrder(c, coId, co.hash);
    expect(await code(signChangeOrder(c, coId, co.hash))).toBe("ALREADY_SIGNED");
    expect(await code(declineChangeOrder(p, coId, ""))).toBe("INVALID_INPUT");
    await declineChangeOrder(p, coId, "We still need the final check-in.");
    expect((await db.select().from(changeOrders).where(eq(changeOrders.id, coId)))[0].state).toBe("DECLINED");
    expect((await getWorkspace(c, id)).revision).toBe(1); // old terms stay
    const co2 = await proposeChangeOrder(p, id, { items: [{ action: "REMOVE", milestoneCode: "M06" }], note: "Another try." });
    await declineChangeOrder(p, co2, "");
    expect((await db.select().from(changeOrders).where(eq(changeOrders.id, co2)))[0].state).toBe("WITHDRAWN");
  });

  it("policy violations on the amended contract block signing", async () => {
    const { c, p, id } = await locked(false);
    const items: CoItem[] = ["M02", "M03", "M04", "M05", "M06"].map((m) => ({ action: "REMOVE", milestoneCode: m }));
    const coId = await proposeChangeOrder(c, id, { items, note: "Shrink the scope to the last step." });
    const r = await room(p, id);
    expect(r.open?.violations.map((v) => v.rule)).toContain("R10");
    expect(await code(signChangeOrder(c, coId, r.open!.hash))).toBe("POLICY_BLOCKED");
  });

  it("a change order whose money plan no longer holds (the tranche was funded meanwhile) is superseded, not signed", async () => {
    const { c, p, id } = await locked(false);
    const coId = await proposeChangeOrder(p, id, { items: [{ action: "EDIT", milestoneCode: "M05", amountCents: 80_000 }], note: "Smaller scope for the reports step." });
    const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, coId));
    const [t1] = await trs(id);
    await fundAndHold(c, t1.id);
    expect((await room(c, id)).openStale).toMatch(/money has moved/);
    expect(await code(signChangeOrder(c, coId, co.hash))).toBe("SUPERSEDED");
    expect((await db.select().from(changeOrders).where(eq(changeOrders.id, coId)))[0].state).toBe("SUPERSEDED");
  });

  it("risk 75 or more sends the signed change order to Operations' clearance queue before it takes effect", async () => {
    const { c, p, o, id } = await locked(false, "probation");
    // a riskier contract: protective clauses off and several custom clauses (set directly for the test)
    await db.update(wsClauses).set({ active: false }).where(and(eq(wsClauses.workspaceId, id), eq(wsClauses.category, "BASELINE"), eq(wsClauses.protective, true)));
    for (let i = 1; i <= 8; i++) await db.insert(wsClauses).values({ id: newId("cl"), workspaceId: id, category: "CUSTOM", code: `CUS_${String(i).padStart(2, "0")}`, title: `Custom ${i}`, body: "Weekly status call on Mondays.", active: true, protective: false });
    const coId = await proposeChangeOrder(c, id, { items: [addPay("Second booking flow", 20, 1_000_000)], note: "Adds a second booking flow." });
    expect((await room(c, id)).open!.risk).toBeGreaterThanOrEqual(75);
    expect((await bothSign(c, p, coId)).state).toBe("AWAITING_OPS");
    expect((await getWorkspace(c, id)).revision).toBe(1);
    const q = await changeOrderQueue(o);
    expect(q.map((x) => x.id)).toContain(coId);
    expect(await code(clearChangeOrder(c, coId, "clear", ""))).toBe("FORBIDDEN");
    await clearChangeOrder(o, coId, "clear", "Checked the new scope with both parties.");
    const v = await getWorkspace(c, id);
    expect(v.revision).toBe(2);
    expect(v.tranches.map((t) => [t.idx, t.state, t.amountCents])).toEqual([[1, "PLANNED", 600_000], [2, "PLANNED", 1_000_000]]);
  });

  it("not on contracts that are not locked", async () => {
    const ppl = await people();
    const id = await createWorkspace(ppl.c, { blueprintCode: "UC_WEB_MVP", title: "Draft", totalCents: 600_000, providerId: ppl.p.id });
    expect(await code(proposeChangeOrder(ppl.c, id, { items: [{ action: "REMOVE", milestoneCode: "M07" }], note: "Too early." }))).toBe("NOT_LOCKED");
    expect((await db.select().from(workspaces).where(eq(workspaces.id, id)))[0].state).toBe("READY_TO_SIGN");
  });
});
