/**
 * F4.10 representment: a PayPal CUSTOMER.DISPUTE.CREATED webhook blocks releases, supersedes the internal
 * dispute, builds the evidence dossier (signed contract hash, approvals with time, evidence roots and file hashes,
 * timeline) and sends it through rail.provideEvidence with a stored idempotency key (P1, P2). Replays never resend.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { disputes, evidencePackages, revisions, signatures, tranches } from "@/db/schema";
import { representments } from "@/db/schema-representment";
import { canonical, canonicalHash } from "@/lib/canonical";
import { newId, sha256 } from "@/lib/ids";
import { mockControl } from "@/lib/rails/mock";
import { confirmTranche, fundTranche, releaseMilestone } from "@/server/money";
import { makeContract, recordApproval, setMilestoneState } from "@/server/money/fixtures";
import { ingestPaypalWebhook, processWebhookEvent, representmentRail } from "@/server/money/webhook";
import { DomainError } from "../types";
import { buildDossier, dossierNotes } from "./dossier";
import { representmentPdf, retryRepresentment } from "./index";

beforeAll(() => { delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_WEBHOOK_ID; process.env.MONEY_RETRY_MS = "0"; });
beforeEach(() => mockControl.reset());
afterAll(async () => { await pool.end(); });

const OPS = { id: "u_ops", role: "ops" as const };
const hdr = (id: string) => new Headers({ "paypal-transmission-id": id, "content-type": "application/json", "x-paysettle-sim": "1" });
const disputeId = () => `PP-D-${randomBytes(6).toString("hex").toUpperCase()}`;
const ms3 = [{ day: 3, amountCents: 20_000 }, { day: 8, amountCents: 20_000 }, { day: 14, amountCents: 20_000 }];

/** A funded mock contract with a sealed revision, both signatures, and M1 approved (with an evidence file) and released. */
async function released() {
  const f = await makeContract({ milestones: ms3 });
  const doc = { kind: "paysettle.contract", v: 1, id: f.workspaceId, revNo: 1, title: "Representment test", totalCents: 60_000 };
  const hash = canonicalHash(doc);
  await db.insert(revisions).values({ workspaceId: f.workspaceId, revNo: 1, hash, canonical: JSON.parse(canonical(doc)), authorId: f.clientId, change: { action: "CREATE" } });
  for (const [who, role] of [[f.clientId, "client"], [f.providerId, "provider"]] as const) await db.insert(signatures).values({ id: newId("sig"), workspaceId: f.workspaceId, revNo: 1, hash, signerId: who, role, signature: sha256(`${who}:${hash}`), mfa: true });
  const { approveUrl } = await fundTranche({ id: f.clientId, role: "client" }, f.trancheId);
  await confirmTranche(null, f.trancheId, new URL(approveUrl).searchParams.get("token")!);
  await db.insert(evidencePackages).values({ id: newId("ev"), milestoneId: f.milestoneIds[0], attempt: 1, rootHash: sha256("root-m1"), files: [{ name: "handover <script>.pdf", kind: "PDF", size: 2048, sha256: sha256("file-1") }], state: "APPROVED", submittedBy: f.providerId });
  await setMilestoneState(f.milestoneIds[0], "APPROVED");
  const sig = await recordApproval(f.milestoneIds[0], { by: f.clientId });
  await releaseMilestone({ id: f.clientId, role: "client" }, f.milestoneIds[0], { kind: "MILESTONE", approvalSig: sig });
  const [t] = await db.select().from(tranches).where(eq(tranches.id, f.trancheId));
  return { ...f, hash, tranche: t };
}
const event = (id: string, authId: string | null) => JSON.stringify({ id: `WH-${id}`, event_type: "CUSTOMER.DISPUTE.CREATED", create_time: new Date().toISOString(), resource: { dispute_id: id, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", status: "WAITING_FOR_SELLER_RESPONSE", disputed_transactions: [{ seller_transaction_id: authId }] } });
const rowFor = async (id: string) => (await db.select().from(representments).where(eq(representments.disputeId, id)))[0];

describe("F4.10 representment", () => {
  it("F4.10 P2 the dispute webhook sends the dossier once through the rail; a replay does not resend", async () => {
    const f = await released();
    const did = disputeId(), tid = newId("wh");
    const r = await ingestPaypalWebhook(event(did, f.tranche.authorizationId), hdr(tid));
    expect(r.state).toBe("PROCESSED");
    const row = await rowFor(did);
    expect(row).toMatchObject({ status: "SUBMITTED", attempts: 1, workspaceId: f.workspaceId, rail: "MOCK", transmissionId: tid, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" });
    expect(row.railRef).toMatch(/^MOCKEVID-/);
    const sent = mockControl.evidence();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ disputeId: did, idemKey: row.idemKey, hash: row.dossierHash, evidenceType: "OTHER" });
    expect(sent[0].documents[0].sha256).toBe(row.documents[0].sha256);
    expect(row.documents[0]).toMatchObject({ contentType: "application/pdf" });
    expect(row.documents[0].bytes).toBeGreaterThan(1000);
    /* replay of the same event: idempotent, nothing new sent */
    expect(await processWebhookEvent(tid)).toBe("PROCESSED");
    expect(mockControl.evidence()).toHaveLength(1);
    expect((await rowFor(did)).attempts).toBe(1);
    /* P1: evidence is not a money movement — no new PayPal transaction beyond the hold and the M1 capture */
    expect(mockControl.txns().map((x) => x.type).sort()).toEqual(["AUTHORIZATION", "CAPTURE"]);
  });

  it("F4.10 the dossier carries the signed hash, signatures, approvals with time, evidence roots and file hashes, and a timeline", async () => {
    const f = await released();
    const did = disputeId();
    const b = await buildDossier({ disputeId: did, reason: "ITEM_NOT_AS_DESCRIBED", trancheIds: [f.trancheId] });
    const d = b.dossier;
    expect(b.hash).toBe(canonicalHash(d));
    expect(d.contract).toMatchObject({ id: f.workspaceId, revNo: 1, canonicalHash: f.hash, hashVerified: true });
    expect(d.signatures.map((s) => s.role).sort()).toEqual(["client", "provider"]);
    const m1 = d.milestones.find((m) => m.code === "M01")!;
    expect(m1.evidence[0]).toMatchObject({ attempt: 1, rootHash: sha256("root-m1") });
    expect(m1.evidence[0].files[0]).toMatchObject({ sha256: sha256("file-1"), size: 2048 });
    expect(m1.approvals[0]).toMatchObject({ decision: "APPROVE" });
    expect(m1.approvals[0].signatureFingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(m1.releases[0]).toMatchObject({ grossCents: 20_000, status: "COMPLETED" });
    expect(d.milestones.find((m) => m.code === "M02")!.approvals).toEqual([]);
    expect(d.timeline.some((t) => t.action === "money.hold_confirmed" || t.action.startsWith("money."))).toBe(true);
    expect(d.timeline.every((t) => !("detail" in t))).toBe(true);
    const notes = dossierNotes(d);
    expect(notes.length).toBeLessThanOrEqual(2000);
    expect(notes).toContain("M01");
    expect(notes).toContain(f.hash.slice(0, 16));
  });

  it("F4.10 PayPal not taking evidence yet → NOT_ELIGIBLE; Ops retries later with the same key; parties cannot retry", async () => {
    const f = await released();
    const did = disputeId();
    mockControl.closeForEvidence(did);
    await ingestPaypalWebhook(event(did, f.tranche.authorizationId), hdr(newId("wh")));
    const first = await rowFor(did);
    expect(first.status).toBe("NOT_ELIGIBLE");
    expect(mockControl.evidence()).toHaveLength(0);
    await expect(retryRepresentment({ id: f.clientId, role: "client" }, first.id, representmentRail)).rejects.toBeInstanceOf(DomainError);
    mockControl.closeForEvidence(did, false);
    const second = await retryRepresentment(OPS, first.id, representmentRail);
    expect(second).toMatchObject({ status: "SUBMITTED", attempts: 2, idemKey: first.idemKey, dossierHash: first.dossierHash });
    await expect(retryRepresentment(OPS, first.id, representmentRail)).rejects.toThrow(/already sent/);
  });

  it("F4.10 a transient PayPal error is stored as FAILED with the reason while releases stay blocked; retry sends it", async () => {
    const f = await released();
    const did = disputeId();
    mockControl.inject("evidence_503");
    const r = await ingestPaypalWebhook(event(did, f.tranche.authorizationId), hdr(newId("wh")));
    expect(r.state).toBe("PROCESSED");
    const row = await rowFor(did);
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toMatch(/TRANSIENT/);
    expect((await db.select().from(tranches).where(eq(tranches.id, f.trancheId)))[0].warned).toContain("EXTERNAL_DISPUTE");
    expect((await retryRepresentment(OPS, row.id, representmentRail)).status).toBe("SUBMITTED");
  });

  it("F4.10 an open PaySettle dispute on that tranche gives way to PayPal's", async () => {
    const f = await released();
    const soon = new Date(Date.now() + 86_400_000);
    const internal = newId("dsp");
    await db.insert(disputes).values({ id: internal, milestoneId: f.milestoneIds[1], openedBy: f.clientId, reason: "QUALITY", narrative: "test", amountCents: 20_000, state: "TIER1", tier1Until: soon, vaultUntil: soon });
    const did = disputeId();
    await ingestPaypalWebhook(event(did, f.tranche.authorizationId), hdr(newId("wh")));
    expect((await db.select().from(disputes).where(eq(disputes.id, internal)))[0].state).toBe("SUPERSEDED");
  });

  it("F4.10 P5 a stored dossier that no longer matches its hash is refused, not sent", async () => {
    const f = await released();
    const did = disputeId();
    mockControl.closeForEvidence(did);
    await ingestPaypalWebhook(event(did, f.tranche.authorizationId), hdr(newId("wh")));
    const row = await rowFor(did);
    await db.update(representments).set({ dossier: { ...(row.dossier as Record<string, unknown>), reason: "EDITED" } }).where(eq(representments.id, row.id));
    mockControl.closeForEvidence(did, false);
    const after = await retryRepresentment(OPS, row.id, representmentRail);
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toMatch(/does not match its hash/);
    expect(mockControl.evidence()).toHaveLength(0);
  });

  it("F4.10 the dossier PDF is readable by Ops and finance only", async () => {
    const f = await released();
    const did = disputeId();
    await ingestPaypalWebhook(event(did, f.tranche.authorizationId), hdr(newId("wh")));
    const row = await rowFor(did);
    const { bytes } = await representmentPdf("finance", row.id);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    await expect(representmentPdf("client", row.id)).rejects.toBeInstanceOf(DomainError);
    await expect(representmentPdf("provider", row.id)).rejects.toBeInstanceOf(DomainError);
  });
});
