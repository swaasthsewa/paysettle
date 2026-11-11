/**
 * F4.05 F4.06 F4.07 — the mediator network service.
 *  - Routing: candidates from the database → the pure router (./router.ts) → an offer valid 2 h (30 min on fast track) with
 *    the score breakdown stored. Decline or expiry → the next candidate; after 3 misses → the Ops lead queue.
 *  - Co-signature: above $5,000 or on a probation mediator's first 5 verdicts; the co-signer must be Senior, from another
 *    firm and free of conflicts.
 *  - Mediator fees are recorded here and paid by PaySettle from its own fee income: this module never calls a rail (P1).
 *  - Onboarding: public application → Ops approval (profile VERIFYING) → credential checks → calibration → probation.
 * An organisation with no mediator profiles keeps the legacy pool (every mediator an active generalist) so older data works.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { disputes, users, verdicts, workspaces, wsMilestones } from "@/db/schema";
import { disputeMeta } from "@/db/schema-disputes";
import {
  mediatorApplications, mediatorAvailability, mediatorCalibrations, mediatorCaseFlags, mediatorCredentials, mediatorFees, mediatorOffers, mediatorProfiles, mediatorReviews,
  MEDIATOR_STATUSES, type MediatorStatus,
} from "@/db/schema-mediators";
import { isSimWorkspaceSql } from "@/lib/sim";
import { audit } from "@/lib/audit";
import { can } from "@/lib/rbac";
import { newId, sha256 } from "@/lib/ids";
import { DAY, HOUR } from "@/lib/clock";
import { fixedWindow } from "@/lib/identity/rate-limit";
import { DomainError, type Actor } from "../types";
import { workspaceNow } from "../clock";
import { objectStore } from "../evidence/storage";
import * as RT from "./router";
import * as MR from "./rules";
import { cleanDomains } from "./domains";
import { ROOT_CAUSES } from "../disputes/rules";

type Q = typeof db | Tx;
type AuditActor = { id: string | null; role: string | null; requestId?: string };
const SYSTEM: AuditActor = { id: null, role: "system" };
const OPEN_STATES = ["TIER3", "EXECUTING"];
export const OFFER_MINUTES = 120;
export const FAST_OFFER_MINUTES = 30;
export const MAX_MISSES = 3;

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new DomainError("BAD_INPUT", r.error.issues.map((i) => i.message).join("; "));
  return r.data;
}

/* ───────────── loading ───────────── */

/** True when the organisation has a mediator network (at least one profile). */
export async function networkMode(orgId: string, q: Q = db): Promise<boolean> {
  const [r] = await q.select({ n: sql<number>`count(*)::int` }).from(mediatorProfiles).where(eq(mediatorProfiles.orgId, orgId));
  return (r?.n ?? 0) > 0;
}

/** Cases with a mediator, for the 180-day conflict check. Playground (sim) cases never create conflicts on real cases. */
export async function coiHistory(excludeDisputeId?: string, q: Q = db) {
  const rows = await q.select({ mediatorId: disputes.mediatorId, clientId: workspaces.clientId, providerId: workspaces.providerId, at: disputes.createdAt, id: disputes.id })
    .from(disputes).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .where(and(isNotNull(disputes.mediatorId), sql`not ${isSimWorkspaceSql(workspaces.id)}`));
  return rows.filter((r) => r.id !== excludeDisputeId);
}

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
/** What routing may use about a party: its id, e-mail, firm (business or billing name), time zone and languages (default "en"). */
export function partyOf(u: { id: string; email: string; profile: Record<string, unknown> | null }): RT.Party {
  const p = u.profile ?? {};
  const prov = (p.provider && typeof p.provider === "object" ? p.provider : {}) as Record<string, unknown>;
  const langs = Array.isArray(p.languages) ? p.languages.filter((x): x is string => typeof x === "string") : str(p.language) ? [str(p.language)!] : [];
  return { id: u.id, email: u.email, firm: str(p.firm) ?? str(prov.businessName) ?? str(p.billingName), timezone: str(p.timezone), languages: langs.length ? langs : ["en"] };
}
export async function partiesOf(w: { clientId: string; providerId: string | null }, q: Q = db): Promise<RT.Party[]> {
  const ids = [w.clientId, ...(w.providerId ? [w.providerId] : [])];
  const rows = await q.select({ id: users.id, email: users.email, profile: users.profile }).from(users).where(inArray(users.id, ids));
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => !!r).map(partyOf);
}

/** Every mediator of the organisation as a router candidate, with load, SLA record, ratings and second reviews. */
export async function loadCandidates(orgId: string, now: Date, q: Q = db): Promise<{ mode: "network" | "legacy"; cands: RT.Candidate[]; names: Map<string, string> }> {
  const network = await networkMode(orgId, q);
  const meds = await q.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "mediator"), eq(users.orgId, orgId))).orderBy(asc(users.id));
  const names = new Map(meds.map((m) => [m.id, m.name]));
  const mode = network ? "network" as const : "legacy" as const;
  const ids = meds.map((m) => m.id);
  if (!ids.length) return { mode, cands: [], names };
  const notSim = sql`not ${isSimWorkspaceSql(wsMilestones.workspaceId)}`;
  const since = new Date(now.getTime() - RT.SLA_WINDOW_DAYS * DAY);
  /* one query at a time: q may be a transaction client, which must not run queries in parallel */
  const seq = async <T extends readonly unknown[]>(...fs: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> => { const out: unknown[] = []; for (const f of fs) out.push(await f()); return out as unknown as T; };
  const [open, last, sla, rates, reviews] = await seq(
    () => q.select({ id: disputes.mediatorId, n: sql<number>`count(*)::int` }).from(disputes).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId))
      .where(and(inArray(disputes.mediatorId, ids), inArray(disputes.state, OPEN_STATES), notSim)).groupBy(disputes.mediatorId),
    () => q.select({ id: disputes.mediatorId, at: sql<Date>`max(${disputes.createdAt})` }).from(disputes).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId))
      .where(and(inArray(disputes.mediatorId, ids), notSim)).groupBy(disputes.mediatorId),
    () => q.select({ id: verdicts.mediatorId, at: verdicts.createdAt, offeredAt: mediatorOffers.offeredAt }).from(verdicts)
      .innerJoin(mediatorOffers, and(eq(mediatorOffers.disputeId, verdicts.disputeId), eq(mediatorOffers.mediatorId, verdicts.mediatorId), eq(mediatorOffers.answer, "ACCEPTED")))
      .where(and(inArray(verdicts.mediatorId, ids), eq(verdicts.origin, "TIER3"), gte(verdicts.createdAt, since))),
    () => q.select({ id: mediatorReviews.mediatorId, sum: sql<number>`sum(${mediatorReviews.score})::int`, n: sql<number>`count(*)::int` }).from(mediatorReviews).where(inArray(mediatorReviews.mediatorId, ids)).groupBy(mediatorReviews.mediatorId),
    () => q.select({ id: verdicts.mediatorId, outcome: mediatorCaseFlags.secondReviewOutcome, n: sql<number>`count(*)::int` }).from(mediatorCaseFlags).innerJoin(verdicts, eq(verdicts.id, mediatorCaseFlags.verdictId))
      .where(and(inArray(verdicts.mediatorId, ids), isNotNull(mediatorCaseFlags.secondReviewOutcome))).groupBy(verdicts.mediatorId, mediatorCaseFlags.secondReviewOutcome),
  );
  const common = (id: string) => {
    const mine = sla.filter((s) => s.id === id);
    const at = last.find((l) => l.id === id)?.at;
    return {
      openCases: open.find((o) => o.id === id)?.n ?? 0,
      sla: { onTime: mine.filter((s) => s.at.getTime() - s.offeredAt.getTime() <= RT.SLA_HOURS * HOUR).length, total: mine.length },
      ratings: { sum: rates.find((r) => r.id === id)?.sum ?? 0, count: rates.find((r) => r.id === id)?.n ?? 0 },
      secondReview: { agree: reviews.find((r) => r.id === id && r.outcome === "AGREE")?.n ?? 0, disagree: reviews.find((r) => r.id === id && r.outcome === "DISAGREE")?.n ?? 0 },
      lastHistory: at ? new Date(at) : null,
    };
  };
  if (!network) return { mode, names, cands: ids.map((id) => { const c = common(id); return { ...RT.legacyCandidate(id, c.openCases, c.lastHistory), sla: c.sla, ratings: c.ratings, secondReview: c.secondReview }; }) };
  const profs = await q.select().from(mediatorProfiles).where(inArray(mediatorProfiles.userId, ids));
  const creds = await q.select({ userId: mediatorCredentials.userId, status: mediatorCredentials.status, expiresOn: mediatorCredentials.expiresOn }).from(mediatorCredentials).where(inArray(mediatorCredentials.userId, ids));
  const avail = await q.select().from(mediatorAvailability).where(inArray(mediatorAvailability.userId, ids));
  const cands: RT.Candidate[] = [];
  for (const p of profs) {
    const c = common(p.userId), av = avail.find((a) => a.userId === p.userId);
    cands.push({
      id: p.userId, status: p.status, domains: p.domains, languages: p.languages, timezone: p.timezone, maxOpen: p.maxOpen, firm: p.firm, declaredConflicts: p.declaredConflicts,
      paused: av?.paused ?? false, leave: av ? { from: av.leaveFrom, to: av.leaveTo } : null,
      credentials: creds.filter((x) => x.userId === p.userId).map((x) => ({ status: x.status, expiresOn: x.expiresOn })),
      openCases: c.openCases, sla: c.sla, ratings: c.ratings, secondReview: c.secondReview, lastAssignedAt: p.lastAssignedAt ?? c.lastHistory,
    });
  }
  return { mode, cands: cands.sort((a, b) => a.id.localeCompare(b.id)), names };
}

