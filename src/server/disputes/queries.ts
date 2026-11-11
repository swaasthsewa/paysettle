/**
 * Read models for the screens. F4.01 freeze view, F4.02 own bids only (sealed), F4.03 vault,
 * F4.05 queue without conflicts, F4.06 workbench (clauses, dispute rule, contract diff, AI advice), F4.10 external
 * PayPal disputes when present, F4.12 root-cause counts and the dispute rate per blueprint milestone code.
 * The assignment ("why this mediator" breakdown, offers), co-sign reasons (high value or probation), mediator ratings
 * and fees, and the offer lane of the mediator queue.
 */
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditChain, bids, blueprints, disputes, evidencePackages, rebuttals, revisions, tranches, users, verdicts, webhookEvents, workspaces, wsClauses, wsMilestones } from "@/db/schema";
import { disputeFees, disputeFiles, disputeMeta, disputeRateByCode } from "@/db/schema-disputes";
import type { Viewer } from "@/lib/session";
import { excludeSim, isTestOrgId } from "@/lib/sim";
import { workspaceNow } from "../clock";
import { advanceDispute } from "./index";
import * as R from "./rules";
import * as MED from "../mediators";
import { mediatorProfiles } from "@/db/schema-mediators";

const OPEN = ["TIER1", "AGREED", "TIER2", "TIER3", "EXECUTING"];
/** Lists leave out playground simulations (and test organisations unless the viewer is in one). Opening a case by id still works. */
const real = (v: Pick<Viewer, "orgId">) => excludeSim(workspaces.id, workspaces.orgId, { keepTest: isTestOrgId(v.orgId) });

export function nextDeadline(d: { state: string; tier1Until: Date; vaultUntil: Date }, tier3Until: Date | null) {
  if (d.state === "TIER1") return { label: "Sealed offers close", at: d.tier1Until };
  if (d.state === "TIER2") return { label: "Vault seals", at: d.vaultUntil };
  if (d.state === "TIER3" && tier3Until) return { label: "Verdict due", at: tier3Until };
  return null;
}

async function names(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Disputes the viewer is a party to (client or provider); everything in the org for ops, admin and the judge. */
export async function listDisputes(v: Viewer) {
  const base = db.select({ d: disputes, m: wsMilestones, w: workspaces, meta: disputeMeta }).from(disputes)
    .innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .leftJoin(disputeMeta, eq(disputeMeta.disputeId, disputes.id));
  const rows = ["ops", "admin", "judge"].includes(v.role)
    ? await base.where(and(eq(workspaces.orgId, v.orgId), real(v))).orderBy(desc(disputes.createdAt))
    : await base.where(and(or(eq(workspaces.clientId, v.id), eq(workspaces.providerId, v.id)), real(v))).orderBy(desc(disputes.createdAt));
  for (const r of rows) if (r.d.state === "TIER1" || r.d.state === "TIER2") { try { r.d.state = await advanceDispute(r.d.id); } catch { /* shown as is */ } }
  const vs = rows.length ? await db.select().from(verdicts).where(inArray(verdicts.disputeId, rows.map((r) => r.d.id))) : [];
  const nm = await names(rows.flatMap((r) => [r.w.clientId, r.w.providerId]));
  const clocks = new Map<string, Date>();
  for (const r of rows) if (!clocks.has(r.w.id)) clocks.set(r.w.id, await workspaceNow(r.w.id));
  return rows.map((r) => ({
    now: clocks.get(r.w.id)!, id: r.d.id, state: r.d.state, tier: r.d.tier, amountCents: r.d.amountCents, reason: r.d.reason, createdAt: r.d.createdAt, currency: r.w.currency,
    workspace: { id: r.w.id, title: r.w.title }, milestone: { code: r.m.code, title: r.m.title },
    client: nm.get(r.w.clientId) ?? "Client", provider: r.w.providerId ? nm.get(r.w.providerId) ?? "Provider" : "Provider",
    next: nextDeadline(r.d, r.meta?.tier3Until ?? null), verdict: vs.find((x) => x.disputeId === r.d.id) ?? null,
  }));
}

/** Milestones the viewer could dispute now (proof submitted, not yet disputed). */
export async function disputable(v: Viewer) {
  if (v.role !== "client" && v.role !== "provider") return [];
  const rows = await db.select({ m: wsMilestones, w: workspaces, d: disputes.id }).from(wsMilestones)
    .innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).leftJoin(disputes, eq(disputes.milestoneId, wsMilestones.id))
    .where(and(inArray(wsMilestones.state, [...R.DISPUTABLE_STATES]), v.role === "client" ? eq(workspaces.clientId, v.id) : eq(workspaces.providerId, v.id), isNull(disputes.id), real(v)))
    .orderBy(asc(workspaces.title), asc(wsMilestones.seq));
  return rows.map((r) => ({ id: r.m.id, code: r.m.code, title: r.m.title, state: r.m.state, amountCents: r.m.amountCents, currency: r.w.currency, workspace: { id: r.w.id, title: r.w.title } }));
}

