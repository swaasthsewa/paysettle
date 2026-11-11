/**
 * F2.14 — continuation contracts, DB-backed with the mock rail: a 6-period monthly retainer with the same milestone
 * template, and "month 2 of a build" carrying unfinished milestones over (moved through a parent change order, so no
 * milestone is ever paid twice). Nothing is charged automatically.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool, type Tx } from "@/db/client";
import { ledgerEntries, orgs, paypalLinks, tranches, users, workspaces, wsMilestones } from "@/db/schema";
import { changeOrders } from "@/db/schema-amend";
import { mockControl } from "@/lib/rails/mock";
import { newId } from "@/lib/ids";
import { confirmTranche, fundTranche } from "../money";
import { runReconcile } from "../control/recon";
import { DomainError, type Actor } from "../types";
import { applyChange, createWorkspace, getWorkspace, listWorkspaces, sign } from "./index";
import { declineChangeOrder, signChangeOrder } from "./change-orders";
import { carryable, contractChain, createContinuation, periodChain } from "./continuation";

beforeAll(() => { delete process.env.PAYPAL_CLIENT_ID; process.env.MONEY_RETRY_MS = "0"; });
beforeEach(() => mockControl.reset());
afterAll(async () => { await pool.end(); });

const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof DomainError ? e.code : String(e); } };
class Rollback extends Error {}
async function reconVerdict(trancheIds: string[]) {
  let v = "";
  try { await db.transaction(async (tx: Tx) => { v = (await runReconcile(null, undefined, { dbx: tx, trancheIds })).verdict; throw new Rollback(); }); }
  catch (e) { if (!(e instanceof Rollback)) throw e; }
  return v;
}
async function people() {
  const tag = newId("t").slice(2, 14);
  const orgId = `org_t_${tag}`;
  await db.insert(orgs).values({ id: orgId, name: `test ${tag}` });
  const c: Actor = { id: `u_c_${tag}`, role: "client" }, p: Actor = { id: `u_p_${tag}`, role: "provider" }, o: Actor = { id: `u_o_${tag}`, role: "ops" }, x: Actor = { id: `u_x_${tag}`, role: "provider" };
  await db.insert(users).values([
    { id: c.id, orgId, email: `c_${tag}@test.example`, name: "Test Client", role: "client", tier: "standard" },
    { id: p.id, orgId, email: `p_${tag}@test.example`, name: "Test Provider", role: "provider", tier: "platinum" },
    { id: o.id, orgId, email: `o_${tag}@test.example`, name: "Test Ops", role: "ops", tier: "standard" },
    { id: x.id, orgId, email: `x_${tag}@test.example`, name: "Other Provider", role: "provider", tier: "standard" },
  ]);
  await db.insert(paypalLinks).values({ id: `pl_${tag}`, userId: p.id, kind: "merchant", email: `p_${tag}@business.example.com`, receivable: true, emailConfirmed: true });
  return { c, p, o, x };
}
async function signBoth(c: Actor, p: Actor, id: string) {
  let v = await getWorkspace(c, id);
  v = await sign(c, id, v.revision, v.canonicalHash!);
  return sign(p, id, v.revision, v.canonicalHash!);
}
async function lockedContract(c: Actor, p: Actor, title = "Website care") {
  const id = await createWorkspace(c, { blueprintCode: "UC_WEB_MVP", title, totalCents: 600_000, providerId: p.id });
  expect((await signBoth(c, p, id)).state).toBe("LOCKED");
  return id;
}

describe("F2.14 continuation contracts", () => {
  it("a monthly maintenance retainer: 6 periods with the same milestone template, each negotiated, signed and locked; nothing is charged", async () => {
    const { c, p } = await people();
    const ids = [await lockedContract(c, p, "Website care retainer")];
    const template = (await getWorkspace(c, ids[0])).milestones.filter((m) => m.active).map((m) => [m.title, m.type, m.targetDay, m.amountCents]);
    for (let n = 2; n <= 6; n++) {
      const by = n % 2 ? c : p; // either party can start the next period
      const r = await createContinuation(by, ids[ids.length - 1], { repeat: true, carry: [] });
      expect(r.changeOrderId).toBeNull();
      const v = await getWorkspace(c, r.workspaceId);
      expect(v.title).toBe(`Website care retainer · period ${n}`);
      expect(v.state).toBe("READY_TO_SIGN");
      expect(v.totalCents).toBe(600_000);
      expect(v.milestones.filter((m) => m.active).map((m) => [m.title, m.type, m.targetDay, m.amountCents])).toEqual(template);
      expect((await signBoth(c, p, r.workspaceId)).state).toBe("LOCKED");
      ids.push(r.workspaceId);
    }
    const rows = await db.select().from(workspaces).where(eq(workspaces.clientId, c.id));
    for (let i = 0; i < ids.length; i++) {
      const w = rows.find((r) => r.id === ids[i])!;
      expect(w.periodNo).toBe(i + 1);
      expect(w.parentWorkspaceId).toBe(i ? ids[i - 1] : null);
      expect(w.clientId).toBe(c.id); expect(w.providerId).toBe(p.id); expect(w.blueprintCode).toBe("UC_WEB_MVP"); expect(w.currency).toBe("USD");
    }
    const chain = await periodChain(c, ids[2]);
    expect(chain).toMatchObject({ periodNo: 3, parent: { id: ids[1], periodNo: 2 }, next: { id: ids[3], periodNo: 4 } });
    expect((await listWorkspaces(c)).filter((r) => ids.includes(r.id)).map((r) => r.periodNo).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    // no automatic charges: every tranche of every period waits for the client to fund it
    const trs = await db.select().from(tranches).where(eq(tranches.workspaceId, ids[5]));
    expect(trs.every((t) => t.state === "PLANNED")).toBe(true);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.trancheId, trs[0].id))).toEqual([]);
    // only the latest period can continue
    expect(await code(createContinuation(c, ids[2], { repeat: true, carry: [] }))).toBe("ALREADY_CONTINUED");
  });

  it("month 2 of a build: unfinished milestones move through a parent change order; period 2 waits for it; no milestone is paid twice", async () => {
    const { c, p, o } = await people();
    const parent = await lockedContract(c, p, "Clinic site build");
    const t1 = (await getWorkspace(c, parent)).tranches[0];
    const { approveUrl } = await fundTranche(c, t1.id);
    await confirmTranche(c, t1.id, new URL(approveUrl).searchParams.get("token") ?? undefined);
    expect((await carryable(c, parent)).map((m) => m.code)).toEqual(["M01", "M02", "M03", "M04", "M05", "M06", "M07"]);

    const r = await createContinuation(p, parent, { carry: ["M05", "M06", "M07"], repeat: false, note: "Reports and launch move to month 2." });
    expect(r.changeOrderId).not.toBeNull();
    const child = await getWorkspace(c, r.workspaceId);
    expect(child.title).toBe("Clinic site build · period 2");
    expect(child.milestones.map((m) => [m.title, m.amountCents])).toEqual((await getWorkspace(c, parent)).milestones.filter((m) => ["M05", "M06", "M07"].includes(m.code)).map((m) => [m.title, m.amountCents]));
    expect(child.totalCents).toBe(240_000);
    const carried = await db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, r.workspaceId));
    expect(carried.every((m) => m.carriedFrom)).toBe(true);
    // the parent keeps its terms until both sign the change order; period 2 cannot be signed before
    const [co] = await db.select().from(changeOrders).where(eq(changeOrders.id, r.changeOrderId!));
    expect(co).toMatchObject({ state: "PROPOSED", continuationId: r.workspaceId });
    expect(await code(sign(c, r.workspaceId, child.revision, child.canonicalHash!))).toBe("CARRY_PENDING");
    expect((await periodChain(o, r.workspaceId)).parent?.id).toBe(parent); // Operations can view the chain

    await signChangeOrder(p, co.id, co.hash);
    expect((await signChangeOrder(c, co.id, co.hash)).state).toBe("APPLIED");
    const pv = await getWorkspace(c, parent);
    expect(pv.milestones.filter((m) => ["M05", "M06", "M07"].includes(m.code)).every((m) => !m.active)).toBe(true);
    expect(pv.totalCents).toBe(360_000);
    expect(await reconVerdict([t1.id])).toBe("CLEAN"); // the moved $2,400 went back to the client from the parent's hold
    expect((await signBoth(c, p, r.workspaceId)).state).toBe("LOCKED");
    const ct = (await getWorkspace(c, r.workspaceId)).tranches;
    expect(ct.map((t) => [t.state, t.amountCents])).toEqual([["PLANNED", 240_000]]); // funded fresh, by the client, through PayPal
  });

  it("a declined carry change order keeps period 2 unsigned until the carried milestones are pruned there", async () => {
    const { c, p } = await people();
    const parent = await lockedContract(c, p);
    const r = await createContinuation(c, parent, { carry: ["M07"], repeat: true });
    await declineChangeOrder(p, r.changeOrderId!, "Launch stays in this month.");
    let v = await getWorkspace(c, r.workspaceId);
    expect(await code(sign(c, r.workspaceId, v.revision, v.canonicalHash!))).toBe("CARRY_PENDING");
    const carriedCode = (await db.select().from(wsMilestones).where(and(eq(wsMilestones.workspaceId, r.workspaceId)))).find((m) => m.carriedFrom)!.code;
    v = await applyChange(c, r.workspaceId, { action: "PRUNE", milestoneCode: carriedCode });
    v = await applyChange(c, r.workspaceId, { action: "SET_BPS", shares: Object.fromEntries(v.milestones.filter((m) => m.active && m.type === "PAY").map((m, i, a) => [m.code, i === a.length - 1 ? 10_000 - a.slice(0, -1).reduce((s, x) => s + x.bps, 0) : m.bps])) });
    expect(v.violations).toEqual([]);
    expect((await signBoth(c, p, r.workspaceId)).state).toBe("LOCKED");
  });

  it("rules: parties only, locked parents only, frozen milestones cannot be carried, something to start with", async () => {
    const { c, p, o, x } = await people();
    const parent = await lockedContract(c, p);
    expect(await code(createContinuation(o, parent, { repeat: true, carry: [] }))).toBe("FORBIDDEN");
    expect(await code(createContinuation(x, parent, { repeat: true, carry: [] }))).toBe("FORBIDDEN");
    expect(await code(createContinuation(c, parent, { repeat: false, carry: [] }))).toBe("INVALID_INPUT");
    await db.update(wsMilestones).set({ state: "SUBMITTED" }).where(and(eq(wsMilestones.workspaceId, parent), eq(wsMilestones.code, "M02")));
    expect(await code(createContinuation(c, parent, { repeat: false, carry: ["M02"] }))).toBe("MILESTONE_FROZEN");
    expect((await db.select().from(workspaces).where(eq(workspaces.parentWorkspaceId, parent))).length).toBe(0); // nothing half-made
    const draft = await createWorkspace(c, { blueprintCode: "UC_WEB_MVP", title: "Draft only", totalCents: 600_000, providerId: p.id });
    expect(await code(createContinuation(c, draft, { repeat: true, carry: [] }))).toBe("NOT_LOCKED");
  });

  it("F2.14 contractChain lists every period around a contract, oldest first, only for people who may read it", async () => {
    const { c, p, o, x } = await people();
    const p1 = await lockedContract(c, p, "Care plan");
    const { workspaceId: p2 } = await createContinuation(c, p1, { repeat: true, carry: [] });
    expect((await signBoth(c, p, p2)).state).toBe("LOCKED");
    const { workspaceId: p3 } = await createContinuation(p, p2, { repeat: true, carry: [] });
    const want = [{ id: p1, periodNo: 1 }, { id: p2, periodNo: 2 }, { id: p3, periodNo: 3 }];
    expect(await contractChain(c, p2)).toEqual(want);
    expect(await contractChain(p, p3)).toEqual(want);
    expect(await contractChain(o, p1)).toEqual(want); // Operations in the same organisation reads every period
    expect(await code(contractChain(x, p2))).toBe("FORBIDDEN");
    const single = await lockedContract(c, p, "One-off build");
    expect(await contractChain(c, single)).toEqual([{ id: single, periodNo: 1 }]);
  });
});