async function caseRow(disputeId: string, q: Q = db) {
  const [r] = await q.select({ d: disputes, w: workspaces, meta: disputeMeta }).from(disputes)
    .innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .leftJoin(disputeMeta, eq(disputeMeta.disputeId, disputes.id)).where(eq(disputes.id, disputeId)).limit(1);
  if (!r) throw new DomainError("NOT_FOUND", "This dispute does not exist.");
  return r;
}

async function caseInput(r: Awaited<ReturnType<typeof caseRow>>, now: Date, q: Q, alreadyOffered: string[] = [], statuses?: MediatorStatus[]): Promise<RT.CaseInput> {
  return { blueprintCode: r.w.blueprintCode, parties: await partiesOf(r.w, q), history: await coiHistory(r.d.id, q), now, alreadyOffered, statuses };
}

/* ───────────── routing and offers (F4.05) ───────────── */

export interface RoutePlan { disputeId: string; mediatorId: string | null; attempt: number; offeredAt: Date; expiresAt: Date; breakdown: RT.ScoreBreakdown | null; mode: "network" | "legacy"; excluded: { id: string; reasons: RT.Exclusion[] }[] }

/** Rank the network for a dispute (read only). The caller records the offer in the same transaction as the assignment. */
export async function planRoute(disputeId: string, now: Date, q: Q = db): Promise<RoutePlan> {
  const r = await caseRow(disputeId, q);
  const prior = await q.select({ mediatorId: mediatorOffers.mediatorId }).from(mediatorOffers).where(eq(mediatorOffers.disputeId, disputeId));
  const { mode, cands } = await loadCandidates(r.w.orgId, now, q);
  const k = await caseInput(r, now, q, prior.map((p) => p.mediatorId));
  const ranking = RT.rankMediators(cands, k);
  const minutes = r.meta?.fastTrack ? FAST_OFFER_MINUTES : OFFER_MINUTES;
  const base = { disputeId, attempt: prior.length + 1, offeredAt: now, expiresAt: new Date(now.getTime() + minutes * 60_000), mode, excluded: ranking.excluded };
  if (!ranking.ranked.length) return { ...base, mediatorId: null, breakdown: null };
  return { ...base, mediatorId: ranking.ranked[0].id, breakdown: RT.breakdownFor(ranking, 0, k, mode) };
}

async function bumpFlags(tx: Q, disputeId: string, set: Partial<typeof mediatorCaseFlags.$inferInsert>) {
  await tx.insert(mediatorCaseFlags).values({ disputeId, ...set }).onConflictDoUpdate({ target: mediatorCaseFlags.disputeId, set: { ...set, updatedAt: new Date() } });
}
async function toOpsQueue(tx: Q, a: AuditActor, disputeId: string, at: Date, reason: string) {
  await bumpFlags(tx, disputeId, { opsQueueAt: at, opsQueueReason: reason });
  await audit(tx, a, "mediator.ops_queue", disputeId, { reason });
}

/** Store the offer of a plan (or send the case to the Ops lead queue when nobody is eligible). */
export async function recordOffer(tx: Q, a: AuditActor, plan: RoutePlan, source: "ROUTER" | "OPS" | "SELF" = "ROUTER", accepted = false): Promise<string | null> {
  if (!plan.mediatorId || !plan.breakdown) {
    await toOpsQueue(tx, a, plan.disputeId, plan.offeredAt, `No mediator is eligible (${plan.excluded.length} considered and excluded).`);
    return null;
  }
  const id = newId("mof");
  const values = { disputeId: plan.disputeId, mediatorId: plan.mediatorId, attempt: plan.attempt, source, offeredAt: plan.offeredAt, expiresAt: plan.expiresAt, breakdown: plan.breakdown as unknown as Record<string, unknown>,
    answer: accepted ? "ACCEPTED" as const : null, answeredAt: accepted ? plan.offeredAt : null, reason: accepted ? (source === "SELF" ? "Took the open case" : null) : null };
  /* an Ops re-offer to someone who declined earlier reuses their row (one row per mediator and case; the audit keeps the history) */
  const [row] = await tx.insert(mediatorOffers).values({ id, ...values }).onConflictDoUpdate({ target: [mediatorOffers.disputeId, mediatorOffers.mediatorId], set: values }).returning({ id: mediatorOffers.id });
  await tx.update(mediatorProfiles).set({ lastAssignedAt: plan.offeredAt, updatedAt: new Date() }).where(eq(mediatorProfiles.userId, plan.mediatorId));
  if (source === "OPS") await bumpFlags(tx, plan.disputeId, { opsQueueAt: null, opsQueueReason: null });
  await audit(tx, a, "mediator.offer", plan.disputeId, { mediatorId: plan.mediatorId, attempt: plan.attempt, source, total: plan.breakdown.total, rank: plan.breakdown.rank, expiresAt: plan.expiresAt.toISOString(), mode: plan.mode });
  return row.id;
}

