/**
 * Disputes: open, blind bids, vault, seal, AI proposal, verdict, co-sign, two-leg execution (→ money).
 * F4.01 scoped freeze (release-final milestones refused, 403) · F4.02 sealed bids, 3 rounds, midpoint within 5 points ·
 * F4.03 write-once rebuttal vault with dossier root · F4.04 annotations bound to Phase 3 file hashes · F4.05 COI router ·
 * F4.06 co-sign above $5,000 · F4.07 split to the cent · F4.08 saga: leg 1 refund, leg 2 release, retry never repeats leg 1 ·
 * F4.09 resume or terminate · F4.10 external disputes supersede · F4.11 fast track under 72 h · F4.12 root-cause tags.
 * Money moves only through src/server/money (P1); AI output is stored as advice and never executed (P3).
 * Sealing routes through the mediator network (src/server/mediators: scored offer with stored breakdown, 2 h to accept,
 * next candidate on decline or expiry, Ops lead queue after 3 misses); co-sign also covers probation; mediator fees recorded.
 */
import { isSimWorkspaceSql } from "@/lib/sim";
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { bids, disputes, evidencePackages, rebuttals, releases, tranches, verdicts, workspaces, wsClauses, wsMilestones } from "@/db/schema";
import { bidNonces, disputeFees, disputeFiles, disputeMeta } from "@/db/schema-disputes";
import { DomainError, NotBuilt, type Actor } from "../types";
import { can } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { disputeMachine, milestoneMachine } from "@/lib/fsm";
import { idemKey, newId, sha256 } from "@/lib/ids";
import { canonicalHash } from "@/lib/canonical";
import { splitDispute, pct } from "@/lib/money";
import { addHours } from "@/lib/clock";
import { workspaceNow } from "../clock";
import { releaseMilestone, returnToClient } from "../money";
import { mediate } from "../ai";
import * as R from "./rules";
import * as MED from "../mediators";

export { REASONS, ROOT_CAUSES, COSIGN_ABOVE_CENTS } from "./rules";

type MS = (typeof milestoneMachine.states)[number];
type DS = (typeof disputeMachine.states)[number];
const SYSTEM = { id: null, role: "system" } as const;

/** HTTP status for each domain error code, for route handlers and the public API (F4.01: settled → 403). */
export const STATUS: Record<string, number> = {
  FORBIDDEN: 403, RELEASE_FINAL: 403, NOT_PARTY: 403, NOT_ASSIGNED: 403, COI: 403, SAME_PERSON: 403,
  NOT_FOUND: 404, BAD_INPUT: 422, BAD_ANNOTATION: 422, NOT_DISPUTABLE: 409, ALREADY_DISPUTED: 409, ALREADY_BID: 409,
  TIER1_CLOSED: 409, VAULT_CLOSED: 409, VAULT_LOCKED: 409, VAULT_OPEN: 409, NOT_TIER3: 409, VERDICT_EXISTS: 409,
  NO_VERDICT: 409, AWAITING_COSIGN: 409, NOT_NEEDED: 409, SUPERSEDED: 409,
  NOT_ELIGIBLE: 403, NOT_SENIOR: 403, SAME_FIRM: 403, OFFER_CLOSED: 409, OFFER_EXPIRED: 409, NOT_SETTLED: 409, ALREADY_RATED: 409, NO_MEDIATOR: 409,
};

/* ───────────── loading and roles ───────────── */

async function load(disputeId: string, q: typeof db | Tx = db) {
  const [row] = await q.select({ d: disputes, m: wsMilestones, w: workspaces, meta: disputeMeta }).from(disputes)
    .innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId))
    .innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .leftJoin(disputeMeta, eq(disputeMeta.disputeId, disputes.id))
    .where(eq(disputes.id, disputeId)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "This dispute does not exist.");
  return row;
}
type Case = Awaited<ReturnType<typeof load>>;

