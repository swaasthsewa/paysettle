/**
 * F2.04 F3.03 F3.11 F4.01 — pure builders for the Bryntum timelines (no React, no Bryntum import: runs in tests and on the
 * server, and returns only plain, serialisable data for the client components).
 *  - Contract Gantt: milestones as bars from the previous milestone's day to their own target day, tranches as summary
 *    rows and shaded bands (the PayPal hold window once funded), dependencies (explicit, else the sequence), now line.
 *  - Mediator schedule: one row per mediator (plus "Not assigned yet"), one bar per case from opening to its last
 *    deadline, with the sealed-offer, vault and verdict phases inside it.
 * Contract day N is N days after the anchor: the first tranche's hold in PayPal (as the ops radar counts days), else the
 * signing, else now (a projection for contracts that are not signed yet).
 */
import { formatCents } from "@/lib/money";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export type MsTone = "held" | "released" | "disputed" | "refunded" | "draft" | "gate";
export const TONE_LABEL: Record<MsTone, string> = {
  held: "Held in PayPal", released: "Released", disputed: "Disputed or being fixed", refunded: "Returned to client", draft: "Not funded yet", gate: "Gate (no money)",
};
const RELEASED = new Set(["RELEASED", "SETTLED_BY_VERDICT"]);
const DISPUTED = new Set(["DISPUTED", "ESCALATED", "REMEDIATION"]);
const REFUNDED = new Set(["REFUNDED"]);
const MS_LABEL: Record<string, string> = {
  DRAFT: "Draft", LOCKED: "Waiting for earlier milestones", OPEN: "Open for work", SUBMITTED: "Evidence in review", APPROVED: "Approved",
  RELEASED: "Released", SETTLED_BY_VERDICT: "Settled by verdict", DISPUTED: "Disputed", ESCALATED: "Escalated", REMEDIATION: "Fix requested", REFUNDED: "Returned to client",
};
export const msStateLabel = (s: string) => MS_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Where a milestone's money is, for colour: released, disputed, returned, held (funded tranche) or not funded yet. */
export function msTone(state: string, type: "GATE" | "PAY", funded: boolean): MsTone {
  if (type === "GATE") return DISPUTED.has(state) ? "disputed" : "gate";
  if (RELEASED.has(state)) return "released";
  if (DISPUTED.has(state)) return "disputed";
  if (REFUNDED.has(state)) return "refunded";
  return funded ? "held" : "draft";
}

export interface PlanInput {
  id: string; title: string; currency: string; state: string;
  milestones: { id: string; seq: number; code: string; title: string; type: "GATE" | "PAY"; active: boolean; targetDay: number; amountCents: number; dependsOn: string[]; trancheIdx: number; state: string }[];
  tranches: { id: string; idx: number; amountCents: number; startDay: number; endDay: number; state: string; heldAt: Date | null; windowEndsAt: Date | null }[];
  signatures: { voided: boolean; at: Date }[];
}
export interface PlanTask {
  id: string; name: string; startDate: string; endDate: string; manuallyScheduled: true; expanded?: boolean;
  kind: "tranche" | "pay" | "gate"; code: string; state: string; stateLabel: string; tone: MsTone; amountCents: number; amountLabel: string;
  dayFrom: number; dayTo: number; href: string | null; eventColor: string; cls: string; children?: PlanTask[];
}
export interface PlanDep { id: string; from: string; to: string; implicit: boolean; cls: string }
export interface PlanBand { id: string; name: string; startDate: string; endDate?: string; cls: string }
export interface ContractPlan {
  workspaceId: string; title: string; currency: string;
  anchor: string; anchorKind: "funded" | "signed" | "projected"; now: string; virtual: boolean;
  startDate: string; endDate: string;
  tasks: PlanTask[]; dependencies: PlanDep[]; timeRanges: PlanBand[];
  rows: { id: string; tranche: string; code: string; title: string; type: string; from: number; to: number; due: string; amount: number; state: string; where: string; open: { href: string; label: string } }[];
  counts: Record<MsTone, number>;
}

export const TONE_COLOR: Record<MsTone, string> = {
  held: "var(--held)", released: "var(--released)", disputed: "var(--disputed)", refunded: "var(--refunded)", draft: "var(--ink-4)", gate: "var(--g2)",
};

const at = (anchor: number, day: number) => new Date(anchor + day * DAY).toISOString();

