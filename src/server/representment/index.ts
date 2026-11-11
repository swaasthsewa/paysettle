/**
 * F4.10 representment: when PayPal reports CUSTOMER.DISPUTE.CREATED on a payment PaySettle tracks, the
 * webhook blocks releases on the tranche, supersedes the internal dispute, and then calls representDispute: PaySettle
 * builds the evidence dossier, stores it with an idempotency key (P2, stored before the call) and sends it to PayPal
 * through the rail that holds the money (P1, rail.provideEvidence). Status lives in `representments`:
 *   PENDING → SUBMITTED | NOT_ELIGIBLE (PayPal not waiting for seller evidence yet) | FAILED (error kept; Ops retries).
 * Never moves money. AI is not involved (P3). Retries resend the stored dossier, so the key and hash stay the same.
 */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { tranches, workspaces } from "@/db/schema";
import { representments, type RepresentmentStatus } from "@/db/schema-representment";
import { audit } from "@/lib/audit";
import { canonical } from "@/lib/canonical";
import { sandboxMode } from "@/lib/clock";
import { idemKey, newId, sha256 } from "@/lib/ids";
import { RailError, type EvidenceDossier, type Rail } from "@/lib/rails";
import { dossierPdf } from "@/lib/pdf/dossier";
import { DomainError, type Actor } from "../types";
import { auditActor, mustWrite, realWorkspace, type Dbx } from "../control/common";
import { buildDossier, dossierNotes, type Dossier } from "./dossier";

export type RepresentmentRow = typeof representments.$inferSelect;
/** Picks the rail that holds a tranche's money (supplied by the money module's webhook module, which owns rail selection). */
export type RailResolver = (trancheId: string) => Promise<Rail>;

const SYSTEM = { id: null, role: "system" } as const;
export const representmentKey = (disputeId: string, dossierHash: string) => idemKey("representment", disputeId, dossierHash);