type OfferRow = typeof mediatorOffers.$inferSelect;
/** Close an offer (declined or expired), free the case and offer it to the next candidate — or to Ops after 3 misses. */
async function closeAndNext(o: OfferRow, at: Date, answer: "DECLINED" | "EXPIRED", reason: string | null, a: AuditActor): Promise<{ next: string | null }> {
  let next: string | null = null;
  await db.transaction(async (tx) => {
    const u = await tx.update(mediatorOffers).set({ answer, answeredAt: at, reason }).where(and(eq(mediatorOffers.id, o.id), isNull(mediatorOffers.answer))).returning({ id: mediatorOffers.id });
    if (!u.length) return;
    await tx.execute(sql`SELECT 1 FROM disputes WHERE id = ${o.disputeId} FOR UPDATE`);
    const [fl] = await tx.insert(mediatorCaseFlags).values({ disputeId: o.disputeId, misses: 1 })
      .onConflictDoUpdate({ target: mediatorCaseFlags.disputeId, set: { misses: sql`${mediatorCaseFlags.misses} + 1`, updatedAt: new Date() } }).returning({ misses: mediatorCaseFlags.misses });
    await audit(tx, a, answer === "DECLINED" ? "mediator.offer_declined" : "mediator.offer_expired", o.disputeId, { mediatorId: o.mediatorId, attempt: o.attempt, misses: fl.misses, ...(reason ? { reason: reason.slice(0, 300) } : {}) });
    const [d] = await tx.select({ state: disputes.state, mediatorId: disputes.mediatorId }).from(disputes).where(eq(disputes.id, o.disputeId));
    const [v] = await tx.select({ id: verdicts.id }).from(verdicts).where(eq(verdicts.disputeId, o.disputeId)).limit(1);
    if (d?.state !== "TIER3" || v) return;
    if (d.mediatorId === o.mediatorId) await tx.update(disputes).set({ mediatorId: null }).where(eq(disputes.id, o.disputeId));
    if (fl.misses >= MAX_MISSES) { await toOpsQueue(tx, SYSTEM, o.disputeId, at, `${fl.misses} offers declined or expired.`); return; }
    const plan = await planRoute(o.disputeId, at, tx);
    if (plan.mediatorId) await tx.update(disputes).set({ mediatorId: plan.mediatorId }).where(and(eq(disputes.id, o.disputeId), isNull(disputes.mediatorId)));
    await recordOffer(tx, SYSTEM, plan);
    next = plan.mediatorId;
  });
  return { next };
}

/** Expire every open offer whose time has passed (run from the dispute timer sweep and on every case read). */
export async function sweepOffers(opts: { disputeId?: string; workspaceId?: string; now?: Date } = {}): Promise<{ disputeId: string; action: string }[]> {
  const conds = [isNull(mediatorOffers.answer)];
  if (opts.disputeId) conds.push(eq(mediatorOffers.disputeId, opts.disputeId));
  if (opts.workspaceId) conds.push(eq(wsMilestones.workspaceId, opts.workspaceId));
  const open = await db.select({ o: mediatorOffers, ws: wsMilestones.workspaceId }).from(mediatorOffers)
    .innerJoin(disputes, eq(disputes.id, mediatorOffers.disputeId)).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).where(and(...conds));
  const out: { disputeId: string; action: string }[] = [];
  for (const { o, ws } of open) {
    const t = opts.now ?? (await workspaceNow(ws));
    if (t < o.expiresAt) continue;
    const r = await closeAndNext(o, t, "EXPIRED", null, SYSTEM);
    out.push({ disputeId: o.disputeId, action: `offer to ${o.mediatorId} expired → ${r.next ?? "Ops lead queue"}` });
  }
  return out;
}

async function offerFor(a: Actor, offerId: string) {
  if (a.role !== "mediator") throw new DomainError("FORBIDDEN", "Only mediators answer case offers.");
  const [r] = await db.select({ o: mediatorOffers, ws: wsMilestones.workspaceId }).from(mediatorOffers).innerJoin(disputes, eq(disputes.id, mediatorOffers.disputeId))
    .innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).where(eq(mediatorOffers.id, offerId)).limit(1);
  if (!r || r.o.mediatorId !== a.id) throw new DomainError("NOT_FOUND", "This offer is not yours.");
  if (r.o.answer) throw new DomainError("OFFER_CLOSED", `This offer is already ${r.o.answer.toLowerCase()}.`);
  const now = await workspaceNow(r.ws);
  if (now >= r.o.expiresAt) { await closeAndNext(r.o, now, "EXPIRED", null, SYSTEM); throw new DomainError("OFFER_EXPIRED", "This offer ran out of time, so the case went to the next mediator."); }
  return { ...r, now };
}

export async function acceptOffer(a: Actor, offerId: string): Promise<string> {
  const { o, now } = await offerFor(a, offerId);
  await db.transaction(async (tx) => {
    const u = await tx.update(mediatorOffers).set({ answer: "ACCEPTED", answeredAt: now }).where(and(eq(mediatorOffers.id, o.id), isNull(mediatorOffers.answer))).returning({ id: mediatorOffers.id });
    if (!u.length) throw new DomainError("OFFER_CLOSED", "This offer was answered a moment ago.");
    const d = await tx.update(disputes).set({ mediatorId: a.id }).where(and(eq(disputes.id, o.disputeId), eq(disputes.state, "TIER3"), sql`(${disputes.mediatorId} IS NULL OR ${disputes.mediatorId} = ${a.id})`)).returning({ id: disputes.id });
    if (!d.length) throw new DomainError("OFFER_CLOSED", "The case moved on while you were answering.");
    await audit(tx, a, "mediator.offer_accepted", o.disputeId, { offerId: o.id, attempt: o.attempt });
  });
  return o.disputeId;
}

const DeclineInput = z.object({ reason: z.string().trim().min(3, "Say why in a few words (3 characters or more).").max(300) });
export async function declineOffer(a: Actor, offerId: string, reason: string): Promise<{ next: string | null }> {
  const input = parse(DeclineInput, { reason });
  const { o, now } = await offerFor(a, offerId);
  return closeAndNext(o, now, "DECLINED", input.reason, a);
}

/** Ops lead assigns a case from the queue to an eligible mediator; the mediator still accepts within the offer window. */
export async function opsAssign(a: Actor, disputeId: string, mediatorId: string): Promise<void> {
  if (!can(a.role, "mediator.verify")) throw new DomainError("FORBIDDEN", "Only Ops can assign cases.");
  const r = await caseRow(disputeId);
  if (r.d.state !== "TIER3") throw new DomainError("NOT_TIER3", "Only a sealed case (Tier 3) can be assigned.");
  const [v] = await db.select({ id: verdicts.id }).from(verdicts).where(eq(verdicts.disputeId, disputeId)).limit(1);
  if (v) throw new DomainError("VERDICT_EXISTS", "This case already has a verdict.");
  const now = await workspaceNow(r.w.id);
  const { mode, cands } = await loadCandidates(r.w.orgId, now);
  const k = await caseInput(r, now, db, [], RT.WITH_PROBATION);
  const ranking = RT.rankMediators(cands, k);
  const i = ranking.ranked.findIndex((x) => x.id === mediatorId);
  if (i < 0) {
    const why = ranking.excluded.find((x) => x.id === mediatorId)?.reasons ?? [];
    throw new DomainError("NOT_ELIGIBLE", why.length ? `This mediator cannot take the case: ${why.map((x) => RT.EXCLUSION_LABEL[x]).join(", ")}.` : "This person is not a mediator in the network.");
  }
  const prior = await db.select({ n: sql<number>`count(*)::int` }).from(mediatorOffers).where(eq(mediatorOffers.disputeId, disputeId));
  const plan: RoutePlan = { disputeId, mediatorId, attempt: (prior[0]?.n ?? 0) + 1, offeredAt: now, expiresAt: new Date(now.getTime() + (r.meta?.fastTrack ? FAST_OFFER_MINUTES : OFFER_MINUTES) * 60_000), breakdown: RT.breakdownFor(ranking, i, k, mode), mode, excluded: ranking.excluded };
  await db.transaction(async (tx) => {
    const u = await tx.update(disputes).set({ mediatorId }).where(and(eq(disputes.id, disputeId), eq(disputes.state, "TIER3"))).returning({ id: disputes.id });
    if (!u.length) throw new DomainError("NOT_TIER3", "The case moved on.");
    await tx.update(mediatorOffers).set({ answer: "EXPIRED", answeredAt: now, reason: "Replaced by an Ops assignment" }).where(and(eq(mediatorOffers.disputeId, disputeId), isNull(mediatorOffers.answer), ne(mediatorOffers.mediatorId, mediatorId)));
    await recordOffer(tx, a, plan, "OPS");
  });
}