export function buildContractPlan(v: PlanInput, now: Date, virtualOffsetHours = 0): ContractPlan {
  const held = v.tranches.map((t) => t.heldAt?.getTime()).filter((x): x is number => typeof x === "number");
  const signed = v.signatures.filter((s) => !s.voided).map((s) => s.at.getTime());
  const anchorKind: ContractPlan["anchorKind"] = held.length ? "funded" : signed.length ? "signed" : "projected";
  const anchor = held.length ? Math.min(...held) : signed.length ? Math.max(...signed) : now.getTime();
  const fundedIdx = new Set(v.tranches.filter((t) => t.heldAt).map((t) => t.idx));
  const ms = v.milestones.filter((m) => m.active).sort((a, b) => a.targetDay - b.targetDay || a.seq - b.seq);
  const byKey = new Map<string, (typeof ms)[number]>();
  for (const m of ms) { byKey.set(m.id, m); byKey.set(m.code, m); }
  const counts: Record<MsTone, number> = { held: 0, released: 0, disputed: 0, refunded: 0, draft: 0, gate: 0 };

  const children = new Map<number, PlanTask[]>();
  const deps: PlanDep[] = [];
  ms.forEach((m, i) => {
    const prevDay = i === 0 ? 0 : ms[i - 1].targetDay;
    const from = m.type === "GATE" ? m.targetDay : Math.min(prevDay, m.targetDay - 1);
    const tone = msTone(m.state, m.type, fundedIdx.has(m.trancheIdx));
    counts[tone] += 1;
    const task: PlanTask = {
      id: m.id, name: `${m.code} · ${m.title}`, startDate: at(anchor, from), endDate: at(anchor, m.targetDay), manuallyScheduled: true,
      kind: m.type === "GATE" ? "gate" : "pay", code: m.code, state: m.state, stateLabel: msStateLabel(m.state), tone,
      amountCents: m.type === "PAY" ? m.amountCents : 0, amountLabel: m.type === "PAY" ? formatCents(m.amountCents, v.currency) : "Gate",
      dayFrom: from, dayTo: m.targetDay, href: `/contracts/${v.id}/m/${m.id}`, eventColor: TONE_COLOR[tone], cls: `ps-ms ps-ms-${tone}`,
    };
    if (!children.has(m.trancheIdx)) children.set(m.trancheIdx, []);
    children.get(m.trancheIdx)!.push(task);
    const explicit = m.dependsOn.map((k) => byKey.get(k)).filter((d): d is (typeof ms)[number] => !!d && d.id !== m.id);
    if (explicit.length) for (const d of explicit) deps.push({ id: `dep-${d.id}-${m.id}`, from: d.id, to: m.id, implicit: false, cls: "ps-dep" });
    else if (i > 0) deps.push({ id: `seq-${ms[i - 1].id}-${m.id}`, from: ms[i - 1].id, to: m.id, implicit: true, cls: "ps-dep ps-dep-seq" });
  });

  const tasks: PlanTask[] = [];
  const bands: PlanBand[] = [];
  const trancheIdx = [...new Set([...v.tranches.map((t) => t.idx), ...children.keys()])].sort((a, b) => a - b);
  for (const idx of trancheIdx) {
    const t = v.tranches.find((x) => x.idx === idx);
    const kids = children.get(idx) ?? [];
    if (!kids.length && !t) continue;
    const dayFrom = kids.length ? Math.min(...kids.map((k) => k.dayFrom)) : Math.max(0, (t?.startDay ?? 1) - 1);
    const dayTo = kids.length ? Math.max(...kids.map((k) => k.dayTo)) : t?.endDay ?? dayFrom + 1;
    const funded = !!t?.heldAt;
    const amount = t?.amountCents ?? kids.reduce((s, k) => s + k.amountCents, 0);
    const tone: MsTone = t && ["CLOSED"].includes(t.state) ? "released" : t?.state === "BREAKER" ? "disputed" : funded ? "held" : "draft";
    tasks.push({
      id: `tranche-${idx}`, name: `Tranche ${idx}`, startDate: at(anchor, dayFrom), endDate: at(anchor, Math.max(dayTo, dayFrom + 1)), manuallyScheduled: true, expanded: true,
      kind: "tranche", code: `T${idx}`, state: t?.state ?? "PLANNED", stateLabel: funded ? `${formatCents(amount, v.currency)} held in PayPal` : "Not funded yet", tone,
      amountCents: amount, amountLabel: formatCents(amount, v.currency), dayFrom, dayTo, href: t && !funded ? `/contracts/${v.id}/fund/${t.id}` : null,
      eventColor: TONE_COLOR[tone], cls: `ps-tranche ps-ms-${tone}`, children: kids,
    });
    if (t) {
      const start = t.heldAt ? t.heldAt.toISOString() : at(anchor, Math.max(0, t.startDay - 1));
      const end = t.heldAt && t.windowEndsAt ? t.windowEndsAt.toISOString() : at(anchor, Math.max(t.endDay, t.startDay));
      bands.push({
        id: `band-${idx}`, cls: `ps-band ps-band-${idx % 2 ? "a" : "b"}${funded ? " ps-band-held" : ""}`, startDate: start, endDate: end,
        name: funded ? `Tranche ${idx}: ${formatCents(t.amountCents, v.currency)} held in PayPal until ${end.slice(0, 10)}` : `Tranche ${idx}: ${formatCents(t.amountCents, v.currency)} planned, days ${t.startDay}–${t.endDay}`,
      });
    }
  }
  const nowIso = now.toISOString();
  bands.push({ id: "now", name: virtualOffsetHours ? `Now (virtual clock, +${virtualOffsetHours} h)` : "Now", startDate: nowIso, cls: "ps-now" });

  const all = [anchor, now.getTime(), ...tasks.flatMap((t) => [Date.parse(t.startDate), Date.parse(t.endDate)]), ...bands.flatMap((b) => [Date.parse(b.startDate), b.endDate ? Date.parse(b.endDate) : NaN])].filter(Number.isFinite);
  const rows = ms.map((m) => {
    const task = children.get(m.trancheIdx)!.find((k) => k.id === m.id)!;
    return {
      id: m.id, tranche: `Tranche ${m.trancheIdx}`, code: m.code, title: m.title, type: m.type === "GATE" ? "Gate" : "Payment", from: task.dayFrom, to: m.targetDay,
      due: at(anchor, m.targetDay), amount: task.amountCents, state: m.state, where: TONE_LABEL[task.tone], open: { href: task.href!, label: "Open" },
    };
  });
  return {
    workspaceId: v.id, title: v.title, currency: v.currency, anchor: new Date(anchor).toISOString(), anchorKind, now: nowIso, virtual: virtualOffsetHours !== 0,
    startDate: new Date(Math.min(...all) - 2 * DAY).toISOString(), endDate: new Date(Math.max(...all) + 3 * DAY).toISOString(),
    tasks, dependencies: deps, timeRanges: bands, rows, counts,
  };
}

