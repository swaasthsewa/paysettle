/**
 * F4.01 F4.02 F4.03 F4.05 F4.06 F4.07 F4.08 F4.09 — disputes module. DB-backed: every run makes its own org, people and
 * contracts with unique ids, so it never touches demo data. Money, AI and the virtual clock are mocked (vi.mock).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { bids, disputes, evidencePackages, orgs, rebuttals, tranches, users, verdicts, workspaces, wsMilestones } from "@/db/schema";
import { bidNonces, disputeFees, disputeMeta, disputeRateByCode } from "@/db/schema-disputes";
import { newId, sha256 } from "@/lib/ids";
import { splitDispute } from "@/lib/money";
import { HOUR, DAY } from "@/lib/clock";
import { DomainError, type Actor } from "../types";

const h = vi.hoisted(() => ({ now: new Date("2026-11-08T10:00:00Z") }));
vi.mock("@/server/clock", () => ({ workspaceNow: vi.fn(async () => h.now), offsetFor: vi.fn(async () => 0) }));
vi.mock("@/server/money", () => ({
  returnToClient: vi.fn(async (_a: unknown, _t: string, _c: number, _r: string, key: string) => ({ refundId: `rf_${key.slice(0, 8)}` })),
  releaseMilestone: vi.fn(async () => ({ releaseId: "rl_1", netCents: 0, feeCents: 0 })),
}));
vi.mock("@/server/ai", () => ({ mediate: vi.fn(async () => ({ available: true, model: "test", confidence: 0.7, data: { providerShareBps: 7500, findings: ["Two of four criteria met"], missing: [], confidence: 0.7 } })) }));

import * as money from "@/server/money";
import { addRebuttal, advanceDispute, cosignVerdict, issueVerdict, lockVault, openDispute, placeBid, retryExecution, sealVault, skipToVault, STATUS } from "./index";
import { conflicted, deadlines, feeSplit, openRound, pickMediator, roundOutcome, verifyCommit } from "./rules";

const tag = newId("t").slice(2, 14);
const orgId = `org_t9_${tag}`;
const P = (s: string, role: Actor["role"]): Actor => ({ id: `u_${s}_${tag}`, role });
const ops = P("o", "ops");
const med1 = P("m1", "mediator"), med2 = P("m2", "mediator");
const client2 = P("c2", "client"), provider2 = P("p2", "provider");
const code = (e: unknown) => (e instanceof DomainError ? e.code : String(e));
const err = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e) { return code(e); } };
const NARR = "The delivered screens do not match the agreed design.";
let seeded = false;

async function seedPeople() {
  if (seeded) return; seeded = true;
  await db.insert(orgs).values({ id: orgId, name: `b9 test ${tag}` });
  await db.insert(users).values([ops, med1, med2, client2, provider2].map((a) => ({ id: a.id, orgId, email: `${a.id}@test.example`, name: a.id, role: a.role, tier: "standard" as const })));
}

/** A locked contract: M1 SUBMITTED (disputed amount), M2 RELEASED, M3 LOCKED (depends on M1), M4 LOCKED. */
async function contract(o: { amountCents?: number; windowHours?: number; c?: Actor; p?: Actor } = {}) {
  await seedPeople();
  let c = o.c, p = o.p;
  if (!c || !p) {
    const n = newId("x").slice(2, 10);
    c = { id: `u_c_${n}_${tag}`, role: "client" }; p = { id: `u_p_${n}_${tag}`, role: "provider" };
    await db.insert(users).values([c, p].map((a) => ({ id: a.id, orgId, email: `${a.id}@test.example`, name: a.id, role: a.role, tier: "standard" as const })));
  }
  const amt = o.amountCents ?? 200_000;
  const ws = newId("ws"), tr = newId("tr");
  await db.insert(workspaces).values({ id: ws, orgId, blueprintCode: "UC_WEB_MVP", title: "Dispute test", clientId: c.id, providerId: p.id, totalCents: amt * 4, state: "LOCKED", rail: "MOCK" });
  await db.insert(tranches).values({ id: tr, workspaceId: ws, idx: 1, rail: "MOCK", amountCents: amt * 4, startDay: 1, endDay: 26, state: "HELD", heldAt: h.now, windowEndsAt: new Date(h.now.getTime() + (o.windowHours ?? 20 * 24) * HOUR) });
  const proof = { artifacts: [{ kind: "IMAGE" as const, min: 1 }], criteria: ["Screens match design"] };
  const ms = ["M1", "M2", "M3", "M4"].map((code, i) => ({ id: newId("ms"), workspaceId: ws, seq: i + 1, code, origin: "BASELINE" as const, type: "PAY" as const, title: `Milestone ${code}`, targetDay: 5 + i * 5, bps: 2500, amountCents: amt, proof, lockRule: "Client approves", disputeRule: "Mediator compares screens to the design", dependsOn: code === "M3" ? ["M1"] : [], trancheIdx: 1, state: ["SUBMITTED", "RELEASED", "LOCKED", "LOCKED"][i] }));
  await db.insert(wsMilestones).values(ms);
  const fileSha = sha256(`image-${ws}`);
  await db.insert(evidencePackages).values({ id: newId("ev"), milestoneId: ms[0].id, attempt: 1, rootHash: sha256(`root-${ws}`), files: [{ name: "screen.png", kind: "IMAGE", size: 10, sha256: fileSha }], submittedBy: p.id });
  return { c, p, ws, tr, m1: ms[0].id, m2: ms[1].id, m3: ms[2].id, m4: ms[3].id, fileSha, amt };
}
const dispute = async (id: string) => (await db.select().from(disputes).where(eq(disputes.id, id)))[0];
const verdictOf = async (id: string) => (await db.select().from(verdicts).where(eq(verdicts.disputeId, id)))[0];
const msState = async (id: string) => (await db.select({ s: wsMilestones.state }).from(wsMilestones).where(eq(wsMilestones.id, id)))[0].s;