/**
 * A mediator taking an unassigned sealed case (issueVerdict). Network: they must pass the router's eligibility.
 * Legacy pool: the 180-day conflict check only. Throws COI or NOT_ELIGIBLE; returns the plan to record as a SELF offer.
 */
export async function takeCheck(a: Actor, disputeId: string, now: Date): Promise<RoutePlan> {
  const r = await caseRow(disputeId);
  const { mode, cands } = await loadCandidates(r.w.orgId, now);
  const k = await caseInput(r, now, db, [], RT.WITH_PROBATION);
  const ranking = RT.rankMediators(cands, k);
  const i = ranking.ranked.findIndex((x) => x.id === a.id);
  if (i < 0) {
    const why = ranking.excluded.find((x) => x.id === a.id)?.reasons ?? (mode === "network" ? ["STATUS" as const] : []);
    if (why.some((x) => x === "COI_HISTORY" || x === "COI_DECLARED" || x === "SAME_FIRM" || x === "IS_PARTY"))
      throw new DomainError("COI", "You mediated a case with one of these parties in the last 180 days, declared a conflict, or share a firm with a party, so you cannot take this one.");
    throw new DomainError("NOT_ELIGIBLE", `You cannot take this case: ${why.map((x) => RT.EXCLUSION_LABEL[x]).join(", ") || "not eligible"}.`);
  }
  const prior = await db.select({ n: sql<number>`count(*)::int` }).from(mediatorOffers).where(eq(mediatorOffers.disputeId, disputeId));
  return { disputeId, mediatorId: a.id, attempt: (prior[0]?.n ?? 0) + 1, offeredAt: now, expiresAt: now, breakdown: RT.breakdownFor(ranking, i, k, mode), mode, excluded: ranking.excluded };
}

/* ───────────── verdict, co-sign, resolution hooks (F4.06) ───────────── */

async function profileOf(userId: string | null | undefined, q: Q = db) {
  if (!userId) return null;
  const [p] = await q.select().from(mediatorProfiles).where(eq(mediatorProfiles.userId, userId)).limit(1);
  return p ?? null;
}

/** Called inside issueVerdict's transaction: decides who must co-sign, counts the verdict, records the mediator fee. */
export async function onVerdictSigned(tx: Tx, a: Actor, c: { disputeId: string; orgId: string; amountCents: number; highValueAboveCents: number }, verdictId: string): Promise<MR.CosignReason[]> {
  const network = await networkMode(c.orgId, tx);
  const prof = a.role === "mediator" ? await profileOf(a.id, tx) : null;
  const reasons = MR.cosignReasons(c.amountCents, c.highValueAboveCents, network && prof ? { status: prof.status, verdictCount: prof.verdictCount } : null);
  await bumpFlags(tx, c.disputeId, { verdictId, cosignReasons: reasons, signerTier: a.role === "judge" ? "JUDGE" : prof?.status ?? "UNLISTED" });
  await tx.update(mediatorOffers).set({ answer: "ACCEPTED", answeredAt: new Date(), reason: "Accepted by signing the verdict" }).where(and(eq(mediatorOffers.disputeId, c.disputeId), eq(mediatorOffers.mediatorId, a.id), isNull(mediatorOffers.answer)));
  if (a.role === "mediator") {
    if (prof) await tx.update(mediatorProfiles).set({ verdictCount: sql`${mediatorProfiles.verdictCount} + 1`, updatedAt: new Date() }).where(eq(mediatorProfiles.userId, a.id));
    const tier = MR.feeTier(prof?.status);
    const fee = await tx.insert(mediatorFees).values({ id: newId("mfe"), disputeId: c.disputeId, mediatorId: a.id, verdictId, role: "VERDICT", tier, amountCents: MR.MEDIATOR_FEE_CENTS[tier], basis: `Flat ${tier.toLowerCase()} verdict fee, paid by PaySettle from its fee income` }).onConflictDoNothing().returning({ id: mediatorFees.id });
    if (fee.length) await audit(tx, a, "mediator.fee_accrued", c.disputeId, { feeId: fee[0].id, role: "VERDICT", tier, amountCents: MR.MEDIATOR_FEE_CENTS[tier] });
  }
  if (reasons.length) await audit(tx, a, "mediator.cosign_required", c.disputeId, { verdictId, reasons });
  return reasons;
}

/** Why each dispute's verdict needs a co-signature (stored at signing; older verdicts fall back to the $5,000 rule). */
export async function cosignReasonsFor(rows: { disputeId: string; amountCents: number; origin: string }[], highValueAboveCents: number): Promise<Map<string, MR.CosignReason[]>> {
  const out = new Map<string, MR.CosignReason[]>();
  if (!rows.length) return out;
  const flags = await db.select({ id: mediatorCaseFlags.disputeId, r: mediatorCaseFlags.cosignReasons, v: mediatorCaseFlags.verdictId }).from(mediatorCaseFlags).where(inArray(mediatorCaseFlags.disputeId, rows.map((x) => x.disputeId)));
  for (const x of rows) {
    if (x.origin !== "TIER3") { out.set(x.disputeId, []); continue; }
    const f = flags.find((y) => y.id === x.disputeId && y.v);
    out.set(x.disputeId, f ? (f.r as MR.CosignReason[]) : x.amountCents > highValueAboveCents ? ["HIGH_VALUE"] : []);
  }
  return out;
}

/** Network co-sign rules: Senior, another firm, no conflict with either party. Throws a DomainError; no-op outside the network. */
export async function checkCosigner(a: Actor, c: { disputeId: string; orgId: string; clientId: string; providerId: string | null; signerId: string | null }, now: Date): Promise<void> {
  if (a.role !== "mediator" || !(await networkMode(c.orgId))) return;
  const [co, signer] = await Promise.all([profileOf(a.id), profileOf(c.signerId)]);
  const p = MR.cosignerProblem(co, signer);
  if (p) throw new DomainError(p.code, p.message);
  const parties = await partiesOf(c);
  const k: RT.CaseInput = { blueprintCode: "", parties, history: await coiHistory(c.disputeId), now };
  const cand = (await loadCandidates(c.orgId, now)).cands.find((x) => x.id === a.id);
  const why = cand ? RT.exclusions(cand, k, RT.conflicted(k.history, parties.map((x) => x.id), now)) : [];
  if (why.some((x) => x === "COI_HISTORY" || x === "COI_DECLARED" || x === "SAME_FIRM" || x === "IS_PARTY"))
    throw new DomainError("COI", "You mediated a case with one of these parties in the last 180 days, declared a conflict, or share a firm with a party, so you cannot co-sign this one.");
}

