/**
 * F2.13 — change orders on a locked contract: the pure planner (no I/O). Given the contract as it stands (milestones with
 * their states, tranches with theirs) and a list of items, it returns the amended contract, the money plan and the
 * canonical document both parties sign. The same inputs always give the same document and hash, so the server re-plans
 * at signing and at apply time and refuses when anything moved in between (a tranche was funded, a milestone was
 * submitted…). After lock, amounts in cents are authoritative: shares (bps) are derived from the cents.
 *
 * Money rules (no money moves here; the money module executes the plan through its existing functions):
 *  - added milestones go into new PLANNED tranche(s) after the last one, split by the rail's hold cap; the client funds
 *    them through the normal fund → PayPal approval flow;
 *  - a milestone whose tranche is not funded yet (PLANNED) just changes; the tranche amount follows;
 *  - a reduction or a removal in a held tranche (HELD, PARTIALLY_RELEASED) is returned to the client from that hold;
 *  - an increase in a held tranche moves the milestone to a new PLANNED tranche (its held amount goes back, the new
 *    amount is funded fresh), because a PayPal hold can never grow;
 *  - any other tranche state (waiting for PayPal approval, settling, rolled over, paused, closed) refuses money changes.
 * Milestones that are submitted or later (or have any evidence) are frozen and cannot be touched.
 */
import { canonical } from "@/lib/canonical";
import { BPS_FULL, splitByBps } from "@/lib/money";
import { trancheOf, type Rail } from "@/lib/policy";
import type { ProofSpec } from "@/db/schema";
import { canonicalDoc, nextCode, type ClDraft, type MsDraft, type WsHead } from "./core";
import { DomainError } from "../types";

/** Milestone states a change order may touch (and only with no evidence submitted). Everything else is frozen. */
export const UNSTARTED = ["LOCKED", "OPEN"] as const;
export const FROZEN_STATES = ["SUBMITTED", "REMEDIATION", "APPROVED", "RELEASED", "DISPUTED", "ESCALATED", "SETTLED_BY_VERDICT", "REFUNDED"] as const;
/** Tranche states in which PayPal holds the money and a part of it can be returned. */
const HELD = ["HELD", "PARTIALLY_RELEASED"];

export interface CoMilestoneIn { title: string; type: "GATE" | "PAY"; day: number; amountCents: number; proof: ProofSpec; lockRule: string; disputeRule: string }
export type CoItem =
  | { action: "ADD"; milestone: CoMilestoneIn }
  | { action: "EDIT"; milestoneCode: string; title?: string; day?: number; amountCents?: number; proof?: ProofSpec; lockRule?: string; disputeRule?: string }
  | { action: "REMOVE"; milestoneCode: string };

export interface CoTranche { idx: number; state: string; amountCents: number; paused?: boolean }
export interface PlanInput {
  head: WsHead; baseRevNo: number; baseHash: string; no: number; actorId: string;
  ms: MsDraft[]; cl: ClDraft[]; tranches: CoTranche[];
  /** Milestone ids that have evidence (any attempt): frozen whatever their state says. */
  withEvidence: Set<string>;
  items: CoItem[];
  /** Codes of the milestones a continuation carries over (the parent removes them); shown in the plan. */
  carriedTo?: string | null;
}
export interface FundLine { trancheIdx: number; amountCents: number; startDay: number; endDay: number; codes: string[] }
export interface ReturnLine { trancheIdx: number; amountCents: number; items: { milestoneCode: string | null; amountCents: number }[] }
export interface PlannedLine { trancheIdx: number; fromCents: number; toCents: number }
export interface MoneyPlan { fund: FundLine[]; returns: ReturnLine[]; planned: PlannedLine[]; moved: { code: string; fromTranche: number; toTranche: number }[]; netCents: number }
export interface CoDiff {
  added: { code: string; title: string; type: "GATE" | "PAY"; day: number; amountCents: number }[];
  removed: { code: string; title: string; amountCents: number }[];
  changed: { code: string; title: string; fields: { field: "title" | "day" | "amount" | "proof" | "criteria" | "lockRule" | "disputeRule"; from: string | number; to: string | number }[] }[];
  totalFromCents: number; totalToCents: number;
}
export interface Plan {
  ms: MsDraft[]; head: WsHead; touched: Set<string>; added: Set<string>; unfund: Set<string>;
  money: MoneyPlan; diff: CoDiff; revNo: number;
  /** New PLANNED tranches to create, and the new amounts of existing PLANNED tranches. */
  newTranches: FundLine[]; plannedAmounts: Map<number, number>;
  /** Cents to add to amended_out_cents per held tranche (what goes back to the client from it). */
  amendedOut: Map<number, number>;
  doc: ReturnType<typeof changeOrderDoc>;
}