function sideOf(a: Actor, w: { clientId: string; providerId: string | null }): "client" | "provider" | null {
  if (a.role === "client" && a.id === w.clientId) return "client";
  if (a.role === "provider" && a.id === w.providerId) return "provider";
  return null;
}
/** Judge rights exist only in sandbox mode (P9); can() already returns false for a judge outside it. */
const isJudge = (a: Actor) => a.role === "judge" && can("judge", "dispute.verdict");

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new DomainError("BAD_INPUT", r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

async function history(excludeDisputeId?: string): Promise<R.CaseHistory[]> {
  const rows = await db.select({ mediatorId: disputes.mediatorId, clientId: workspaces.clientId, providerId: workspaces.providerId, at: disputes.createdAt, id: disputes.id })
    .from(disputes).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    /* playground (sim) cases never create conflicts of interest on real cases */
    .where(and(isNotNull(disputes.mediatorId), sql`not ${isSimWorkspaceSql(workspaces.id)}`));
  return rows.filter((r) => r.id !== excludeDisputeId);
}
const partiesOf = (w: { clientId: string; providerId: string | null }) => [w.clientId, ...(w.providerId ? [w.providerId] : [])];

/* ───────────── open (F4.01, F4.11) ───────────── */

const OpenInput = z.object({
  reason: z.enum(Object.keys(R.REASONS) as [R.ReasonCode, ...R.ReasonCode[]], { message: "Pick a reason." }),
  narrative: z.string().trim().min(10, "Say in a sentence or two what went wrong (10 characters or more).").max(4000),
});

export async function openDispute(a: Actor, milestoneId: string, reason: string, narrative: string): Promise<string> {
  if (!can(a.role, "dispute.open")) throw new DomainError("FORBIDDEN", "Your role cannot open disputes.");
  const input = parse(OpenInput, { reason, narrative });
  const [row] = await db.select({ m: wsMilestones, w: workspaces }).from(wsMilestones)
    .innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).where(eq(wsMilestones.id, milestoneId)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "This milestone does not exist.");
  const { m, w } = row;
  if ((a.role === "client" || a.role === "provider") && !sideOf(a, w)) throw new DomainError("NOT_PARTY", "Only the two parties to this contract can dispute its milestones.");
  const [done] = await db.select({ id: releases.id }).from(releases).where(and(eq(releases.milestoneId, m.id), eq(releases.status, "COMPLETED"))).limit(1);
  if (m.state === "RELEASED" || m.state === "SETTLED_BY_VERDICT" || m.state === "REFUNDED" || done)
    throw new DomainError("RELEASE_FINAL", `“${m.title}” is settled and its release is final within PaySettle, so it cannot be disputed here. PayPal's own buyer and seller programmes are unaffected.`);
  const [dup] = await db.select({ id: disputes.id }).from(disputes).where(eq(disputes.milestoneId, m.id)).limit(1);
  if (dup) throw new DomainError("ALREADY_DISPUTED", "This milestone already has a dispute.");
  if (!(R.DISPUTABLE_STATES as readonly string[]).includes(m.state))
    throw new DomainError("NOT_DISPUTABLE", `Only a milestone with submitted proof can be disputed. “${m.title}” is ${m.state.toLowerCase()}.`);

  const now = await workspaceNow(w.id);
  const [tr] = await db.select().from(tranches).where(and(eq(tranches.workspaceId, w.id), eq(tranches.idx, m.trancheIdx))).limit(1);
  const dl = R.deadlines(now, tr?.windowEndsAt ?? null);
  const siblings = await db.select({ code: wsMilestones.code, dependsOn: wsMilestones.dependsOn, active: wsMilestones.active }).from(wsMilestones).where(eq(wsMilestones.workspaceId, w.id));
  const frozen = siblings.filter((s) => s.active && s.dependsOn.includes(m.code)).map((s) => s.code);
  const id = newId("dsp");

  await db.transaction(async (tx) => {
    const next = milestoneMachine.next(m.state as MS, "dispute");
    const upd = await tx.update(wsMilestones).set({ state: next }).where(and(eq(wsMilestones.id, m.id), eq(wsMilestones.state, m.state))).returning({ id: wsMilestones.id });
    if (!upd.length) throw new DomainError("NOT_DISPUTABLE", "The milestone changed while you were opening the dispute. Reload and try again.");
    await tx.insert(disputes).values({ id, milestoneId: m.id, openedBy: a.id, reason: input.reason, narrative: input.narrative, amountCents: m.amountCents, tier: 1, state: "TIER1", tier1Until: dl.tier1Until, vaultUntil: dl.vaultUntil, createdAt: now });
    await tx.insert(disputeMeta).values({ disputeId: id, workspaceId: w.id, trancheId: tr?.id ?? null, openedRole: a.role, fastTrack: dl.fastTrack, tier3Until: dl.tier3Until, frozenDependants: frozen, updatedAt: now });
    await audit(tx, a, "dispute.open", id, { milestoneId: m.id, code: m.code, amountCents: m.amountCents, reason: input.reason, fastTrack: dl.fastTrack, tier1Until: dl.tier1Until.toISOString(), vaultUntil: dl.vaultUntil.toISOString(), frozenDependants: frozen });
  });
  return id;
}

/* ───────────── Tier 1 sealed offers (F4.02, §6.10) ───────────── */