/** Called inside cosignVerdict's transaction: co-sign fee, and the end of probation after 5 co-signed verdicts. */
export async function onCosigned(tx: Tx, a: Actor, disputeId: string, verdictId: string, signerId: string | null): Promise<void> {
  if (a.role === "mediator") {
    const co = await profileOf(a.id, tx);
    const fee = await tx.insert(mediatorFees).values({ id: newId("mfe"), disputeId, mediatorId: a.id, verdictId, role: "COSIGN", tier: MR.feeTier(co?.status), amountCents: MR.COSIGN_FEE_CENTS, basis: "Flat co-signature fee, paid by PaySettle from its fee income" }).onConflictDoNothing().returning({ id: mediatorFees.id });
    if (fee.length) await audit(tx, a, "mediator.fee_accrued", disputeId, { feeId: fee[0].id, role: "COSIGN", amountCents: MR.COSIGN_FEE_CENTS });
  }
  const signer = await profileOf(signerId, tx);
  if (signer?.status !== "PROBATION") return;
  const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(mediatorCaseFlags).innerJoin(verdicts, eq(verdicts.id, mediatorCaseFlags.verdictId))
    .where(and(eq(verdicts.mediatorId, signer.userId), isNotNull(verdicts.cosignerId), sql`'PROBATION' = ANY(${mediatorCaseFlags.cosignReasons})`));
  if ((n?.n ?? 0) >= MR.PROBATION_COSIGNS) {
    await tx.update(mediatorProfiles).set({ status: "ACTIVE", updatedAt: new Date() }).where(and(eq(mediatorProfiles.userId, signer.userId), eq(mediatorProfiles.status, "PROBATION")));
    await audit(tx, SYSTEM, "mediator.status", signer.userId, { from: "PROBATION", to: "ACTIVE", why: `${n.n} co-signed verdicts` });
  }
}

/** Called when a dispute resolves: the random 5% second review flag on Tier 3 verdicts. */
export async function onResolved(disputeId: string): Promise<void> {
  const [v] = await db.select().from(verdicts).where(eq(verdicts.disputeId, disputeId)).limit(1);
  if (!v || v.origin !== "TIER3") return;
  const picked = MR.secondReviewPicked(v.signature);
  await bumpFlags(db, disputeId, { verdictId: v.id, secondReview: picked });
  if (picked) await audit(db, SYSTEM, "mediator.second_review_flagged", disputeId, { verdictId: v.id });
}

/* ───────────── ratings after settlement ───────────── */

const ReviewInput = z.object({ score: z.number().int().min(1, "Pick 1 to 5 stars.").max(5, "Pick 1 to 5 stars."), comment: z.string().trim().max(1000).default("") });
export async function submitReview(a: Actor, disputeId: string, score: number, comment: string): Promise<void> {
  const input = parse(ReviewInput, { score, comment });
  const r = await caseRow(disputeId);
  const role = a.id === r.w.clientId && a.role === "client" ? "client" : a.id === r.w.providerId && a.role === "provider" ? "provider" : null;
  if (!role) throw new DomainError("NOT_PARTY", "Only the two parties can rate the mediator.");
  if (r.d.state !== "RESOLVED") throw new DomainError("NOT_SETTLED", "You can rate the mediator once the case is settled.");
  const [v] = await db.select().from(verdicts).where(eq(verdicts.disputeId, disputeId)).limit(1);
  if (!v || v.origin !== "TIER3" || !v.mediatorId) throw new DomainError("NO_MEDIATOR", "This case was settled by agreement, without a mediator.");
  await db.transaction(async (tx) => {
    const ins = await tx.insert(mediatorReviews).values({ id: newId("mrv"), disputeId, mediatorId: v.mediatorId!, raterId: a.id, raterRole: role, score: input.score, comment: input.comment }).onConflictDoNothing().returning({ id: mediatorReviews.id });
    if (!ins.length) throw new DomainError("ALREADY_RATED", "You already rated this mediator for this case.");
    await audit(tx, a, "mediator.review", disputeId, { mediatorId: v.mediatorId, score: input.score });
  });
}

/* ───────────── the mediator's own profile ───────────── */

async function requireProfile(a: Actor) {
  if (a.role !== "mediator") throw new DomainError("FORBIDDEN", "This is for mediators.");
  const p = await profileOf(a.id);
  if (!p) throw new DomainError("NO_PROFILE", "You do not have a network profile yet. Ops creates it when your application is approved.");
  return p;
}
const tzOk = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
const ProfileInput = z.object({
  bio: z.string().trim().max(1200),
  languages: z.array(z.string()).transform((l) => [...new Set(l.filter((x) => x in MR.LANGUAGES))]).pipe(z.array(z.string()).min(1, "Keep at least one language.")),
  timezone: z.string().trim().refine(tzOk, "Pick a time zone from the list."),
  maxOpen: z.number().int().min(1, "At least 1 open case.").max(12, "At most 12 open cases."),
  declaredConflicts: z.array(z.string().trim().max(160)).max(50),
});
export async function updateProfile(a: Actor, input: { bio: string; languages: string[]; timezone: string; maxOpen: number; declaredConflicts: string[] }): Promise<void> {
  await requireProfile(a);
  const v = parse(ProfileInput, input);
  await db.transaction(async (tx) => {
    await tx.update(mediatorProfiles).set({ ...v, declaredConflicts: v.declaredConflicts.filter(Boolean), updatedAt: new Date() }).where(eq(mediatorProfiles.userId, a.id));
    await audit(tx, a, "mediator.profile", a.id, { languages: v.languages, timezone: v.timezone, maxOpen: v.maxOpen, conflicts: v.declaredConflicts.filter(Boolean).length });
  });
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-24.");
const AvailInput = z.object({ weeklyHours: z.number().int().min(0, "0 to 60 hours.").max(60, "0 to 60 hours."), leaveFrom: isoDate.nullable(), leaveTo: isoDate.nullable(), paused: z.boolean() })
  .refine((x) => (!x.leaveFrom && !x.leaveTo) || (x.leaveFrom && x.leaveTo && x.leaveFrom <= x.leaveTo), "Leave needs a start and an end, and the end cannot be before the start.");
export async function setAvailability(a: Actor, input: { weeklyHours: number; leaveFrom: string | null; leaveTo: string | null; paused: boolean }): Promise<void> {
  await requireProfile(a);
  const v = parse(AvailInput, input);
  await db.transaction(async (tx) => {
    await tx.insert(mediatorAvailability).values({ userId: a.id, ...v }).onConflictDoUpdate({ target: mediatorAvailability.userId, set: { ...v, updatedAt: new Date() } });
    await audit(tx, a, "mediator.availability", a.id, v);
  });
}

const CredInput = z.object({
  type: z.string().trim().min(2, "Name the credential type.").max(80),
  issuer: z.string().trim().min(2, "Name the issuer.").max(120),
  number: z.string().trim().min(3, "Enter the licence or member number.").max(60),
  expiresOn: isoDate.nullable(),
});
const CRED_TYPES = ["application/pdf", "image/png", "image/jpeg"];
/** Add a credential. The file goes to the evidence store under its SHA-256; only the hash and a masked number are kept here (P11). */
export async function addCredential(a: Actor, input: { type: string; issuer: string; number: string; expiresOn: string | null }, file?: { name: string; type: string; bytes: Buffer }): Promise<string> {
  await requireProfile(a);
  const v = parse(CredInput, input);
  let fileSha: string | null = null, fileName: string | null = null;
  if (file && file.bytes.length > 0) {
    if (file.bytes.length > 5 * 1024 * 1024) throw new DomainError("BAD_INPUT", "Files must be 5 MB or smaller.");
    if (!CRED_TYPES.includes(file.type)) throw new DomainError("BAD_INPUT", "Upload a PDF, PNG or JPEG file.");
    fileSha = sha256(file.bytes);
    fileName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "credential";
    await objectStore().putObject(fileSha, file.bytes);
  }
  const id = newId("mcr");
  await db.transaction(async (tx) => {
    await tx.insert(mediatorCredentials).values({ id, userId: a.id, type: v.type, issuer: v.issuer, numberMasked: MR.maskNumber(v.number), expiresOn: v.expiresOn, fileSha256: fileSha, fileName });
    await audit(tx, a, "mediator.credential_added", a.id, { credentialId: id, type: v.type, fileSha256: fileSha });
  });
  return id;
}

/** Answer the three sealed calibration cases. All within 10 points with the right root cause → probation. */
export async function submitCalibration(a: Actor, answers: MR.CalibrationAnswer[]): Promise<{ passed: boolean; scorePct: number; attempt: number; attemptsLeft: number }> {
  const p = await requireProfile(a);
  if (p.status !== "CALIBRATING") throw new DomainError("NOT_CALIBRATING", "Calibration opens once Ops has verified your credentials.");
  if (p.calibrationAttempts >= MR.CALIBRATION_MAX_ATTEMPTS) throw new DomainError("NO_ATTEMPTS", "You have used all three attempts. Ops can reset calibration after a conversation.");
  const roots = Object.keys(ROOT_CAUSES);
  const Ans = z.array(z.object({ caseId: z.enum(MR.CALIBRATION_CASES.map((c) => c.id) as [string, ...string[]]), shareBps: z.number().int().min(0).max(10_000), rootCause: z.string().refine((r) => roots.includes(r), "Pick a root cause.") }))
    .refine((l) => MR.CALIBRATION_CASES.every((c) => l.filter((x) => x.caseId === c.id).length === 1), "Answer each of the three cases once.");
  const list = parse(Ans, answers);
  const g = MR.gradeCalibration(list);
  const attempt = p.calibrationAttempts + 1;
  await db.transaction(async (tx) => {
    const u = await tx.update(mediatorProfiles).set({ calibrationAttempts: attempt, calibrationScore: Math.max(p.calibrationScore ?? 0, g.scorePct), ...(g.passed ? { status: "PROBATION" as const } : {}), updatedAt: new Date() })
      .where(and(eq(mediatorProfiles.userId, a.id), eq(mediatorProfiles.calibrationAttempts, p.calibrationAttempts), eq(mediatorProfiles.status, "CALIBRATING"))).returning({ id: mediatorProfiles.userId });
    if (!u.length) throw new DomainError("STALE", "Your calibration changed in another tab. Reload and try again.");
    await tx.insert(mediatorCalibrations).values(g.results.map((r) => { const x = list.find((y) => y.caseId === r.caseId)!; return { id: newId("mcal"), userId: a.id, attempt, caseId: r.caseId, shareBps: x.shareBps, rootCause: x.rootCause, withinPoints: r.withinPoints, rootOk: r.rootOk, passed: r.passed }; }));
    await audit(tx, a, "mediator.calibration", a.id, { attempt, scorePct: g.scorePct, passed: g.passed });
    if (g.passed) await audit(tx, SYSTEM, "mediator.status", a.id, { from: "CALIBRATING", to: "PROBATION", why: "calibration passed" });
  });
  return { passed: g.passed, scorePct: g.scorePct, attempt, attemptsLeft: MR.CALIBRATION_MAX_ATTEMPTS - attempt };
}

/* ───────────── Ops: applications, credentials, status, second review ───────────── */

function requireOps(a: Actor) { if (!can(a.role, "mediator.verify")) throw new DomainError("FORBIDDEN", "Only Ops can manage the mediator network."); }
const conflictList = (text: string) => text.split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s.length >= 2).slice(0, 50);