beforeEach(() => { vi.mocked(money.returnToClient).mockClear(); vi.mocked(money.releaseMilestone).mockClear(); });
afterAll(async () => { await pool.end(); });

describe("F4.01 scoped freeze", () => {
  it("F4.01 release-final milestones cannot be disputed (403)", async () => {
    const k = await contract();
    expect(await err(openDispute(k.c, k.m2, "QUALITY", NARR))).toBe("RELEASE_FINAL");
    expect(STATUS.RELEASE_FINAL).toBe(403);
    expect(await err(openDispute(k.c, k.m3, "QUALITY", NARR))).toBe("NOT_DISPUTABLE");
    expect(await err(openDispute(client2, k.m1, "QUALITY", NARR))).toBe("NOT_PARTY");
    expect(await err(openDispute(med1, k.m1, "QUALITY", NARR))).toBe("FORBIDDEN");
  });
  it("F4.01 opening freezes only the disputed milestone; deadlines 48 h / 96 h", async () => {
    const k = await contract();
    const id = await openDispute(k.c, k.m1, "QUALITY", NARR);
    const d = await dispute(id);
    expect(await msState(k.m1)).toBe("DISPUTED");
    expect(await msState(k.m2)).toBe("RELEASED");
    expect(await msState(k.m3)).toBe("LOCKED");
    expect(d.amountCents).toBe(k.amt);
    expect(d.tier1Until.getTime() - h.now.getTime()).toBe(48 * HOUR);
    expect(d.vaultUntil.getTime() - h.now.getTime()).toBe(96 * HOUR);
    const [meta] = await db.select().from(disputeMeta).where(eq(disputeMeta.disputeId, id));
    expect(meta.frozenDependants).toEqual(["M3"]);
    expect(await err(openDispute(k.p, k.m1, "QUALITY", NARR))).toBe("ALREADY_DISPUTED");
  });
  it("F4.11 fast track: 24 h per tier when under 72 h of the hold window remain", async () => {
    const k = await contract({ windowHours: 60 });
    const d = await dispute(await openDispute(k.p, k.m1, "UNFAIR_REJECTION", NARR));
    expect(d.tier1Until.getTime() - h.now.getTime()).toBe(24 * HOUR);
    expect(d.vaultUntil.getTime() - h.now.getTime()).toBe(48 * HOUR);
    expect(deadlines(h.now, new Date(h.now.getTime() + 100 * HOUR)).fastTrack).toBe(false);
  });
});