export async function milestoneForDispute(v: Viewer, milestoneId: string) {
  const [r] = await db.select({ m: wsMilestones, w: workspaces }).from(wsMilestones).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).where(eq(wsMilestones.id, milestoneId)).limit(1);
  if (!r) return null;
  const party = r.w.clientId === v.id || r.w.providerId === v.id;
  if (!party && !["ops", "judge"].includes(v.role)) return null;
  const [d] = await db.select({ id: disputes.id }).from(disputes).where(eq(disputes.milestoneId, milestoneId)).limit(1);
  const nm = await names([r.w.clientId, r.w.providerId]);
  const final = ["RELEASED", "SETTLED_BY_VERDICT", "REFUNDED"].includes(r.m.state);
  const open = (R.DISPUTABLE_STATES as readonly string[]).includes(r.m.state);
  const [tr] = await db.select().from(tranches).where(and(eq(tranches.workspaceId, r.w.id), eq(tranches.idx, r.m.trancheIdx))).limit(1);
  const now = await workspaceNow(r.w.id);
  return {
    milestone: { id: r.m.id, code: r.m.code, title: r.m.title, state: r.m.state, amountCents: r.m.amountCents, disputeRule: r.m.disputeRule, criteria: r.m.proof.criteria },
    workspace: { id: r.w.id, title: r.w.title, currency: r.w.currency, client: nm.get(r.w.clientId) ?? "Client", provider: r.w.providerId ? nm.get(r.w.providerId) ?? "Provider" : "Provider" },
    existingDisputeId: d?.id ?? null, final, open, deadlines: R.deadlines(now, tr?.windowEndsAt ?? null), now,
  };
}

export type Access = "party" | "mediator" | "cosigner" | "staff" | null;
function accessFor(v: Viewer, w: { clientId: string; providerId: string | null; orgId: string }, d: { mediatorId: string | null }, cosignOpen: boolean): Access {
  if (v.id === w.clientId || v.id === w.providerId) return "party";
  if (v.role === "mediator" && d.mediatorId === v.id) return "mediator";
  if (v.role === "mediator" && v.orgId === w.orgId && (cosignOpen || !d.mediatorId)) return "cosigner";
  if (["ops", "admin", "judge"].includes(v.role) && v.orgId === w.orgId) return "staff";
  return null;
}