export async function decideApplication(a: Actor, orgId: string, applicationId: string, decision: "APPROVE" | "REJECT", note: string): Promise<{ userId: string | null }> {
  requireOps(a);
  const n = parse(z.string().trim().max(500), note);
  const [app] = await db.select().from(mediatorApplications).where(eq(mediatorApplications.id, applicationId)).limit(1);
  if (!app) throw new DomainError("NOT_FOUND", "This application does not exist.");
  if (app.status !== "NEW") throw new DomainError("DECIDED", `This application is already ${app.status.toLowerCase()}.`);
  let userId: string | null = null;
  await db.transaction(async (tx) => {
    const u = await tx.update(mediatorApplications).set({ status: decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedBy: a.id, decidedAt: new Date(), note: n || null }).where(and(eq(mediatorApplications.id, app.id), eq(mediatorApplications.status, "NEW"))).returning({ id: mediatorApplications.id });
    if (!u.length) throw new DomainError("DECIDED", "Someone decided this application a moment ago.");
    if (decision === "APPROVE") {
      const [existing] = await tx.select().from(users).where(eq(users.email, app.email)).limit(1);
      if (existing && existing.role !== "mediator") throw new DomainError("EMAIL_IN_USE", "This e-mail belongs to an account with another role. Ask the applicant for a separate address.");
      userId = existing?.id ?? newId("u_medapp");
      if (!existing) await tx.insert(users).values({ id: userId, orgId, email: app.email, name: app.name, role: "mediator", tier: "new", onboardingState: "INVITED", profile: { timezone: app.timezone, languages: app.languages } });
      const [had] = await tx.select({ id: mediatorProfiles.userId }).from(mediatorProfiles).where(eq(mediatorProfiles.userId, userId)).limit(1);
      if (!had) await tx.insert(mediatorProfiles).values({ userId, orgId: existing?.orgId ?? orgId, status: "VERIFYING", domains: app.domains, languages: app.languages, timezone: app.timezone, firm: app.firm, maxOpen: Math.max(1, Math.min(8, Math.ceil(app.weeklyHours / 5))), declaredConflicts: conflictList(app.conflicts), bio: "" });
      await tx.insert(mediatorAvailability).values({ userId, weeklyHours: app.weeklyHours }).onConflictDoNothing();
      await tx.update(mediatorApplications).set({ userId }).where(eq(mediatorApplications.id, app.id));
    }
    await audit(tx, a, decision === "APPROVE" ? "mediator.application_approved" : "mediator.application_rejected", `mediator_application:${app.id}`, { userId });
  });
  return { userId };
}

export async function verifyCredential(a: Actor, credentialId: string, decision: "VERIFIED" | "REJECTED", note: string): Promise<void> {
  requireOps(a);
  const n = parse(z.string().trim().max(300), note);
  if (decision === "REJECTED" && n.length < 3) throw new DomainError("BAD_INPUT", "Say why the credential is rejected.");
  const [c] = await db.select().from(mediatorCredentials).where(eq(mediatorCredentials.id, credentialId)).limit(1);
  if (!c) throw new DomainError("NOT_FOUND", "This credential does not exist.");
  if (c.userId === a.id) throw new DomainError("SAME_PERSON", "You cannot verify your own credential.");
  await db.transaction(async (tx) => {
    await tx.update(mediatorCredentials).set({ status: decision, verifiedBy: a.id, verifiedAt: new Date(), note: n || null }).where(eq(mediatorCredentials.id, credentialId));
    await audit(tx, a, decision === "VERIFIED" ? "mediator.credential_verified" : "mediator.credential_rejected", c.userId, { credentialId, expiresOn: c.expiresOn });
  });
}