/** Renders the dossier PDF and wraps it for the rail. */
export async function dossierDocuments(d: Dossier, hash: string): Promise<EvidenceDossier["documents"]> {
  const json = canonical(d);
  const bytes = await dossierPdf(d, hash, json);
  return [{ name: `paysettle-dossier-${d.disputeId}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_"), contentType: "application/pdf", bytes: new Uint8Array(bytes), sha256: sha256(bytes) }];
}

/**
 * Creates (once per PayPal dispute) and sends the representment. Safe to call again — webhook replay and Ops retry
 * both land here: a SUBMITTED row is left alone; any other row is resent with its stored dossier and key.
 */
export async function representDispute(p: { disputeId: string; reason?: string | null; transmissionId?: string | null; trancheIds: string[] }, railOf: RailResolver, dbx: Dbx = db): Promise<RepresentmentRow> {
  const [existing] = await dbx.select().from(representments).where(eq(representments.disputeId, p.disputeId)).limit(1);
  let row = existing;
  if (!row) {
    const b = await buildDossier({ disputeId: p.disputeId, reason: p.reason, trancheIds: p.trancheIds }, dbx);
    const [w] = await dbx.select({ rail: workspaces.rail }).from(workspaces).where(eq(workspaces.id, b.workspaceId)).limit(1);
    const key = representmentKey(p.disputeId, b.hash);
    await dbx.insert(representments).values({
      id: newId("rep"), disputeId: p.disputeId, transmissionId: p.transmissionId ?? null, workspaceId: b.workspaceId, trancheIds: p.trancheIds, reason: p.reason ?? null,
      rail: w?.rail ?? "MOCK", status: "PENDING", idemKey: key, dossierHash: b.hash, dossier: { ...b.dossier, merchantId: b.merchantId ?? null } as unknown as Record<string, unknown>,
    }).onConflictDoNothing();
    [row] = await dbx.select().from(representments).where(eq(representments.disputeId, p.disputeId)).limit(1);
    await audit(dbx, SYSTEM, "representment.created", row.id, { disputeId: p.disputeId, workspaceId: row.workspaceId, dossierHash: row.dossierHash, idemKey: row.idemKey });
  }
  if (row.status === "SUBMITTED") return row;
  return send(row, railOf, dbx);
}

async function send(row: RepresentmentRow, railOf: RailResolver, dbx: Dbx): Promise<RepresentmentRow> {
  const stored = row.dossier as unknown as Dossier & { merchantId?: string | null };
  const { merchantId, ...dossier } = stored;
  const hash = row.dossierHash ?? "";
  let status: RepresentmentStatus, note: string | null = null, railRef: string | null = null, lastError: string | null = null, docs: RepresentmentRow["documents"] = row.documents;
  try {
    if (canonicalHashOf(dossier) !== hash) throw new DomainError("TAMPERED", "The stored dossier does not match its hash; it was not sent.");
    const documents = await dossierDocuments(dossier, hash);
    docs = documents.map((d) => ({ name: d.name, contentType: d.contentType, bytes: d.bytes.byteLength, sha256: d.sha256 }));
    const rail = await railOf(row.trancheIds[0]);
    const r = await rail.provideEvidence(row.disputeId, { hash, evidenceType: "OTHER", notes: dossierNotes(dossier), documents, merchantId: merchantId ?? undefined }, row.idemKey);
    status = r.status; railRef = r.id || null; note = r.note ?? (r.status === "SUBMITTED" ? "Dossier sent to PayPal." : null);
  } catch (e) {
    status = "FAILED";
    lastError = (e instanceof RailError ? `${e.kind}: ${e.message}` : e instanceof Error ? e.message : String(e)).slice(0, 500);
  }
  const now = new Date();
  const [out] = await dbx.update(representments).set({
    status, note, railRef, lastError, documents: docs, attempts: sql`${representments.attempts} + 1`, updatedAt: now, submittedAt: status === "SUBMITTED" ? now : row.submittedAt,
  }).where(eq(representments.id, row.id)).returning();
  await audit(dbx, SYSTEM, status === "SUBMITTED" ? "representment.submitted" : status === "NOT_ELIGIBLE" ? "representment.not_eligible" : "representment.failed", row.id,
    { disputeId: row.disputeId, idemKey: row.idemKey, railRef, attempt: out.attempts, error: lastError, documents: docs.map((d) => d.sha256.slice(0, 16)) });
  return out;
}
const canonicalHashOf = (d: unknown) => sha256(canonical(d));

/** Ops/admin: send again (FAILED or NOT_ELIGIBLE only). Same stored dossier, same key. */
export async function retryRepresentment(a: Actor, id: string, railOf: RailResolver, dbx: Dbx = db): Promise<RepresentmentRow> {
  mustWrite(a, "webhook.replay");
  const [row] = await dbx.select().from(representments).where(eq(representments.id, id)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "That representment does not exist.");
  if (row.status === "SUBMITTED") throw new DomainError("STATE", "This dossier was already sent to PayPal.");
  await audit(dbx, auditActor(a), "representment.retry", row.id, { disputeId: row.disputeId, status: row.status, attempts: row.attempts });
  return send(row, railOf, dbx);
}

/** Ops, admin and finance read dossiers; judges only in sandbox (P9). */
export const canReadRepresentments = (role: string) => role === "ops" || role === "admin" || role === "finance" || (role === "judge" && sandboxMode());

/** List for the ops screen, newest first, with the contract title. Playground and test contracts only when asked (console rule). */
export async function listRepresentments(o: { status?: RepresentmentStatus[]; limit?: number; includeSim?: boolean } = {}, dbx: Dbx = db) {
  const where: SQL[] = [];
  if (o.status?.length) where.push(inArray(representments.status, o.status));
  if (!o.includeSim) where.push(realWorkspace(workspaces.id, workspaces.orgId));
  const rows = await dbx.select({ r: representments, title: workspaces.title }).from(representments).innerJoin(workspaces, eq(workspaces.id, representments.workspaceId))
    .where(where.length ? and(...where) : undefined).orderBy(desc(representments.createdAt)).limit(o.limit ?? 100);
  const trs = rows.length ? await dbx.select({ id: tranches.id, idx: tranches.idx, amountCents: tranches.amountCents, state: tranches.state }).from(tranches).where(inArray(tranches.id, [...new Set(rows.flatMap((x) => x.r.trancheIds))])) : [];
  return rows.map(({ r, title }) => ({ ...r, title: title ?? r.workspaceId, tranches: trs.filter((t) => r.trancheIds.includes(t.id)) }));
}

/** The dossier PDF as stored (Ops, admin, finance; judges in sandbox for playground data). */
export async function representmentPdf(role: string, id: string, dbx: Dbx = db): Promise<{ bytes: Buffer; row: RepresentmentRow }> {
  if (!canReadRepresentments(role)) throw new DomainError("FORBIDDEN", "Only Operations, finance and admins can open PayPal dispute dossiers.");
  const [row] = await dbx.select().from(representments).where(eq(representments.id, id)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "That representment does not exist.");
  const { merchantId: _m, ...dossier } = row.dossier as unknown as Dossier & { merchantId?: string | null };
  void _m;
  return { bytes: await dossierPdf(dossier, row.dossierHash ?? "", canonical(dossier)), row };
}

export async function representmentCounts(dbx: Dbx = db, o: { includeSim?: boolean } = {}) {
  const r = await dbx.select({ status: representments.status, n: sql<number>`count(*)::int` }).from(representments).innerJoin(workspaces, eq(workspaces.id, representments.workspaceId))
    .where(o.includeSim ? undefined : realWorkspace(workspaces.id, workspaces.orgId)).groupBy(representments.status);
  const by = (s: RepresentmentStatus) => r.find((x) => x.status === s)?.n ?? 0;
  return { submitted: by("SUBMITTED"), pending: by("PENDING"), notEligible: by("NOT_ELIGIBLE"), failed: by("FAILED"), total: r.reduce((a, x) => a + x.n, 0) };
}
