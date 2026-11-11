/**
 * F4.05 F4.06 F4.07 — the mediator network against the database: routing at seal with a stored breakdown, offer
 * expiry and reassignment through the dispute timer sweep, decline, Ops lead queue after 3 misses, Ops assignment,
 * co-sign rules (Senior, other firm, conflicts, probation), mediator fees (no rail call), ratings after settlement,
 * calibration, and the public application. Every run makes its own org and people (unique ids); money, AI and the
 * virtual clock are mocked.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { disputes, evidencePackages, orgs, tranches, users, workspaces, wsMilestones } from "@/db/schema";
import { mediatorApplications, mediatorAvailability, mediatorCaseFlags, mediatorCredentials, mediatorFees, mediatorOffers, mediatorProfiles, mediatorReviews, type MediatorStatus } from "@/db/schema-mediators";
import { newId, sha256 } from "@/lib/ids";
import { HOUR } from "@/lib/clock";
import { DomainError, type Actor } from "../types";

const h = vi.hoisted(() => ({ now: new Date("2026-11-08T10:00:00Z") }));
vi.mock("@/server/clock", () => ({ workspaceNow: vi.fn(async () => h.now), offsetFor: vi.fn(async () => 0) }));
vi.mock("@/server/money", () => ({
  returnToClient: vi.fn(async (_a: unknown, _t: string, _c: number, _r: string, key: string) => ({ refundId: `rf_${key.slice(0, 8)}` })),
  releaseMilestone: vi.fn(async () => ({ releaseId: "rl_1", netCents: 0, feeCents: 0 })),
}));
vi.mock("@/server/ai", () => ({ mediate: vi.fn(async () => ({ available: false, reason: "off in tests" })) }));

import * as money from "@/server/money";
import { cosignVerdict, issueVerdict, lockVault, openDispute, retryExecution, runDisputeTimers, skipToVault } from "../disputes";
import { acceptOffer, assignmentOf, declineOffer, decideApplication, opsAssign, submitApplication, submitCalibration, submitReview } from "./index";
import { CALIBRATION_CASES } from "./rules";
import type { ScoreBreakdown } from "./router";

const tag = newId("t").slice(2, 14);
const orgId = `org_t9_${tag}`;
const T0 = new Date("2026-11-08T10:00:00Z");
const code = (e: unknown) => (e instanceof DomainError ? e.code : String(e));
const err = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e) { return code(e); } };
const ops: Actor = { id: `u_ops_${tag}`, role: "ops" };
const NARR = "The delivered screens do not match the agreed design.";
const FINDINGS = "Two of the four criteria are met by the evidence on file.";

interface MSpec { key: string; status: MediatorStatus; firm?: string | null; domains?: string[]; tz?: string; maxOpen?: number; conflicts?: string[]; verdicts?: number; lang?: string[]; cred?: "ok" | "expired" | "none" }
const M = (key: string): Actor => ({ id: `u_m_${key}_${tag}`, role: "mediator" });
async function mediator(s: MSpec) {
  const a = M(s.key);
  await db.insert(users).values({ id: a.id, orgId, email: `${a.id}@test.example`, name: `Mediator ${s.key}`, role: "mediator", tier: "standard" });
  await db.insert(mediatorProfiles).values({ userId: a.id, orgId, status: s.status, firm: s.firm ?? null, domains: s.domains ?? ["digital"], languages: s.lang ?? ["en"], timezone: s.tz ?? "UTC", maxOpen: s.maxOpen ?? 5, declaredConflicts: s.conflicts ?? [], verdictCount: s.verdicts ?? 0 });
  if ((s.cred ?? "ok") !== "none") await db.insert(mediatorCredentials).values({ id: newId("mcr"), userId: a.id, type: "Accreditation", issuer: "Test body", numberMasked: "••••1234", expiresOn: s.cred === "expired" ? "2026-01-01" : "2028-01-01", status: "VERIFIED" });
  return a;
}

let seeded = false;
let A: Actor, B: Actor, S1: Actor, S2: Actor, PR: Actor, CAL: Actor;
async function network() {
  if (seeded) return; seeded = true;
  await db.insert(orgs).values({ id: orgId, name: `mediator test ${tag}` });
  await db.insert(users).values({ id: ops.id, orgId, email: `${ops.id}@test.example`, name: "Ops", role: "ops", tier: "standard" });
  A = await mediator({ key: "a", status: "ACTIVE", firm: "Harbor", domains: ["UC_WEB_MVP"], tz: "UTC" });            // exact fit: top
  B = await mediator({ key: "b", status: "ACTIVE", firm: "Kestrel", domains: ["digital"], tz: "UTC" });              // category fit: second
  S1 = await mediator({ key: "s1", status: "SENIOR", firm: "Harbor", domains: ["digital"], tz: "Asia/Tokyo", verdicts: 20 }); // same firm as A
  S2 = await mediator({ key: "s2", status: "SENIOR", firm: "Northgate", domains: ["digital"], tz: "Pacific/Auckland", verdicts: 20 });
  PR = await mediator({ key: "pr", status: "PROBATION", firm: "Kestrel", domains: ["travel"] });
  CAL = await mediator({ key: "cal", status: "CALIBRATING", domains: ["digital"] });
  await mediator({ key: "x1", status: "ACTIVE", domains: ["automotive"] });          // wrong domain
  await mediator({ key: "x2", status: "ACTIVE", domains: ["digital"], cred: "expired" }); // expired credential
  await mediator({ key: "x3", status: "ACTIVE", domains: ["digital"], lang: ["fr"] });   // no shared language
  const lv = await mediator({ key: "x4", status: "ACTIVE", domains: ["digital"] });
  await db.insert(mediatorAvailability).values({ userId: lv.id, weeklyHours: 5, leaveFrom: "2026-11-01", leaveTo: "2026-11-30" });
}

async function contract(o: { amountCents?: number; windowHours?: number; blueprint?: string; providerFirm?: string } = {}) {
  await network();
  const n = newId("x").slice(2, 10);
  const c: Actor = { id: `u_c_${n}_${tag}`, role: "client" }, p: Actor = { id: `u_p_${n}_${tag}`, role: "provider" };
  await db.insert(users).values([
    { id: c.id, orgId, email: `${c.id}@test.example`, name: "Client", role: "client" as const, tier: "standard" as const, profile: { timezone: "Europe/London" } },
    { id: p.id, orgId, email: `${p.id}@test.example`, name: "Provider", role: "provider" as const, tier: "standard" as const, profile: { timezone: "UTC", ...(o.providerFirm ? { provider: { businessName: o.providerFirm } } : {}) } },
  ]);
  const amt = o.amountCents ?? 200_000;
  const ws = newId("ws"), tr = newId("tr");
  await db.insert(workspaces).values({ id: ws, orgId, blueprintCode: o.blueprint ?? "UC_WEB_MVP", title: "Network test", clientId: c.id, providerId: p.id, totalCents: amt * 2, state: "LOCKED", rail: "MOCK" });
  await db.insert(tranches).values({ id: tr, workspaceId: ws, idx: 1, rail: "MOCK", amountCents: amt * 2, startDay: 1, endDay: 26, state: "HELD", heldAt: T0, windowEndsAt: new Date(T0.getTime() + (o.windowHours ?? 20 * 24) * HOUR) });
  const proof = { artifacts: [{ kind: "IMAGE" as const, min: 1 }], criteria: ["Screens match design"] };
  const m1 = newId("ms");
  await db.insert(wsMilestones).values([{ id: m1, workspaceId: ws, seq: 1, code: "M1", origin: "BASELINE" as const, type: "PAY" as const, title: "M1", targetDay: 5, bps: 5000, amountCents: amt, proof, lockRule: "Client approves", disputeRule: "Compare to design", dependsOn: [], trancheIdx: 1, state: "SUBMITTED" },
    { id: newId("ms"), workspaceId: ws, seq: 2, code: "M2", origin: "BASELINE" as const, type: "PAY" as const, title: "M2", targetDay: 10, bps: 5000, amountCents: amt, proof, lockRule: "Client approves", disputeRule: "Compare", dependsOn: [], trancheIdx: 1, state: "LOCKED" }]);
  await db.insert(evidencePackages).values({ id: newId("ev"), milestoneId: m1, attempt: 1, rootHash: sha256(`root-${ws}`), files: [{ name: "s.png", kind: "IMAGE", size: 1, sha256: sha256(`f-${ws}`) }], submittedBy: p.id });
  return { c, p, m1, amt };
}
async function sealed(o: Parameters<typeof contract>[0] = {}) {
  const k = await contract(o);
  const id = await openDispute(k.c, k.m1, "QUALITY", NARR);
  await skipToVault(k.c, id); await lockVault(k.c, id); await lockVault(k.p, id);
  return { ...k, id };
}
const dispute = async (id: string) => (await db.select().from(disputes).where(eq(disputes.id, id)))[0];
const offers = async (id: string) => db.select().from(mediatorOffers).where(eq(mediatorOffers.disputeId, id)).orderBy(mediatorOffers.attempt);
const later = (hours: number) => { h.now = new Date(h.now.getTime() + hours * HOUR); return h.now; };

beforeEach(() => { h.now = new Date(T0); vi.mocked(money.returnToClient).mockClear(); vi.mocked(money.releaseMilestone).mockClear(); });
afterAll(async () => { await pool.end(); });

describe("F4.05 routing at seal", () => {
  it("F4.05 sealing offers the case to the best-scoring eligible mediator and stores the breakdown", async () => {
    const k = await sealed();
    const d = await dispute(k.id);
    expect(d.state).toBe("TIER3");
    expect(d.mediatorId).toBe(A.id);
    const [o] = await offers(k.id);
    expect(o).toMatchObject({ mediatorId: A.id, attempt: 1, source: "ROUTER", answer: null });
    expect(o.expiresAt.getTime() - o.offeredAt.getTime()).toBe(2 * HOUR);
    const b = o.breakdown as unknown as ScoreBreakdown;
    expect(b.mode).toBe("network");
    expect(b.rank).toBe(1);
    expect(b.parts.find((p) => p.part === "domain")!.points).toBe(400);
    expect(b.parts.reduce((s, p) => s + p.points, 0)).toBe(b.total);
    const why = Object.fromEntries(b.excluded.map((x) => [x.id, x.reasons]));
    expect(why[PR.id]).toEqual(expect.arrayContaining(["STATUS", "DOMAIN"]));
    expect(why[CAL.id]).toContain("STATUS");
    expect(why[M("x1").id]).toContain("DOMAIN");
    expect(why[M("x2").id]).toContain("CREDENTIALS");
    expect(why[M("x3").id]).toContain("LANGUAGE");
    expect(why[M("x4").id]).toContain("ON_LEAVE");
    expect(b.runnersUp[0].id).toBe(B.id);
  });
  it("F4.05 a provider in the mediator's firm excludes that mediator (SAME_FIRM); fast track gives 30 minutes", async () => {
    const k = await sealed({ providerFirm: "Harbor LLC", windowHours: 60 });
    const [o] = await offers(k.id);
    expect(o.mediatorId).toBe(B.id);
    expect(o.expiresAt.getTime() - o.offeredAt.getTime()).toBe(30 * 60_000);
    expect((o.breakdown as unknown as ScoreBreakdown).excluded.find((x) => x.id === A.id)?.reasons).toContain("SAME_FIRM");
  });
});

describe("F4.05 offers: expiry, decline, Ops lead queue", () => {
  it("F4.05 an expired offer moves to the next mediator in the timer sweep; decline moves on; 3 misses → Ops lead", async () => {
    const k = await sealed();
    expect((await dispute(k.id)).mediatorId).toBe(A.id);
    await runDisputeTimers(later(1)); // still open
    expect((await offers(k.id)).length).toBe(1);
    const r = await runDisputeTimers(later(1.5));
    expect(r.actions.some((x) => x.disputeId === k.id && /expired/.test(x.action))).toBe(true);
    let os = await offers(k.id);
    expect(os.map((o) => [o.mediatorId, o.answer])).toEqual([[A.id, "EXPIRED"], [B.id, null]]);
    expect((await dispute(k.id)).mediatorId).toBe(B.id);
    expect(await err(acceptOffer(A, os[0].id))).toBe("OFFER_CLOSED");
    expect(await err(declineOffer(B, os[1].id, "x"))).toBe("BAD_INPUT");
    await declineOffer(B, os[1].id, "Away on site visits");
    os = await offers(k.id);
    expect(os[2]).toMatchObject({ attempt: 3, answer: null });
    const third = os[2].mediatorId;
    expect([S1.id, S2.id]).toContain(third);
    await declineOffer({ id: third, role: "mediator" }, os[2].id, "Conflict of schedule");
    const d = await dispute(k.id);
    expect(d.mediatorId).toBeNull();
    const [f] = await db.select().from(mediatorCaseFlags).where(eq(mediatorCaseFlags.disputeId, k.id));
    expect(f.misses).toBe(3);
    expect(f.opsQueueAt).not.toBeNull();
    expect((await offers(k.id)).length).toBe(3);
    // Ops assigns by hand; an ineligible pick is refused with the reason
    expect(await err(opsAssign(ops, k.id, M("x1").id))).toBe("NOT_ELIGIBLE");
    expect(await err(opsAssign(A, k.id, B.id))).toBe("FORBIDDEN");
    await opsAssign(ops, k.id, A.id);
    const a = await assignmentOf(k.id);
    expect(a.current).toMatchObject({ mediatorId: A.id, source: "OPS", answer: null });
    expect(a.flags?.opsQueueAt).toBeNull();
    await acceptOffer(A, a.current!.id);
    expect((await dispute(k.id)).mediatorId).toBe(A.id);
    expect((await assignmentOf(k.id)).current?.answer).toBe("ACCEPTED");
  });
  it("F4.05 accepting after the window closes is refused and the case moves on", async () => {
    const k = await sealed();
    const [o] = await offers(k.id);
    later(3);
    expect(await err(acceptOffer(A, o.id))).toBe("OFFER_EXPIRED");
    expect((await dispute(k.id)).mediatorId).toBe(B.id);
  });
  it("F4.05 signing the verdict accepts the open offer; another mediator cannot sign", async () => {
    const k = await sealed();
    expect(await err(issueVerdict(B, k.id, { providerShareBps: 5000, findings: FINDINGS, rootCause: "CRITERIA_VAGUE", disposition: "RESUME" }))).toBe("NOT_ASSIGNED");
    await issueVerdict(A, k.id, { providerShareBps: 5000, findings: FINDINGS, rootCause: "CRITERIA_VAGUE", disposition: "RESUME" });
    const [o] = await offers(k.id);
    expect(o.answer).toBe("ACCEPTED");
    expect((await dispute(k.id)).state).toBe("RESOLVED");
  });
});

describe("F4.06 co-signature in the network", () => {
  it("F4.06 above $5,000 the co-signer must be Senior, from another firm and conflict-free; fees are recorded without a rail call", async () => {
    const k = await sealed({ amountCents: 600_000 });
    await issueVerdict(A, k.id, { providerShareBps: 7000, findings: FINDINGS, rootCause: "SCOPE_CHANGE", disposition: "RESUME", fault: "SHARED" });
    expect(money.returnToClient).not.toHaveBeenCalled();
    expect(await err(retryExecution(A, k.id))).toBe("AWAITING_COSIGN");
    expect(await err(cosignVerdict(B, k.id))).toBe("NOT_SENIOR");
    expect(await err(cosignVerdict(S1, k.id))).toBe("SAME_FIRM");
    await db.update(mediatorProfiles).set({ declaredConflicts: [`${k.c.id}@test.example`] }).where(eq(mediatorProfiles.userId, S2.id));
    expect(await err(cosignVerdict(S2, k.id))).toBe("COI");
    await db.update(mediatorProfiles).set({ declaredConflicts: [] }).where(eq(mediatorProfiles.userId, S2.id));
    await cosignVerdict(S2, k.id);
    expect((await dispute(k.id)).state).toBe("RESOLVED");
    expect(money.returnToClient).toHaveBeenCalledTimes(1); // leg 1 only: fees never touch a rail
    expect(money.releaseMilestone).toHaveBeenCalledTimes(1);
    const fees = await db.select().from(mediatorFees).where(eq(mediatorFees.disputeId, k.id));
    expect(fees.map((f) => [f.mediatorId, f.role, f.amountCents]).sort()).toEqual([[A.id, "VERDICT", 6000], [S2.id, "COSIGN", 2500]].sort());
    const [f] = await db.select().from(mediatorCaseFlags).where(eq(mediatorCaseFlags.disputeId, k.id));
    expect(f.cosignReasons).toEqual(["HIGH_VALUE"]);
    expect(typeof f.secondReview).toBe("boolean");
  });
  it("F4.06 a probation mediator's first 5 verdicts wait for a Senior; after 5 co-signed they become Active", async () => {
    await db.update(mediatorProfiles).set({ domains: ["UC_TRAVEL_TOUR"] }).where(eq(mediatorProfiles.userId, PR.id));
    for (let i = 0; i < 5; i++) {
      const k = await sealed({ blueprint: "UC_TRAVEL_TOUR", amountCents: 50_000 });
      expect((await offers(k.id)).map((o) => o.mediatorId)).not.toContain(PR.id); // the router offers only to Active and Senior …
      expect((await dispute(k.id)).mediatorId).toBeNull(); // … and nobody else covers travel, so the case waits for the Ops lead
      await opsAssign(ops, k.id, PR.id); // probation mediators get cases from the Ops lead (or by taking open cases), never from the router
      await issueVerdict(PR, k.id, { providerShareBps: 6000, findings: FINDINGS, rootCause: "LATE_DELIVERY", disposition: "RESUME" });
      expect((await dispute(k.id)).state).toBe("TIER3");
      expect(await err(retryExecution(ops, k.id))).toBe("AWAITING_COSIGN");
      expect(await err(cosignVerdict(B, k.id))).toBe("NOT_SENIOR");
      await cosignVerdict(S1, k.id); // S1 (Harbor) and PR (Kestrel): different firms
      expect((await dispute(k.id)).state).toBe("RESOLVED");
    }
    const [p] = await db.select().from(mediatorProfiles).where(eq(mediatorProfiles.userId, PR.id));
    expect(p.status).toBe("ACTIVE");
    expect(p.verdictCount).toBe(5);
  });
});

describe("ratings after settlement", () => {
  it("only the parties rate, only after settlement, once each", async () => {
    const k = await sealed();
    expect(await err(submitReview(k.c, k.id, 5, ""))).toBe("NOT_SETTLED");
    await issueVerdict(A, k.id, { providerShareBps: 5000, findings: FINDINGS, rootCause: "CRITERIA_VAGUE", disposition: "RESUME" });
    expect(await err(submitReview(B, k.id, 5, ""))).toBe("NOT_PARTY");
    expect(await err(submitReview(k.c, k.id, 6, ""))).toBe("BAD_INPUT");
    await submitReview(k.c, k.id, 4, "Clear findings.");
    await submitReview(k.p, k.id, 3, "");
    expect(await err(submitReview(k.c, k.id, 5, ""))).toBe("ALREADY_RATED");
    const rs = await db.select().from(mediatorReviews).where(eq(mediatorReviews.disputeId, k.id));
    expect(rs.map((r) => [r.raterRole, r.score, r.mediatorId]).sort()).toEqual([["client", 4, A.id], ["provider", 3, A.id]]);
  });
});

describe("calibration", () => {
  const gold = CALIBRATION_CASES.map((c) => ({ caseId: c.id, shareBps: c.gold.providerShareBps, rootCause: c.gold.rootCause }));
  it("a failed attempt is recorded; a pass moves Calibrating → Probation; others cannot calibrate", async () => {
    await network();
    expect(await err(submitCalibration(A, gold))).toBe("NOT_CALIBRATING");
    expect(await err(submitCalibration(CAL, gold.slice(0, 2)))).toBe("BAD_INPUT");
    const bad = await submitCalibration(CAL, gold.map((g) => ({ ...g, shareBps: Math.max(0, g.shareBps - 2500) })));
    expect(bad).toMatchObject({ passed: false, scorePct: 0, attempt: 1, attemptsLeft: 2 });
    const ok = await submitCalibration(CAL, gold);
    expect(ok).toMatchObject({ passed: true, scorePct: 100, attempt: 2 });
    const [p] = await db.select().from(mediatorProfiles).where(eq(mediatorProfiles.userId, CAL.id));
    expect(p).toMatchObject({ status: "PROBATION", calibrationScore: 100, calibrationAttempts: 2 });
    expect(await err(submitCalibration(CAL, gold))).toBe("NOT_CALIBRATING");
  });
});

describe("public application", () => {
  const form = (email: string) => ({ name: "Test Applicant", email, domains: ["construction"], languages: ["en"], timezone: "Europe/Berlin", credentials: "Chartered engineer, 2019", weeklyHours: "6", conflicts: "Acme Roofing\nBeta Builders" });
  it("validation, honeypot, duplicate, rate limit; Ops approval creates a Verifying profile", async () => {
    await network();
    const ip = `ip_${tag}`;
    const email = `apply_${tag}@test.example`;
    expect(await submitApplication({ ...form(email), email: "bad" }, ip)).toMatchObject({ ok: false, code: "invalid" });
    expect(await submitApplication({ ...form(`robot_${tag}@test.example`), website: "spam" }, ip)).toMatchObject({ ok: true, code: "received" });
    expect(await db.select().from(mediatorApplications).where(eq(mediatorApplications.email, `robot_${tag}@test.example`))).toHaveLength(0);
    expect(await submitApplication(form(email), ip)).toMatchObject({ ok: true, code: "received" });
    expect(await submitApplication(form(email.toUpperCase()), ip)).toMatchObject({ ok: true, code: "already" });
    expect(await submitApplication(form(email), ip)).toMatchObject({ ok: true, code: "already" });
    expect(await submitApplication(form(email), ip)).toMatchObject({ ok: false, code: "limit" });
    const [app] = await db.select().from(mediatorApplications).where(eq(mediatorApplications.email, email));
    expect(await err(decideApplication(A, orgId, app.id, "APPROVE", ""))).toBe("FORBIDDEN");
    const { userId } = await decideApplication(ops, orgId, app.id, "APPROVE", "Strong roofing background");
    const [p] = await db.select().from(mediatorProfiles).where(eq(mediatorProfiles.userId, userId!));
    expect(p).toMatchObject({ status: "VERIFYING", domains: ["construction"], declaredConflicts: ["Acme Roofing", "Beta Builders"], maxOpen: 2 });
    const [u] = await db.select().from(users).where(and(eq(users.id, userId!), eq(users.role, "mediator")));
    expect(u.email).toBe(email);
    expect(await err(decideApplication(ops, orgId, app.id, "REJECT", ""))).toBe("DECIDED");
  });
});