export async function moveStatus(a: Actor, userId: string, to: string, note: string): Promise<void> {
  requireOps(a);
  const target = parse(z.enum(MEDIATOR_STATUSES), to);
  const n = parse(z.string().trim().max(300), note);
  const p = await profileOf(userId);
  if (!p) throw new DomainError("NOT_FOUND", "No network profile for this person.");
  const today = new Date().toISOString().slice(0, 10);
  const creds = await db.select().from(mediatorCredentials).where(eq(mediatorCredentials.userId, userId));
  const problem = MR.moveProblem(p.status, target, { verifiedCredential: creds.some((c) => c.status === "VERIFIED" && (!c.expiresOn || c.expiresOn >= today)), verdictCount: p.verdictCount, passedCalibration: (p.calibrationScore ?? 0) >= 100 });
  if (problem) throw new DomainError("BAD_MOVE", problem);
  await db.transaction(async (tx) => {
    const u = await tx.update(mediatorProfiles).set({ status: target, updatedAt: new Date() }).where(and(eq(mediatorProfiles.userId, userId), eq(mediatorProfiles.status, p.status))).returning({ id: mediatorProfiles.userId });
    if (!u.length) throw new DomainError("STALE", "The status changed a moment ago. Reload.");
    await audit(tx, a, "mediator.status", userId, { from: p.status, to: target, note: n || null });
  });
}

const NetInput = z.object({ domains: z.array(z.string()).transform(cleanDomains).pipe(z.array(z.string()).min(1, "Keep at least one domain.")), firm: z.string().trim().max(120).nullable(), maxOpen: z.number().int().min(1).max(12) });
export async function setNetworkFields(a: Actor, userId: string, input: { domains: string[]; firm: string | null; maxOpen: number }): Promise<void> {
  requireOps(a);
  const v = parse(NetInput, input);
  if (!(await profileOf(userId))) throw new DomainError("NOT_FOUND", "No network profile for this person.");
  await db.transaction(async (tx) => {
    await tx.update(mediatorProfiles).set({ domains: v.domains, firm: v.firm || null, maxOpen: v.maxOpen, updatedAt: new Date() }).where(eq(mediatorProfiles.userId, userId));
    await audit(tx, a, "mediator.network_fields", userId, { domains: v.domains, firm: v.firm || null, maxOpen: v.maxOpen });
  });
}

export async function recordSecondReview(a: Actor, disputeId: string, outcome: "AGREE" | "DISAGREE", reviewerId: string, note: string): Promise<void> {
  requireOps(a);
  const n = parse(z.string().trim().min(10, "Write what the reviewer found (10 characters or more).").max(1000), note);
  const [f] = await db.select().from(mediatorCaseFlags).where(eq(mediatorCaseFlags.disputeId, disputeId)).limit(1);
  if (!f?.secondReview) throw new DomainError("NOT_FLAGGED", "This verdict was not picked for a second review.");
  if (f.secondReviewOutcome) throw new DomainError("DONE", "The second review is already recorded.");
  const [v] = await db.select().from(verdicts).where(eq(verdicts.disputeId, disputeId)).limit(1);
  const rev = await profileOf(reviewerId);
  if (!rev || rev.status !== "SENIOR") throw new DomainError("NOT_SENIOR", "A second review is done by a Senior mediator.");
  if (v && (v.mediatorId === reviewerId || v.cosignerId === reviewerId)) throw new DomainError("SAME_PERSON", "The reviewer must not have signed or co-signed this verdict.");
  await db.transaction(async (tx) => {
    await tx.update(mediatorCaseFlags).set({ secondReviewOutcome: outcome, secondReviewerId: reviewerId, secondReviewNote: n, secondReviewAt: new Date(), updatedAt: new Date() }).where(eq(mediatorCaseFlags.disputeId, disputeId));
    await audit(tx, a, "mediator.second_review", disputeId, { outcome, reviewerId });
  });
}

/** Finance marks a mediator fee as paid (PaySettle pays it from its own fee income, outside any PayPal hold). */
export async function markFeePaid(a: Actor, feeId: string): Promise<void> {
  if (!can(a.role, "fee.configure")) throw new DomainError("FORBIDDEN", "Only Finance marks mediator fees as paid.");
  await db.transaction(async (tx) => {
    const u = await tx.update(mediatorFees).set({ status: "PAID" }).where(and(eq(mediatorFees.id, feeId), eq(mediatorFees.status, "ACCRUED"))).returning({ id: mediatorFees.id, cents: mediatorFees.amountCents });
    if (!u.length) throw new DomainError("NOT_FOUND", "This fee is not waiting to be paid.");
    await audit(tx, a, "mediator.fee_paid", feeId, { amountCents: u[0].cents });
  });
}

/* ───────────── public application ───────────── */

const g = globalThis as unknown as { __psMediatorApplyLimit?: ReturnType<typeof fixedWindow> };
export const applyLimiter = (g.__psMediatorApplyLimit ??= fixedWindow(5, 10 * 60_000));
export type ApplyResult = { ok: true; code: "received" | "already" } | { ok: false; code: "invalid"; errors: Partial<Record<MR.ApplicationField, string>> } | { ok: false; code: "limit"; retryAfterS: number };

/** Public form: zod, honeypot, 5 posts per address per 10 minutes. The audit row carries no personal data. */
export async function submitApplication(input: Record<string, unknown>, ipKey: string, nowMs = Date.now()): Promise<ApplyResult> {
  const gate = applyLimiter.hit(`apply:${ipKey}`, nowMs);
  if (!gate.ok) return { ok: false, code: "limit", retryAfterS: gate.retryAfterS };
  const read = MR.readApplication(input);
  if (!read.ok) return { ok: false, code: "invalid", errors: read.errors };
  if (read.robot) return { ok: true, code: "received" };
  const d = read.data;
  const [dup] = await db.select({ id: mediatorApplications.id }).from(mediatorApplications).where(and(eq(mediatorApplications.email, d.email), eq(mediatorApplications.status, "NEW"))).limit(1);
  if (dup) return { ok: true, code: "already" };
  const id = newId("mapp");
  await db.insert(mediatorApplications).values({ id, name: d.name, email: d.email, domains: d.domains, languages: d.languages, timezone: d.timezone, firm: d.firm ?? null, credentials: d.credentials, conflicts: d.conflicts, weeklyHours: d.weeklyHours });
  await audit(db, { id: null, role: "public" }, "mediator.application", `mediator_application:${id}`, { domains: d.domains.length, languages: d.languages.length });
  return { ok: true, code: "received" };
}

/* ───────────── read models ───────────── */

export type Offer = typeof mediatorOffers.$inferSelect;
/** Offers, flags and the current assignment's breakdown for one dispute ("why this mediator"). */
export async function assignmentOf(disputeId: string) {
  const [offers, [flags]] = await Promise.all([
    db.select().from(mediatorOffers).where(eq(mediatorOffers.disputeId, disputeId)).orderBy(asc(mediatorOffers.attempt)),
    db.select().from(mediatorCaseFlags).where(eq(mediatorCaseFlags.disputeId, disputeId)).limit(1),
  ]);
  const ids = [...new Set(offers.flatMap((o) => [o.mediatorId, ...((o.breakdown as unknown as RT.ScoreBreakdown).runnersUp ?? []).map((r) => r.id), ...((o.breakdown as unknown as RT.ScoreBreakdown).excluded ?? []).map((r) => r.id)]))];
  const nm = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  const current = [...offers].reverse().find((o) => o.answer === null || o.answer === "ACCEPTED") ?? null;
  return { offers, flags: flags ?? null, current, breakdown: current ? (current.breakdown as unknown as RT.ScoreBreakdown) : null, names: Object.fromEntries(nm.map((n) => [n.id, n.name])) as Record<string, string> };
}
export type Assignment = Awaited<ReturnType<typeof assignmentOf>>;

/** Open offers for one mediator (case queue). */
export async function openOffersFor(userId: string) {
  return db.select({ o: mediatorOffers, d: disputes, m: wsMilestones, w: workspaces }).from(mediatorOffers)
    .innerJoin(disputes, eq(disputes.id, mediatorOffers.disputeId)).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .where(and(eq(mediatorOffers.mediatorId, userId), isNull(mediatorOffers.answer), sql`not ${isSimWorkspaceSql(workspaces.id)}`)).orderBy(asc(mediatorOffers.expiresAt));
}