export async function placeBid(a: Actor, disputeId: string, providerShareBps: number): Promise<{ settled: boolean; shareBps?: number }> {
  if (!can(a.role, "dispute.bid")) throw new DomainError("FORBIDDEN", "Your role cannot make offers.");
  try { R.assertBps(providerShareBps); } catch (e) { throw new DomainError("BAD_INPUT", (e as Error).message); }
  await advanceDispute(disputeId);
  const c = await load(disputeId);
  if (c.d.state !== "TIER1") throw new DomainError("TIER1_CLOSED", "Sealed offers are closed for this dispute.");
  let side = sideOf(a, c.w);
  const result: { settled: boolean; shareBps?: number } = { settled: false };

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM disputes WHERE id = ${disputeId} FOR UPDATE`);
    const [fresh] = await tx.select({ state: disputes.state }).from(disputes).where(eq(disputes.id, disputeId));
    if (fresh?.state !== "TIER1") throw new DomainError("TIER1_CLOSED", "Sealed offers are closed for this dispute.");
    const all = await tx.select({ round: bids.round, role: bids.role, providerShareBps: bids.providerShareBps, commit: bids.commit }).from(bids).where(eq(bids.disputeId, disputeId));
    const round = R.openRound(all);
    if (!round) throw new DomainError("TIER1_CLOSED", "All three rounds are used.");
    if (!side && isJudge(a)) side = all.some((b) => b.round === round && b.role === "client") ? "provider" : "client";
    if (!side) throw new DomainError("NOT_PARTY", "Only the two parties can make an offer.");
    if (all.some((b) => b.round === round && b.role === side)) throw new DomainError("ALREADY_BID", `You already made your offer for round ${round}. Wait for the other party.`);
    const { commit, nonce } = R.sealBid(providerShareBps);
    const bidId = newId("bid");
    await tx.insert(bids).values({ id: bidId, disputeId, round, role: side, commit, providerShareBps });
    await tx.insert(bidNonces).values({ bidId, nonce });
    await audit(tx, a, "dispute.bid", disputeId, { round, role: side, commit });
    const after = [...all, { round, role: side, providerShareBps, commit }];
    const out = R.roundOutcome(after, round);
    if (out.complete && out.settledBps !== null) {
      const cb = after.find((b) => b.round === round && b.role === "client")!, pb = after.find((b) => b.round === round && b.role === "provider")!;
      await tx.update(disputes).set({ state: disputeMachine.next("TIER1", "converge") }).where(eq(disputes.id, disputeId));
      const s = splitDispute(c.d.amountCents, out.settledBps);
      const findings = `Both sealed offers met within 5 points in round ${round}: the client offered ${pct(cb.providerShareBps)} and the provider asked ${pct(pb.providerShareBps)} to the provider. Settled at the midpoint, ${pct(out.settledBps)}.`;
      await insertVerdict(tx, c, { origin: "TIER1", mediatorId: null, providerShareBps: out.settledBps, ...s, findings, rootCause: "AGREED_TIER1", disposition: "RESUME", commits: [cb.commit, pb.commit] });
      await audit(tx, a, "dispute.agreed", disputeId, { round, shareBps: out.settledBps, refundCents: s.refundCents, releaseCents: s.releaseCents });
      result.settled = true; result.shareBps = out.settledBps;
    } else if (out.complete && round === R.MAX_ROUNDS) {
      await tx.update(disputes).set({ state: disputeMachine.next("TIER1", "impasse"), tier: 2 }).where(eq(disputes.id, disputeId));
      await audit(tx, a, "dispute.impasse", disputeId, { rounds: R.MAX_ROUNDS });
    }
  });
  if (result.settled) await execute(a, disputeId).catch(() => undefined); // a failed leg is shown in the room and retried
  return result;
}

/** F4.02: either party may skip to the evidence vault at any time in Tier 1, with no penalty. */
export async function skipToVault(a: Actor, disputeId: string): Promise<void> {
  const c = await load(disputeId);
  const side = sideOf(a, c.w) ?? (isJudge(a) ? "judge" : null);
  if (!side) throw new DomainError("NOT_PARTY", "Only the two parties can move the dispute on.");
  if (c.d.state !== "TIER1") throw new DomainError("TIER1_CLOSED", "The dispute is already past Tier 1.");
  await db.transaction(async (tx) => {
    const u = await tx.update(disputes).set({ state: disputeMachine.next("TIER1", "impasse"), tier: 2 }).where(and(eq(disputes.id, disputeId), eq(disputes.state, "TIER1"))).returning({ id: disputes.id });
    if (!u.length) return;
    await tx.update(disputeMeta).set({ skippedBy: side }).where(eq(disputeMeta.disputeId, disputeId));
    await audit(tx, a, "dispute.skip_to_vault", disputeId, { by: side });
  });
}

/* ───────────── Tier 2 vault (F4.03, F4.04) ───────────── */

const Hex = z.string().regex(/^[a-f0-9]{64}$/, "A SHA-256 hash is 64 hex characters.");
const RebuttalInput = z.object({
  kind: z.enum(["NOTE", "FILE", "ANNOTATION"]),
  narrative: z.string().trim().min(1, "Write a short note.").max(4000),
  sha256: Hex,
  annotations: z.array(z.object({
    fileSha: Hex,
    box: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
    clause: z.string().trim().max(60).optional(),
    comment: z.string().trim().min(1, "Each mark needs a comment.").max(1000),
  })).max(20).optional(),
});

function vaultEnd(c: Case) {
  const ext = c.meta?.vaultExtendedUntil;
  return ext && ext > c.d.vaultUntil ? ext : c.d.vaultUntil;
}

export async function addRebuttal(a: Actor, disputeId: string, r: { kind: string; narrative: string; sha256: string; annotations?: unknown[] }): Promise<void> {
  const input = parse(RebuttalInput, r);
  await advanceDispute(disputeId);
  const c = await load(disputeId);
  const side = sideOf(a, c.w) ?? (isJudge(a) ? "judge" : null);
  if (!side) throw new DomainError("NOT_PARTY", "Only the two parties can add to the vault.");
  const now = await workspaceNow(c.w.id);
  const ext = c.meta?.vaultExtendedUntil;
  const late = c.d.state === "TIER3" && ext && now <= ext;
  if (!(c.d.state === "TIER2" && now <= vaultEnd(c)) && !late)
    throw new DomainError("VAULT_CLOSED", c.d.state === "TIER3" ? "The vault is sealed. Late evidence needs an extension from the mediator." : "The vault is open only during Tier 2.");
  if (c.d.state === "TIER2" && c.meta?.vaultLocks.includes(side)) throw new DomainError("VAULT_LOCKED", "You locked your side of the vault, so it takes no more from you.");

  const anns = input.annotations ?? [];
  if (anns.length) {
    const pk = await db.select({ files: evidencePackages.files }).from(evidencePackages).where(eq(evidencePackages.milestoneId, c.m.id));
    const own = await db.select({ sha: disputeFiles.sha256 }).from(disputeFiles).where(eq(disputeFiles.disputeId, disputeId));
    const known = new Set([...pk.flatMap((p) => p.files.map((f) => f.sha256)), ...own.map((o) => o.sha)]);
    const clauses = await db.select({ code: wsClauses.code }).from(wsClauses).where(eq(wsClauses.workspaceId, c.w.id));
    const codes = new Set([...clauses.map((x) => x.code), c.m.code]);
    for (const n of anns) {
      if (!known.has(n.fileSha)) throw new DomainError("BAD_ANNOTATION", "A mark points at an image that is not in the milestone's evidence record (its hash does not match).");
      if (n.clause && !codes.has(n.clause)) throw new DomainError("BAD_ANNOTATION", `Clause “${n.clause}” is not part of this contract.`);
    }
  }
  await db.transaction(async (tx) => {
    await tx.insert(rebuttals).values({ id: newId("rbt"), disputeId, byUser: a.id, role: side, kind: input.kind, sha256: input.sha256, narrative: input.narrative, annotations: anns.map((n) => ({ fileSha: n.fileSha, box: n.box, clause: n.clause || undefined, comment: n.comment })), createdAt: now });
    await audit(tx, a, "dispute.rebuttal", disputeId, { role: side, kind: input.kind, sha256: input.sha256, marks: anns.length, late: !!late });
    if (late) {
      const root = await computeRoot(tx, c.m.id, disputeId);
      await tx.update(disputes).set({ dossierRoot: root }).where(eq(disputes.id, disputeId));
      await audit(tx, a, "dispute.dossier_amended", disputeId, { dossierRoot: root });
    }
  });
}

/** Store an uploaded rebuttal file (write-once; same bytes twice is a no-op). Returns its SHA-256. */
export async function storeRebuttalFile(a: Actor, disputeId: string, f: { name: string; type: string; bytes: Buffer }): Promise<string> {
  const c = await load(disputeId);
  if (!(sideOf(a, c.w) || isJudge(a))) throw new DomainError("NOT_PARTY", "Only the two parties can add to the vault.");
  if (f.bytes.length === 0 || f.bytes.length > 5 * 1024 * 1024) throw new DomainError("BAD_INPUT", "Files must be between 1 byte and 5 MB.");
  const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain"];
  if (!allowed.includes(f.type)) throw new DomainError("BAD_INPUT", "Upload a PNG, JPEG, WebP, PDF or plain-text file.");
  const hash = sha256(f.bytes);
  const name = f.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  await db.insert(disputeFiles).values({ disputeId, sha256: hash, name, type: f.type, size: f.bytes.length, bytes: f.bytes, byUser: a.id }).onConflictDoNothing();
  return hash;
}

/** F4.03: a party locks its side; when both have locked, the vault seals early. */
export async function lockVault(a: Actor, disputeId: string): Promise<{ sealed: boolean }> {
  const c = await load(disputeId);
  const side = sideOf(a, c.w) ?? (isJudge(a) ? "judge" : null);
  if (!side) throw new DomainError("NOT_PARTY", "Only the two parties can lock the vault.");
  if (c.d.state !== "TIER2") throw new DomainError("VAULT_CLOSED", "The vault is not open.");
  const locks = [...new Set([...(c.meta?.vaultLocks ?? []), ...(side === "judge" ? ["client", "provider"] : [side])])];
  await db.transaction(async (tx) => {
    await tx.update(disputeMeta).set({ vaultLocks: locks }).where(eq(disputeMeta.disputeId, disputeId));
    await audit(tx, a, "dispute.vault_lock", disputeId, { side, locks });
  });
  if (locks.includes("client") && locks.includes("provider")) { await sealVault(a, disputeId); return { sealed: true }; }
  return { sealed: false };
}

/** F4.03: late evidence after sealing needs the assigned mediator to grant an extension (up to 48 h). */
export async function grantExtension(a: Actor, disputeId: string, hours: number): Promise<void> {
  const c = await load(disputeId);
  if (!(isJudge(a) || (a.role === "mediator" && c.d.mediatorId === a.id))) throw new DomainError("NOT_ASSIGNED", "Only the assigned mediator can allow late evidence.");
  if (c.d.state !== "TIER3" && c.d.state !== "TIER2") throw new DomainError("VAULT_CLOSED", "This dispute no longer takes evidence.");
  if (!Number.isInteger(hours) || hours < 1 || hours > 48) throw new DomainError("BAD_INPUT", "An extension is 1 to 48 hours.");
  const now = await workspaceNow(c.w.id);
  const until = addHours(now, hours);
  await db.transaction(async (tx) => {
    await tx.update(disputeMeta).set({ vaultExtendedUntil: until }).where(eq(disputeMeta.disputeId, disputeId));
    await audit(tx, a, "dispute.extension", disputeId, { until: until.toISOString(), hours });
  });
}

async function computeRoot(q: typeof db | Tx, milestoneId: string, disputeId: string) {
  const pkgs = await q.select({ root: evidencePackages.rootHash }).from(evidencePackages).where(eq(evidencePackages.milestoneId, milestoneId)).orderBy(asc(evidencePackages.attempt));
  const rebs = await q.select({ sha: rebuttals.sha256 }).from(rebuttals).where(eq(rebuttals.disputeId, disputeId)).orderBy(asc(rebuttals.createdAt), asc(rebuttals.id));
  return R.dossierRoot(pkgs.map((p) => p.root), rebs.map((r) => r.sha));
}

/* ───────────── seal → Tier 3 (F4.03, F4.05, A4) ───────────── */

async function aiAdvice(c: Case): Promise<Record<string, unknown>> {
  const at = new Date().toISOString();
  try {
    const clauses = await db.select().from(wsClauses).where(and(eq(wsClauses.workspaceId, c.w.id), eq(wsClauses.active, true)));
    const pkgs = await db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, c.m.id)).orderBy(asc(evidencePackages.attempt));
    const rebs = await db.select().from(rebuttals).where(eq(rebuttals.disputeId, c.d.id)).orderBy(asc(rebuttals.createdAt));
    const bs = await db.select({ role: bids.role, shareBps: bids.providerShareBps }).from(bids).where(eq(bids.disputeId, c.d.id));
    const r = await mediate({
      disputeRule: c.m.disputeRule,
      clauses: clauses.map((x) => `${x.code} ${x.title}: ${x.body}`),
      evidence: pkgs.map((p) => `Attempt ${p.attempt} (root ${p.rootHash.slice(0, 12)}): files ${p.files.map((f) => `${f.name} [${f.kind}]`).join(", ")}; signals ${p.signals.map((s) => `${s.code}=${s.level}`).join(", ") || "none"}; note: ${p.note ?? ""}`),
      rebuttals: [`Opening (${c.d.reason}): ${c.d.narrative}`, ...rebs.map((x) => `${x.role} (${x.kind}): ${x.narrative}${x.annotations.length ? ` — ${x.annotations.length} marked region(s): ${x.annotations.map((n) => `${n.clause ?? "no clause"}: ${n.comment}`).join("; ")}` : ""}`)],
      bids: bs, amountCents: c.d.amountCents,
    });
    return { available: r.available, reason: r.reason ?? null, model: r.model ?? null, confidence: r.confidence ?? r.data?.confidence ?? null, data: r.data ?? null, at };
  } catch (e) {
    return { available: false, reason: e instanceof NotBuilt ? "The AI mediator is not switched on in this build." : "The AI mediator did not answer. The case continues without advice.", at };
  }
}

export async function sealVault(a: Actor | null, disputeId: string): Promise<void> {
  const c = await load(disputeId);
  if (c.d.state === "TIER3") return;
  if (c.d.state !== "TIER2") throw new DomainError("VAULT_CLOSED", "Only an open vault can be sealed.");
  const now = await workspaceNow(c.w.id);
  const locks = c.meta?.vaultLocks ?? [];
  const both = locks.includes("client") && locks.includes("provider");
  if (!(now >= vaultEnd(c) || both || (a && isJudge(a))))
    throw new DomainError("VAULT_OPEN", `The vault stays open until ${c.d.vaultUntil.toISOString()} unless both parties lock it.`);
  const root = await computeRoot(db, c.m.id, disputeId);
  /* F4.05: scored, explainable routing; the offer (with its breakdown) is stored in the same transaction */
  const plan = await MED.planRoute(disputeId, now);
  const mediatorId = plan.mediatorId;
  const aiProposal = await aiAdvice(c);
  await db.transaction(async (tx) => {
    const u = await tx.update(disputes).set({ state: disputeMachine.next("TIER2", "seal"), tier: 3, dossierRoot: root, mediatorId, aiProposal })
      .where(and(eq(disputes.id, disputeId), eq(disputes.state, "TIER2"))).returning({ id: disputes.id });
    if (!u.length) return;
    await audit(tx, a ?? SYSTEM, "dispute.seal", disputeId, { dossierRoot: root, mediatorId, unassigned: !mediatorId, ai: aiProposal.available === true, trigger: both ? "both_locked" : now >= c.d.vaultUntil ? "deadline" : "judge", routing: plan.mode, score: plan.breakdown?.total ?? null });
    await MED.recordOffer(tx, a ?? SYSTEM, plan);
  });
}

/* ───────────── verdict, co-sign (F4.06, F4.07, §6.13, F4.12) ───────────── */

const VerdictInput = z.object({
  providerShareBps: z.number().int().min(0).max(10_000),
  findings: z.string().trim().min(20, "Write the findings (20 characters or more).").max(8000),
  rootCause: z.enum(Object.keys(R.ROOT_CAUSES) as [R.RootCause, ...R.RootCause[]], { message: "Pick a root cause." }),
  disposition: z.enum(["RESUME", "TERMINATE"]),
  fault: z.enum(["CLIENT", "PROVIDER", "SHARED"]).optional(),
});

async function insertVerdict(tx: Tx, c: Case, v: { origin: "TIER1" | "TIER3"; mediatorId: string | null; providerShareBps: number; refundCents: number; releaseCents: number; findings: string; rootCause: string; disposition: "RESUME" | "TERMINATE"; fault?: "CLIENT" | "PROVIDER" | "SHARED"; commits?: string[] }) {
  const id = newId("vrd");
  const signature = canonicalHash({ verdict: id, dispute: c.d.id, milestone: c.m.id, amountCents: c.d.amountCents, origin: v.origin, mediatorId: v.mediatorId, providerShareBps: v.providerShareBps, refundCents: v.refundCents, releaseCents: v.releaseCents, findings: v.findings, rootCause: v.rootCause, disposition: v.disposition, fault: v.fault ?? null, dossierRoot: c.d.dossierRoot, commits: v.commits ?? [] });
  await tx.insert(verdicts).values({ id, disputeId: c.d.id, origin: v.origin, mediatorId: v.mediatorId, providerShareBps: v.providerShareBps, refundCents: v.refundCents, releaseCents: v.releaseCents, findings: v.findings, rootCause: v.rootCause, disposition: v.disposition, fault: v.fault ?? null, signature,
    leg1: v.refundCents === 0 ? "SKIPPED" : "PENDING", leg2: v.releaseCents === 0 ? "SKIPPED" : "PENDING" });
  return { id, signature };
}

export async function issueVerdict(a: Actor, disputeId: string, v: { providerShareBps: number; findings: string; rootCause: string; disposition: "RESUME" | "TERMINATE"; fault?: "CLIENT" | "PROVIDER" | "SHARED" }): Promise<string> {
  if (!can(a.role, "dispute.verdict")) throw new DomainError("FORBIDDEN", "Only a mediator can sign a verdict.");
  const input = parse(VerdictInput, v);
  await advanceDispute(disputeId);
  const c = await load(disputeId);
  if (c.d.state !== "TIER3") throw new DomainError("NOT_TIER3", "A verdict can be signed only after the vault is sealed (Tier 3).");
  const [prior] = await db.select({ id: verdicts.id }).from(verdicts).where(eq(verdicts.disputeId, disputeId)).limit(1);
  if (prior) throw new DomainError("VERDICT_EXISTS", "This dispute already has a signed verdict.");
  /* F4.05: an unassigned case (Ops lead queue) can be taken only by a mediator the router finds eligible (COI, domain, status…) */
  let takePlan: MED.RoutePlan | null = null;
  if (a.role === "mediator") {
    if (c.d.mediatorId && c.d.mediatorId !== a.id) throw new DomainError("NOT_ASSIGNED", "This case is assigned to another mediator.");
    if (!c.d.mediatorId) takePlan = await MED.takeCheck(a, disputeId, await workspaceNow(c.w.id));
  }
  const s = splitDispute(c.d.amountCents, input.providerShareBps);
  const fee = R.feeSplit(R.mediationFeeCents(), input.fault);
  let needsCosign = false;
  let verdictId = "";
  await db.transaction(async (tx) => {
    const { id } = await insertVerdict(tx, c, { origin: "TIER3", mediatorId: a.id, providerShareBps: input.providerShareBps, ...s, findings: input.findings, rootCause: input.rootCause, disposition: input.disposition, fault: input.fault });
    verdictId = id;
    if (takePlan) {
      const u = await tx.update(disputes).set({ mediatorId: a.id }).where(and(eq(disputes.id, disputeId), sql`${disputes.mediatorId} IS NULL`)).returning({ id: disputes.id });
      if (!u.length) throw new DomainError("NOT_ASSIGNED", "Another mediator took this case a moment ago.");
      await MED.recordOffer(tx, a, takePlan, "SELF", true);
    }
    /* F4.06: a second signature above $5,000 and on a probation mediator's first 5 verdicts; mediator fee recorded */
    const reasons = await MED.onVerdictSigned(tx, a, { disputeId, orgId: c.w.orgId, amountCents: c.d.amountCents, highValueAboveCents: R.COSIGN_ABOVE_CENTS }, id);
    needsCosign = reasons.length > 0;
    await tx.insert(disputeFees).values({ disputeId, verdictId: id, basis: fee.basis, totalCents: fee.totalCents, clientCents: fee.clientCents, providerCents: fee.providerCents,
      note: `Mediation fee §6.13: ${fee.basis === "SHARED" ? "split 50/50" : `charged to the ${fee.basis.toLowerCase()}`}. Recorded for Finance; not taken from the held amount.` });
    await audit(tx, a, "dispute.verdict", disputeId, { verdictId: id, providerShareBps: input.providerShareBps, refundCents: s.refundCents, releaseCents: s.releaseCents, disposition: input.disposition, fault: input.fault ?? null, rootCause: input.rootCause, needsCosign, feeCents: fee.totalCents });
  });
  if (!needsCosign) await execute(a, disputeId).catch(() => undefined);
  return verdictId;
}

export async function cosignVerdict(a: Actor, disputeId: string): Promise<void> {
  if (!can(a.role, "dispute.verdict")) throw new DomainError("FORBIDDEN", "Only a mediator can co-sign a verdict.");
  const c = await load(disputeId);
  const [v] = await db.select().from(verdicts).where(eq(verdicts.disputeId, disputeId)).limit(1);
  if (!v) throw new DomainError("NO_VERDICT", "There is no verdict to co-sign yet.");
  const reasons = (await MED.cosignReasonsFor([{ disputeId, amountCents: c.d.amountCents, origin: v.origin }], R.COSIGN_ABOVE_CENTS)).get(disputeId) ?? [];
  if (!reasons.length) throw new DomainError("NOT_NEEDED", "This verdict does not need a co-signature.");
  if (v.cosignerId) throw new DomainError("NOT_NEEDED", "This verdict is already co-signed.");
  if (a.id === v.mediatorId) throw new DomainError("SAME_PERSON", "A second, different mediator must co-sign this verdict.");
  const now = await workspaceNow(c.w.id);
  if (a.role === "mediator" && R.conflicted(await history(disputeId), partiesOf(c.w), now).has(a.id))
    throw new DomainError("COI", "You mediated a case with one of these parties in the last 180 days, so you cannot co-sign this one.");
  /* in a mediator network the co-signer is Senior, from another firm, and free of declared or firm conflicts */
  await MED.checkCosigner(a, { disputeId, orgId: c.w.orgId, clientId: c.w.clientId, providerId: c.w.providerId, signerId: v.mediatorId }, now);
  await db.transaction(async (tx) => {
    const u = await tx.update(verdicts).set({ cosignerId: a.id }).where(and(eq(verdicts.id, v.id), sql`${verdicts.cosignerId} IS NULL`, ne(verdicts.mediatorId, a.id))).returning({ id: verdicts.id });
    if (!u.length) throw new DomainError("NOT_NEEDED", "This verdict is already co-signed.");
    await tx.update(disputes).set({ cosignerId: a.id }).where(eq(disputes.id, disputeId));
    await audit(tx, a, "dispute.cosign", disputeId, { verdictId: v.id, mediatorId: v.mediatorId, reasons });
    await MED.onCosigned(tx, a, disputeId, v.id, v.mediatorId);
  });
  await execute(a, disputeId).catch(() => undefined);
}

/* ───────────── execution saga (F4.08, F4.09) ───────────── */

type Leg = "leg1" | "leg2";
async function claimLeg(verdictId: string, leg: Leg, from: string[]) {
  const col = leg === "leg1" ? verdicts.leg1 : verdicts.leg2;
  const u = await db.update(verdicts).set(leg === "leg1" ? { leg1: "IN_FLIGHT" } : { leg2: "IN_FLIGHT" }).where(and(eq(verdicts.id, verdictId), inArray(col, from))).returning({ id: verdicts.id });
  return u.length > 0;
}
async function setLeg(verdictId: string, leg: Leg, status: "DONE" | "FAILED") {
  await db.update(verdicts).set(leg === "leg1" ? { leg1: status } : { leg2: status }).where(eq(verdicts.id, verdictId));
}
const errText = (e: unknown) => e instanceof NotBuilt ? "The money service is not built yet in this environment." : (e as Error)?.message ?? String(e);

/**
 * Saga: leg 1 returns the refund to the client (refund of captured money or void of the authorisation remainder — the
 * money module decides), then leg 2 releases the provider's part as a VERDICT release. A failed leg stops the saga; a
 * retry resumes at the first leg that is not done, so leg 1 never runs twice. Idempotency keys are stored before each call (P2).
 */
async function execute(a: Actor, disputeId: string, opts: { retry?: boolean } = {}): Promise<{ done: boolean; error?: string }> {
  let c = await load(disputeId);
  const [v] = await db.select().from(verdicts).where(eq(verdicts.disputeId, disputeId)).limit(1);
  if (!v) throw new DomainError("NO_VERDICT", "There is no verdict to carry out.");
  if (c.d.state === "RESOLVED") return { done: true };
  if (c.d.state === "SUPERSEDED") throw new DomainError("SUPERSEDED", "A PayPal dispute on this payment takes over. PaySettle moves no money on this case.");
  if (v.origin === "TIER3" && !v.cosignerId && ((await MED.cosignReasonsFor([{ disputeId, amountCents: c.d.amountCents, origin: v.origin }], R.COSIGN_ABOVE_CENTS)).get(disputeId) ?? []).length)
    throw new DomainError("AWAITING_COSIGN", "A second mediator must co-sign before any money moves.");
  if (c.d.state === "AGREED" || c.d.state === "TIER3") {
    await db.transaction(async (tx) => {
      const u = await tx.update(disputes).set({ state: disputeMachine.next(c.d.state as DS, "execute") }).where(and(eq(disputes.id, disputeId), eq(disputes.state, c.d.state))).returning({ id: disputes.id });
      if (u.length) await audit(tx, a, "dispute.execute", disputeId, { verdictId: v.id });
    });
    c = await load(disputeId);
  }
  const from = opts.retry ? ["PENDING", "FAILED", "IN_FLIGHT"] : ["PENDING", "FAILED"];
  /* P4: the signed verdict (or the two parties' sealed commits at Tier 1) authorises the money call. The money module
     accepts verdict releases from mediator, ops, admin or a sandbox judge only, so a party-triggered run (Tier 1
     agreement, or a party pressing retry) acts through the settlement service identity. */
  const ma: Actor = ["mediator", "ops", "admin", "judge"].includes(a.role) ? a : { id: "system:disputes", role: "ops", name: "Dispute settlement", requestId: a.requestId };
  const trancheId = c.meta?.trancheId;
  const fail = async (leg: string, e: unknown) => {
    const msg = errText(e);
    await db.update(disputeMeta).set({ legError: `${leg}: ${msg}` }).where(eq(disputeMeta.disputeId, disputeId));
    await audit(db, a, `dispute.${leg}_failed`, disputeId, { error: msg.slice(0, 300) });
    return { done: false, error: msg };
  };

  if (v.leg1 !== "DONE" && v.leg1 !== "SKIPPED") {
    const key = idemKey(disputeId, "refund");
    await db.update(disputeMeta).set({ leg1Key: key }).where(eq(disputeMeta.disputeId, disputeId));
    if (!(await claimLeg(v.id, "leg1", from))) return { done: false, error: "Leg 1 is already running." };
    try {
      if (!trancheId) throw new Error("No hold was found for this milestone's tranche.");
      const r = await returnToClient(ma, trancheId, v.refundCents, `Dispute ${disputeId}: verdict refund`, key);
      await setLeg(v.id, "leg1", "DONE");
      await db.update(disputeMeta).set({ leg1Ref: r.refundId, legError: null }).where(eq(disputeMeta.disputeId, disputeId));
      await audit(db, a, "dispute.leg1_done", disputeId, { refundId: r.refundId, amountCents: v.refundCents, key });
    } catch (e) { await setLeg(v.id, "leg1", "FAILED"); return fail("leg1", e); }
  }

  if (v.leg2 !== "DONE" && v.leg2 !== "SKIPPED") {
    const key = idemKey("release", c.m.id, "VERDICT"); // the key the money module uses for this release
    await db.update(disputeMeta).set({ leg2Key: key }).where(eq(disputeMeta.disputeId, disputeId));
    if (!(await claimLeg(v.id, "leg2", from))) return { done: false, error: "Leg 2 is already running." };
    try {
      const r = await releaseMilestone(ma, c.m.id, { kind: "VERDICT", amountCents: v.releaseCents, approvalSig: v.signature });
      await setLeg(v.id, "leg2", "DONE");
      await db.update(disputeMeta).set({ leg2Ref: r.releaseId, legError: null }).where(eq(disputeMeta.disputeId, disputeId));
      await audit(db, a, "dispute.leg2_done", disputeId, { releaseId: r.releaseId, amountCents: v.releaseCents, netCents: r.netCents, feeCents: r.feeCents });
    } catch (e) { await setLeg(v.id, "leg2", "FAILED"); return fail("leg2", e); }
  }

  if (v.disposition === "TERMINATE") {
    const t = await terminateRest(ma, c);
    if (!t.done) return t;
  }

  let resolvedNow = false;
  await db.transaction(async (tx) => {
    const [m] = await tx.select({ state: wsMilestones.state }).from(wsMilestones).where(eq(wsMilestones.id, c.m.id));
    if (m?.state === "DISPUTED") await tx.update(wsMilestones).set({ state: milestoneMachine.next("DISPUTED", "verdict_executed") }).where(eq(wsMilestones.id, c.m.id));
    const u = await tx.update(disputes).set({ state: disputeMachine.next("EXECUTING", "done") }).where(and(eq(disputes.id, disputeId), eq(disputes.state, "EXECUTING"))).returning({ id: disputes.id });
    if (u.length) { resolvedNow = true; await audit(tx, a, "dispute.resolved", disputeId, { verdictId: v.id, refundCents: v.refundCents, releaseCents: v.releaseCents, disposition: v.disposition }); }
  });
  if (resolvedNow) await MED.onResolved(disputeId).catch(() => undefined); // random 5% second review flag; never blocks settlement
  return { done: true };
}

/** F4.09 terminate: every unstarted milestone of the same tranche goes back to the client. */
async function terminateRest(a: Actor, c: Case): Promise<{ done: boolean; error?: string }> {
  const rest = await db.select().from(wsMilestones).where(and(eq(wsMilestones.workspaceId, c.w.id), eq(wsMilestones.trancheIdx, c.m.trancheIdx), eq(wsMilestones.active, true), inArray(wsMilestones.state, ["LOCKED", "OPEN"]), ne(wsMilestones.id, c.m.id))).orderBy(asc(wsMilestones.seq));
  const plan = [...(c.meta?.terminated ?? [])];
  for (const m of rest) if (!plan.some((p) => p.milestoneId === m.id)) plan.push({ milestoneId: m.id, code: m.code, amountCents: m.amountCents, key: idemKey(c.d.id, "terminate", m.id), status: "PENDING" });
  await db.update(disputeMeta).set({ terminated: plan }).where(eq(disputeMeta.disputeId, c.d.id));
  for (const p of plan) {
    if (p.status === "DONE") continue;
    try {
      if (p.amountCents > 0) {
        if (!c.meta?.trancheId) throw new Error("No hold was found for this tranche.");
        const r = await returnToClient(a, c.meta.trancheId, p.amountCents, `Dispute ${c.d.id}: contract ended, ${p.code} not started`, p.key);
        p.ref = r.refundId;
      }
      p.status = "DONE";
      await db.update(wsMilestones).set({ state: milestoneMachine.next("LOCKED", "refund_unstarted") }).where(and(eq(wsMilestones.id, p.milestoneId), inArray(wsMilestones.state, ["LOCKED", "OPEN"])));
    } catch (e) {
      p.status = "FAILED";
      await db.update(disputeMeta).set({ terminated: plan, legError: `terminate ${p.code}: ${errText(e)}` }).where(eq(disputeMeta.disputeId, c.d.id));
      await audit(db, a, "dispute.terminate_failed", c.d.id, { milestone: p.code, error: errText(e).slice(0, 300) });
      return { done: false, error: errText(e) };
    }
  }
  await db.update(disputeMeta).set({ terminated: plan }).where(eq(disputeMeta.disputeId, c.d.id));
  if (plan.length) await audit(db, a, "dispute.terminated", c.d.id, { refunded: plan.map((p) => ({ code: p.code, amountCents: p.amountCents })) });
  return { done: true };
}

/** Retry a stopped execution: resumes at the first unfinished leg (leg 1 is never repeated once done). */
export async function retryExecution(a: Actor, disputeId: string): Promise<{ done: boolean; error?: string }> {
  const c = await load(disputeId);
  if (!(isJudge(a) || a.role === "ops" || (a.role === "mediator" && (c.d.mediatorId === a.id || c.d.cosignerId === a.id)) || sideOf(a, c.w)))
    throw new DomainError("FORBIDDEN", "You cannot retry this settlement.");
  return execute(a, disputeId, { retry: true });
}

/* ───────────── timers (F4.01 interceptor, F4.02 timeout, F4.03 seal at hour 96) ───────────── */

/** Applies any deadline that has passed for one dispute. Safe to call on every read. */
export async function advanceDispute(disputeId: string, now?: Date): Promise<string> {
  const c = await load(disputeId);
  const t = now ?? (await workspaceNow(c.w.id));
  let state = c.d.state;
  if (c.meta?.trancheId && disputeMachine.allows(state as DS, "external_dispute")) {
    const [tr] = await db.select({ warned: tranches.warned }).from(tranches).where(eq(tranches.id, c.meta.trancheId)).limit(1);
    if (tr?.warned.includes("EXTERNAL_DISPUTE") && (await supersedeByExternal(c.m.id, `tranche:${c.meta.trancheId}`))) return "SUPERSEDED";
  }
  if (state === "TIER1" && t > c.d.tier1Until) {
    await db.transaction(async (tx) => {
      const u = await tx.update(disputes).set({ state: disputeMachine.next("TIER1", "impasse"), tier: 2 }).where(and(eq(disputes.id, disputeId), eq(disputes.state, "TIER1"))).returning({ id: disputes.id });
      if (u.length) await audit(tx, SYSTEM, "dispute.tier1_timeout", disputeId, { at: t.toISOString() });
    });
    state = "TIER2";
  }
  if (state === "TIER2" && t >= vaultEnd(c)) { await sealVault(null, disputeId); state = "TIER3"; }
  if (state === "TIER3") await MED.sweepOffers({ disputeId, now: t }); // an expired offer moves to the next mediator
  return state;
}

export async function runDisputeTimers(now?: Date, workspaceId?: string): Promise<{ actions: { disputeId: string; action: string }[] }> {
  const open = await db.select({ id: disputes.id, state: disputes.state, ws: wsMilestones.workspaceId }).from(disputes).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId))
    .where(inArray(disputes.state, ["TIER1", "TIER2"]));
  const actions: { disputeId: string; action: string }[] = [];
  for (const d of open) {
    if (workspaceId && d.ws !== workspaceId) continue;
    const after = await advanceDispute(d.id, now);
    if (after !== d.state) actions.push({ disputeId: d.id, action: `${d.state}→${after}` });
  }
  actions.push(...(await MED.sweepOffers({ now, workspaceId }))); // offer expiry → next mediator, or the Ops lead queue after 3 misses
  return { actions };
}

/** F4.10: called by the money module's webhook when PayPal opens a dispute on the same payment. */
export async function supersedeByExternal(milestoneId: string, externalRef: string): Promise<boolean> {
  const [d] = await db.select().from(disputes).where(eq(disputes.milestoneId, milestoneId)).limit(1);
  if (!d || !disputeMachine.allows(d.state as DS, "external_dispute")) return false;
  await db.transaction(async (tx) => {
    await tx.update(disputes).set({ state: "SUPERSEDED" }).where(eq(disputes.id, d.id));
    await audit(tx, SYSTEM, "dispute.superseded", d.id, { externalRef });
  });
  return true;
}
