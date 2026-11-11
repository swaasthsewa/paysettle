/**
 * A6 "Try to cheat" (F5.04, P5, P9): the tamper demo only ever reaches a sandbox simulation's own rows.
 * Covers: refusal outside sandbox mode, refusal for a workspace that is not a recorded simulation (even when a sim session
 * points at it), the append-only trigger refusing a direct edit of the real chain, detection of an edited copy (content)
 * and of an edited-and-re-hashed copy (chain link), isolation between simulations, and repair by reset.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { auditChain, orgs, simSessions, tranches, users, workspaces } from "@/db/schema";
import { sandboxAuditCopies } from "@/db/schema-evidence";
import { simWorkspaces } from "@/db/schema-sim";
import { audit } from "@/lib/audit";
import { SandboxOnly, createSim, setSimWorkspace } from "./session";
import { attemptDirectAuditEditForDemo, copySimAudit, repairSimAuditForDemo, resolveSimScope, rowHash, tamperSimAuditCopyForDemo, verifySimAuditCopy } from "./tamper";

const RUN = Math.random().toString(36).slice(2, 8);
const ORG = `org_t_x1t_${RUN}`, CLIENT = `u_x1tc_${RUN}`;
const JUDGE = { id: "u_judge", role: "judge" };
const prevEnv = process.env.PAYSETTLE_ENV;
afterEach(() => { if (prevEnv === undefined) delete process.env.PAYSETTLE_ENV; else process.env.PAYSETTLE_ENV = prevEnv; });
const madeWs: string[] = [], madeSims: string[] = [];

async function workspace(label: string) {
  const id = `ws_x1t_${RUN}_${label}`;
  await db.insert(workspaces).values({ id, orgId: ORG, blueprintCode: "UC_WEB_MVP", title: `Tamper ${label}`, clientId: CLIENT, totalCents: 600_000, state: "LOCKED" });
  await db.insert(tranches).values({ id: `tr_${id}`, workspaceId: id, idx: 1, rail: "MOCK", amountCents: 600_000, startDay: 0, endDay: 20, state: "HELD" });
  madeWs.push(id);
  await audit(db, { id: CLIENT, role: "client" }, "contract.create", id, { totalCents: 600_000 });
  await audit(db, { id: CLIENT, role: "client" }, "money.fund", `tr_${id}`, { amountCents: 600_000, rail: "MOCK" });
  await audit(db, { id: CLIENT, role: "client" }, "evidence.approve", id, { note: "ok" });
  return id;
}
async function simFor(wsId: string, tag = true) {
  const s = await createSim(JUDGE, "S1", "MOCK");
  madeSims.push(s.id);
  if (tag) await setSimWorkspace(s.id, wsId);
  else await db.update(simSessions).set({ workspaceId: wsId }).where(eq(simSessions.id, s.id)); // forged: points at a real workspace
  return s.id;
}
const realRows = (wsId: string) => db.select().from(auditChain).where(inArray(auditChain.target, [wsId, `tr_${wsId}`])).orderBy(asc(auditChain.seq));

let simWs = "", realWs = "", otherWs = "", simA = "", simB = "", forged = "";
beforeAll(async () => {
  await db.insert(orgs).values({ id: ORG, name: "Sequence tamper tests" });
  await db.insert(users).values({ id: CLIENT, orgId: ORG, email: `${CLIENT}@test.local`, name: "Tamper Client", role: "client" });
  simWs = await workspace("sim"); otherWs = await workspace("other"); realWs = await workspace("real");
  simA = await simFor(simWs); simB = await simFor(otherWs); forged = await simFor(realWs, false);
});
afterAll(async () => {
  await db.delete(sandboxAuditCopies).where(inArray(sandboxAuditCopies.workspaceId, madeWs));
  await db.update(simSessions).set({ workspaceId: null }).where(inArray(simSessions.id, madeSims));
  await db.delete(simWorkspaces).where(inArray(simWorkspaces.workspaceId, madeWs));
  await db.delete(tranches).where(inArray(tranches.workspaceId, madeWs));
  await db.delete(workspaces).where(inArray(workspaces.id, madeWs));
  await db.delete(users).where(eq(users.id, CLIENT));
  await db.delete(orgs).where(eq(orgs.id, ORG));
});

describe("A6 P9 the tamper demo cannot be aimed at non-simulation data", () => {
  it("A6 P9: every entry point refuses outside sandbox mode", async () => {
    process.env.PAYSETTLE_ENV = "production";
    await expect(resolveSimScope(simA)).rejects.toBeInstanceOf(SandboxOnly);
    await expect(copySimAudit(simA)).rejects.toBeInstanceOf(SandboxOnly);
    await expect(attemptDirectAuditEditForDemo(JUDGE, simA)).rejects.toBeInstanceOf(SandboxOnly);
    await expect(tamperSimAuditCopyForDemo(JUDGE, simA, { mode: "edit" })).rejects.toBeInstanceOf(SandboxOnly);
    await expect(verifySimAuditCopy(simA)).rejects.toBeInstanceOf(SandboxOnly);
    await expect(repairSimAuditForDemo(JUDGE, simA)).rejects.toBeInstanceOf(SandboxOnly);
  });

  it("A6: a sim session pointing at a workspace that is not in sim_workspaces is refused, and its real rows stay unchanged", async () => {
    const before = await realRows(realWs);
    await expect(resolveSimScope(forged)).rejects.toMatchObject({ code: "NOT_SIM" });
    await expect(tamperSimAuditCopyForDemo(JUDGE, forged, { mode: "edit" })).rejects.toMatchObject({ code: "NOT_SIM" });
    await expect(tamperSimAuditCopyForDemo(JUDGE, forged, { mode: "rehash" })).rejects.toMatchObject({ code: "NOT_SIM" });
    await expect(attemptDirectAuditEditForDemo(JUDGE, forged)).rejects.toMatchObject({ code: "NOT_SIM" });
    await expect(verifySimAuditCopy(forged)).rejects.toMatchObject({ code: "NOT_SIM" });
    await expect(repairSimAuditForDemo(JUDGE, forged)).rejects.toMatchObject({ code: "NOT_SIM" });
    await expect(resolveSimScope("x'; drop table audit_chain; --")).rejects.toMatchObject({ code: "NOT_SIM" });
    expect(await realRows(realWs)).toEqual(before);
    expect(await db.select().from(sandboxAuditCopies).where(eq(sandboxAuditCopies.workspaceId, realWs))).toHaveLength(0);
  });

  it("A6: a row of another simulation cannot be targeted through this one", async () => {
    await copySimAudit(simB);
    const [rowOfB] = await db.select().from(sandboxAuditCopies).where(eq(sandboxAuditCopies.simId, simB)).limit(1);
    await expect(tamperSimAuditCopyForDemo(JUDGE, simA, { seq: rowOfB.seq, mode: "edit" })).rejects.toMatchObject({ code: "NOT_SIM" });
  });
});

describe("A6 Try to cheat on a simulation", () => {
  it("A6 P5: a direct UPDATE on the real chain is refused by the append-only trigger and changes nothing", async () => {
    const before = await realRows(simWs);
    const r = await attemptDirectAuditEditForDemo(JUDGE, simA);
    expect(r.refused).toBe(true);
    expect(r.message).toMatch(/append-only/);
    expect(await realRows(simWs)).toEqual(before);
  });

  it("A6: an untouched copy verifies with the same formula as the audit writer", async () => {
    await copySimAudit(simA);
    const v = await verifySimAuditCopy(simA);
    expect(v.ok).toBe(true);
    expect(v.realIntact).toBe(true);
    expect(v.rows.length).toBeGreaterThanOrEqual(3);
    const real = await realRows(simWs);
    for (const r of real) expect(rowHash(r.prevHash, r)).toBe(r.hash);
  });

  it("A6: editing an amount in a copied row turns exactly that row red (content check)", async () => {
    const t = await tamperSimAuditCopyForDemo(JUDGE, simA, { mode: "edit" });
    expect(t.change).toMatch(/\$6,000\.00 → \$60,000\.00/);
    const v = await verifySimAuditCopy(simA);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(t.seq);
    expect(v.rows.filter((r) => r.status !== "ok").map((r) => r.seq)).toEqual([t.seq]);
    expect(v.rows.find((r) => r.seq === t.seq)?.status).toBe("content");
    expect(v.realIntact).toBe(true);
    const [b] = await db.select().from(sandboxAuditCopies).where(eq(sandboxAuditCopies.simId, simB)).limit(1);
    expect(b.tampered).toBeNull();
  });

  it("A6: editing and re-hashing the row is still caught: the next real row points at the old hash (link check)", async () => {
    const t = await tamperSimAuditCopyForDemo(JUDGE, simA, { mode: "rehash" });
    const v = await verifySimAuditCopy(simA);
    expect(v.brokenAt).toBe(t.seq);
    const row = v.rows.find((r) => r.seq === t.seq)!;
    expect(row.status).toBe("link");
    expect(row.why).toMatch(/still points at the original hash/);
    expect((await realRows(simWs)).every((r) => rowHash(r.prevHash, r) === r.hash)).toBe(true);
  });

  it("A6 F5.08: repair drops the copy and resets the scenario to a fresh session", async () => {
    const fresh = await repairSimAuditForDemo(JUDGE, simA);
    madeSims.push(fresh.id);
    expect(fresh.id).not.toBe(simA);
    expect(fresh.clockOffsetHours).toBe(0);
    expect(await db.select().from(sandboxAuditCopies).where(eq(sandboxAuditCopies.simId, simA))).toHaveLength(0);
  });
});
