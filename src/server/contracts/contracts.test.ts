/**
 * F2.02 F2.04 F2.05 F2.06 F2.07 F2.10 F2.11 — DB-backed tests for the contracts module. Each test makes its own org and
 * people with unique ids, so runs never collide with the demo data or with each other.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { orgs, paypalLinks, revisions, signatures, tranches, users, workspaces, wsMilestones } from "@/db/schema";
import { newId } from "@/lib/ids";
import { DomainError, type Actor } from "../types";
import { applyChange, applyChangeAt, clearContract, createWorkspace, getWorkspace, listWorkspaces, sign } from "./index";
import { parseDollarsToCents, parsePctToBps } from "./core";

async function people(tier: "platinum" | "standard" | "new" = "platinum", payable = true) {
  const tag = newId("t").slice(2, 14);
  const orgId = `org_t_${tag}`;
  await db.insert(orgs).values({ id: orgId, name: `test ${tag}` });
  const c: Actor = { id: `u_c_${tag}`, role: "client" }, p: Actor = { id: `u_p_${tag}`, role: "provider" }, o: Actor = { id: `u_o_${tag}`, role: "ops" };
  await db.insert(users).values([
    { id: c.id, orgId, email: `c_${tag}@test.example`, name: "Test Client", role: "client", tier: "standard" },
    { id: p.id, orgId, email: `p_${tag}@test.example`, name: "Test Provider", role: "provider", tier },
    { id: o.id, orgId, email: `o_${tag}@test.example`, name: "Test Ops", role: "ops", tier: "standard" },
  ]);
  if (payable) await db.insert(paypalLinks).values({ id: `pl_${tag}`, userId: p.id, kind: "merchant", email: `p_${tag}@business.example.com`, receivable: true, emailConfirmed: true });
  return { c, p, o };
}
const make = (c: Actor, providerId: string, totalCents = 600_000) => createWorkspace(c, { blueprintCode: "UC_WEB_MVP", title: "Test booking app", totalCents, providerId });
const code = (e: unknown) => (e instanceof DomainError ? e.code : String(e));

afterAll(async () => { await pool.end(); });

describe("contracts module", () => {
  it("F2.02/F2.06/F2.10 create → change → gate → sign twice → locked with tranches", async () => {
    const { c, p } = await people();
    const id = await make(c, p.id);
    let v = await getWorkspace(c, id);
    expect(v.revision).toBe(1);
    expect(v.state).toBe("READY_TO_SIGN");
    expect(v.violations).toEqual([]);
    expect(v.clauses.filter((k) => k.category === "SYSTEM").length).toBeGreaterThanOrEqual(6);
    const pay = v.milestones.filter((m) => m.type === "PAY" && m.active);
    expect(pay.reduce((a, m) => a + m.amountCents, 0)).toBe(600_000);

    // provider prunes M07 (10%) → R01 fails → DRAFT; then gives the 10% to M06 → gate passes again
    v = await applyChange(p, id, { action: "PRUNE", milestoneCode: "M07" });
    expect(v.revision).toBe(2);
    expect(v.state).toBe("DRAFT");
    expect(v.violations.map((x) => x.rule)).toContain("R01");
    expect(v.milestones.find((m) => m.code === "M07")?.active).toBe(false);
    v = await applyChange(p, id, { action: "SET_BPS", shares: { M06: 2500 } });
    expect(v.revision).toBe(3);
    expect(v.state).toBe("READY_TO_SIGN");
    expect(v.milestones.filter((m) => m.active && m.type === "PAY").reduce((a, m) => a + m.amountCents, 0)).toBe(600_000);

    v = await sign(c, id, v.revision, v.canonicalHash!);
    expect(v.state).toBe("PARTIALLY_SIGNED");
    v = await sign(p, id, v.revision, v.canonicalHash!);
    expect(v.state).toBe("LOCKED");
    expect(v.tranches).toHaveLength(1);
    expect(v.tranches[0].state).toBe("PLANNED");
    expect(v.tranches[0].amountCents).toBe(600_000);
    const states = v.milestones.filter((m) => m.active).map((m) => m.state);
    expect(states[0]).toBe("OPEN");
    expect(states.slice(1).every((s) => s === "LOCKED")).toBe(true);
    const sigs = await db.select().from(signatures).where(eq(signatures.workspaceId, id));
    expect(sigs).toHaveLength(2);
    expect(sigs.every((s) => /^[0-9a-f]{64}$/.test(s.signature) && s.hash === v.canonicalHash)).toBe(true);
    // a locked contract is no longer editable
    await expect(applyChange(c, id, { action: "SET_DAY", milestoneCode: "M03", day: 12 })).rejects.toMatchObject({ code: "STATE" });
    expect((await listWorkspaces(c)).map((x) => x.id)).toContain(id);
  });

  it("F2.10 edit after first signature voids it", async () => {
    const { c, p } = await people();
    const id = await make(c, p.id);
    let v = await getWorkspace(c, id);
    v = await sign(c, id, v.revision, v.canonicalHash!);
    expect(v.state).toBe("PARTIALLY_SIGNED");
    v = await applyChange(p, id, { action: "SET_DAY", milestoneCode: "M05", day: 22 });
    expect(v.revision).toBe(2);
    expect(v.state).toBe("READY_TO_SIGN");
    const [s] = await db.select().from(signatures).where(eq(signatures.workspaceId, id));
    expect(s.voidedAtRev).toBe(2);
    expect(v.signatures.every((x) => x.voided)).toBe(true);
    // the old revision can no longer be countersigned
    await expect(sign(p, id, 1, s.hash)).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
  });

  it("F2.05 system clause cannot be pruned", async () => {
    const { c, p } = await people();
    const id = await make(c, p.id);
    let err: unknown;
    try { await applyChange(c, id, { action: "TOGGLE_CLAUSE", clauseCode: "SYS_01_HOLD", active: false }); } catch (e) { err = e; }
    expect(code(err)).toBe("SYSTEM_CLAUSE_LOCKED");
    const v = await getWorkspace(c, id);
    expect(v.revision).toBe(1);
    expect(v.clauses.find((k) => k.code === "SYS_01_HOLD")?.active).toBe(true);
    // a baseline clause can be switched off, and that raises the risk score
    const before = v.riskScore;
    const after = await applyChange(c, id, { action: "TOGGLE_CLAUSE", clauseCode: "TPL_IP", active: false });
    expect(after.riskScore).toBeGreaterThan(before);
  });

  it("F2.06 R01 violation blocks signing", async () => {
    const { c, p } = await people();
    const id = await make(c, p.id);
    const v = await applyChange(c, id, { action: "SET_BPS", shares: { M02: 1000 } });
    expect(v.violations.map((x) => x.code)).toContain("SUM_NOT_100");
    await expect(sign(c, id, v.revision, v.canonicalHash!)).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect((await getWorkspace(c, id)).state).toBe("DRAFT");
  });

  it("F2.03/P5 revision rows are immutable and each change is a new revision", async () => {
    const { c, p } = await people();
    const id = await make(c, p.id);
    await applyChange(p, id, { action: "APPEND", milestone: { title: "Client provides staging access", type: "GATE", day: 3, bps: 0, proof: { artifacts: [{ kind: "LINK", min: 1 }], criteria: ["Access works"] }, lockRule: "Both confirm.", disputeRule: "Delay extends dates." } });
    await applyChange(c, id, { action: "APPEND_CLAUSE", title: "Weekly demo", body: "The provider shows progress every Friday." });
    const revs = await db.select().from(revisions).where(eq(revisions.workspaceId, id));
    expect(revs.map((r) => r.revNo).sort()).toEqual([1, 2, 3]);
    expect(new Set(revs.map((r) => r.hash)).size).toBe(3);
    await expect(db.update(revisions).set({ hash: "tampered" }).where(and(eq(revisions.workspaceId, id), eq(revisions.revNo, 1)))).rejects.toThrow();
    await expect(db.delete(revisions).where(eq(revisions.workspaceId, id))).rejects.toThrow();
    const [r1] = await db.select().from(revisions).where(and(eq(revisions.workspaceId, id), eq(revisions.revNo, 1)));
    expect(r1.hash).not.toBe("tampered");
    // stale edits are refused (409 semantics)
    await expect(applyChangeAt(c, id, { action: "SET_DAY", milestoneCode: "M03", day: 12 }, 1)).rejects.toMatchObject({ code: "MERGE_REQUIRED" });
    // the appended milestone is custom and a GATE carries no money
    const [m] = await db.select().from(wsMilestones).where(and(eq(wsMilestones.workspaceId, id), eq(wsMilestones.code, "C01")));
    expect(m.origin).toBe("CUSTOM");
    expect(m.amountCents).toBe(0);
  });

  it("F2.11 high risk goes to Operations; return sends it back to DRAFT, clear locks it", async () => {
    const { c, p, o } = await people("standard");
    const id = await make(c, p.id, 1_800_000);
    for (const k of ["TPL_IP", "TPL_CHANGE", "TPL_WARRANTY"]) await applyChange(c, id, { action: "TOGGLE_CLAUSE", clauseCode: k, active: false });
    for (const t of ["Daily stand-up notes", "Shared Slack channel", "Design files in Figma"]) await applyChange(c, id, { action: "APPEND_CLAUSE", title: t, body: `${t} are part of the delivery.` });
    let v = await applyChange(c, id, { action: "SET_BPS", shares: { M02: 4000, M03: 2000, M04: 1500, M05: 1000, M06: 1000, M07: 500 } });
    expect(v.violations).toEqual([]);
    expect(v.riskScore).toBeGreaterThanOrEqual(75);
    await sign(c, id, v.revision, v.canonicalHash!);
    v = await sign(p, id, v.revision, v.canonicalHash!);
    expect(v.state).toBe("PENDING_OPS");
    await expect(clearContract(c, id, "clear", "")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await clearContract(o, id, "return", "Restore the code-ownership clause, please.");
    v = await getWorkspace(o, id);
    expect(v.state).toBe("DRAFT");
    expect(v.signatures.every((s) => s.voided)).toBe(true);
    // signing again goes straight back to Operations; this time ops clears it
    await sign(c, id, v.revision, v.canonicalHash!);
    await sign(p, id, v.revision, v.canonicalHash!);
    await clearContract(o, id, "clear", "Checked with both parties.");
    const [w] = await db.select().from(workspaces).where(eq(workspaces.id, id));
    expect(w.state).toBe("LOCKED");
    const trs = await db.select().from(tranches).where(eq(tranches.workspaceId, id));
    expect(trs.map((t) => t.amountCents)).toEqual([1_800_000]);
  });

  it("F2.10 only the parties can sign; R08 blocks an unpayable provider", async () => {
    const { c, p, o } = await people("new", false);
    const id = await make(c, p.id);
    const v = await getWorkspace(c, id);
    expect(v.violations.map((x) => x.rule)).toContain("R08");
    await expect(sign(o, id, v.revision, v.canonicalHash!)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getWorkspace({ id: "u_nobody", role: "client" }, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("F2.06 input parsing never uses floating point", () => {
    expect(parsePctToBps("15.25")).toBe(1525);
    expect(parsePctToBps("100")).toBe(10_000);
    expect(parsePctToBps("100.01")).toBeNull();
    expect(parseDollarsToCents("6,000")).toBe(600_000);
    expect(parseDollarsToCents("$12000.5")).toBe(1_200_050);
    expect(parseDollarsToCents("1e5")).toBeNull();
  });
});
