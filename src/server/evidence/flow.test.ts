/**
 * Evidence flows against the local Postgres with money, AI and disputes mocked (vi.mock):
 * F3.04 submit/hash/GPS, F3.07 signed approval → release, F3.09 remediation and third rejection, F3.06 review timers, A3.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { evidencePackages, orgs, simSessions, tranches, users, workspaces, wsMilestones, type ProofSpec } from "@/db/schema";
import { evidenceNotifications, evidenceReviews, workspaceSites } from "@/db/schema-evidence";
import { sha256 } from "@/lib/ids";
import { DomainError, NotBuilt, type Actor } from "@/server/types";

const h = vi.hoisted(() => ({ release: vi.fn(), verify: vi.fn(), open: vi.fn() }));
vi.mock("@/server/money", () => ({ releaseMilestone: h.release }));
vi.mock("@/server/ai", () => ({ verifyEvidence: h.verify }));
vi.mock("@/server/disputes", () => ({ openDispute: h.open }));

import { approvalSignature, approveMilestone, requestFix, rootHashOf, runReviewTimers, submitEvidence, verifyApprovalSignature, SpecFailed } from "./index";
import { LocalDiskStore, objectStore, setObjectStore } from "./storage";
import { craftExifJpeg } from "./exif";
import { samplePdf, samplePng } from "./samples";
import { seedEvidence } from "./seed";

const RUN = Math.random().toString(36).slice(2, 8);
const ORG = `org_tev_${RUN}`, CLIENT = `u_tevc_${RUN}`, PROVIDER = `u_tevp_${RUN}`;
const client: Actor = { id: CLIENT, role: "client" }, provider: Actor = { id: PROVIDER, role: "provider" };
const made: { ws: string[]; ms: string[] } = { ws: [], ms: [] };
let dir = "";

const SPEC: ProofSpec = { artifacts: [{ kind: "IMAGE", min: 1 }, { kind: "PDF", min: 1 }, { kind: "LINK", min: 1 }], criteria: ["Every feature has a screen"] };
const GPS_SPEC: ProofSpec = { artifacts: [{ kind: "IMAGE", min: 1 }], gpsRadiusM: 200, criteria: ["Photo on site"] };
const NOTE = "Prototype: https://proto.example.com/app";
const goodFiles = () => [{ name: "screen.png", type: "image/png", bytes: samplePng(16, 12) }, { name: "list.pdf", type: "application/pdf", bytes: samplePdf("Screens", ["1", "2"]) }];

async function fixture(o: { rule?: "ESCALATE" | "DEEMED_APPROVED"; proof?: ProofSpec; type?: "GATE" | "PAY" } = {}) {
  const ws = `ws_tev_${RUN}_${made.ws.length}`, ms = `ms_tev_${RUN}_${made.ms.length}`;
  await db.insert(workspaces).values({ id: ws, orgId: ORG, blueprintCode: "UC_WEB_MVP", title: `Evidence test ${ws}`, clientId: CLIENT, providerId: PROVIDER, totalCents: 100_000, state: "LOCKED", reviewTimeoutRule: o.rule ?? "ESCALATE" });
  made.ws.push(ws);
  await db.insert(tranches).values({ id: `tr_${ws}`, workspaceId: ws, idx: 1, rail: "MOCK", amountCents: 100_000, startDay: 0, endDay: 20, state: "HELD" });
  await db.insert(wsMilestones).values({ id: ms, workspaceId: ws, seq: 1, code: "M02", origin: "BASELINE", type: o.type ?? "PAY", title: "Clickable design", targetDay: 6, bps: 10_000, amountCents: 100_000, proof: o.proof ?? SPEC, lockRule: "Client approves.", disputeRule: "Missing screens added in 72 h.", state: "OPEN" });
  made.ms.push(ms);
  return { ws, ms };
}
const msRow = async (id: string) => (await db.select().from(wsMilestones).where(eq(wsMilestones.id, id)))[0];
async function setOffset(ws: string, hours: number) {
  const id = `sim_${ws}`;
  await db.insert(simSessions).values({ id, scenario: "evidence-test", workspaceId: ws, clockOffsetHours: hours }).onConflictDoUpdate({ target: simSessions.id, set: { clockOffsetHours: hours } });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ps-evidence-"));
  setObjectStore(new LocalDiskStore(dir));
  await db.insert(orgs).values({ id: ORG, name: "Evidence tests" });
  await db.insert(users).values([{ id: CLIENT, orgId: ORG, email: `${CLIENT}@test.local`, name: "Test Client", role: "client" }, { id: PROVIDER, orgId: ORG, email: `${PROVIDER}@test.local`, name: "Test Provider", role: "provider" }]);
});
beforeEach(() => {
  h.release.mockReset().mockResolvedValue({ releaseId: "rel_1", netCents: 97_500, feeCents: 2_500 });
  h.verify.mockReset().mockRejectedValue(new NotBuilt("verifyEvidence"));
  h.open.mockReset().mockResolvedValue("dp_1");
});
afterAll(async () => {
  if (made.ms.length) {
    await db.delete(evidenceNotifications).where(inArray(evidenceNotifications.milestoneId, made.ms));
    await db.delete(evidenceReviews).where(inArray(evidenceReviews.milestoneId, made.ms));
    await db.delete(evidencePackages).where(inArray(evidencePackages.milestoneId, made.ms));
    await db.delete(wsMilestones).where(inArray(wsMilestones.id, made.ms));
  }
  if (made.ws.length) {
    await db.delete(simSessions).where(inArray(simSessions.workspaceId, made.ws));
    await db.delete(workspaceSites).where(inArray(workspaceSites.workspaceId, made.ws));
    await db.delete(tranches).where(inArray(tranches.workspaceId, made.ws));
    await db.delete(workspaces).where(inArray(workspaces.id, made.ws));
  }
  await db.delete(users).where(inArray(users.id, [CLIENT, PROVIDER]));
  await db.delete(orgs).where(eq(orgs.id, ORG));
  setObjectStore(null);
  rmSync(dir, { recursive: true, force: true });
  await pool.end();
});

describe("F3.04 submit evidence", () => {
  it("F3.04 hashes files, stores them, sets SUBMITTED with a 48 h review and records AI unavailable (A3)", async () => {
    const { ms } = await fixture();
    const files = goodFiles();
    const r = await submitEvidence(provider, ms, files, NOTE);
    expect(r.rootHash).toBe(rootHashOf(files.map((f) => sha256(f.bytes))));
    expect(r.rootHash).toBe(sha256(files.map((f) => sha256(f.bytes)).sort().join("")));
    expect(r.signals.find((s) => s.code === "COUNT_LINK")?.level).toBe("ok");
    expect(r.signals.find((s) => s.code === "EXIF_MISSING")?.detail).toContain("EXIF signals are a hint, not proof");
    const m = await msRow(ms);
    expect(m.state).toBe("SUBMITTED"); expect(m.attempts).toBe(1);
    expect(Math.round((m.reviewDueAt!.getTime() - Date.now()) / 3_600_000)).toBe(48);
    const [pkg] = await db.select().from(evidencePackages).where(eq(evidencePackages.id, r.packageId));
    expect(pkg.verifier).toMatchObject({ available: false });
    expect(await objectStore().getObject(sha256(files[0].bytes))).toEqual(files[0].bytes);
    expect(h.verify).toHaveBeenCalledOnce();
  });
  it("F3.04 a failing count blocks submission and nothing changes", async () => {
    const { ms } = await fixture();
    await expect(submitEvidence(provider, ms, [goodFiles()[0]], NOTE)).rejects.toBeInstanceOf(SpecFailed);
    expect((await msRow(ms)).state).toBe("OPEN");
  });
  it("P11 F3.04 refuses HTML and type mismatches; only the provider may submit", async () => {
    const { ms } = await fixture();
    await expect(submitEvidence(provider, ms, [{ name: "x.html", type: "text/html", bytes: Buffer.from("<script>alert(1)</script>") }], NOTE)).rejects.toMatchObject({ code: "TYPE_NOT_ALLOWED" });
    await expect(submitEvidence(provider, ms, [{ name: "x.png", type: "image/png", bytes: samplePdf("t", []) }], NOTE)).rejects.toMatchObject({ code: "TYPE_MISMATCH" });
    await expect(submitEvidence(client, ms, goodFiles(), NOTE)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("F3.04 GPS distance: a photo 85 km from the site is blocked; the waiver turns it into a warning", async () => {
    const { ws, ms } = await fixture({ proof: GPS_SPEC });
    await db.insert(workspaceSites).values({ workspaceId: ws, label: "Site A", lat: 12.9716, lng: 77.5946 });
    const far = craftExifJpeg({ lat: 13.73, lng: 77.6, takenAt: new Date().toISOString().slice(0, 19) });
    const err = await submitEvidence(provider, ms, [{ name: "far.jpg", type: "image/jpeg", bytes: far }], "").catch((e) => e);
    expect(err).toBeInstanceOf(SpecFailed);
    expect((err as SpecFailed).signals.find((s) => s.code === "GPS_DISTANCE")?.level).toBe("fail");
    const near = craftExifJpeg({ lat: 12.9720, lng: 77.5950 });
    const ok = await submitEvidence(provider, ms, [{ name: "near.jpg", type: "image/jpeg", bytes: near }], "");
    expect(ok.signals.find((s) => s.code === "GPS_DISTANCE")?.level).toBe("ok");
    const { ws: ws2, ms: ms2 } = await fixture({ proof: GPS_SPEC });
    await db.insert(workspaceSites).values({ workspaceId: ws2, label: "Site B", lat: 12.9716, lng: 77.5946 });
    const waived = await submitEvidence(provider, ms2, [{ name: "far.jpg", type: "image/jpeg", bytes: far }], "Shot at the supplier yard [gps-waiver]");
    expect(waived.signals.find((s) => s.code === "GPS_DISTANCE")?.level).toBe("warn");
  });
  it("A3 stores the verifier's advice when available", async () => {
    h.verify.mockResolvedValue({ available: true, model: "test-model", data: { criteria: [{ criterion: "Every feature has a screen", verdict: "met", confidence: 0.8, cites: ["list.pdf"] }], recommendation: "approve", summary: "Looks complete." } });
    const { ms } = await fixture();
    const r = await submitEvidence(provider, ms, goodFiles(), NOTE);
    const [pkg] = await db.select().from(evidencePackages).where(eq(evidencePackages.id, r.packageId));
    expect(pkg.verifier).toMatchObject({ available: true, data: { recommendation: "approve" } });
    expect((await msRow(ms)).state).toBe("SUBMITTED"); // P3: advice never approves
  });
});

describe("F3.07 approval and release trigger", () => {
  it("F3.07 submit → approve signs over milestoneId+rootHash and calls money.releaseMilestone (P4)", async () => {
    const { ms } = await fixture();
    const r = await submitEvidence(provider, ms, goodFiles(), NOTE);
    await approveMilestone(client, ms, r.rootHash);
    expect((await msRow(ms)).state).toBe("APPROVED");
    expect(h.release).toHaveBeenCalledOnce();
    const [a, id, p] = h.release.mock.calls[0];
    expect(a).toMatchObject({ id: CLIENT }); expect(id).toBe(ms);
    expect(p).toMatchObject({ kind: "MILESTONE", approvalSig: approvalSignature(ms, r.rootHash) });
    expect(verifyApprovalSignature(ms, r.rootHash, p.approvalSig)).toBe(true);
    const [rev] = await db.select().from(evidenceReviews).where(eq(evidenceReviews.milestoneId, ms));
    expect(rev).toMatchObject({ decision: "APPROVE", rootHash: r.rootHash, byUser: CLIENT });
  });
  it("F3.07 root hash mismatch refuses approval", async () => {
    const { ms } = await fixture();
    await submitEvidence(provider, ms, goodFiles(), NOTE);
    await expect(approveMilestone(client, ms, "0".repeat(64))).rejects.toMatchObject({ code: "ROOT_MISMATCH" });
    expect((await msRow(ms)).state).toBe("SUBMITTED");
    expect(h.release).not.toHaveBeenCalled();
  });
  it("F3.07 only the client approves", async () => {
    const { ms } = await fixture();
    const r = await submitEvidence(provider, ms, goodFiles(), NOTE);
    await expect(approveMilestone(provider, ms, r.rootHash)).rejects.toBeInstanceOf(DomainError);
  });
  it("F3.07 money NotBuilt leaves the milestone APPROVED with the release queued; retry reuses the signature", async () => {
    h.release.mockRejectedValue(new NotBuilt("releaseMilestone"));
    const { ms } = await fixture();
    const r = await submitEvidence(provider, ms, goodFiles(), NOTE);
    await expect(approveMilestone(client, ms, r.rootHash)).resolves.toBeUndefined();
    expect((await msRow(ms)).state).toBe("APPROVED");
    h.release.mockResolvedValue({ releaseId: "rel_2", netCents: 1, feeCents: 0 });
    await approveMilestone(client, ms, r.rootHash);
    expect(h.release).toHaveBeenCalledTimes(2);
    expect(h.release.mock.calls[1][2].approvalSig).toBe(h.release.mock.calls[0][2].approvalSig);
  });
  it("F3.07 a GATE approval is still signed and handed to money (zero amount) so dependents unlock", async () => {
    const { ms } = await fixture({ type: "GATE" });
    const r = await submitEvidence(provider, ms, goodFiles(), NOTE);
    await approveMilestone(client, ms, r.rootHash);
    expect((await msRow(ms)).state).toBe("APPROVED");
    expect(h.release).toHaveBeenCalledWith(expect.objectContaining({ id: CLIENT }), ms, expect.objectContaining({ kind: "MILESTONE" }));
  });
  it("F3.03 a LOCKED milestone opens lazily at submit once its tranche is held and earlier steps are settled", async () => {
    const { ws, ms } = await fixture();
    await db.update(wsMilestones).set({ state: "LOCKED" }).where(eq(wsMilestones.id, ms));
    const later = `${ms}_b`;
    await db.insert(wsMilestones).values({ id: later, workspaceId: ws, seq: 2, code: "M03", origin: "BASELINE", type: "PAY", title: "Later", targetDay: 9, bps: 0, amountCents: 0, proof: SPEC, lockRule: "x", disputeRule: "y", state: "LOCKED" });
    made.ms.push(later);
    await expect(submitEvidence(provider, later, goodFiles(), NOTE)).rejects.toMatchObject({ code: "BAD_STATE" });
    await submitEvidence(provider, ms, goodFiles(), NOTE);
    expect((await msRow(ms)).state).toBe("SUBMITTED");
  });
});

describe("F3.09 remediation loop", () => {
  it("F3.09 two fix requests, then the third rejection opens a dispute", async () => {
    const { ms } = await fixture();
    for (let i = 1; i <= 2; i++) {
      const files: { name: string; type: string; bytes: Buffer }[] = [{ name: "screen.png", type: "image/png", bytes: samplePng(16 + i, 12) }, { name: `list${i}.pdf`, type: "application/pdf", bytes: samplePdf(`v${i}`, [String(i)]) }];
      await submitEvidence(provider, ms, files, NOTE);
      await requestFix(client, ms, [`Fix item ${i}`]);
      const m = await msRow(ms);
      expect(m.state).toBe("REMEDIATION"); expect(m.attempts).toBe(i);
      expect(Math.round((m.reviewDueAt!.getTime() - Date.now()) / 3_600_000)).toBe(72);
    }
    await submitEvidence(provider, ms, goodFiles(), NOTE);
    expect((await msRow(ms)).attempts).toBe(3);
    await requestFix(client, ms, ["Still missing the checkout screen"]);
    expect(h.open).toHaveBeenCalledOnce();
    expect(h.open.mock.calls[0][1]).toBe(ms);
    expect((await msRow(ms)).state).toBe("DISPUTED");
    const reviews = await db.select().from(evidenceReviews).where(eq(evidenceReviews.milestoneId, ms));
    expect(reviews.map((r) => r.decision).sort()).toEqual(["REQUEST_FIX", "REQUEST_FIX", "THIRD_REJECTION"]);
  });
  it("F3.09 third rejection still lands in DISPUTED when the disputes module is not built", async () => {
    h.open.mockRejectedValue(new NotBuilt("openDispute"));
    const { ms } = await fixture();
    await db.update(wsMilestones).set({ attempts: 2, state: "REMEDIATION" }).where(eq(wsMilestones.id, ms));
    await submitEvidence(provider, ms, goodFiles(), NOTE);
    await requestFix(client, ms, ["No"]);
    expect((await msRow(ms)).state).toBe("DISPUTED");
  });
});

describe("F3.06 review timers", () => {
  it("F3.06 reminders at 24 h and 36 h, escalation at 72 h, each once, using the virtual clock offset", async () => {
    const { ws, ms } = await fixture({ rule: "ESCALATE" });
    await submitEvidence(provider, ms, goodFiles(), NOTE);
    const now = new Date();
    expect((await runReviewTimers(now, ws)).actions).toEqual([]);
    await setOffset(ws, 24);
    expect((await runReviewTimers(new Date(), ws)).actions.map((a) => a.action)).toEqual(["REMIND_24H"]);
    expect((await runReviewTimers(new Date(), ws)).actions).toEqual([]);
    await setOffset(ws, 36);
    expect((await runReviewTimers(new Date(), ws)).actions.map((a) => a.action)).toEqual(["REMIND_36H"]);
    await setOffset(ws, 72);
    expect((await runReviewTimers(new Date(), ws)).actions.map((a) => a.action)).toEqual(["ESCALATED"]);
    expect((await msRow(ms)).state).toBe("ESCALATED");
    expect((await runReviewTimers(new Date(), ws)).actions).toEqual([]);
    const notes = await db.select().from(evidenceNotifications).where(eq(evidenceNotifications.milestoneId, ms));
    expect(notes.filter((n) => n.kind === "REVIEW_REMINDER")).toHaveLength(2);
    expect(notes.some((n) => n.toRole === "ops" && n.kind === "REVIEW_ESCALATED")).toBe(true);
    // the client can still approve an escalated milestone
    const [pkg] = await db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, ms));
    await approveMilestone(client, ms, pkg.rootHash);
    expect((await msRow(ms)).state).toBe("APPROVED");
  });
  it("F3.06 deemed approval at 72 h signs with the system signature and calls money", async () => {
    const { ws, ms } = await fixture({ rule: "DEEMED_APPROVED" });
    const r = await submitEvidence(provider, ms, goodFiles(), NOTE);
    await setOffset(ws, 73);
    const acts = (await runReviewTimers(new Date(), ws)).actions.map((a) => a.action);
    expect(acts).toEqual(["REMIND_24H", "REMIND_36H", "DEEMED_APPROVED"]);
    expect((await msRow(ms)).state).toBe("APPROVED");
    expect(h.release).toHaveBeenCalledOnce();
    expect(h.release.mock.calls[0][2]).toMatchObject({ kind: "MILESTONE", approvalSig: approvalSignature(ms, r.rootHash) });
    const [rev] = await db.select().from(evidenceReviews).where(eq(evidenceReviews.milestoneId, ms));
    expect(rev).toMatchObject({ decision: "DEEMED_APPROVED", mfa: "system" });
  });
  it("F3.09 the 72 h fix window raises a notice once", async () => {
    const { ws, ms } = await fixture();
    await submitEvidence(provider, ms, goodFiles(), NOTE);
    await requestFix(client, ms, ["Add the checkout screen"]);
    await setOffset(ws, 73);
    expect((await runReviewTimers(new Date(), ws)).actions.map((a) => a.action)).toEqual(["FIX_WINDOW_PASSED"]);
    expect((await runReviewTimers(new Date(), ws)).actions).toEqual([]);
    expect((await msRow(ms)).state).toBe("REMEDIATION");
  });
});

describe("F3.04 demo seed", () => {
  it("F3.04 seeds M01 gate + M02 evidence on a HELD web-MVP contract, then skips (idempotent)", async () => {
    const { ws, ms: m1 } = await fixture({ type: "GATE", proof: { artifacts: [{ kind: "PDF", min: 1 }, { kind: "LINK", min: 1 }], criteria: ["Backlog signed"] } });
    const title = `Booking app MVP ${RUN}`;
    await db.update(workspaces).set({ title }).where(eq(workspaces.id, ws));
    await db.update(wsMilestones).set({ code: "M01", targetDay: 2 }).where(eq(wsMilestones.id, m1));
    const m2 = `${m1}_m2`;
    await db.insert(wsMilestones).values({ id: m2, workspaceId: ws, seq: 2, code: "M02", origin: "BASELINE", type: "PAY", title: "Clickable design approved", targetDay: 6, bps: 1500, amountCents: 15_000, proof: { artifacts: [{ kind: "LINK", min: 1 }, { kind: "PDF", min: 1 }], criteria: ["Every backlog feature has at least one screen"] }, lockRule: "x", disputeRule: "y", state: "LOCKED" });
    made.ms.push(m2);
    h.release.mockImplementation(async (_a: Actor, id: string) => { await db.update(wsMilestones).set({ state: "RELEASED" }).where(eq(wsMilestones.id, id)); return { releaseId: "rel_g", netCents: 0, feeCents: 0 }; });
    const msg = await seedEvidence(title);
    expect(msg).toMatch(/^seeded M01 gate approved; M02 evidence/);
    expect((await msRow(m2)).state).toBe("SUBMITTED");
    expect(await seedEvidence(title)).toBe("skip: M02 already has evidence");
    expect(await seedEvidence(`missing ${RUN}`)).toMatch(/^skip:/);
  });
});