export const isFrozen = (m: Pick<MsDraft, "state" | "id">, withEvidence: Set<string>) => !(UNSTARTED as readonly string[]).includes(m.state) || withEvidence.has(m.id);

/** Shares derived from cents after lock (largest remainder, they add up to exactly 100% when any money is left). */
export function bpsFromCents(ms: MsDraft[]): void {
  const pay = ms.filter((m) => m.active && m.type === "PAY");
  const sum = pay.reduce((s, m) => s + m.amountCents, 0);
  const bps = sum > 0 ? splitByBps(BPS_FULL, pay.map((m) => m.amountCents)) : pay.map(() => 0);
  for (const m of ms) if (!m.active || m.type !== "PAY") m.bps = 0;
  pay.forEach((m, i) => (m.bps = bps[i]));
}

/** The document both parties sign: the amended contract (next revision) plus what the change order is and what money it moves. */
export function changeOrderDoc(h: WsHead, revNo: number, ms: MsDraft[], cl: ClDraft[], amends: { changeOrder: number; baseRevNo: number; baseHash: string; items: CoItem[]; money: MoneyPlan; carriedTo: string | null }) {
  return { ...canonicalDoc(h, revNo, ms, cl), amends: { kind: "paysettle.change_order", ...amends } };
}

/* canonical JSON: key order differs between blueprint data, form input and Postgres jsonb, and must not count as a change */
const same = (a: unknown, b: unknown) => canonical(a ?? null) === canonical(b ?? null);
const artifactsText = (p: ProofSpec) => p.artifacts.map((a) => `${a.min} × ${a.kind}${a.note ? ` (${a.note})` : ""}`).join(", ") || "none";