describe("F4.02 blind bids", () => {
  it("F4.02 blind bids converge at the midpoint when within 5 points, and execute both legs", async () => {
    const k = await contract({ amountCents: 200_001 });
    const id = await openDispute(k.c, k.m1, "QUALITY", NARR);
    expect(await placeBid(k.c, id, 6000)).toEqual({ settled: false });
    expect(await err(placeBid(k.c, id, 6100))).toBe("ALREADY_BID");
    expect(await placeBid(k.p, id, 6400)).toEqual({ settled: true, shareBps: 6200 });
    const v = await verdictOf(id);
    const s = splitDispute(200_001, 6200);
    expect(v.origin).toBe("TIER1");
    expect([v.refundCents, v.releaseCents]).toEqual([s.refundCents, s.releaseCents]);
    expect(v.refundCents + v.releaseCents).toBe(200_001);
    expect(money.returnToClient).toHaveBeenCalledTimes(1);
    expect(vi.mocked(money.returnToClient).mock.calls[0][2]).toBe(s.refundCents);
    expect(vi.mocked(money.releaseMilestone).mock.calls[0][2]).toMatchObject({ kind: "VERDICT", amountCents: s.releaseCents });
    expect((await dispute(id)).state).toBe("RESOLVED");
    expect(await msState(k.m1)).toBe("SETTLED_BY_VERDICT");
    // commits verify against their stored nonce
    const bs = await db.select({ b: bids, n: bidNonces }).from(bids).innerJoin(bidNonces, eq(bidNonces.bidId, bids.id)).where(eq(bids.disputeId, id));
    for (const x of bs) expect(verifyCommit(x.b.providerShareBps, x.n.nonce, x.b.commit)).toBe(true);
    // once settled, the milestone is final
    expect(await err(openDispute(k.c, k.m1, "QUALITY", NARR))).toBe("RELEASE_FINAL");
  });
  it("F4.02 a gap over 5 points goes to the next round, and to Tier 2 after round 3", async () => {
    const k = await contract();
    const id = await openDispute(k.c, k.m1, "QUALITY", NARR);
    for (let r = 1; r <= 3; r++) {
      await placeBid(k.c, id, 3000);
      expect(await placeBid(k.p, id, 9000)).toEqual({ settled: false });
      expect((await dispute(id)).state).toBe(r < 3 ? "TIER1" : "TIER2");
    }
    expect(await err(placeBid(k.c, id, 5000))).toBe("TIER1_CLOSED");
    expect(money.returnToClient).not.toHaveBeenCalled();
  });
  it("F4.02 rules: open round and outcome; offer ≥ ask settles at the midpoint", () => {
    const b = [{ round: 1, role: "client" as const, providerShareBps: 7000 }, { round: 1, role: "provider" as const, providerShareBps: 6000 }];
    expect(roundOutcome(b, 1)).toEqual({ complete: true, settledBps: 6500 });
    expect(openRound(b)).toBe(2);
    expect(roundOutcome([{ round: 1, role: "client", providerShareBps: 1000 }, { round: 1, role: "provider", providerShareBps: 1501 }], 1).settledBps).toBeNull();
  });
  it("F4.02 skipping to the vault is allowed; Tier 1 timeout also moves on", async () => {
    const k = await contract();
    const id = await openDispute(k.c, k.m1, "QUALITY", NARR);
    await skipToVault(k.p, id);
    expect((await dispute(id)).state).toBe("TIER2");
    const k2 = await contract();
    const id2 = await openDispute(k2.c, k2.m1, "QUALITY", NARR);
    expect(await advanceDispute(id2, new Date(h.now.getTime() + 49 * HOUR))).toBe("TIER2");
  });
});

describe("F4.07 split", () => {
  it("F4.07 split sums exactly; the odd cent goes to the refund (buyer) leg", () => {
    for (let i = 0; i < 2000; i++) {
      const amt = 1 + Math.floor(Math.random() * 10_000_000), bps = Math.floor(Math.random() * 10_001);
      const s = splitDispute(amt, bps);
      expect(s.refundCents + s.releaseCents).toBe(amt);
      expect(s.refundCents).toBeGreaterThanOrEqual(0); expect(s.releaseCents).toBeGreaterThanOrEqual(0);
    }
    expect(splitDispute(200_000, 7500)).toEqual({ refundCents: 50_000, releaseCents: 150_000 });
    expect(splitDispute(1001, 5000)).toEqual({ refundCents: 501, releaseCents: 500 });
    expect(feeSplit(2500, "SHARED")).toMatchObject({ clientCents: 1250, providerCents: 1250 });
    expect(feeSplit(2501, undefined)).toMatchObject({ clientCents: 1250, providerCents: 1251 });
    expect(feeSplit(2500, "PROVIDER")).toMatchObject({ clientCents: 0, providerCents: 2500 });
  });
});