/** Everything the dispute room and the workbench show. Applies passed deadlines first (F4.01 interceptor). */
export async function disputeCase(v: Viewer, id: string) {
  try { await advanceDispute(id); } catch { /* not found handled below */ }
  const [r] = await db.select({ d: disputes, m: wsMilestones, w: workspaces, meta: disputeMeta }).from(disputes)
    .innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .leftJoin(disputeMeta, eq(disputeMeta.disputeId, disputes.id)).where(eq(disputes.id, id)).limit(1);
  if (!r) return null;
  const [verdict] = await db.select().from(verdicts).where(eq(verdicts.disputeId, id)).limit(1);
  const cosignReasons = verdict ? (await MED.cosignReasonsFor([{ disputeId: id, amountCents: r.d.amountCents, origin: verdict.origin }], R.COSIGN_ABOVE_CENTS)).get(id) ?? [] : [];
  const cosignOpen = !!verdict && verdict.origin === "TIER3" && !verdict.cosignerId && cosignReasons.length > 0;
  const access = accessFor(v, r.w, r.d, cosignOpen);
  if (!access) return null;
  const side: "client" | "provider" | null = v.id === r.w.clientId ? "client" : v.id === r.w.providerId ? "provider" : null;
  const now = await workspaceNow(r.w.id);
  const [assignment, reviews, mediatorFees] = await Promise.all([MED.assignmentOf(id), MED.reviewsFor(id), MED.feesFor(id)]);
  const [allMs, pkgs, rebs, files, bidRows, trRows, fee, events] = await Promise.all([
    db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, r.w.id)).orderBy(asc(wsMilestones.seq)),
    db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, r.m.id)).orderBy(asc(evidencePackages.attempt)),
    db.select().from(rebuttals).where(eq(rebuttals.disputeId, id)).orderBy(asc(rebuttals.createdAt)),
    db.select({ sha256: disputeFiles.sha256, name: disputeFiles.name, type: disputeFiles.type, size: disputeFiles.size, byUser: disputeFiles.byUser }).from(disputeFiles).where(eq(disputeFiles.disputeId, id)),
    db.select().from(bids).where(eq(bids.disputeId, id)).orderBy(asc(bids.round)),
    db.select().from(tranches).where(eq(tranches.workspaceId, r.w.id)).orderBy(asc(tranches.idx)),
    db.select().from(disputeFees).where(eq(disputeFees.disputeId, id)).limit(1),
    db.select({ seq: auditChain.seq, action: auditChain.action, actorId: auditChain.actorId, actorRole: auditChain.actorRole, at: auditChain.at, detail: auditChain.detail }).from(auditChain).where(eq(auditChain.target, id)).orderBy(asc(auditChain.seq)),
  ]);
  const tranche = trRows.find((t) => t.idx === r.m.trancheIdx) ?? null;
  const nm = await names([r.w.clientId, r.w.providerId, r.d.mediatorId, r.d.cosignerId, verdict?.mediatorId, verdict?.cosignerId, r.d.openedBy, ...rebs.map((x) => x.byUser), ...events.map((e) => e.actorId), ...assignment.offers.map((o) => o.mediatorId)]);
  /* sealed offers: a party sees only its own; everyone sees them once the dispute settled at Tier 1 */
  const revealed = r.d.state === "AGREED" || verdict?.origin === "TIER1";
  const round = R.openRound(bidRows);
  const bidsView = bidRows.filter((b) => revealed || (side && b.role === side)).map((b) => ({ round: b.round, role: b.role, providerShareBps: b.providerShareBps, commit: b.commit }));
  const roundsDone = [1, 2, 3].filter((n) => bidRows.filter((b) => b.round === n).length === 2).length;
  const myTurn = r.d.state === "TIER1" && side !== null && round !== null && !bidRows.some((b) => b.round === round && b.role === side);
  const waitingOther = r.d.state === "TIER1" && side !== null && round !== null && bidRows.some((b) => b.round === round && b.role === side);
  /* F4.10: PayPal's own disputes on this hold, if the money module has recorded any */
  const refs = [tranche?.paypalOrderId, tranche?.captureId, tranche?.authorizationId].filter((x): x is string => !!x);
  const external = refs.length ? await db.select({ id: webhookEvents.transmissionId, type: webhookEvents.type, resourceId: webhookEvents.resourceId, at: webhookEvents.receivedAt, state: webhookEvents.state })
    .from(webhookEvents).where(and(like(webhookEvents.type, "CUSTOMER.DISPUTE%"), or(...refs.map((x) => sql`${webhookEvents.payload}::text LIKE ${"%" + x + "%"}`)))).limit(20) : [];
  const vaultEnd = r.meta?.vaultExtendedUntil && r.meta.vaultExtendedUntil > r.d.vaultUntil ? r.meta.vaultExtendedUntil : r.d.vaultUntil;
  return {
    access, side, now,
    d: r.d, meta: r.meta, verdict: verdict ?? null, fee: fee[0] ?? null, cosignOpen, cosignReasons, assignment, reviews, mediatorFees,
    milestone: r.m, workspace: r.w, tranche, tranches: trRows,
    milestones: allMs.map((m) => ({ id: m.id, code: m.code, title: m.title, type: m.type, state: m.state, amountCents: m.amountCents, trancheIdx: m.trancheIdx, active: m.active, dependsOn: m.dependsOn })),
    evidence: pkgs, rebuttals: rebs, files,
    bids: bidsView, round, roundsDone, myTurn, waitingOther, revealed,
    events, external, vaultEnd,
    names: Object.fromEntries(nm), mediatorName: r.d.mediatorId ? nm.get(r.d.mediatorId) ?? null : null,
    clientName: nm.get(r.w.clientId) ?? "Client", providerName: r.w.providerId ? nm.get(r.w.providerId) ?? "Provider" : "Provider",
  };
}
export type DisputeCase = NonNullable<Awaited<ReturnType<typeof disputeCase>>>;