export async function reviewsFor(disputeId: string) {
  return db.select().from(mediatorReviews).where(eq(mediatorReviews.disputeId, disputeId));
}
export async function feesFor(disputeId: string) {
  return db.select().from(mediatorFees).where(eq(mediatorFees.disputeId, disputeId)).orderBy(asc(mediatorFees.createdAt));
}

/** One mediator's scorecard numbers (also used on the profile page). */
function scorecard(c: RT.Candidate | undefined, verdictCount: number) {
  return {
    verdicts: verdictCount, open: c?.openCases ?? 0, maxOpen: c?.maxOpen ?? 0,
    slaPct: c && c.sla.total ? Math.round((c.sla.onTime * 100) / c.sla.total) : null, slaN: c?.sla.total ?? 0,
    rating: c && c.ratings.count ? c.ratings.sum / c.ratings.count : null, ratingN: c?.ratings.count ?? 0,
    agreePct: c && c.secondReview.agree + c.secondReview.disagree ? Math.round((c.secondReview.agree * 100) / (c.secondReview.agree + c.secondReview.disagree)) : null,
  };
}

export async function myProfile(userId: string, orgId: string) {
  const p = await profileOf(userId);
  if (!p) return null;
  const now = new Date();
  const [creds, [avail], cals, fees, cands] = await Promise.all([
    db.select().from(mediatorCredentials).where(eq(mediatorCredentials.userId, userId)).orderBy(desc(mediatorCredentials.createdAt)),
    db.select().from(mediatorAvailability).where(eq(mediatorAvailability.userId, userId)).limit(1),
    db.select().from(mediatorCalibrations).where(eq(mediatorCalibrations.userId, userId)).orderBy(desc(mediatorCalibrations.attempt)),
    db.select().from(mediatorFees).where(eq(mediatorFees.mediatorId, userId)).orderBy(desc(mediatorFees.createdAt)).limit(20),
    loadCandidates(orgId, now),
  ]);
  const me = cands.cands.find((c) => c.id === userId);
  const attempts = [...new Set(cals.map((c) => c.attempt))].map((n) => ({ attempt: n, passed: cals.filter((c) => c.attempt === n && c.passed).length, of: MR.CALIBRATION_CASES.length }));
  return { profile: p, credentials: creds, availability: avail ?? null, attempts, fees, card: scorecard(me, p.verdictCount), cases: MR.CALIBRATION_CASES.map(MR.publicCase) };
}

/** Everything the Ops mediator page shows. Finance sees the fee list only (the page decides). */
export async function opsNetwork(orgId: string) {
  const now = new Date();
  const [profs, apps, creds, cands, fees, flagged, queue, peopleRows] = await Promise.all([
    db.select().from(mediatorProfiles).where(eq(mediatorProfiles.orgId, orgId)).orderBy(asc(mediatorProfiles.status), asc(mediatorProfiles.userId)),
    db.select().from(mediatorApplications).orderBy(desc(mediatorApplications.createdAt)).limit(50),
    db.select().from(mediatorCredentials).innerJoin(mediatorProfiles, eq(mediatorProfiles.userId, mediatorCredentials.userId)).where(eq(mediatorProfiles.orgId, orgId)).orderBy(asc(mediatorCredentials.status), desc(mediatorCredentials.createdAt)),
    loadCandidates(orgId, now),
    db.select({ f: mediatorFees, w: workspaces.title, cur: workspaces.currency }).from(mediatorFees).innerJoin(disputes, eq(disputes.id, mediatorFees.disputeId)).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId))
      .innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).where(eq(workspaces.orgId, orgId)).orderBy(desc(mediatorFees.createdAt)).limit(100),
    db.select({ f: mediatorCaseFlags, v: verdicts, w: workspaces.title }).from(mediatorCaseFlags).innerJoin(verdicts, eq(verdicts.id, mediatorCaseFlags.verdictId)).innerJoin(disputes, eq(disputes.id, mediatorCaseFlags.disputeId))
      .innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
      .where(and(eq(workspaces.orgId, orgId), eq(mediatorCaseFlags.secondReview, true))).orderBy(desc(mediatorCaseFlags.updatedAt)),
    db.select({ f: mediatorCaseFlags, d: disputes, m: wsMilestones, w: workspaces }).from(mediatorCaseFlags).innerJoin(disputes, eq(disputes.id, mediatorCaseFlags.disputeId))
      .innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
      .where(and(eq(workspaces.orgId, orgId), isNotNull(mediatorCaseFlags.opsQueueAt), isNull(disputes.mediatorId), eq(disputes.state, "TIER3"), sql`not ${isSimWorkspaceSql(workspaces.id)}`)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.orgId, orgId), eq(users.role, "mediator"))),
  ]);
  const people = new Map(peopleRows.map((p) => [p.id, p]));
  const queueWithCands = await Promise.all(queue.map(async (q) => {
    const k = await caseInput({ d: q.d, w: q.w, meta: null }, now, db, [], RT.WITH_PROBATION);
    const r = RT.rankMediators(cands.cands, k);
    return { ...q, eligible: r.ranked.map((x) => ({ id: x.id, total: x.total })) };
  }));
  return {
    profiles: profs.map((p) => ({ ...p, name: people.get(p.userId)?.name ?? p.userId, email: people.get(p.userId)?.email ?? "", card: scorecard(cands.cands.find((c) => c.id === p.userId), p.verdictCount) })),
    applications: apps, credentials: creds.map((c) => ({ ...c.mediator_credentials, name: people.get(c.mediator_credentials.userId)?.name ?? c.mediator_credentials.userId })),
    fees: fees.map((x) => ({ ...x.f, workspace: x.w, currency: x.cur, name: people.get(x.f.mediatorId)?.name ?? x.f.mediatorId })),
    secondReviews: flagged.map((x) => ({ disputeId: x.f.disputeId, workspace: x.w, outcome: x.f.secondReviewOutcome, reviewerId: x.f.secondReviewerId, note: x.f.secondReviewNote, mediatorId: x.v.mediatorId, cosignerId: x.v.cosignerId, shareBps: x.v.providerShareBps, rootCause: x.v.rootCause })),
    queue: queueWithCands, names: Object.fromEntries([...people].map(([id, p]) => [id, p.name])) as Record<string, string>, mode: cands.mode,
  };
}

/** Aggregate numbers for the public page (no names, no personal data). */
export async function publicNetwork() {
  const rows = await db.select({ status: mediatorProfiles.status, domains: mediatorProfiles.domains, timezone: mediatorProfiles.timezone, languages: mediatorProfiles.languages }).from(mediatorProfiles)
    .where(and(inArray(mediatorProfiles.status, ["ACTIVE", "SENIOR", "PROBATION"]), sql`${mediatorProfiles.orgId} !~ '^org_(t[0-9]*|test)_'`));
  return rows;
}

/** What signing would mean for this mediator: who must co-sign and their own fee (workbench preview; the server decides again). */
export async function signerOutlook(userId: string, orgId: string, amountCents: number, highValueAboveCents: number) {
  const [network, prof] = await Promise.all([networkMode(orgId), profileOf(userId)]);
  const reasons = MR.cosignReasons(amountCents, highValueAboveCents, network && prof ? { status: prof.status, verdictCount: prof.verdictCount } : null);
  const tier = MR.feeTier(prof?.status);
  return { network, status: prof?.status ?? null, firm: prof?.firm ?? null, reasons, fee: { cents: MR.MEDIATOR_FEE_CENTS[tier], tier }, cosignFeeCents: MR.COSIGN_FEE_CENTS };
}
