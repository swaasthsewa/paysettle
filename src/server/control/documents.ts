/**
 * F2.10 contract PDF read model and access rule. Who may download a contract PDF: the two parties, Operations
 * and admins (back office), a mediator assigned to (or co-signing) a dispute on one of its milestones, and — sandbox
 * only (P9) — a judge for a playground workspace. Every download is audited by the route.
 */
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { blueprints, disputes, revisions, signatures, tranches, users, workspaces, wsClauses, wsMilestones } from "@/db/schema";
import { canonical, canonicalHash } from "@/lib/canonical";
import { sandboxMode } from "@/lib/clock";
import { isSimWorkspaceSql } from "@/lib/sim";
import type { ContractPdfData } from "@/lib/pdf/contract";
import { DomainError, type Actor } from "../types";
import type { Dbx } from "./common";

export type PdfAccess = "party" | "back-office" | "mediator" | "judge";

/** Throws NOT_FOUND / FORBIDDEN; returns why the viewer may read the contract. */
export async function contractPdfAccess(a: Actor, workspaceId: string, dbx: Dbx = db): Promise<PdfAccess> {
  const [w] = await dbx.select({ id: workspaces.id, clientId: workspaces.clientId, providerId: workspaces.providerId }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!w) throw new DomainError("NOT_FOUND", "This contract does not exist.");
  if ((a.role === "client" && a.id === w.clientId) || (a.role === "provider" && a.id === w.providerId)) return "party";
  if (a.role === "ops" || a.role === "admin") return "back-office";
  if (a.role === "mediator") {
    const [d] = await dbx.select({ id: disputes.id }).from(disputes).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId))
      .where(and(eq(wsMilestones.workspaceId, workspaceId), or(eq(disputes.mediatorId, a.id), eq(disputes.cosignerId, a.id)))).limit(1);
    if (d) return "mediator";
    throw new DomainError("FORBIDDEN", "Mediators can open a contract only while a dispute on it is assigned to them.");
  }
  if (a.role === "judge" && sandboxMode()) {
    const r = await dbx.execute(sql`select ${isSimWorkspaceSql(sql`${workspaceId}`)} as sim`);
    if ((r.rows[0] as { sim?: boolean } | undefined)?.sim) return "judge";
  }
  throw new DomainError("FORBIDDEN", "Only the parties, Operations and the assigned mediator can download this contract.");
}

const KNOWN_KEYS = new Set(["kind", "v", "id", "revNo", "title", "blueprint", "currency", "totalCents", "feeBps", "rail", "clientId", "providerId", "inviteEmail", "reviewTimeoutRule", "milestones", "clauses"]);
interface CanonMs { code: string; seq?: number; origin?: string; active?: boolean; type?: "GATE" | "PAY"; title?: string; day?: number; bps?: number; amountCents?: number; proof?: { artifacts?: { kind: string; min: number; note?: string }[]; criteria?: string[]; oracle?: string }; lockRule?: string; disputeRule?: string; tranche?: number }
interface CanonCl { code: string; category?: "SYSTEM" | "BASELINE" | "CUSTOM"; title?: string; body?: string; active?: boolean }

const artifactsText = (p?: CanonMs["proof"]) => [
  ...(p?.artifacts ?? []).filter((x) => x.min > 0).map((x) => `${x.min} ${x.kind.toLowerCase()}${x.min > 1 ? "s" : ""}${x.note ? ` (${x.note})` : ""}`),
  ...(p?.oracle ? [`oracle ${p.oracle}`] : []),
].join(", ");

/**
 * Builds the PDF data from the sealed revision the signatures bind to (the canonical JSON in `revisions`), so the PDF
 * shows exactly what was signed. Without a revision (very early drafts) it falls back to the live tables.
 */