/** Opens a dispute and walks it to Tier 3 through the vault (rebuttal with an annotation, both lock). */
async function toTier3(k: Awaited<ReturnType<typeof contract>>) {
  const { c, p } = k;
  const id = await openDispute(c, k.m1, "QUALITY", NARR);
  await skipToVault(c, id);
  expect(await err(addRebuttal(p, id, { kind: "ANNOTATION", narrative: "Wrong image", sha256: sha256("x"), annotations: [{ fileSha: sha256("not-in-record"), box: [0.1, 0.1, 0.2, 0.2], comment: "Here" }] }))).toBe("BAD_ANNOTATION");
  await addRebuttal(p, id, { kind: "ANNOTATION", narrative: "Screens match section 2", sha256: sha256(`note-${id}`), annotations: [{ fileSha: k.fileSha, box: [0.1, 0.1, 0.3, 0.2], comment: "This is the agreed header" }] });
  expect(await err(sealVault(null, id))).toBe("VAULT_OPEN");
  await lockVault(c, id);
  expect(await err(addRebuttal(c, id, { kind: "NOTE", narrative: "late", sha256: sha256("late") }))).toBe("VAULT_LOCKED");
  expect((await lockVault(p, id)).sealed).toBe(true);
  return id;
}

describe("F4.03/F4.06 vault, seal and co-sign", () => {
  it("F4.03/F4.04 marks must match a Phase 3 file hash; sealing stores a dossier root and the AI proposal as advice", async () => {
    const k = await contract();
    const id = await toTier3(k);
    const d = await dispute(id);
    expect(d.state).toBe("TIER3");
    expect(d.dossierRoot).toMatch(/^[a-f0-9]{64}$/);
    expect(d.mediatorId).toMatch(/^u_m[12]_/);
    expect((d.aiProposal as { data: { providerShareBps: number } }).data.providerShareBps).toBe(7500);
    const rb = await db.select().from(rebuttals).where(eq(rebuttals.disputeId, id));
    expect(rb[0].annotations[0].fileSha).toBe(k.fileSha);
  });
  it("F4.06 a verdict over $5,000 needs a second, distinct mediator before money moves", async () => {
    const k = await contract({ amountCents: 600_000 });
    const id = await toTier3(k);
    const d = await dispute(id);
    const assigned = d.mediatorId === med1.id ? med1 : med2, other = assigned === med1 ? med2 : med1;
    expect(await err(issueVerdict(other, id, { providerShareBps: 7500, findings: "Two of four criteria were met by the evidence.", rootCause: "CRITERIA_VAGUE", disposition: "RESUME", fault: "SHARED" }))).toBe("NOT_ASSIGNED");
    await issueVerdict(assigned, id, { providerShareBps: 7500, findings: "Two of four criteria were met by the evidence.", rootCause: "CRITERIA_VAGUE", disposition: "RESUME", fault: "SHARED" });
    expect(money.returnToClient).not.toHaveBeenCalled();
    expect(money.releaseMilestone).not.toHaveBeenCalled();
    expect(await err(retryExecution(assigned, id))).toBe("AWAITING_COSIGN");
    expect(await err(cosignVerdict(assigned, id))).toBe("SAME_PERSON");
    await cosignVerdict(other, id);
    const v = await verdictOf(id);
    expect(v.cosignerId).toBe(other.id);
    expect([v.refundCents, v.releaseCents]).toEqual([150_000, 450_000]);
    expect(v.leg1).toBe("DONE"); expect(v.leg2).toBe("DONE");
    expect((await dispute(id)).state).toBe("RESOLVED");
    const [fee] = await db.select().from(disputeFees).where(eq(disputeFees.disputeId, id));
    expect(fee).toMatchObject({ basis: "SHARED", totalCents: 2500, clientCents: 1250, providerCents: 1250 });
  });
});

describe("F4.08/F4.09 execution saga", () => {
  it("F4.08 leg 2 retry does not repeat leg 1", async () => {
    const k = await contract({ amountCents: 200_000 });
    const id = await toTier3(k);
    const m = (await dispute(id)).mediatorId === med1.id ? med1 : med2;
    vi.mocked(money.releaseMilestone).mockRejectedValueOnce(new Error("PayPal timeout"));
    await issueVerdict(m, id, { providerShareBps: 7500, findings: "Evidence shows most of the work matches the design.", rootCause: "QUALITY_DEFECT", disposition: "RESUME", fault: "PROVIDER" });
    let v = await verdictOf(id);
    expect(v.leg1).toBe("DONE"); expect(v.leg2).toBe("FAILED");
    expect((await dispute(id)).state).toBe("EXECUTING");
    expect(await retryExecution(m, id)).toEqual({ done: true });
    v = await verdictOf(id);
    expect(v.leg2).toBe("DONE");
    expect(money.returnToClient).toHaveBeenCalledTimes(1);
    expect(money.releaseMilestone).toHaveBeenCalledTimes(2);
    expect((await dispute(id)).state).toBe("RESOLVED");
  });
  it("F4.09 terminate returns every unstarted milestone of the tranche", async () => {
    const k = await contract({ amountCents: 100_000 });
    const id = await toTier3(k);
    const m = (await dispute(id)).mediatorId === med1.id ? med1 : med2;
    await issueVerdict(m, id, { providerShareBps: 0, findings: "Nothing delivered matches the specification at all.", rootCause: "INCOMPLETE_WORK", disposition: "TERMINATE", fault: "PROVIDER" });
    expect(money.releaseMilestone).not.toHaveBeenCalled(); // release is 0 → leg 2 skipped
    expect(money.returnToClient).toHaveBeenCalledTimes(3); // leg 1 + M3 + M4
    expect(await msState(k.m3)).toBe("REFUNDED");
    expect(await msState(k.m4)).toBe("REFUNDED");
    expect(await msState(k.m2)).toBe("RELEASED");
  });
});