/** F4.06 workbench extras: active clauses, the contract's difference from its blueprint, in-progress parallel steps. */
export async function workbenchExtras(c: DisputeCase) {
  const [clauses, [bp], revs] = await Promise.all([
    db.select().from(wsClauses).where(eq(wsClauses.workspaceId, c.workspace.id)).orderBy(asc(wsClauses.category), asc(wsClauses.code)),
    db.select().from(blueprints).where(eq(blueprints.code, c.workspace.blueprintCode)).limit(1),
    db.select({ revNo: revisions.revNo, change: revisions.change, authorId: revisions.authorId }).from(revisions).where(eq(revisions.workspaceId, c.workspace.id)).orderBy(asc(revisions.revNo)),
  ]);
  const ms = await db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, c.workspace.id)).orderBy(asc(wsMilestones.seq));
  const base = new Map((bp?.milestones ?? []).map((m) => [m.code, m]));
  const diff: { kind: "pruned" | "appended" | "share" | "day" | "clause_off" | "clause_custom"; text: string; target: string }[] = [];
  for (const m of ms) {
    const b = base.get(m.code);
    if (m.origin === "BASELINE" && !m.active) diff.push({ kind: "pruned", target: m.code, text: `${m.code} “${m.title}” pruned` });
    if (m.origin === "CUSTOM") diff.push({ kind: "appended", target: m.code, text: `${m.code} “${m.title}” appended (${(m.bps / 100).toFixed(2)}%, day ${m.targetDay})` });
    if (b && m.active && b.bps !== m.bps) diff.push({ kind: "share", target: m.code, text: `${m.code} share ${(b.bps / 100).toFixed(2)}% → ${(m.bps / 100).toFixed(2)}%` });
    if (b && m.active && b.day !== m.targetDay) diff.push({ kind: "day", target: m.code, text: `${m.code} day ${b.day} → ${m.targetDay}` });
  }
  for (const k of clauses) {
    if (k.category === "BASELINE" && !k.active) diff.push({ kind: "clause_off", target: k.code, text: `Clause ${k.code} “${k.title}” switched off${k.protective ? " (protective)" : ""}` });
    if (k.category === "CUSTOM" && k.active) diff.push({ kind: "clause_custom", target: k.code, text: `Custom clause ${k.code} “${k.title}” added` });
  }
  const parallel = ms.filter((m) => m.id !== c.milestone.id && m.trancheIdx === c.milestone.trancheIdx && ["SUBMITTED", "REMEDIATION", "ESCALATED"].includes(m.state));
  return { clauses, diff, revisions: revs.length, blueprintTitle: bp?.title ?? c.workspace.blueprintCode, parallel };
}