export function planChangeOrder(i: PlanInput): Plan {
  if (!i.items.length) throw new DomainError("NO_CHANGE", "A change order needs at least one change.");
  const ms: MsDraft[] = i.ms.map((m) => ({ ...m, proof: structuredClone(m.proof), dependsOn: [...m.dependsOn] }));
  const head: WsHead = { ...i.head };
  const rail = head.rail as Rail;
  const trancheOfIdx = new Map(i.tranches.map((t) => [t.idx, t]));
  const totalFrom = ms.filter((m) => m.active && m.type === "PAY").reduce((s, m) => s + m.amountCents, 0);
  const seen = new Set<string>();
  const touched = new Set<string>(), added = new Set<string>(), unfund = new Set<string>();
  const diff: CoDiff = { added: [], removed: [], changed: [], totalFromCents: totalFrom, totalToCents: totalFrom };
  const returns = new Map<number, ReturnLine>();
  const amendedOut = new Map<number, number>();
  const plannedAmounts = new Map<number, number>();
  const moved: MoneyPlan["moved"] = [];
  const toNewTranche: MsDraft[] = [];

  const findOpen = (code: string) => {
    const m = ms.find((x) => x.code === code && x.active);
    if (!m) throw new DomainError("NOT_FOUND", `Milestone ${code} is not an active part of this contract.`);
    if (seen.has(code)) throw new DomainError("INVALID_INPUT", `${code} appears twice in this change order. Put all of its changes in one item.`);
    seen.add(code);
    if (isFrozen(m, i.withEvidence)) throw new DomainError("MILESTONE_FROZEN", `${m.code} “${m.title}” has ${i.withEvidence.has(m.id) && (UNSTARTED as readonly string[]).includes(m.state) ? "evidence submitted" : `moved on (${m.state.toLowerCase().replace(/_/g, " ")})`}, so it can no longer be changed. Only milestones that have not started can be changed or removed.`);
    return m;
  };
  /** Checks the milestone's tranche allows a money change and returns its state class. */
  const moneyClass = (m: MsDraft): "PLANNED" | "HELD" => {
    const t = trancheOfIdx.get(m.trancheIdx);
    if (!t) throw new DomainError("NOT_FOUND", `Tranche ${m.trancheIdx} of ${m.code} does not exist.`);
    if (t.state === "PLANNED") return "PLANNED";
    if (HELD.includes(t.state) && !t.paused) return "HELD";
    const why = t.state === "AWAITING_APPROVAL" ? "is waiting for the client's PayPal approval; let that finish (or expire) first"
      : t.paused ? "is paused by an open PayPal dispute" : `is ${t.state.toLowerCase().replace(/_/g, " ")}`;
    throw new DomainError("TRANCHE_BUSY", `The amount of ${m.code} cannot change now: tranche ${t.idx} ${why}.`);
  };
  const addReturn = (idx: number, code: string | null, cents: number) => {
    if (cents <= 0) return;
    const r = returns.get(idx) ?? { trancheIdx: idx, amountCents: 0, items: [] };
    r.amountCents += cents; r.items.push({ milestoneCode: code, amountCents: cents }); returns.set(idx, r);
    amendedOut.set(idx, (amendedOut.get(idx) ?? 0) + cents);
  };
  const planned = (idx: number, delta: number) => {
    const base = plannedAmounts.get(idx) ?? trancheOfIdx.get(idx)?.amountCents ?? 0;
    plannedAmounts.set(idx, base + delta);
  };

  for (const it of i.items) {
    if (it.action === "ADD") {
      const nm = it.milestone;
      if (nm.type === "PAY" && nm.amountCents < 100) throw new DomainError("INVALID_INPUT", `“${nm.title}” is a payment milestone; give it an amount of at least $1.00.`);
      if (nm.type === "PAY" && head.deadline?.early) throw new DomainError("DEADLINE_TERMS", "This contract has an early-finish bonus funded with its holds, and a change order cannot grow that pool. Start a continuation contract for the new work instead.");
      const code = nextCode("C", ms.map((m) => m.code));
      const seq = Math.max(0, ...ms.map((m) => m.seq)) + 10;
      const m: MsDraft = { id: `new:${code}`, seq, code, origin: "CUSTOM", active: true, prunedBy: null, type: nm.type, title: nm.title, targetDay: nm.day, bps: 0, amountCents: nm.type === "GATE" ? 0 : nm.amountCents, proof: nm.proof, lockRule: nm.lockRule, disputeRule: nm.disputeRule, dependsOn: [], trancheIdx: 0, state: "LOCKED" };
      ms.push(m); added.add(code); touched.add(code); toNewTranche.push(m);
      diff.added.push({ code, title: m.title, type: m.type, day: m.targetDay, amountCents: m.amountCents });
      continue;
    }
    const m = findOpen(it.milestoneCode);
    touched.add(m.code);
    if (it.action === "REMOVE") {
      if (m.type === "PAY" && m.amountCents > 0) {
        if (moneyClass(m) === "PLANNED") planned(m.trancheIdx, -m.amountCents);
        else addReturn(m.trancheIdx, m.code, m.amountCents);
      }
      m.active = false; m.prunedBy = i.actorId;
      diff.removed.push({ code: m.code, title: m.title, amountCents: m.type === "PAY" ? m.amountCents : 0 });
      continue;
    }
    /* EDIT */
    const fields: CoDiff["changed"][number]["fields"] = [];
    if (it.title !== undefined && it.title !== m.title) { fields.push({ field: "title", from: m.title, to: it.title }); m.title = it.title; }
    if (it.day !== undefined && it.day !== m.targetDay) { fields.push({ field: "day", from: m.targetDay, to: it.day }); m.targetDay = it.day; }
    if (it.proof !== undefined) {
      if (!same(it.proof.artifacts, m.proof.artifacts) || !same(it.proof.oracle, m.proof.oracle) || !same(it.proof.gpsRadiusM, m.proof.gpsRadiusM)) fields.push({ field: "proof", from: artifactsText(m.proof), to: artifactsText(it.proof) });
      if (!same(it.proof.criteria, m.proof.criteria)) fields.push({ field: "criteria", from: m.proof.criteria.join(" · ") || "none", to: it.proof.criteria.join(" · ") || "none" });
      m.proof = it.proof;
    }
    if (it.lockRule !== undefined && it.lockRule !== m.lockRule) { fields.push({ field: "lockRule", from: m.lockRule, to: it.lockRule }); m.lockRule = it.lockRule; }
    if (it.disputeRule !== undefined && it.disputeRule !== m.disputeRule) { fields.push({ field: "disputeRule", from: m.disputeRule, to: it.disputeRule }); m.disputeRule = it.disputeRule; }
    if (it.amountCents !== undefined && it.amountCents !== m.amountCents) {
      if (m.type !== "PAY") throw new DomainError("INVALID_INPUT", `${m.code} is an information step and carries no payment.`);
      if (it.amountCents < 100) throw new DomainError("INVALID_INPUT", `${m.code}: give an amount of at least $1.00, or remove the milestone.`);
      const from = m.amountCents, to = it.amountCents;
      if (to > from && head.deadline?.early) throw new DomainError("DEADLINE_TERMS", "This contract has an early-finish bonus funded with its holds, and a change order cannot grow that pool. Start a continuation contract for the new work instead.");
      const cls = moneyClass(m);
      if (cls === "PLANNED") planned(m.trancheIdx, to - from);
      else if (to < from) addReturn(m.trancheIdx, null, from - to); // the rest stays held for this milestone
      else { // a hold never grows: the held amount goes back and the new amount is funded in a new tranche
        addReturn(m.trancheIdx, m.code, from);
        moved.push({ code: m.code, fromTranche: m.trancheIdx, toTranche: 0 });
        if (m.state === "OPEN") unfund.add(m.code);
        toNewTranche.push(m);
      }
      fields.push({ field: "amount", from, to }); m.amountCents = to;
    }
    if (!fields.length) throw new DomainError("NO_CHANGE", `Nothing changes for ${m.code}.`);
    diff.changed.push({ code: m.code, title: m.title, fields });
  }

  /* new PLANNED tranches for added (and moved) milestones, after the last tranche, split by the rail's hold cap */
  const newTranches: FundLine[] = [];
  if (toNewTranche.length) {
    const top = Math.max(0, ...i.tranches.map((t) => t.idx), ...ms.map((m) => m.trancheIdx));
    const sorted = [...toNewTranche].sort((a, b) => a.targetDay - b.targetDay || a.seq - b.seq);
    const idx = trancheOf(sorted.map((m) => ({ code: m.code, type: m.type, day: m.targetDay, bps: 0, amountCents: m.amountCents, active: true, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: [] })), rail);
    sorted.forEach((m, k) => {
      m.trancheIdx = top + idx[k];
      const line = newTranches.find((t) => t.trancheIdx === m.trancheIdx) ?? (newTranches.push({ trancheIdx: m.trancheIdx, amountCents: 0, startDay: m.targetDay, endDay: m.targetDay, codes: [] }), newTranches[newTranches.length - 1]);
      line.amountCents += m.type === "PAY" ? m.amountCents : 0; line.endDay = Math.max(line.endDay, m.targetDay); line.codes.push(m.code);
    });
    for (const mv of moved) mv.toTranche = ms.find((m) => m.code === mv.code)!.trancheIdx;
  }

  bpsFromCents(ms);
  head.totalCents = ms.filter((m) => m.active && m.type === "PAY").reduce((s, m) => s + m.amountCents, 0);
  diff.totalToCents = head.totalCents;
  const money: MoneyPlan = {
    fund: newTranches,
    returns: [...returns.values()].sort((a, b) => a.trancheIdx - b.trancheIdx),
    planned: [...plannedAmounts.entries()].sort((a, b) => a[0] - b[0]).map(([idx, to]) => ({ trancheIdx: idx, fromCents: trancheOfIdx.get(idx)?.amountCents ?? 0, toCents: to })),
    moved, netCents: head.totalCents - totalFrom,
  };
  const revNo = i.baseRevNo + 1;
  const doc = changeOrderDoc(head, revNo, ms, i.cl, { changeOrder: i.no, baseRevNo: i.baseRevNo, baseHash: i.baseHash, items: i.items, money, carriedTo: i.carriedTo ?? null });
  return { ms, head, touched, added, unfund, money, diff, revNo, newTranches, plannedAmounts, amendedOut, doc };
}

/** Plain-words money impact lines for the review panel ("+$1,200.00 to fund as tranche 3"). */
export function moneyLines(p: MoneyPlan, fmt: (c: number) => string): string[] {
  const out: string[] = [];
  for (const f of p.fund) if (f.amountCents > 0) out.push(`+${fmt(f.amountCents)} to fund as tranche ${f.trancheIdx} (${f.codes.join(", ")}); the client approves it in PayPal as usual.`);
  for (const r of p.returns) out.push(`${fmt(r.amountCents)} goes back to the client's PayPal from tranche ${r.trancheIdx}.`);
  for (const l of p.planned) if (l.fromCents !== l.toCents) out.push(`Tranche ${l.trancheIdx} is not funded yet: it changes from ${fmt(l.fromCents)} to ${fmt(l.toCents)}.`);
  for (const mv of p.moved) out.push(`${mv.code} moves from tranche ${mv.fromTranche} to tranche ${mv.toTranche}, because a PayPal hold cannot grow.`);
  if (!out.length) out.push("No money moves: only the terms change.");
  return out;
}
