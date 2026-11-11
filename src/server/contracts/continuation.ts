/**
 * F2.14 continuation contracts: roll a LOCKED contract into its next period (a monthly retainer, month 2 of a build).
 * Either party starts it. The new contract is a DRAFT linked to its parent (parent_workspace_id, period_no): same
 * parties, blueprint, currency, fee, rail, clauses and deadline terms; optionally the parent's milestone template again
 * (a retainer's next month) and/or the parent's unfinished milestones carried over. Carried milestones are MOVED: the
 * parent removes them through a change order (F2.13), and the new period cannot be signed until both parties have signed
 * that change order, so no milestone is ever paid twice. The draft then goes through normal negotiation, signing, lock
 * and funding. Nothing is ever charged automatically. The signing gate lives in sign() (./index.ts, carryBlock).
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { evidencePackages, workspaces, wsMilestones } from "@/db/schema";
import { changeOrders } from "@/db/schema-amend";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { canWrite } from "@/lib/rbac";
import { workspaceMachine } from "@/lib/fsm";
import type { Rail } from "@/lib/policy";
import { normalizeTerms } from "@/lib/deadline";
import { noticeParties } from "../money";
import { DomainError, type Actor } from "../types";
import { evaluate, recomputeTranches, type ClDraft, type MsDraft, type WsHead } from "./core";
import { bpsFromCents, isFrozen } from "./change-core";
import { proposeChangeOrder } from "./change-orders";
import { internals } from "./index";

const { loadWs, loadMs, loadCl, providerFacts, assertCanRead, partyRole, saveMs, saveCl, writeRevision } = internals;
const zIn = z.object({
  title: z.string().trim().min(3).max(120).optional(),
  repeat: z.boolean(),
  carry: z.array(z.string().min(1).max(40)).max(50),
  note: z.string().trim().max(500).optional(),
});

/** The chain around a contract: its parent and its (live) next period. */
export async function periodChain(a: Actor, workspaceId: string): Promise<{ periodNo: number; parent: { id: string; title: string; periodNo: number } | null; next: { id: string; title: string; periodNo: number; state: string } | null }> {
  const w = await loadWs(db, workspaceId);
  await assertCanRead(db, a, w);
  const [parent] = w.parentWorkspaceId ? await db.select({ id: workspaces.id, title: workspaces.title, periodNo: workspaces.periodNo }).from(workspaces).where(eq(workspaces.id, w.parentWorkspaceId)).limit(1) : [];
  const [next] = await db.select({ id: workspaces.id, title: workspaces.title, periodNo: workspaces.periodNo, state: workspaces.state }).from(workspaces)
    .where(and(eq(workspaces.parentWorkspaceId, w.id), ne(workspaces.state, "ABANDONED"))).orderBy(asc(workspaces.createdAt)).limit(1);
  return { periodNo: w.periodNo, parent: parent ?? null, next: next ?? null };
}

/** Milestones of a locked contract that can be carried into the next period (active, not started, no evidence). */
export async function carryable(a: Actor, workspaceId: string): Promise<{ code: string; title: string; type: "GATE" | "PAY"; amountCents: number; day: number }[]> {
  const w = await loadWs(db, workspaceId);
  await assertCanRead(db, a, w);
  const ms = await loadMs(db, w.id);
  const ids = ms.map((m) => m.id);
  const ev = new Set((ids.length ? await db.selectDistinct({ id: evidencePackages.milestoneId }).from(evidencePackages).where(inArray(evidencePackages.milestoneId, ids)) : []).map((e) => e.id));
  return ms.filter((m) => m.active && !isFrozen(m, ev)).sort((x, y) => x.targetDay - y.targetDay || x.seq - y.seq).map((m) => ({ code: m.code, title: m.title, type: m.type, amountCents: m.amountCents, day: m.targetDay }));
}