/** Mediator queue: my cases, unassigned sealed cases I am free to take, and verdicts waiting for my co-signature. */
export async function mediatorQueue(v: Viewer) {
  const rows = await db.select({ d: disputes, m: wsMilestones, w: workspaces, meta: disputeMeta }).from(disputes)
    .innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .leftJoin(disputeMeta, eq(disputeMeta.disputeId, disputes.id))
    .where(and(eq(workspaces.orgId, v.orgId), inArray(disputes.state, OPEN.concat(["RESOLVED"])), real(v))).orderBy(asc(disputes.vaultUntil));
  for (const r of rows) if (r.d.state === "TIER1" || r.d.state === "TIER2") { try { r.d.state = await advanceDispute(r.d.id); } catch { /* keep */ } }
  const vs = rows.length ? await db.select().from(verdicts).where(inArray(verdicts.disputeId, rows.map((r) => r.d.id))) : [];
  const hist = rows.filter((r) => r.d.mediatorId).map((r) => ({ mediatorId: r.d.mediatorId, clientId: r.w.clientId, providerId: r.w.providerId, at: r.d.createdAt, id: r.d.id }));
  const nm = await names(rows.flatMap((r) => [r.w.clientId, r.w.providerId, r.d.mediatorId]));
  /* open offers to me, co-sign reasons per verdict, and (in a network) only Seniors see the co-sign lane */
  const offers = v.role === "mediator" ? await MED.openOffersFor(v.id) : [];
  const reasons = await MED.cosignReasonsFor(vs.map((x) => ({ disputeId: x.disputeId, amountCents: rows.find((r) => r.d.id === x.disputeId)!.d.amountCents, origin: x.origin })), R.COSIGN_ABOVE_CENTS);
  const network = await MED.networkMode(v.orgId);
  const [me] = v.role === "mediator" ? await db.select({ status: mediatorProfiles.status }).from(mediatorProfiles).where(eq(mediatorProfiles.userId, v.id)).limit(1) : [];
  const canCosign = !network || v.role !== "mediator" || me?.status === "SENIOR";
  const out = await Promise.all(rows.map(async (r) => {
    const verdict = vs.find((x) => x.disputeId === r.d.id) ?? null;
    const now = await workspaceNow(r.w.id);
    const coi = R.conflicted(hist.filter((h) => h.id !== r.d.id), [r.w.clientId, ...(r.w.providerId ? [r.w.providerId] : [])], now).has(v.id);
    const offer = offers.find((o) => o.o.disputeId === r.d.id)?.o ?? null;
    const cos = reasons.get(r.d.id) ?? [];
    let openOk = !coi;
    if (network && v.role === "mediator" && r.d.state === "TIER3" && !r.d.mediatorId && !coi) { try { await MED.takeCheck({ id: v.id, role: v.role }, r.d.id, now); } catch { openOk = false; } }
    const lane: "offered" | "mine" | "open" | "cosign" | "upcoming" | "done" | null =
      r.d.state === "RESOLVED" ? (r.d.mediatorId === v.id || r.d.cosignerId === v.id ? "done" : null)
      : offer && !verdict ? "offered"
      : verdict && verdict.origin === "TIER3" && !verdict.cosignerId && cos.length ? (verdict.mediatorId === v.id ? "mine" : coi || !canCosign ? null : "cosign")
      : r.d.mediatorId === v.id ? "mine"
      : r.d.state === "TIER3" && !r.d.mediatorId ? (openOk ? "open" : null)
      : r.d.state === "TIER1" || r.d.state === "TIER2" ? "upcoming" : null;
    const due = r.meta?.tier3Until ?? null;
    return {
      id: r.d.id, lane, state: r.d.state, amountCents: r.d.amountCents, currency: r.w.currency, reason: r.d.reason, createdAt: r.d.createdAt,
      workspace: r.w.title, milestone: `${r.m.code} · ${r.m.title}`, client: nm.get(r.w.clientId) ?? "Client", provider: r.w.providerId ? nm.get(r.w.providerId) ?? "" : "",
      mediator: r.d.mediatorId ? nm.get(r.d.mediatorId) ?? r.d.mediatorId : null, verdict, due, overdue: !!due && r.d.state === "TIER3" && now > due, now,
      highValue: r.d.amountCents > R.COSIGN_ABOVE_CENTS, fastTrack: r.meta?.fastTrack ?? false, cosignReasons: cos,
      offer: offer ? { id: offer.id, expiresAt: offer.expiresAt, attempt: offer.attempt, total: (offer.breakdown as { total?: number }).total ?? null } : null,
    };
  }));
  return out.filter((x) => x.lane !== null);
}

/** Overview numbers and the F4.12 feedback loop. */
export async function mediatorOverview(v: Viewer) {
  const queue = await mediatorQueue(v);
  const rows = await db.select({ d: disputes, w: workspaces }).from(disputes).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId))
    .innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).where(and(eq(workspaces.orgId, v.orgId), real(v)));
  const byState: Record<string, number> = {};
  for (const r of rows) byState[r.d.state] = (byState[r.d.state] ?? 0) + 1;
  const vs = rows.length ? await db.select().from(verdicts).where(inArray(verdicts.disputeId, rows.map((r) => r.d.id))) : [];
  const roots: Record<string, number> = {};
  for (const x of vs) roots[x.rootCause] = (roots[x.rootCause] ?? 0) + 1;
  const hours = vs.filter((x) => x.origin === "TIER3").map((x) => { const d = rows.find((r) => r.d.id === x.disputeId)!.d; return (x.createdAt.getTime() - d.createdAt.getTime()) / 3_600_000; }).filter((n) => n >= 0);
  const rates = await db.select().from(disputeRateByCode).where(eq(disputeRateByCode.orgId, v.orgId)).orderBy(desc(disputeRateByCode.rateBps));
  const externalCount = (await db.select({ n: sql<number>`count(*)::int` }).from(tranches).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId))
    .where(and(eq(workspaces.orgId, v.orgId), real(v), sql`${tranches.warned} @> '["EXTERNAL_DISPUTE"]'::jsonb`)))[0]?.n ?? 0;
  return {
    queue, byState, roots, rates, externalCount,
    avgHoursToVerdict: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null,
    tier1Share: vs.length ? vs.filter((x) => x.origin === "TIER1").length / vs.length : null,
  };
}
