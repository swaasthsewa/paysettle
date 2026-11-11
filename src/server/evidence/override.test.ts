/**
 * F3.03 out-of-sequence override against the local Postgres, money/AI/disputes mocked: request, client
 * signature (HMAC over milestone + contract hash + skipped prerequisites), opening, payout unchanged, decline, withdraw.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { auditChain, evidencePackages, orgs, tranches, users, workspaces, wsMilestones, type ProofSpec } from "@/db/schema";
import { evidenceNotifications, evidenceReviews, sequenceOverrides } from "@/db/schema-evidence";
import { NotBuilt, type Actor } from "@/server/types";

const h = vi.hoisted(() => ({ release: vi.fn(), verify: vi.fn(), open: vi.fn() }));
vi.mock("@/server/money", () => ({ releaseMilestone: h.release }));
vi.mock("@/server/ai", () => ({ verifyEvidence: h.verify }));
vi.mock("@/server/disputes", () => ({ openDispute: h.open }));

import { prerequisitesSettled, submitEvidence, unsettledPrerequisites } from "./index";
import { declineSequenceOverride, grantSequenceOverride, overrideSignature, requestSequenceOverride, revokeSequenceOverride } from "./override";
import { getMilestoneDetail } from "./view";
import { LocalDiskStore, setObjectStore } from "./storage";
import { samplePdf } from "./samples";

const RUN = Math.random().toString(36).slice(2, 8);
const ORG = `org_t_x1o_${RUN}`, CLIENT = `u_x1oc_${RUN}`, PROVIDER = `u_x1op_${RUN}`, OTHER = `u_x1ox_${RUN}`;
const client: Actor = { id: CLIENT, role: "client" }, provider: Actor = { id: PROVIDER, role: "provider" }, stranger: Actor = { id: OTHER, role: "client" };
const SPEC: ProofSpec = { artifacts: [{ kind: "PDF", min: 1 }], criteria: ["Document delivered"] };
const made = { ws: [] as string[], ms: [] as string[] };
const pdf = () => [{ name: "doc.pdf", type: "application/pdf", bytes: samplePdf(`Doc ${Math.random()}`, ["x"]) }];
let dir = "";

/** M01 (day 2, OPEN) → M02 (day 5, LOCKED). `dag` adds dependsOn; `held` funds tranche 1. */
async function contract(o: { held?: boolean; dag?: boolean } = {}) {
  const ws = `ws_x1o_${RUN}_${made.ws.length}`;
  await db.insert(workspaces).values({ id: ws, orgId: ORG, blueprintCode: "UC_WEB_MVP", title: `Override test ${ws}`, clientId: CLIENT, providerId: PROVIDER, totalCents: 200_000, state: "LOCKED", canonicalHash: "c".repeat(64) });
  made.ws.push(ws);
  await db.insert(tranches).values({ id: `tr_${ws}`, workspaceId: ws, idx: 1, rail: "MOCK", amountCents: 200_000, startDay: 0, endDay: 20, state: o.held === false ? "PLANNED" : "HELD" });
  const m1 = `ms_x1o_${RUN}_${made.ms.length}a`, m2 = `ms_x1o_${RUN}_${made.ms.length}b`;
  await db.insert(wsMilestones).values([
    { id: m1, workspaceId: ws, seq: 1, code: "M01", origin: "BASELINE", type: "PAY", title: "Parts ordered", targetDay: 2, bps: 4000, amountCents: 80_000, proof: SPEC, lockRule: "Client approves.", disputeRule: "Redo.", state: "OPEN" },
    { id: m2, workspaceId: ws, seq: 2, code: "M02", origin: "BASELINE", type: "PAY", title: "Bench test", targetDay: 5, bps: 6000, amountCents: 120_000, proof: SPEC, lockRule: "Client approves.", disputeRule: "Redo.", state: "LOCKED", dependsOn: o.dag ? ["M01"] : [] },
  ]);
  made.ms.push(m1, m2);
  return { ws, m1, m2 };
}
const msRow = async (id: string) => (await db.select().from(wsMilestones).where(eq(wsMilestones.id, id)))[0];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ps-override-"));
  setObjectStore(new LocalDiskStore(dir));
  await db.insert(orgs).values({ id: ORG, name: "Sequence override tests" });
  await db.insert(users).values([
    { id: CLIENT, orgId: ORG, email: `${CLIENT}@test.local`, name: "Override Client", role: "client" },
    { id: PROVIDER, orgId: ORG, email: `${PROVIDER}@test.local`, name: "Override Provider", role: "provider" },
    { id: OTHER, orgId: ORG, email: `${OTHER}@test.local`, name: "Someone Else", role: "client" },
  ]);
});
beforeEach(() => {
  h.release.mockReset().mockResolvedValue({ releaseId: "rel_1", netCents: 1, feeCents: 0 });
  h.verify.mockReset().mockRejectedValue(new NotBuilt("verifyEvidence"));
  h.open.mockReset().mockResolvedValue("dp_1");
});
afterAll(async () => {
  if (made.ms.length) {
    await db.delete(evidenceNotifications).where(inArray(evidenceNotifications.milestoneId, made.ms));
    await db.delete(evidenceReviews).where(inArray(evidenceReviews.milestoneId, made.ms));
    await db.delete(evidencePackages).where(inArray(evidencePackages.milestoneId, made.ms));
    await db.delete(sequenceOverrides).where(inArray(sequenceOverrides.milestoneId, made.ms));
    await db.delete(wsMilestones).where(inArray(wsMilestones.id, made.ms));
  }
  if (made.ws.length) { await db.delete(tranches).where(inArray(tranches.workspaceId, made.ws)); await db.delete(workspaces).where(inArray(workspaces.id, made.ws)); }
  await db.delete(users).where(inArray(users.id, [CLIENT, PROVIDER, OTHER]));
  await db.delete(orgs).where(eq(orgs.id, ORG));
  setObjectStore(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("F3.03 prerequisite rule (pure)", () => {
  const all = [
    { id: "a", code: "M01", state: "OPEN", targetDay: 2, dependsOn: [] as string[] },
    { id: "b", code: "M02", state: "LOCKED", targetDay: 5, dependsOn: [] as string[] },
  ];
  it("F3.03: lists unsettled prerequisites; a signed override counts as settled", () => {
    expect(unsettledPrerequisites(all[1], all)).toEqual(["M01"]);
    expect(prerequisitesSettled(all[1], all)).toBe(false);
    expect(prerequisitesSettled(all[1], all, true)).toBe(true);
    expect(unsettledPrerequisites(all[1], [{ ...all[0], state: "RELEASED" }, all[1]])).toEqual([]);
    const dag = [{ ...all[0] }, { ...all[1], dependsOn: ["M01", "M09"] }];
    expect(unsettledPrerequisites(dag[1], dag)).toEqual(["M01"]); // M09 is not active: treated as done, as in money's unlocker
  });
});

describe("F3.03 out-of-sequence override", () => {
  it("F3.03: request → client signs → milestone opens; payout unchanged; signature binds milestone, hash and skipped steps", async () => {
    const { ws, m2 } = await contract();
    await expect(submitEvidence(provider, m2, pdf(), "")).rejects.toMatchObject({ code: "BAD_STATE" });
    await expect(requestSequenceOverride(provider, m2, "short")).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(requestSequenceOverride(client, m2, "The client cannot ask for this")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const req = await requestSequenceOverride(provider, m2, "Parts arrived early; the bench test can run now.");
    expect(req).toMatchObject({ status: "REQUESTED", skipped: ["M01"] });
    await expect(requestSequenceOverride(provider, m2, "Asking a second time for the same thing")).rejects.toMatchObject({ code: "ALREADY" });

    await expect(grantSequenceOverride(provider, m2, { reason: "", confirm: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(grantSequenceOverride(stranger, m2, { reason: "", confirm: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(grantSequenceOverride(client, m2, { reason: "", confirm: false })).rejects.toMatchObject({ code: "CONFIRM_REQUIRED" });
    const before = await msRow(m2);
    const g = await grantSequenceOverride(client, m2, { reason: "", confirm: true });
    expect(g.opened).toBe(true);
    expect(g.override).toMatchObject({ status: "GRANTED", reason: "Parts arrived early; the bench test can run now.", mfa: "sandbox-skip", canonicalHash: "c".repeat(64) });
    expect(g.override.signature).toBe(overrideSignature(m2, "c".repeat(64), ["M01"], CLIENT));
    const after = await msRow(m2);
    expect(after.state).toBe("OPEN");
    expect(after.amountCents).toBe(before.amountCents);
    expect(after.bps).toBe(before.bps);
    const log = await db.select().from(auditChain).where(and(eq(auditChain.target, m2), inArray(auditChain.action, ["evidence.sequence_override_requested", "evidence.sequence_override_granted", "evidence.milestone_open"])));
    expect(log.map((r) => r.action).sort()).toEqual(["evidence.milestone_open", "evidence.sequence_override_granted", "evidence.sequence_override_requested"]);
    expect(log.find((r) => r.action === "evidence.milestone_open")?.detail).toMatchObject({ outOfSequence: ["M01"] });

    const r = await submitEvidence(provider, m2, pdf(), "");
    expect(r.packageId).toBeTruthy();
    expect((await msRow(m2)).state).toBe("SUBMITTED");
    await expect(revokeSequenceOverride(client, m2)).rejects.toMatchObject({ code: "TOO_LATE" });
    const notes = await db.select().from(evidenceNotifications).where(eq(evidenceNotifications.milestoneId, m2));
    expect(notes.map((n) => n.kind)).toEqual(expect.arrayContaining(["OVERRIDE_REQUESTED", "OVERRIDE_GRANTED"]));
    expect((await getMilestoneDetail({ id: CLIENT, role: "client" }, ws, m2))?.override?.status).toBe("GRANTED");
  });

  it("F3.03: with the tranche not funded yet, the signed override waits; the client can withdraw it until the milestone opens", async () => {
    const { ws, m2 } = await contract({ held: false, dag: true });
    const g = await grantSequenceOverride(client, m2, { reason: "Client agrees to an early start.", confirm: true });
    expect(g.opened).toBe(false);
    expect((await msRow(m2)).state).toBe("LOCKED");
    const d = await getMilestoneDetail({ id: PROVIDER, role: "provider" }, ws, m2);
    expect(d?.prerequisitesSettled).toBe(true);
    expect(d?.pendingPrerequisites).toEqual(["M01"]);
    await expect(grantSequenceOverride(client, m2, { reason: "Signing the same thing twice", confirm: true })).rejects.toMatchObject({ code: "ALREADY" });
    const rv = await revokeSequenceOverride(client, m2);
    expect(rv.status).toBe("REVOKED");
    expect((await getMilestoneDetail({ id: PROVIDER, role: "provider" }, ws, m2))?.prerequisitesSettled).toBe(false);
    await db.update(tranches).set({ state: "HELD" }).where(eq(tranches.workspaceId, ws));
    await expect(submitEvidence(provider, m2, pdf(), "")).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("F3.03: the client can decline a request; nothing opens; a milestone with no pending prerequisite needs no override", async () => {
    const { m1, m2 } = await contract();
    await requestSequenceOverride(provider, m2, "Could we start the bench test early?");
    await expect(declineSequenceOverride(provider, m2)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const d = await declineSequenceOverride(client, m2, "Let us finish M01 first.");
    expect(d.status).toBe("DECLINED");
    expect((await msRow(m2)).state).toBe("LOCKED");
    await expect(grantSequenceOverride(client, m1, { reason: "Not needed here at all", confirm: true })).rejects.toMatchObject({ code: "NOT_NEEDED" });
    // after a decline the provider may ask again
    expect((await requestSequenceOverride(provider, m2, "Parts are on the bench now; asking again.")).status).toBe("REQUESTED");
  });
});