describe("F4.05 conflict of interest", () => {
  it("F4.05 rules: a mediator with a case for either party in 180 days is excluded", () => {
    const now = new Date("2026-11-08T00:00:00Z");
    const hist = [{ mediatorId: "m1", clientId: "c", providerId: "p", at: new Date(now.getTime() - 10 * DAY) }, { mediatorId: "m2", clientId: "x", providerId: "y", at: new Date(now.getTime() - 200 * DAY) }];
    expect([...conflicted(hist, ["c", "q"], now)]).toEqual(["m1"]);
    expect(pickMediator(["m1", "m2", "m3"], hist, ["q", "p"], now)).toBe("m3"); // m3 never assigned, m1 conflicted
    expect(pickMediator(["m1", "m2"], hist, ["c", "q"], now)).toBe("m2"); // m2's case was 200 days ago
    expect(pickMediator(["m1"], hist, ["p"], now)).toBeNull();
  });
  it("F4.05 the router never assigns a conflicted mediator, and a conflicted mediator cannot take the case", async () => {
    const a = await toTier3(await contract({ c: client2, p: provider2 }));
    const first = (await dispute(a)).mediatorId!;
    const b = await toTier3(await contract({ c: client2, p: provider2 }));
    const second = (await dispute(b)).mediatorId!;
    expect(second).not.toBe(first);
    const c = await toTier3(await contract({ c: client2, p: provider2 }));
    expect((await dispute(c)).mediatorId).toBeNull(); // both mediators now conflicted
    expect(await err(issueVerdict(med1, c, { providerShareBps: 5000, findings: "Split evenly because evidence is mixed.", rootCause: "COMMUNICATION", disposition: "RESUME" }))).toBe("COI");
  });
});

describe("F4.10 external PayPal dispute", () => {
  it("F4.10 a PayPal dispute on the hold supersedes the internal dispute and blocks settlement", async () => {
    const k = await contract();
    const id = await openDispute(k.c, k.m1, "QUALITY", NARR);
    await db.update(tranches).set({ warned: ["EXTERNAL_DISPUTE"] }).where(eq(tranches.id, k.tr));
    expect(await advanceDispute(id)).toBe("SUPERSEDED");
    expect(await err(placeBid(k.c, id, 5000))).toBe("TIER1_CLOSED");
    expect(money.returnToClient).not.toHaveBeenCalled();
  });
});

describe("F4.12 clause feedback loop", () => {
  it("F4.12 root causes are stored and the dispute rate per blueprint milestone code is flagged above 8%", async () => {
    const rows = await db.select().from(disputeRateByCode).where(eq(disputeRateByCode.orgId, orgId));
    const m1 = rows.find((r) => r.blueprintCode === "UC_WEB_MVP" && r.milestoneCode === "M1")!;
    const m2 = rows.find((r) => r.milestoneCode === "M2")!;
    expect(m1.disputes).toBeGreaterThan(0);
    expect(m1.flagged).toBe(true);
    expect(m2.disputes).toBe(0);
    expect(m2.flagged).toBe(false);
    const tagged = await db.select({ rc: verdicts.rootCause }).from(verdicts).innerJoin(disputes, eq(disputes.id, verdicts.disputeId)).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).where(eq(workspaces.orgId, orgId));
    expect(tagged.map((t) => t.rc)).toEqual(expect.arrayContaining(["AGREED_TIER1", "CRITERIA_VAGUE", "QUALITY_DEFECT", "INCOMPLETE_WORK"]));
  });
});