export async function createContinuation(a: Actor, parentId: string, input: { title?: string; repeat: boolean; carry: string[]; note?: string }): Promise<{ workspaceId: string; changeOrderId: string | null }> {
  if (!canWrite(a.role, "contract.create")) throw new DomainError("FORBIDDEN", "Your role cannot start contracts.");
  const p = zIn.safeParse({ ...input, title: input.title?.trim() || undefined, note: input.note?.trim() || undefined });
  if (!p.success) throw new DomainError("INVALID_INPUT", p.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  const parent = await loadWs(db, parentId);
  partyRole(a, parent);
  if (parent.state !== "LOCKED") throw new DomainError("NOT_LOCKED", "Only a signed, locked contract can continue into a next period.");
  if (!parent.providerId) throw new DomainError("STATE", "This contract has no provider yet.");
  const [child] = await db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces).where(and(eq(workspaces.parentWorkspaceId, parent.id), ne(workspaces.state, "ABANDONED"))).limit(1);
  if (child) throw new DomainError("ALREADY_CONTINUED", `This contract already continues in “${child.title}”. Continue from that period instead.`);
  const carry = [...new Set(p.data.carry)];
  if (!p.data.repeat && !carry.length) throw new DomainError("INVALID_INPUT", "Repeat this period's milestones, carry some over, or both. More milestones can be added in the negotiation room.");

  const src = await loadMs(db, parent.id);
  const byCode = new Map(src.filter((m) => m.active).map((m) => [m.code, m]));
  for (const c of carry) if (!byCode.has(c)) throw new DomainError("NOT_FOUND", `Milestone ${c} is not an active part of this contract.`);
  const periodNo = parent.periodNo + 1;
  const id = newId("ws");
  const title = p.data.title ?? `${parent.title.replace(/ · period \d+$/, "")} · period ${periodNo}`;

  /* carried milestones are removed from the parent by a change order (validates that each has not started) */
  const changeOrderId = carry.length
    ? await proposeChangeOrder(a, parent.id, { items: carry.map((c) => ({ action: "REMOVE" as const, milestoneCode: c })), note: `Moves ${carry.join(", ")} into period ${periodNo} (“${title}”).${p.data.note ? ` ${p.data.note}` : ""}`, expectedRev: parent.revision }, { continuationId: id })
    : null;

  try {
    const template = p.data.repeat ? src.filter((m) => m.active).map((m) => ({ m, carriedFrom: null as string | null })) : [];
    const carried = carry.map((c) => ({ m: byCode.get(c)!, carriedFrom: byCode.get(c)!.id }));
    const list = [...template, ...carried].sort((x, y) => x.m.targetDay - y.m.targetDay || x.m.seq - y.m.seq);
    const ms: MsDraft[] = list.map(({ m }, i) => ({
      id: newId("ms"), seq: (i + 1) * 10, code: `M${String(i + 1).padStart(2, "0")}`, origin: m.origin, active: true, prunedBy: null, type: m.type, title: m.title,
      targetDay: m.targetDay, bps: 0, amountCents: m.type === "PAY" ? m.amountCents : 0, proof: structuredClone(m.proof), lockRule: m.lockRule, disputeRule: m.disputeRule,
      dependsOn: [], trancheIdx: 1, state: "DRAFT",
    }));
    const carriedFrom = new Map(list.map(({ carriedFrom: cf }, i) => [ms[i].id, cf]));
    const cl: ClDraft[] = (await loadCl(db, parent.id)).map((c) => ({ ...c, id: newId("cl") }));
    const total = ms.filter((m) => m.type === "PAY").reduce((s, m) => s + m.amountCents, 0);
    if (total <= 0) throw new DomainError("INVALID_INPUT", "The next period needs at least one payment milestone.");
    const h: WsHead = { id, title, blueprintCode: parent.blueprintCode, currency: parent.currency, totalCents: total, feeBps: parent.feeBps, rail: parent.rail as Rail, clientId: parent.clientId, providerId: parent.providerId, inviteEmail: null, reviewTimeoutRule: parent.reviewTimeoutRule, deadline: normalizeTerms(parent.deadlineTerms) };
    bpsFromCents(ms); // shares from the cents of the template and the carried milestones; the cents stay exact
    recomputeTranches(ms, h.rail);
    const facts = await providerFacts(db, parent.providerId);
    const ev = evaluate(h, ms, cl, facts.payable, facts.tier);
    const state = ev.violations.length ? "DRAFT" : workspaceMachine.next("DRAFT", "gate_pass");
    await db.transaction(async (tx) => {
      await tx.insert(workspaces).values({ id, orgId: parent.orgId, blueprintCode: parent.blueprintCode, title, clientId: parent.clientId, providerId: parent.providerId, inviteEmail: null, currency: parent.currency, totalCents: total, feeBps: parent.feeBps, rail: parent.rail, state, revision: 1, riskScore: ev.risk.score, reviewTimeoutRule: parent.reviewTimeoutRule, deadlineTerms: parent.deadlineTerms ?? null, parentWorkspaceId: parent.id, periodNo });
      await saveMs(tx, id, ms);
      for (const [msId, cf] of carriedFrom) if (cf) await tx.update(wsMilestones).set({ carriedFrom: cf }).where(eq(wsMilestones.id, msId));
      await saveCl(tx, id, cl);
      const hash = await writeRevision(tx, h, 1, ms, cl, a.id, { action: "CREATE", detail: { blueprint: parent.blueprintCode, source: "continuation", parent: parent.id, periodNo, repeat: p.data.repeat, carried: carry, changeOrderId } });
      await tx.update(workspaces).set({ canonicalHash: hash }).where(eq(workspaces.id, id));
      await audit(tx, a, "contract.continuation_created", id, { parent: parent.id, periodNo, repeat: p.data.repeat, carried: carry, changeOrderId, totalCents: total });
    });
  } catch (e) {
    if (changeOrderId) await db.update(changeOrders).set({ state: "WITHDRAWN", decidedBy: a.id, decidedAt: new Date(), decisionNote: "The next-period contract could not be created." }).where(and(eq(changeOrders.id, changeOrderId), eq(changeOrders.state, "PROPOSED")));
    throw e;
  }
  const other = a.id === parent.clientId ? parent.providerId : parent.clientId;
  await noticeParties(id, "CONTINUATION", `“${parent.title}” continues into period ${periodNo}: “${title}” is a draft to review and sign${carry.length ? `. It carries ${carry.join(", ")}, which the current contract removes by change order once both of you sign it` : ""}.`, `continued:${id}`, other ? [other] : []);
  return { workspaceId: id, changeOrderId };
}
