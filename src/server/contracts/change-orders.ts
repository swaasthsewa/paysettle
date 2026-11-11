/**
 * F2.13 change orders on a LOCKED contract: either party proposes (add milestones; change the title, proof spec,
 * criteria, due day or amount of a milestone that has not started; remove one), both parties sign the change order's
 * canonical hash (same HMAC scheme as contract signatures), and it becomes the next contract revision. Until both have
 * signed, the contract runs on the old terms. The policy gate runs on the amended contract (violations block signing);
 * a risk score of 75 or more sends the signed change order to Operations' clearance queue before it takes effect.
 * Money moves only through the money module's existing functions (P1): new PLANNED tranches are funded by the client
 * through fundTranche/confirmTranche; reductions in held tranches go back through returnFunds (settleChangeOrder).
 * The AI never writes change orders, signatures, ledger rows or releases.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import { evidencePackages, revisions, signatures, tranches, users, workspaces, wsMilestones } from "@/db/schema";
import { changeOrders, changeOrderSignatures, type ChangeOrderReturn } from "@/db/schema-amend";
import { audit } from "@/lib/audit";
import { canonical, canonicalHash } from "@/lib/canonical";
import { sandboxMode } from "@/lib/clock";
import { milestoneMachine } from "@/lib/fsm";
import { idemKey, newId } from "@/lib/ids";
import { verifyTotp } from "@/lib/identity/totp";
import { formatCents } from "@/lib/money";
import { RISK_OPS_THRESHOLD, type Violation } from "@/lib/policy";
import { can, canWrite } from "@/lib/rbac";
import { excludeSim, isTestOrgId } from "@/lib/sim";
import { noticeParties, settleChangeOrder } from "../money";
import { workspaceNow } from "../clock";
import { DomainError, type Actor } from "../types";
import { evaluate } from "./core";
import { isFrozen, moneyLines, planChangeOrder, UNSTARTED, type CoDiff, type CoItem, type MoneyPlan, type Plan } from "./change-core";
import { internals, signatureFor } from "./index";

const { actorUser, loadWs, loadMs, loadCl, providerFacts, head, assertCanRead, partyRole } = internals;
type ActorCtx = Actor & { mfa?: boolean; ip?: string; userAgent?: string };
type Q = Tx | typeof db;
type CoRow = typeof changeOrders.$inferSelect;
const OPEN_STATES = ["PROPOSED", "AWAITING_OPS"] as const;

/* ───────────── input validation (zod) ───────────── */
const zProof = z.object({
  artifacts: z.array(z.object({ kind: z.enum(["IMAGE", "VIDEO", "PDF", "LOG", "LINK", "SIGNATURE", "ORACLE"]), min: z.number().int().min(0).max(50), note: z.string().max(200).optional() })).max(12),
  gpsRadiusM: z.number().int().min(1).max(100_000).optional(),
  oracle: z.string().max(40).optional(),
  criteria: z.array(z.string().trim().min(1).max(300)).max(20),
});
const zCode = z.string().min(1).max(40);
const zDay = z.number().int().min(1).max(365);
const zCents = z.number().int().min(0).max(100_000_000);
const zRule = z.string().trim().min(1).max(300);
const zItem = z.union([
  z.object({ action: z.literal("ADD"), milestone: z.object({ title: z.string().trim().min(3).max(140), type: z.enum(["GATE", "PAY"]), day: zDay, amountCents: zCents, proof: zProof, lockRule: zRule, disputeRule: zRule }) }),
  z.object({ action: z.literal("EDIT"), milestoneCode: zCode, title: z.string().trim().min(3).max(140).optional(), day: zDay.optional(), amountCents: zCents.optional(), proof: zProof.optional(), lockRule: zRule.optional(), disputeRule: zRule.optional() }),
  z.object({ action: z.literal("REMOVE"), milestoneCode: zCode }),
]);
const zPropose = z.object({ items: z.array(zItem).min(1).max(20), note: z.string().trim().min(5, "Say in a few words why the contract changes.").max(1000), expectedRev: z.number().int().min(1).optional() });
function invalid(e: z.ZodError): never { throw new DomainError("INVALID_INPUT", e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")); }

/* ───────────── planning from the database ───────────── */
async function planFor(q: Q, w: typeof workspaces.$inferSelect, items: CoItem[], no: number, actorId: string, carriedTo: string | null): Promise<{ plan: Plan; hash: string; violations: Violation[]; risk: { score: number; parts: Record<string, number> } }> {
  if (!w.canonicalHash) throw new DomainError("STATE", "This contract has no signed revision yet.");
  /* sequential: inside a transaction the queries share one connection */
  const ms = await loadMs(q, w.id);
  const cl = await loadCl(q, w.id);
  const trs = await q.select().from(tranches).where(eq(tranches.workspaceId, w.id));
  const ids = ms.map((m) => m.id);
  const ev = ids.length ? await q.selectDistinct({ id: evidencePackages.milestoneId }).from(evidencePackages).where(inArray(evidencePackages.milestoneId, ids)) : [];
  const plan = planChangeOrder({
    head: head(w), baseRevNo: w.revision, baseHash: w.canonicalHash, no, actorId, ms, cl, items, carriedTo,
    tranches: trs.map((t) => ({ idx: t.idx, state: t.state, amountCents: t.amountCents, paused: (t.warned ?? []).some((x) => x === "EXTERNAL_DISPUTE" || x.startsWith("EXTERNAL_DISPUTE:")) })),
    withEvidence: new Set(ev.map((e) => e.id)),
  });
  const facts = await providerFacts(q, w.providerId);
  const e = evaluate(plan.head, plan.ms, cl, facts.payable, facts.tier);
  return { plan, hash: canonicalHash(plan.doc), violations: e.violations, risk: e.risk };
}

async function loadCo(q: Q, id: string, forUpdate = false): Promise<CoRow> {
  const base = q.select().from(changeOrders).where(eq(changeOrders.id, id)).limit(1);
  const [co] = forUpdate ? await base.for("update") : await base;
  if (!co) throw new DomainError("NOT_FOUND", "This change order does not exist.");
  return co;
}

/* ───────────── propose ───────────── */
export async function proposeChangeOrder(a: Actor, workspaceId: string, input: { items: CoItem[]; note: string; expectedRev?: number }, opts: { continuationId?: string } = {}): Promise<string> {
  if (!canWrite(a.role, "contract.negotiate")) throw new DomainError("FORBIDDEN", "Your role cannot change contracts.");
  const p = zPropose.safeParse(input);
  if (!p.success) invalid(p.error);
  const now = await workspaceNow(workspaceId);
  const id = newId("co");
  const out = await db.transaction(async (tx) => {
    const w = await loadWs(tx, workspaceId, true);
    const role = partyRole(a, w);
    if (w.state !== "LOCKED") throw new DomainError("NOT_LOCKED", "Change orders apply to signed, locked contracts. Before signing, change the contract in the negotiation room.");
    if (p.data.expectedRev !== undefined && p.data.expectedRev !== w.revision) throw new DomainError("MERGE_REQUIRED", `This contract changed while you were editing (now revision ${w.revision}). Review the latest version and try again.`);
    const [open] = await tx.select({ no: changeOrders.no }).from(changeOrders).where(and(eq(changeOrders.workspaceId, w.id), inArray(changeOrders.state, [...OPEN_STATES]))).limit(1);
    if (open) throw new DomainError("ALREADY_OPEN", `Change order ${open.no} is still open. Sign, decline or withdraw it first.`);
    const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${changeOrders.no}), 0)::int` }).from(changeOrders).where(eq(changeOrders.workspaceId, w.id));
    const no = Number(n) + 1;
    const items = p.data.items as CoItem[];
    const r = await planFor(tx, w, items, no, a.id, opts.continuationId ?? null);
    await tx.insert(changeOrders).values({
      id, workspaceId: w.id, no, baseRevNo: w.revision, baseHash: w.canonicalHash!, revNo: r.plan.revNo, proposedBy: a.id, proposedRole: role, note: p.data.note,
      items, canonical: JSON.parse(canonical(r.plan.doc)), hash: r.hash, diff: r.plan.diff as unknown as Record<string, unknown>, money: r.plan.money as unknown as Record<string, unknown>,
      totalFromCents: r.plan.diff.totalFromCents, totalToCents: r.plan.diff.totalToCents, risk: r.risk.score, riskParts: r.risk.parts, violations: r.violations,
      continuationId: opts.continuationId ?? null, state: "PROPOSED", createdAt: now,
    });
    await audit(tx, a, "contract.change_order_proposed", w.id, { changeOrderId: id, no, baseRevNo: w.revision, revNo: r.plan.revNo, hash: r.hash, items: items.map((x) => x.action === "ADD" ? `ADD ${x.milestone.title}` : `${x.action} ${x.milestoneCode}`), netCents: r.plan.money.netCents, risk: r.risk.score, violations: r.violations.map((v) => v.code), continuationId: opts.continuationId ?? null });
    return { w, no, role, net: r.plan.money.netCents };
  });
  const other = out.role === "client" ? out.w.providerId : out.w.clientId;
  if (other) await noticeParties(out.w.id, "CHANGE_ORDER", `Change order ${out.no} on “${out.w.title}” is waiting for your review and signature (${out.net === 0 ? "no change to the total" : `${out.net > 0 ? "+" : "−"}${formatCents(Math.abs(out.net), out.w.currency)} to the total`}).`, `co-proposed:${id}`, [other]);
  return id;
}

/* ───────────── sign ───────────── */
/**
 * Signs the change order's hash. The plan is computed again from the contract as it is now; if that no longer gives the
 * same document (a tranche was funded, a milestone was submitted, another revision landed), the change order is marked
 * superseded and nothing is signed. The second signature applies it (or sends it to Operations at risk ≥ 75).
 */
export async function signChangeOrder(a: Actor, changeOrderId: string, hash: string, mfaCode?: string): Promise<{ state: string }> {
  if (!canWrite(a.role, "contract.sign")) throw new DomainError("FORBIDDEN", "Your role cannot sign contracts.");
  const ctx = a as ActorCtx;
  const co0 = await loadCo(db, changeOrderId);
  const now = await workspaceNow(co0.workspaceId);
  const r = await db.transaction(async (tx) => {
    const w = await loadWs(tx, co0.workspaceId, true);
    const co = await loadCo(tx, changeOrderId, true);
    const role = partyRole(a, w);
    if (co.state !== "PROPOSED") throw new DomainError("STATE", `Change order ${co.no} is ${co.state.toLowerCase().replace(/_/g, " ")}; it cannot be signed.`);
    if (hash !== co.hash) throw new DomainError("REVISION_MISMATCH", "You are signing a different document from the one this change order holds. Reload and review it again.");
    const stale = await staleness(tx, w, co);
    if (stale) return { superseded: stale } as const;
    const { violations, risk } = await planFor(tx, w, co.items as CoItem[], co.no, co.proposedBy, co.continuationId);
    if (violations.length) throw new DomainError("POLICY_BLOCKED", `This change order cannot be signed: ${violations.map((v) => `${v.rule} ${v.message}`).join(" ")} Withdraw it and propose a corrected one.`);
    const me = await actorUser(tx, a);
    let mfa = ctx.mfa === true;
    if (mfaCode && me.mfaSecret) {
      const t = verifyTotp(me.mfaSecret, mfaCode, Date.now(), me.mfaLastStep);
      if (!t.ok) throw new DomainError("MFA_FAILED", "That authenticator code is not right.");
      await tx.update(users).set({ mfaLastStep: t.step }).where(eq(users.id, me.id));
      mfa = true;
    }
    if (!mfa && !sandboxMode()) throw new DomainError("MFA_REQUIRED", "Signing needs a fresh authenticator code.");
    const have = await tx.select().from(changeOrderSignatures).where(eq(changeOrderSignatures.changeOrderId, co.id));
    if (have.some((s) => s.role === role)) throw new DomainError("ALREADY_SIGNED", `You already signed change order ${co.no}.`);
    await tx.insert(changeOrderSignatures).values({ id: newId("cosig"), changeOrderId: co.id, workspaceId: w.id, revNo: co.revNo, hash: co.hash, signerId: a.id, role, signature: signatureFor(w.id, co.revNo, co.hash, a.id, role), mfa, ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 300) ?? null });
    await audit(tx, a, "contract.change_order_signed", w.id, { changeOrderId: co.id, no: co.no, revNo: co.revNo, hash: co.hash, role, mfa });
    if (!have.length) return { state: "PROPOSED", w, role } as const;
    if (risk.score >= RISK_OPS_THRESHOLD) {
      await tx.update(changeOrders).set({ state: "AWAITING_OPS", risk: risk.score, riskParts: risk.parts }).where(eq(changeOrders.id, co.id));
      await audit(tx, a, "contract.change_order_pending_ops", w.id, { changeOrderId: co.id, no: co.no, risk: risk.score, threshold: RISK_OPS_THRESHOLD });
      return { state: "AWAITING_OPS", w, role } as const;
    }
    await applyTx(tx, a, w, co, now);
    return { state: "APPLIED", w, role } as const;
  });
  if ("superseded" in r) { await supersede(a, co0, r.superseded!); throw new DomainError("SUPERSEDED", r.superseded!); }
  if (r.state === "APPLIED") await afterApply(a, changeOrderId);
  else {
    const other = r.role === "client" ? r.w.providerId : r.w.clientId;
    const msg = r.state === "AWAITING_OPS" ? `Both parties signed change order ${co0.no} on “${r.w.title}”. Operations reviews it (risk score ${RISK_OPS_THRESHOLD} or more) before it takes effect.` : `Change order ${co0.no} on “${r.w.title}” has one signature and is waiting for yours.`;
    await noticeParties(r.w.id, "CHANGE_ORDER", msg, `co-${r.state}:${changeOrderId}`, r.state === "AWAITING_OPS" ? undefined : other ? [other] : []);
  }
  return { state: r.state };
}

/** Why a change order no longer fits the contract (null when it still does). */
async function staleness(q: Q, w: typeof workspaces.$inferSelect, co: CoRow): Promise<string | null> {
  if (w.state !== "LOCKED") return `The contract is no longer locked (${w.state.toLowerCase()}); change order ${co.no} cannot apply.`;
  if (w.revision !== co.baseRevNo || w.canonicalHash !== co.baseHash) return `The contract moved to revision ${w.revision} after change order ${co.no} was proposed on revision ${co.baseRevNo}. Propose it again on the current terms.`;
  try {
    const again = await planFor(q, w, co.items as CoItem[], co.no, co.proposedBy, co.continuationId);
    if (again.hash !== co.hash) return `The contract's money has moved since change order ${co.no} was proposed (for example a tranche was funded), so its money plan no longer holds. Propose it again on the current terms.`;
  } catch (e) {
    if (e instanceof DomainError) return `Change order ${co.no} no longer fits the contract: ${e.message}`;
    throw e;
  }
  return null;
}
async function supersede(a: Actor | null, co: CoRow, why: string) {
  await db.update(changeOrders).set({ state: "SUPERSEDED", decidedAt: new Date(), decisionNote: why.slice(0, 1000) }).where(and(eq(changeOrders.id, co.id), inArray(changeOrders.state, [...OPEN_STATES])));
  await audit(db, a ? { id: a.id, role: a.role } : { id: null, role: "system" }, "contract.change_order_superseded", co.workspaceId, { changeOrderId: co.id, no: co.no, why });
}

/**
 * Writes the amended contract as the next revision, inside the caller's transaction (workspace row locked). The plan is
 * computed again and must give the signed hash. Only the touched milestones are written (states of others stay as they
 * are); shares are derived from cents for every payment milestone.
 */
async function applyTx(tx: Tx, a: Actor, w: typeof workspaces.$inferSelect, co: CoRow, now: Date) {
  await tx.select({ id: wsMilestones.id }).from(wsMilestones).where(eq(wsMilestones.workspaceId, w.id)).for("update");
  const why = await staleness(tx, w, co);
  if (why) throw new DomainError("SUPERSEDED", why);
  const { plan, hash, risk } = await planFor(tx, w, co.items as CoItem[], co.no, co.proposedBy, co.continuationId);
  if (hash !== co.hash) throw new DomainError("SUPERSEDED", `Change order ${co.no} no longer matches the contract.`);
  for (const m of plan.ms) {
    if (plan.added.has(m.code)) {
      await tx.insert(wsMilestones).values({ id: newId("ms"), workspaceId: w.id, seq: m.seq, code: m.code, origin: m.origin, active: true, type: m.type, title: m.title, targetDay: m.targetDay, bps: m.bps, amountCents: m.amountCents, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: [], trancheIdx: m.trancheIdx, state: milestoneMachine.next("DRAFT", "lock") });
    } else if (plan.touched.has(m.code)) {
      const state = plan.unfund.has(m.code) ? milestoneMachine.next("OPEN", "unfund") : m.state;
      const r = await tx.update(wsMilestones).set({ title: m.title, targetDay: m.targetDay, bps: m.bps, amountCents: m.amountCents, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, active: m.active, prunedBy: m.prunedBy, trancheIdx: m.trancheIdx, state })
        .where(and(eq(wsMilestones.id, m.id), inArray(wsMilestones.state, [...UNSTARTED]))).returning({ id: wsMilestones.id });
      if (!r.length) throw new DomainError("SUPERSEDED", `${m.code} moved on while change order ${co.no} was being applied.`);
    } else if (m.active && m.type === "PAY") {
      await tx.update(wsMilestones).set({ bps: m.bps }).where(eq(wsMilestones.id, m.id)); // shares are derived from the cents
    }
  }
  for (const [idx, cents] of plan.plannedAmounts) await tx.update(tranches).set({ amountCents: cents }).where(and(eq(tranches.workspaceId, w.id), eq(tranches.idx, idx), eq(tranches.state, "PLANNED")));
  for (const [idx, cents] of plan.amendedOut) await tx.update(tranches).set({ amendedOutCents: sql`${tranches.amendedOutCents} + ${cents}` }).where(and(eq(tranches.workspaceId, w.id), eq(tranches.idx, idx)));
  for (const t of plan.newTranches) await tx.insert(tranches).values({ id: newId("tr"), workspaceId: w.id, idx: t.trancheIdx, rail: w.rail, amountCents: t.amountCents, bonusPoolCents: 0, startDay: t.startDay, endDay: t.endDay, state: "PLANNED" });
  const trs = await tx.select({ id: tranches.id, idx: tranches.idx }).from(tranches).where(eq(tranches.workspaceId, w.id));
  const returns: ChangeOrderReturn[] = plan.money.returns.map((r) => ({ trancheIdx: r.trancheIdx, trancheId: trs.find((t) => t.idx === r.trancheIdx)!.id, amountCents: r.amountCents, items: r.items, idemKey: idemKey("change_order", co.id, r.trancheIdx), status: "PENDING" }));
  await tx.insert(revisions).values({ workspaceId: w.id, revNo: plan.revNo, hash, canonical: JSON.parse(canonical(plan.doc)), authorId: co.proposedBy, change: { action: "CHANGE_ORDER", target: `CO${co.no}`, detail: { changeOrderId: co.id, no: co.no, note: co.note, diff: plan.diff, money: plan.money } } });
  const sigs = await tx.select().from(changeOrderSignatures).where(eq(changeOrderSignatures.changeOrderId, co.id));
  for (const s of sigs) await tx.insert(signatures).values({ id: newId("sig"), workspaceId: w.id, revNo: plan.revNo, hash, signerId: s.signerId, role: s.role, signature: s.signature, mfa: s.mfa, ip: s.ip, userAgent: s.userAgent });
  await tx.update(workspaces).set({ totalCents: plan.head.totalCents, revision: plan.revNo, canonicalHash: hash, riskScore: risk.score, updatedAt: now }).where(eq(workspaces.id, w.id));
  await tx.update(changeOrders).set({ state: "APPLIED", appliedAt: now, returns }).where(eq(changeOrders.id, co.id));
  await audit(tx, a, "contract.change_order_applied", w.id, { changeOrderId: co.id, no: co.no, revNo: plan.revNo, hash, prevHash: co.baseHash, totalFromCents: plan.diff.totalFromCents, totalToCents: plan.diff.totalToCents, fund: plan.money.fund, returns: returns.map((r) => ({ trancheIdx: r.trancheIdx, amountCents: r.amountCents, idemKey: r.idemKey })), planned: plan.money.planned, moved: plan.money.moved });
}

async function afterApply(a: Actor | null, changeOrderId: string) {
  const co = await loadCo(db, changeOrderId);
  try { await settleChangeOrder(a, co.id); } catch (e) { await audit(db, a ? { id: a.id, role: a.role } : { id: null, role: "system" }, "contract.change_order_settle_failed", co.workspaceId, { changeOrderId: co.id, error: e instanceof Error ? e.message : String(e) }); }
  const lines = moneyLines(co.money as unknown as MoneyPlan, (c) => formatCents(c));
  const w = await loadWs(db, co.workspaceId);
  await noticeParties(w.id, "CHANGE_ORDER", `Change order ${co.no} on “${w.title}” is signed by both parties and is now revision ${co.revNo}. ${lines.join(" ")}`, `co-applied:${co.id}`);
}

/* ───────────── decline / withdraw ───────────── */
export async function declineChangeOrder(a: Actor, changeOrderId: string, note: string): Promise<void> {
  const n = z.string().trim().max(1000).safeParse(note ?? "");
  if (!n.success) invalid(n.error);
  const co0 = await loadCo(db, changeOrderId);
  const out = await db.transaction(async (tx) => {
    const w = await loadWs(tx, co0.workspaceId, true);
    const co = await loadCo(tx, changeOrderId, true);
    partyRole(a, w);
    if (co.state !== "PROPOSED") throw new DomainError("STATE", `Change order ${co.no} is ${co.state.toLowerCase().replace(/_/g, " ")}.`);
    const withdraw = co.proposedBy === a.id;
    if (!withdraw && n.data.length < 3) throw new DomainError("INVALID_INPUT", "Say in a few words why you decline, so the other party knows what to change.");
    const state = withdraw ? "WITHDRAWN" : "DECLINED";
    await tx.update(changeOrders).set({ state, decidedBy: a.id, decidedAt: await workspaceNow(w.id), decisionNote: n.data || null }).where(eq(changeOrders.id, co.id));
    await audit(tx, a, withdraw ? "contract.change_order_withdrawn" : "contract.change_order_declined", w.id, { changeOrderId: co.id, no: co.no, note: n.data });
    return { w, co, state, other: a.id === w.clientId ? w.providerId : w.clientId };
  });
  if (out.other) await noticeParties(out.w.id, "CHANGE_ORDER", `Change order ${out.co.no} on “${out.w.title}” was ${out.state.toLowerCase()}${n.data ? `: “${n.data}”` : "."} The contract stays on its current terms.`, `co-${out.state}:${out.co.id}`, [out.other]);
}

/* ───────────── Operations clearance (F2.11 path, for change orders) ───────────── */
export async function clearChangeOrder(a: Actor, changeOrderId: string, decision: "clear" | "return", note: string): Promise<void> {
  if (!canWrite(a.role, "contract.clear_high_risk")) throw new DomainError("FORBIDDEN", "Only Operations can clear high-risk change orders.");
  if (decision !== "clear" && decision !== "return") throw new DomainError("INVALID_INPUT", "Decision must be clear or return.");
  const n = z.string().trim().max(1000).safeParse(note ?? "");
  if (!n.success) invalid(n.error);
  if (decision === "return" && n.data.length < 3) throw new DomainError("INVALID_INPUT", "Say why the change order goes back, so both parties know what to change.");
  const co0 = await loadCo(db, changeOrderId);
  const now = await workspaceNow(co0.workspaceId);
  const r = await db.transaction(async (tx) => {
    const w = await loadWs(tx, co0.workspaceId, true);
    await assertCanRead(tx, a, w);
    const co = await loadCo(tx, changeOrderId, true);
    if (co.state !== "AWAITING_OPS") throw new DomainError("STATE", `Only a change order waiting for Operations can be cleared (this one is ${co.state.toLowerCase()}).`);
    if (decision === "return") {
      await tx.update(changeOrders).set({ state: "RETURNED", decidedBy: a.id, decidedAt: now, decisionNote: n.data }).where(eq(changeOrders.id, co.id));
      await audit(tx, a, "contract.change_order_returned", w.id, { changeOrderId: co.id, no: co.no, note: n.data, risk: co.risk });
      return { w, co, applied: false } as const;
    }
    const stale = await staleness(tx, w, co);
    if (stale) return { superseded: stale } as const;
    await audit(tx, a, "contract.change_order_cleared", w.id, { changeOrderId: co.id, no: co.no, note: n.data, risk: co.risk });
    await tx.update(changeOrders).set({ decidedBy: a.id, decidedAt: now, decisionNote: n.data || null }).where(eq(changeOrders.id, co.id));
    await applyTx(tx, a, w, co, now);
    return { w, co, applied: true } as const;
  });
  if ("superseded" in r) { await supersede(a, co0, r.superseded!); throw new DomainError("SUPERSEDED", r.superseded!); }
  if (r.applied) await afterApply(a, changeOrderId);
  else await noticeParties(r.w.id, "CHANGE_ORDER", `Operations returned change order ${r.co.no} on “${r.w.title}”: “${n.data}” The contract stays on its current terms.`, `co-returned:${r.co.id}`);
}

/* ───────────── read models ───────────── */
export interface ChangeOrderView {
  id: string; no: number; state: string; revNo: number; baseRevNo: number; hash: string; note: string; createdAt: Date;
  proposedBy: { id: string; name: string; role: "client" | "provider" }; items: CoItem[]; diff: CoDiff; money: MoneyPlan; lines: string[];
  totalFromCents: number; totalToCents: number; risk: number; riskParts: Record<string, number>; violations: Violation[];
  signatures: { role: "client" | "provider"; name: string; at: Date; mfa: boolean; hashPrefix: string }[];
  decidedBy: string | null; decidedAt: Date | null; decisionNote: string | null; appliedAt: Date | null; returns: ChangeOrderReturn[]; continuationId: string | null;
}
export interface ChangeOrderRoom {
  orders: ChangeOrderView[]; open: ChangeOrderView | null; openStale: string | null;
  milestones: { code: string; title: string; type: "GATE" | "PAY"; day: number; amountCents: number; state: string; trancheIdx: number; trancheState: string; frozen: boolean; proof: import("@/db/schema").ProofSpec; lockRule: string; disputeRule: string }[];
}

async function views(q: Q, rows: CoRow[], currency: string): Promise<ChangeOrderView[]> {
  if (!rows.length) return [];
  const sigs = await q.select().from(changeOrderSignatures).where(inArray(changeOrderSignatures.changeOrderId, rows.map((r) => r.id))).orderBy(asc(changeOrderSignatures.createdAt));
  const ids = [...new Set([...rows.flatMap((r) => [r.proposedBy, r.decidedBy ?? ""]), ...sigs.map((s) => s.signerId)].filter(Boolean))];
  const ppl = await q.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  const name = (id: string) => ppl.find((p) => p.id === id)?.name ?? id;
  return rows.map((r) => ({
    id: r.id, no: r.no, state: r.state, revNo: r.revNo, baseRevNo: r.baseRevNo, hash: r.hash, note: r.note, createdAt: r.createdAt,
    proposedBy: { id: r.proposedBy, name: name(r.proposedBy), role: r.proposedRole }, items: r.items as CoItem[], diff: r.diff as unknown as CoDiff, money: r.money as unknown as MoneyPlan,
    lines: moneyLines(r.money as unknown as MoneyPlan, (c) => formatCents(c, currency)),
    totalFromCents: r.totalFromCents, totalToCents: r.totalToCents, risk: r.risk, riskParts: r.riskParts, violations: r.violations,
    signatures: sigs.filter((s) => s.changeOrderId === r.id).map((s) => ({ role: s.role, name: name(s.signerId), at: s.createdAt, mfa: s.mfa, hashPrefix: s.hash.slice(0, 12) })),
    decidedBy: r.decidedBy ? name(r.decidedBy) : null, decidedAt: r.decidedAt, decisionNote: r.decisionNote, appliedAt: r.appliedAt, returns: r.returns, continuationId: r.continuationId,
  }));
}

/** Everything the contract room needs for change orders. Parties and organisation-wide roles (Ops, admin…) can read. */
export async function changeOrderRoom(a: Actor, workspaceId: string): Promise<ChangeOrderRoom> {
  const w = await loadWs(db, workspaceId);
  await assertCanRead(db, a, w);
  const rows = await db.select().from(changeOrders).where(eq(changeOrders.workspaceId, w.id)).orderBy(desc(changeOrders.no));
  const orders = await views(db, rows, w.currency);
  const open = orders.find((o) => (OPEN_STATES as readonly string[]).includes(o.state)) ?? null;
  const openRow = open ? rows.find((r) => r.id === open.id)! : null;
  const openStale = openRow && openRow.state === "PROPOSED" ? await staleness(db, w, openRow) : null;
  const [ms, trs] = await Promise.all([loadMs(db, w.id), db.select().from(tranches).where(eq(tranches.workspaceId, w.id))]);
  const ids = ms.map((m) => m.id);
  const ev = new Set((ids.length ? await db.selectDistinct({ id: evidencePackages.milestoneId }).from(evidencePackages).where(inArray(evidencePackages.milestoneId, ids)) : []).map((e) => e.id));
  return {
    orders, open, openStale,
    milestones: ms.filter((m) => m.active).sort((x, y) => x.targetDay - y.targetDay || x.seq - y.seq).map((m) => ({
      code: m.code, title: m.title, type: m.type, day: m.targetDay, amountCents: m.amountCents, state: m.state, trancheIdx: m.trancheIdx,
      trancheState: trs.find((t) => t.idx === m.trancheIdx)?.state ?? "PLANNED", frozen: isFrozen(m, ev), proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule,
    })),
  };
}

/** Change orders both parties signed that wait for Operations (risk ≥ 75), for the clearance queue. */
export async function changeOrderQueue(a: Actor): Promise<{ id: string; no: number; workspaceId: string; title: string; client: string; provider: string; totalFromCents: number; totalToCents: number; risk: { score: number; parts: Record<string, number> }; lines: string[]; waitingMinutes: number; revNo: number }[]> {
  if (!can(a.role, "contract.clear_high_risk")) throw new DomainError("FORBIDDEN", "Only Operations can see the clearance queue.");
  const me = await actorUser(db, a);
  const rows = await db.select({ co: changeOrders, w: workspaces }).from(changeOrders).innerJoin(workspaces, eq(workspaces.id, changeOrders.workspaceId))
    .where(and(eq(changeOrders.state, "AWAITING_OPS"), eq(workspaces.orgId, me.orgId), excludeSim(workspaces.id, workspaces.orgId, { keepTest: isTestOrgId(me.orgId) }))).orderBy(asc(changeOrders.createdAt));
  const out = [];
  for (const { co, w } of rows) {
    const ppl = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [w.clientId, w.providerId ?? w.clientId]));
    const [last] = await db.select({ at: changeOrderSignatures.createdAt }).from(changeOrderSignatures).where(eq(changeOrderSignatures.changeOrderId, co.id)).orderBy(desc(changeOrderSignatures.createdAt)).limit(1);
    const since = last?.at ?? co.createdAt;
    out.push({
      id: co.id, no: co.no, workspaceId: w.id, title: w.title, client: ppl.find((p) => p.id === w.clientId)?.name ?? "", provider: ppl.find((p) => p.id === w.providerId)?.name ?? "—",
      totalFromCents: co.totalFromCents, totalToCents: co.totalToCents, risk: { score: co.risk, parts: co.riskParts }, lines: moneyLines(co.money as unknown as MoneyPlan, (c) => formatCents(c, w.currency)),
      waitingMinutes: Math.max(0, Math.floor(((await workspaceNow(w.id)).getTime() - since.getTime()) / 60_000)), revNo: co.revNo,
    });
  }
  return out;
}
