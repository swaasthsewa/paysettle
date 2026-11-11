/**
 * F4.10 representment dossier: what PaySettle can show PayPal about a disputed payment — the signed contract (revision
 * and canonical hash, both signatures with time), every client approval with time and the evidence root it approved,
 * the evidence packages with their file hashes, the releases, and a timeline from the audit chain.
 * Only facts PaySettle recorded; file contents are not sent (names, sizes and SHA-256 only), and uploaded names are
 * treated as untrusted text (P11). The dossier is canonical JSON; its SHA-256 is stored with the representment.
 */
import { and, asc, desc, eq, inArray, isNull, like, lte, or } from "drizzle-orm";
import { db } from "@/db/client";
import { auditChain, evidencePackages, paypalLinks, releases, revisions, signatures, tranches, users, workspaces, wsMilestones } from "@/db/schema";
import { evidenceReviews } from "@/db/schema-evidence";
import { canonicalHash } from "@/lib/canonical";
import { sha256 } from "@/lib/ids";
import { formatCents } from "@/lib/money";
import { DomainError } from "../types";
import type { Dbx } from "../control/common";

export interface DossierFile { name: string; kind: string; size: number; sha256: string }
export interface Dossier {
  kind: "paysettle.representment"; v: 1;
  disputeId: string; reason: string | null; asOf: string;
  contract: { id: string; title: string; blueprint: string; currency: string; totalCents: number; feeBps: number; rail: string; revNo: number | null; canonicalHash: string | null; hashVerified: boolean };
  parties: { client: string; provider: string | null };
  signatures: { role: string; signer: string; revNo: number; hash: string; mfa: boolean; at: string }[];
  tranches: { id: string; idx: number; amountCents: number; state: string; heldAt: string | null; orderId: string | null; authorizationId: string | null; captureId: string | null }[];
  milestones: {
    code: string; title: string; type: string; amountCents: number; state: string; targetDay: number;
    evidence: { attempt: number; rootHash: string; submittedAt: string; files: DossierFile[] }[];
    approvals: { decision: string; at: string; rootHash: string; by: string; mfa: string | null; signatureFingerprint: string | null }[];
    releases: { kind: string; grossCents: number; feeCents: number; netCents: number; status: string; at: string; paypalRef: string | null; approvalFingerprint: string }[];
  }[];
  timeline: { at: string; action: string; target: string; role: string | null }[];
}

const clean = (s: unknown, max = 120) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
const fp = (s: string | null | undefined) => (s ? sha256(s).slice(0, 32) : null);
/** Audit actions worth showing PayPal: what was agreed, delivered, approved and paid. Detail fields are not copied. */
const TIMELINE_PREFIXES = ["contract.", "money.", "evidence.", "release.", "milestone.", "dispute.", "tranche.", "oracle."];
const TIMELINE_LIMIT = 300;