/* ── mediator schedule ── */
export interface CaseInput {
  id: string; state: string; amountCents: number; currency: string; mediatorId: string | null; createdAt: Date; tier1Until: Date; vaultUntil: Date;
  tier3Until: Date | null; fastTrack: boolean; workspace: string; milestone: string; now: Date;
}
export interface CaseEvent {
  id: string; resourceId: string; name: string; startDate: string; endDate: string; state: string; stateLabel: string; amountLabel: string;
  phases: { key: "offers" | "vault" | "verdict"; label: string; from: string; to: string; pct: number; current: boolean; past: boolean }[];
  next: { label: string; at: string } | null; overdue: boolean; href: string; eventColor: string; cls: string; workspace: string; milestone: string;
}
export const UNASSIGNED = "unassigned";
const OPEN = new Set(["TIER1", "AGREED", "TIER2", "TIER3", "EXECUTING"]);
const CASE_LABEL: Record<string, string> = { TIER1: "Sealed offers", AGREED: "Agreed by offers", TIER2: "Evidence vault", TIER3: "With a mediator", EXECUTING: "Paying out", RESOLVED: "Resolved", SUPERSEDED: "Superseded" };

/** Verdict deadline when the dispute table has none yet: 144 h after opening (72 h on fast track), as the SLA says. */
export function verdictDue(c: Pick<CaseInput, "tier3Until" | "createdAt" | "fastTrack" | "vaultUntil">): Date {
  if (c.tier3Until) return c.tier3Until;
  const sla = new Date(c.createdAt.getTime() + (c.fastTrack ? 72 : 144) * HOUR);
  return sla > c.vaultUntil ? sla : new Date(c.vaultUntil.getTime() + 48 * HOUR);
}

export function buildCaseEvent(c: CaseInput): CaseEvent {
  const end = verdictDue(c);
  const start = c.createdAt;
  const span = Math.max(1, end.getTime() - start.getTime());
  const open = OPEN.has(c.state);
  const phase = (key: CaseEvent["phases"][number]["key"], label: string, from: Date, to: Date, isState: boolean) => ({
    key, label, from: from.toISOString(), to: to.toISOString(), pct: Math.max(0, Math.round(((to.getTime() - from.getTime()) / span) * 1000) / 10),
    current: open && isState, past: !open || c.now >= to,
  });
  const phases = [
    phase("offers", "Sealed offers", start, c.tier1Until, c.state === "TIER1"),
    phase("vault", "Evidence vault", c.tier1Until, c.vaultUntil, c.state === "TIER2"),
    phase("verdict", "Verdict", c.vaultUntil, end, c.state === "TIER3" || c.state === "EXECUTING"),
  ];
  const next = c.state === "TIER1" ? { label: "Sealed offers close", at: c.tier1Until } : c.state === "TIER2" ? { label: "Vault seals", at: c.vaultUntil }
    : c.state === "TIER3" ? { label: "Verdict due", at: end } : null;
  const overdue = !!next && c.now > next.at;
  const tone = !open ? "released" : overdue ? "danger" : c.state === "TIER3" ? "disputed" : "held";
  return {
    id: c.id, resourceId: c.mediatorId ?? UNASSIGNED, name: c.milestone, startDate: start.toISOString(), endDate: end.toISOString(),
    state: c.state, stateLabel: CASE_LABEL[c.state] ?? c.state, amountLabel: formatCents(c.amountCents, c.currency), phases,
    next: next ? { label: next.label, at: next.at.toISOString() } : null, overdue, href: `/mediator/cases/${c.id}`,
    eventColor: tone === "danger" ? "var(--danger)" : tone === "released" ? "var(--released)" : tone === "disputed" ? "var(--disputed)" : "var(--held)",
    cls: `ps-case ps-case-${tone}${c.fastTrack ? " ps-case-fast" : ""}`, workspace: c.workspace, milestone: c.milestone,
  };
}