export async function contractPdfData(a: Actor & { name?: string }, workspaceId: string, dbx: Dbx = db, now = new Date()): Promise<ContractPdfData> {
  const [w] = await dbx.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!w) throw new DomainError("NOT_FOUND", "This contract does not exist.");
  const [rev] = await dbx.select().from(revisions).where(and(eq(revisions.workspaceId, w.id), eq(revisions.revNo, w.revision))).limit(1);
  const ids = [w.clientId, w.providerId].filter((x): x is string => Boolean(x));
  const sigs = await dbx.select().from(signatures).where(eq(signatures.workspaceId, w.id)).orderBy(asc(signatures.createdAt));
  const people = await dbx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...new Set([...ids, ...sigs.map((s) => s.signerId)])]));
  const name = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? id : "");
  const [bp] = await dbx.select({ title: blueprints.title }).from(blueprints).where(eq(blueprints.code, w.blueprintCode)).limit(1);
  const trs = await dbx.select({ idx: tranches.idx, amountCents: tranches.amountCents, startDay: tranches.startDay, endDay: tranches.endDay, state: tranches.state }).from(tranches).where(eq(tranches.workspaceId, w.id)).orderBy(asc(tranches.idx));

  let milestones: ContractPdfData["milestones"], clauses: ContractPdfData["clauses"], extraTerms: Record<string, unknown> = {};
  const canon = rev?.canonical as (Record<string, unknown> & { milestones?: CanonMs[]; clauses?: CanonCl[] }) | undefined;
  if (canon && Array.isArray(canon.milestones) && Array.isArray(canon.clauses)) {
    milestones = canon.milestones.map((m) => ({
      code: m.code, title: m.title ?? m.code, type: m.type ?? "PAY", day: m.day ?? 0, bps: m.bps ?? 0, amountCents: m.amountCents ?? 0, origin: m.origin ?? "BASELINE", active: m.active !== false,
      tranche: m.tranche ?? 1, criteria: m.proof?.criteria ?? [], artifacts: artifactsText(m.proof), lockRule: m.lockRule ?? "", disputeRule: m.disputeRule ?? "",
    }));
    clauses = canon.clauses.map((c) => ({ category: c.category ?? "CUSTOM", code: c.code, title: c.title ?? c.code, body: c.body ?? "", active: c.active !== false }));
    extraTerms = Object.fromEntries(Object.entries(canon).filter(([k]) => !KNOWN_KEYS.has(k)));
  } else {
    const ms = await dbx.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, w.id)).orderBy(asc(wsMilestones.seq));
    const cl = await dbx.select().from(wsClauses).where(eq(wsClauses.workspaceId, w.id)).orderBy(asc(wsClauses.code));
    milestones = ms.map((m) => ({ code: m.code, title: m.title, type: m.type, day: m.targetDay, bps: m.bps, amountCents: m.amountCents, origin: m.origin, active: m.active, tranche: m.trancheIdx, criteria: m.proof.criteria, artifacts: artifactsText(m.proof), lockRule: m.lockRule, disputeRule: m.disputeRule }));
    clauses = cl.map((c) => ({ category: c.category, code: c.code, title: c.title, body: c.body, active: c.active }));
  }
  const order = { SYSTEM: 0, BASELINE: 1, CUSTOM: 2 } as const;
  clauses.sort((x, y) => order[x.category] - order[y.category] || x.code.localeCompare(y.code));

  return {
    id: w.id, title: w.title, blueprintCode: w.blueprintCode, blueprintTitle: bp?.title ?? null, state: w.state, currency: w.currency, totalCents: w.totalCents, feeBps: w.feeBps, rail: w.rail,
    reviewTimeoutRule: w.reviewTimeoutRule, createdAt: w.createdAt,
    client: { id: w.clientId, name: name(w.clientId) }, provider: w.providerId ? { id: w.providerId, name: name(w.providerId) } : null, inviteEmail: w.providerId ? null : w.inviteEmail,
    revision: rev ? { revNo: rev.revNo, hash: rev.hash, recomputed: canonicalHash(rev.canonical), createdAt: rev.createdAt } : null,
    milestones, clauses,
    signatures: sigs.map((s) => ({ role: s.role, name: name(s.signerId), revNo: s.revNo, hash: s.hash, mfa: s.mfa, at: s.createdAt, voidedAtRev: s.voidedAtRev })),
    extraTerms, canonicalJson: rev ? canonical(rev.canonical) : null, tranches: trs,
    generatedAt: now, generatedFor: `${a.name ?? a.id} (${a.role})`,
  };
}