export async function buildDossier(p: { disputeId: string; reason?: string | null; trancheIds: string[]; asOf?: Date }, dbx: Dbx = db): Promise<{ dossier: Dossier; hash: string; workspaceId: string; merchantId?: string }> {
  if (!p.trancheIds.length) throw new DomainError("NOT_FOUND", "No tranche matches the disputed payment.");
  const asOf = p.asOf ?? new Date();
  const trs = await dbx.select().from(tranches).where(inArray(tranches.id, p.trancheIds)).orderBy(asc(tranches.idx));
  if (!trs.length) throw new DomainError("NOT_FOUND", "No tranche matches the disputed payment.");
  const workspaceId = trs[0].workspaceId;
  const [w] = await dbx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!w) throw new DomainError("NOT_FOUND", "The contract behind this payment does not exist.");
  const idxs = trs.filter((t) => t.workspaceId === workspaceId).map((t) => t.idx);

  const [rev] = await dbx.select().from(revisions).where(and(eq(revisions.workspaceId, w.id), eq(revisions.revNo, w.revision))).limit(1);
  const sigs = await dbx.select().from(signatures).where(and(eq(signatures.workspaceId, w.id), isNull(signatures.voidedAtRev))).orderBy(asc(signatures.createdAt));
  const ms = await dbx.select().from(wsMilestones).where(and(eq(wsMilestones.workspaceId, w.id), eq(wsMilestones.active, true), inArray(wsMilestones.trancheIdx, idxs))).orderBy(asc(wsMilestones.targetDay), asc(wsMilestones.seq));
  const msIds = ms.map((m) => m.id);
  const [pkgs, revs, rels] = msIds.length
    ? await Promise.all([
      dbx.select().from(evidencePackages).where(and(inArray(evidencePackages.milestoneId, msIds), lte(evidencePackages.createdAt, asOf))).orderBy(asc(evidencePackages.attempt)),
      dbx.select().from(evidenceReviews).where(and(inArray(evidenceReviews.milestoneId, msIds), lte(evidenceReviews.createdAt, asOf))).orderBy(asc(evidenceReviews.createdAt)),
      dbx.select().from(releases).where(and(inArray(releases.milestoneId, msIds), lte(releases.createdAt, asOf))).orderBy(asc(releases.createdAt)),
    ])
    : [[], [], []];
  const peopleIds = [...new Set([w.clientId, w.providerId, ...sigs.map((s) => s.signerId), ...revs.map((r) => r.byUser)].filter((x): x is string => Boolean(x)))];
  const people = peopleIds.length ? await dbx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.id, peopleIds)) : [];
  const who = (id: string | null) => (id ? people.find((u) => u.id === id) : undefined);

  const targets = [w.id, ...msIds, ...trs.map((t) => t.id), ...pkgs.map((x) => x.id)];
  const audit = await dbx.select({ at: auditChain.at, action: auditChain.action, target: auditChain.target, role: auditChain.actorRole }).from(auditChain)
    .where(and(inArray(auditChain.target, targets), lte(auditChain.at, asOf), or(...TIMELINE_PREFIXES.map((x) => like(auditChain.action, `${x}%`)))))
    .orderBy(desc(auditChain.seq)).limit(TIMELINE_LIMIT + 50);
  const timeline = audit.filter((a) => TIMELINE_PREFIXES.some((x) => a.action.startsWith(x)) && !a.action.startsWith("contract.pdf")).slice(0, TIMELINE_LIMIT).reverse()
    .map((a) => ({ at: a.at.toISOString(), action: a.action, target: a.target, role: a.role }));

  let merchantId: string | undefined;
  if (w.providerId && (w.rail === "A1" || w.rail === "B")) {
    const [link] = await dbx.select({ merchantId: paypalLinks.merchantId }).from(paypalLinks).where(and(eq(paypalLinks.userId, w.providerId), eq(paypalLinks.kind, "merchant"))).limit(1);
    merchantId = link?.merchantId ?? undefined;
  }

  const dossier: Dossier = {
    kind: "paysettle.representment", v: 1, disputeId: clean(p.disputeId, 255), reason: p.reason ? clean(p.reason, 80) : null, asOf: asOf.toISOString(),
    contract: { id: w.id, title: clean(w.title, 200), blueprint: w.blueprintCode, currency: w.currency, totalCents: w.totalCents, feeBps: w.feeBps, rail: w.rail, revNo: rev?.revNo ?? null, canonicalHash: rev?.hash ?? null, hashVerified: rev ? canonicalHash(rev.canonical) === rev.hash : false },
    parties: { client: clean(who(w.clientId)?.name ?? w.clientId), provider: w.providerId ? clean(who(w.providerId)?.name ?? w.providerId) : null },
    signatures: sigs.map((s) => ({ role: s.role, signer: clean(who(s.signerId)?.name ?? s.signerId), revNo: s.revNo, hash: s.hash, mfa: s.mfa, at: s.createdAt.toISOString() })),
    tranches: trs.map((t) => ({ id: t.id, idx: t.idx, amountCents: t.amountCents, state: t.state, heldAt: t.heldAt?.toISOString() ?? null, orderId: t.paypalOrderId, authorizationId: t.authorizationId, captureId: t.captureId })),
    milestones: ms.map((m) => ({
      code: m.code, title: clean(m.title, 200), type: m.type, amountCents: m.amountCents, state: m.state, targetDay: m.targetDay,
      evidence: pkgs.filter((x) => x.milestoneId === m.id).map((x) => ({ attempt: x.attempt, rootHash: x.rootHash, submittedAt: x.createdAt.toISOString(), files: x.files.slice(0, 50).map((f) => ({ name: clean(f.name), kind: clean(f.kind, 20), size: Number(f.size) || 0, sha256: clean(f.sha256, 64) })) })),
      approvals: revs.filter((r) => r.milestoneId === m.id && (r.decision === "APPROVE" || r.decision === "DEEMED_APPROVED"))
        .map((r) => ({ decision: r.decision, at: r.createdAt.toISOString(), rootHash: r.rootHash, by: r.byUser ? `${clean(who(r.byUser)?.name ?? r.byUser)} (${who(r.byUser)?.role ?? "user"})` : "PaySettle timer rule", mfa: r.mfa ?? null, signatureFingerprint: fp(r.signature) })),
      releases: rels.filter((r) => r.milestoneId === m.id).map((r) => ({ kind: r.kind, grossCents: r.grossCents, feeCents: r.feeCents, netCents: r.netCents, status: r.status, at: (r.completedAt ?? r.createdAt).toISOString(), paypalRef: r.paypalRef, approvalFingerprint: fp(r.approvalSig) ?? "" })),
    })),
    timeline,
  };
  return { dossier, hash: canonicalHash(dossier), workspaceId, merchantId };
}

/** Plain-text summary for PayPal's notes field (≤ 2,000 characters). */
export function dossierNotes(d: Dossier, max = 2000): string {
  const m = (c: number) => formatCents(c, d.contract.currency);
  const signed = d.signatures.filter((s) => s.revNo === d.contract.revNo);
  const lines = [
    `PaySettle milestone contract ${d.contract.id} "${d.contract.title}", total ${m(d.contract.totalCents)}.`,
    d.contract.canonicalHash ? `Signed by ${signed.map((s) => `${s.role} ${s.signer} on ${s.at.slice(0, 10)}`).join(" and ") || "the parties"} (revision ${d.contract.revNo}, SHA-256 ${d.contract.canonicalHash.slice(0, 16)}...).` : "Contract not sealed.",
    `Money moved only after the client's signed approval of each milestone's evidence.`,
    ...d.milestones.flatMap((x) => {
      const ap = x.approvals[0], rel = x.releases.find((r) => r.status === "COMPLETED");
      if (!ap && !rel) return [];
      return [`${x.code} ${x.title}: ${ap ? `approved ${ap.at.slice(0, 16).replace("T", " ")} UTC (${ap.decision === "DEEMED_APPROVED" ? "deemed approved under the signed review rule" : "client signature"}, evidence root ${ap.rootHash.slice(0, 12)}...)` : "not approved"}${rel ? `; released ${m(rel.grossCents)} on ${rel.at.slice(0, 10)}` : ""}.`];
    }),
    "The attached PDF lists the signatures, approvals, evidence file hashes and the timeline.",
  ];
  const out = lines.join("\n");
  return out.length <= max ? out : out.slice(0, max - 3) + "...";
}
