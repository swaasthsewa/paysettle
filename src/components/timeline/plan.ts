/**
 * F2.04 F2.13 F2.14 F3.03 F3.11 F4.01 — pure builders for the Bryntum timelines (no React, no Bryntum import: runs in tests and on the
 * server, and returns only plain, serialisable data for the client components).
 *  - Contract Gantt: milestones as bars from the previous milestone's day to their own target day, tranches as summary
 *    rows and shaded bands (the PayPal hold window once funded), dependencies (explicit, else the sequence), now line.
 *  - Mediator schedule: one row per mediator (plus "Not assigned yet"), one bar per case from opening to its last
 *    deadline, with the sealed-offer, vault and verdict phases inside it.
 *  - F2.13 proposed change order: the change order's milestones as bars, the signed plan as Bryntum baselines, and each
 *    row marked added, removed, re-dated or unchanged (read from the stored change order; nothing changes until both sign).
 *  - F2.14 contract chain: one summary row per period of a continuation chain, its milestones as children, arrows from
 *    each period to the next, all on one calendar.
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
  /** F2.13 proposed change order view: what the change order does to this row, and the signed bar as a baseline. */
  change?: CoChange; changeLabel?: string; baselines?: { startDate: string; endDate: string }[];
  /** F2.14 contract chain view: the target date shown in the Gantt's date column. */
  dueLabel?: string;
}
export interface PlanDep { id: string; from: string; to: string; implicit: boolean; cls: string }
export interface PlanBand { id: string; name: string; startDate: string; endDate?: string; cls: string }
export interface ContractPlan {
  workspaceId: string; title: string; currency: string;
  anchor: string; anchorKind: "funded" | "signed" | "projected"; now: string; virtual: boolean;
  startDate: string; endDate: string;
  tasks: PlanTask[]; dependencies: PlanDep[]; timeRanges: PlanBand[];
  rows: { id: string; tranche: string; code: string; title: string; type: string; from: number; to: number; due: string; amount: number; state: string; where: string; open: { href: string; label: string }; change?: string; signedDue?: string | null }[];
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

/* ── F2.13 proposed change order on the Gantt ── */
export type CoChange = "added" | "removed" | "redated" | "changed" | "same";
export const CHANGE_LABEL: Record<CoChange, string> = { added: "Added", removed: "Removed", redated: "Re-dated", changed: "Changed (same date)", same: "No change" };
/** The milestone part of a change order's stored canonical document (changeOrderDoc → canonicalDoc). */
export interface CoDocMilestone { code: string; seq: number; active: boolean; type: "GATE" | "PAY"; title: string; day: number; amountCents: number; dependsOn: string[]; tranche: number }
export interface ProposedInput {
  milestones: CoDocMilestone[];
  /** Money plan of the change order: new PLANNED tranches to fund, and new amounts of tranches not funded yet. */
  fund: { trancheIdx: number; amountCents: number; startDay: number; endDay: number }[];
  planned: { trancheIdx: number; toCents: number }[];
}
export type ProposedPlan = ContractPlan & { changes: Record<CoChange, number> };

/**
 * The contract as the change order would make it, on the same day 0 as the signed plan: the proposed milestones are the
 * bars, each carries its signed bar as a baseline, and milestones the change order removes stay as rows marked
 * "Removed" (bar and baseline at the signed dates). Nothing here changes the contract; it only reads the stored document.
 */
export function buildProposedPlan(v: PlanInput, co: ProposedInput, now: Date, virtualOffsetHours = 0): ProposedPlan {
  const signed = buildContractPlan(v, now, virtualOffsetHours);
  const signedTask = new Map(signed.tasks.flatMap((t) => t.children ?? []).map((k) => [k.id, k]));
  const byCode = new Map(v.milestones.map((m) => [m.code, m]));
  const docByCode = new Map(co.milestones.map((m) => [m.code, m]));
  const planned = new Map(co.planned.map((l) => [l.trancheIdx, l.toCents]));
  const input: PlanInput = {
    ...v,
    milestones: co.milestones.filter((m) => m.active).map((m) => {
      const old = byCode.get(m.code);
      return { id: old?.id ?? `new-${m.code}`, seq: m.seq, code: m.code, title: m.title, type: m.type, active: true, targetDay: m.day, amountCents: m.amountCents, dependsOn: m.dependsOn, trancheIdx: m.tranche, state: old?.state ?? "LOCKED" };
    }),
    tranches: [
      ...v.tranches.map((t) => (planned.has(t.idx) && !t.heldAt ? { ...t, amountCents: planned.get(t.idx)! } : t)),
      ...co.fund.filter((f) => !v.tranches.some((t) => t.idx === f.trancheIdx)).map((f) => ({ id: `new-tranche-${f.trancheIdx}`, idx: f.trancheIdx, amountCents: f.amountCents, startDay: f.startDay, endDay: f.endDay, state: "PLANNED", heldAt: null, windowEndsAt: null })),
    ],
  };
  const p = buildContractPlan(input, now, virtualOffsetHours);
  const changes: Record<CoChange, number> = { added: 0, removed: 0, redated: 0, changed: 0, same: 0 };
  const mark = (t: PlanTask, c: CoChange, base: PlanTask | undefined) => {
    t.change = c; t.changeLabel = CHANGE_LABEL[c]; changes[c] += 1;
    t.cls = `${t.cls} ps-co-${c}`;
    if (base) t.baselines = [{ startDate: base.startDate, endDate: base.endDate }];
    if (c === "added") t.href = null; // no milestone page until both parties sign
  };
  for (const tr of p.tasks) for (const t of tr.children ?? []) {
    const old = byCode.get(t.code);
    const base = old ? signedTask.get(old.id) : undefined;
    if (!old || !old.active) mark(t, "added", undefined);
    else if (old.targetDay !== t.dayTo) mark(t, "redated", base);
    else if (old.title !== docByCode.get(t.code)!.title || old.amountCents !== t.amountCents) mark(t, "changed", base);
    else mark(t, "same", base);
  }
  /* removed: active in the signed plan, inactive (or absent) in the change order */
  const removed = v.milestones.filter((m) => m.active && !docByCode.get(m.code)?.active);
  for (const m of removed) {
    const base = signedTask.get(m.id);
    if (!base) continue;
    const t: PlanTask = { ...base, name: `${base.name} (removed)`, cls: base.cls };
    mark(t, "removed", base);
    let tr = p.tasks.find((x) => x.id === `tranche-${m.trancheIdx}`);
    if (!tr) {
      const st = signed.tasks.find((x) => x.id === `tranche-${m.trancheIdx}`)!;
      tr = { ...st, children: [] };
      p.tasks.push(tr);
      p.tasks.sort((a, b) => a.dayFrom - b.dayFrom || a.id.localeCompare(b.id));
    }
    tr.children = [...(tr.children ?? []), t].sort((a, b) => a.dayTo - b.dayTo || a.code.localeCompare(b.code));
  }
  /* table rows follow the same order and say what changed, with the signed date next to the proposed one */
  const signedRow = new Map(signed.rows.map((r) => [r.id, r]));
  p.rows = p.tasks.flatMap((tr) => (tr.children ?? []).map((t) => {
    const r = signedRow.get(t.id);
    return {
      id: t.id, tranche: tr.name, code: t.code, title: t.name.replace(/^[^·]+· /, ""), type: t.kind === "gate" ? "Gate" : "Payment", from: t.dayFrom, to: t.dayTo,
      due: t.endDate, amount: t.amountCents, state: t.change === "added" ? "PROPOSED" : t.state, where: t.change === "added" ? "Not funded yet" : TONE_LABEL[t.tone],
      open: t.href ? { href: t.href, label: "Open" } : { href: `/contracts/${v.id}#co`, label: "Change order" }, change: t.changeLabel, signedDue: r?.due ?? null,
    };
  }));
  const ends = [Date.parse(p.startDate), Date.parse(p.endDate), Date.parse(signed.startDate), Date.parse(signed.endDate)];
  return { ...p, startDate: new Date(Math.min(...ends)).toISOString(), endDate: new Date(Math.max(...ends)).toISOString(), changes };
}

/* ── F2.14 contract chain: every period the viewer may see, on one calendar ── */
export interface ChainPeriod { input: PlanInput; periodNo: number; state: string; totalCents: number }
/* same words as the contract state chips (src/components/contracts/chips.tsx, which this pure module cannot import) */
const WS_LABEL: Record<string, string> = { DRAFT: "Draft", READY_TO_SIGN: "Ready to sign", PARTIALLY_SIGNED: "Signed by one party", SIGNED: "Signed by both", PENDING_OPS: "With Operations", LOCKED: "Locked", ABANDONED: "Abandoned" };
export const wsStateLabel = (s: string) => WS_LABEL[s] ?? s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/**
 * One summary row per period (title, period number, state, total) with its milestones as children, dated on each
 * period's own day 0. A period that is not signed yet is projected to start where the period before it ends. Arrows
 * run from each period to the next.
 */
export function buildChainPlan(periods: ChainPeriod[], now: Date): ContractPlan {
  const sorted = [...periods].sort((a, b) => a.periodNo - b.periodNo);
  const tasks: PlanTask[] = [];
  const deps: PlanDep[] = [];
  const rows: ContractPlan["rows"] = [];
  const counts: Record<MsTone, number> = { held: 0, released: 0, disputed: 0, refunded: 0, draft: 0, gate: 0 };
  let prevEnd: number | null = null;
  for (const per of sorted) {
    const signedOrFunded = per.input.tranches.some((t) => t.heldAt) || per.input.signatures.some((s) => !s.voided);
    const at0 = !signedOrFunded && prevEnd !== null ? new Date(Math.max(prevEnd, now.getTime())) : now;
    const p = buildContractPlan(per.input, at0);
    const kids = p.tasks.flatMap((t) => t.children ?? []).map((k) => ({ ...k, id: `${per.input.id}:${k.id}`, dueLabel: k.endDate.slice(0, 10) }));
    for (const t of Object.keys(counts) as MsTone[]) counts[t] += p.counts[t];
    const start = kids.length ? Math.min(...kids.map((k) => Date.parse(k.startDate))) : Date.parse(p.anchor);
    const end = kids.length ? Math.max(...kids.map((k) => Date.parse(k.endDate))) : start + DAY;
    const id = `period-${per.input.id}`;
    const money = formatCents(per.totalCents, per.input.currency);
    tasks.push({
      id, name: `Period ${per.periodNo} · ${per.input.title}`, startDate: new Date(start).toISOString(), endDate: new Date(Math.max(end, start + DAY)).toISOString(), manuallyScheduled: true, expanded: true,
      kind: "tranche", code: `P${per.periodNo}`, state: per.state, stateLabel: wsStateLabel(per.state) + (p.anchorKind === "projected" ? " (dates projected)" : ""), tone: per.state === "LOCKED" ? "held" : "draft",
      amountCents: per.totalCents, amountLabel: money, dayFrom: 0, dayTo: Math.round((end - start) / DAY), href: `/contracts/${per.input.id}`,
      eventColor: TONE_COLOR[per.state === "LOCKED" ? "held" : "draft"], cls: "ps-tranche ps-period", children: kids, dueLabel: new Date(end).toISOString().slice(0, 10),
    });
    const prev = tasks[tasks.length - 2];
    if (prev) deps.push({ id: `chain-${prev.id}-${id}`, from: prev.id, to: id, implicit: false, cls: "ps-dep ps-dep-chain" });
    for (const k of kids) rows.push({
      id: k.id, tranche: `Period ${per.periodNo}`, code: k.code, title: k.name.replace(/^[^·]+· /, ""), type: k.kind === "gate" ? "Gate" : "Payment", from: k.dayFrom, to: k.dayTo,
      due: k.endDate, amount: k.amountCents, state: k.state, where: TONE_LABEL[k.tone], open: { href: k.href ?? `/contracts/${per.input.id}`, label: "Open" },
    });
    prevEnd = end;
  }
  const nowIso = now.toISOString();
  const all = [now.getTime(), ...tasks.flatMap((t) => [Date.parse(t.startDate), Date.parse(t.endDate)])];
  const first = sorted[0]?.input;
  return {
    workspaceId: first?.id ?? "", title: first?.title ?? "", currency: first?.currency ?? "USD", anchor: tasks[0]?.startDate ?? nowIso, anchorKind: "signed", now: nowIso, virtual: false,
    startDate: new Date(Math.min(...all) - 2 * DAY).toISOString(), endDate: new Date(Math.max(...all) + 3 * DAY).toISOString(),
    tasks, dependencies: deps, timeRanges: [{ id: "now", name: "Now", startDate: nowIso, cls: "ps-now" }], rows, counts,
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
