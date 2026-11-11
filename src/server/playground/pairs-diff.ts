/**
 * A12 "Same blueprint, two contracts" (F2.04 Append-and-Prune, F2.05 risk score, F2.06 amounts, F2.07 tranches).
 * Pure: the change lists that turn the classic-car blueprint into Pair A (purist, $6,000, 18 days) and Pair B (track build,
 * $14,500, 28 days, eight appended checkpoints, M06 parts procurement at 35%), and the side-by-side diff of the results.
 * The change lists are applied through the contracts service (every change is a signed-off-able revision); nothing here
 * touches the database or money.
 */
import type { BlueprintMilestone, ProofSpec } from "@/db/schema";
import { feeFor, splitByBps } from "@/lib/money";
import { riskScore, type Rail, type Tier } from "@/lib/policy";
import type { Change, WorkspaceView } from "../types";

export const PAIR_BLUEPRINT = "UC_CLASSIC_CAR";
export const PAIR_A = { key: "A", label: "Pair A · Purist", totalCents: 600_000, days: 18, client: "u_priya", provider: "u_arjun", title: "Purist refresh, original carburettor" } as const;
export const PAIR_B = { key: "B", label: "Pair B · Track build", totalCents: 1_450_000, days: 28, client: "u_dan", provider: "u_meera", title: "Track build with checkpoints" } as const;
export type PairKey = "A" | "B";

const P = (kind: ProofSpec["artifacts"][number]["kind"], min: number, note: string) => ({ kind, min, note });
type Append = Extract<Change, { action: "APPEND" }>["milestone"];
const pay = (title: string, day: number, bps: number, afterCode: string, proof: ProofSpec, lockRule: string, disputeRule: string): Append => ({ title, type: "PAY", day, bps, afterCode, proof, lockRule, disputeRule });
const gate = (title: string, day: number, afterCode: string, proof: ProofSpec, lockRule: string, disputeRule: string): Append => ({ title, type: "GATE", day, bps: 0, afterCode, proof, lockRule, disputeRule });

/** Scale every blueprint day onto a shorter or longer timeline; never below day 1. Integer arithmetic only. */
export const scaleDay = (day: number, fromDays: number, toDays: number) => Math.max(1, Math.round((day * toDays) / fromDays));

/** Pair A — the purist keeps the original carburettor and engine mounts and wants no power tuning. */
export function pairAChanges(bp: BlueprintMilestone[], recommendedDays: number): Change[] {
  const pruned = ["M07", "M10", "M17"];
  const out: Change[] = pruned.map((c) => ({ action: "PRUNE", milestoneCode: c }));
  out.push(
    { action: "APPEND", milestone: pay("Originality record: matching numbers and original finish", 2, 400, "M01",
      { artifacts: [P("IMAGE", 6, "Engine, chassis and gearbox numbers; paint-code plate"), P("PDF", 1, "Originality checklist signed by both")], gpsRadiusM: 200, criteria: ["Engine, chassis and gearbox numbers match the title and the build sheet", "Original paint code and trim are recorded"] },
      "Owner signs the originality checklist.", "A number that does not match is recorded before work starts; work continues only if the owner agrees in writing.") },
    { action: "APPEND", milestone: pay("Original carburettor rebuilt and balanced", 9, 1200, "M08",
      { artifacts: [P("IMAGE", 4, "Carburettor stripped, cleaned and rebuilt"), P("VIDEO", 1, "Idle and throttle response after the rebuild")], gpsRadiusM: 200, criteria: ["Idle holds within ±50 rpm of the shop-manual figure", "No fuel at the float bowl, jets or linkage"] },
      "Owner approves the video.", "A carburettor that fails the idle test is re-jetted and filmed again within 72 hours.") },
    { action: "APPEND", milestone: pay("Period-correct road tune: ignition timing and mixture", 14, 500, "M16",
      { artifacts: [P("LOG", 1, "Timing-light and vacuum-gauge readings"), P("VIDEO", 1, "Cold start and warm idle")], criteria: ["Ignition timing at the factory figure ±2°", "Starts within 5 seconds from cold"] },
      "Owner approves the readings.", "Readings outside the factory figures are set again within 72 hours.") },
  );
  for (const m of bp) {
    if (pruned.includes(m.code)) continue;
    const d = scaleDay(m.day, recommendedDays, PAIR_A.days);
    if (d !== m.day) out.push({ action: "SET_DAY", milestoneCode: m.code, day: d });
  }
  out.push({ action: "APPEND_CLAUSE", title: "No irreversible changes", body: "The shop does not cut, drill or weld original panels or the chassis unless the owner approves it in writing first, and returns every removed original part labelled." });
  return out;
}

/** Pair B — a track build: eight inspection checkpoints, parts procurement (M06) at 35%, 28 days in two holds. */
export function pairBChanges(bp: BlueprintMilestone[]): Change[] {
  const paid = bp.filter((m) => m.type === "PAY");
  const others = paid.filter((m) => m.code !== "M06");
  const scaled = splitByBps(10_000 - 3500, others.map((m) => m.bps));
  const shares: Record<string, number> = { M06: 3500 };
  others.forEach((m, i) => (shares[m.code] = scaled[i]));
  const out: Change[] = [{ action: "SET_BPS", shares }];
  const cps: Append[] = [
    gate("Checkpoint: roll cage fitted and welds inspected", 10, "M08", { artifacts: [P("IMAGE", 6, "Every cage node and weld"), P("PDF", 1, "Cage tube certificate")], gpsRadiusM: 200, criteria: ["Every weld continuous with no porosity", "Tube size and wall thickness match the certificate"] }, "Owner approves the photos.", "A failing weld is cut out and redone within 72 hours."),
    gate("Checkpoint: seat, harness and mounting points", 13, "M09", { artifacts: [P("IMAGE", 4, "Seat rails, harness anchors and labels"), P("PDF", 1, "Seat and harness certificates with expiry dates")], gpsRadiusM: 200, criteria: ["Harness anchors bolted through reinforcement plates", "Seat and harness certificates in date"] }, "Owner approves.", "An anchor without a plate is refitted before the next checkpoint."),
    gate("Checkpoint: fire system and electrical cut-off", 16, "M13", { artifacts: [P("IMAGE", 3, "Extinguisher, nozzles and cut-off switch"), P("VIDEO", 1, "Cut-off switch stops the engine")], gpsRadiusM: 200, criteria: ["The cut-off stops the engine and every circuit", "Extinguisher serviced within the last 12 months"] }, "Owner approves the video.", "A failed cut-off test is repeated after repair."),
    gate("Checkpoint: brake cooling and track fluid", 19, "M15", { artifacts: [P("IMAGE", 4, "Ducts and caliper clearance"), P("PDF", 1, "Fluid specification and bleed record")], gpsRadiusM: 200, criteria: ["Ducts clear the wheels at full lock", "Fluid dry boiling point meets the specification"] }, "Owner approves.", "Ducts that rub are re-routed and photographed again."),
    gate("Checkpoint: data logger and sensor calibration", 20, "M16", { artifacts: [P("LOG", 1, "Logger configuration export"), P("LOG", 1, "Calibration readings against reference gauges")], criteria: ["Oil pressure, oil and coolant temperature logged at 10 Hz or faster", "Sensor readings within 3% of the reference gauges"] }, "Owner approves the logs.", "Sensors outside 3% are recalibrated before the shakedown."),
    gate("Checkpoint: corner weights and alignment sheet", 22, "M17", { artifacts: [P("PDF", 1, "Corner-weight and alignment printout"), P("IMAGE", 2, "Car on the scales")], gpsRadiusM: 200, criteria: ["Cross weight within 1 point of 50%", "Camber and toe within the setup sheet"] }, "Owner approves the printout.", "Out-of-range settings are adjusted and printed again."),
    gate("Checkpoint: track shakedown session", 25, "M18", { artifacts: [P("VIDEO", 1, "Onboard laps"), P("LOG", 1, "Datalog of the session")], criteria: ["Three consecutive laps with no warning lights", "Oil temperature stays below 120 °C"] }, "Owner approves the datalog.", "Faults found are fixed and a second session is logged."),
    gate("Checkpoint: scrutineering pre-check", 27, "M19", { artifacts: [P("PDF", 1, "Checklist signed by a licensed scrutineer"), P("IMAGE", 4, "Tow points, cut-off markings and fire labels")], gpsRadiusM: 200, criteria: ["Every checklist item passed"] }, "Owner approves the signed checklist.", "Failed items are fixed and re-checked before handover."),
  ];
  for (const m of cps) out.push({ action: "APPEND", milestone: m });
  for (const [code, day] of [["M18", 24], ["M19", 27], ["M20", 28]] as const) if (bp.find((m) => m.code === code)?.day !== day) out.push({ action: "SET_DAY", milestoneCode: code, day });
  out.push({ action: "TOGGLE_CLAUSE", clauseCode: "TPL_ROAD_LEGAL", active: false });
  out.push({ action: "APPEND_CLAUSE", title: "Track use", body: "The car is prepared for closed-circuit use. The owner arranges track-day insurance; wear from track driving after handover is not a defect." });
  return out;
}

/* ── diff ── */

export interface PairCell { active: boolean; day: number; bps: number; amountCents: number; changed: ("day" | "bps")[] }
export interface PairRow { code: string; title: string; type: "GATE" | "PAY"; base: { day: number; bps: number }; a: PairCell | null; b: PairCell | null }
export interface PairAdded { code: string; title: string; type: "GATE" | "PAY"; day: number; bps: number; amountCents: number }
export interface PairSide {
  key: PairKey; label: string; workspaceId: string; title: string; state: string; revision: number; totalCents: number; days: number;
  risk: number; riskParts: { label: string; weight: number; value: number; points: number }[];
  feeCents: number; providerNetCents: number; client: string; provider: string;
  tranches: { idx: number; amountCents: number; startDay: number; endDay: number }[];
  pruned: { code: string; title: string }[]; appended: PairAdded[]; moved: number; reweighted: number;
  clausesOff: string[]; clausesAdded: string[]; violations: { rule: string; message: string }[]; activeMilestones: number;
}
export interface PairDiff { blueprint: string; rows: PairRow[]; sides: [PairSide, PairSide] }

type View = Pick<WorkspaceView, "id" | "title" | "state" | "revision" | "rail" | "totalCents" | "feeBps" | "riskScore" | "milestones" | "clauses" | "tranches" | "violations" | "client" | "provider">;

/** The published risk formula (src/lib/policy.ts riskScore), part by part, for the "why" column. */
const RISK_PARTS: { key: string; label: string; weight: number }[] = [
  { key: "valueBand", label: "Contract value band", weight: 30 }, { key: "protectivePruned", label: "Protective clauses switched off", weight: 25 },
  { key: "custom", label: "Share of custom clauses", weight: 20 }, { key: "tier", label: "Provider trust tier", weight: 15 }, { key: "frontLoad", label: "Money paid early", weight: 10 },
];
export function riskBreakdown(v: View, tier: Tier): PairSide["riskParts"] {
  const r = riskScore({
    totalCents: v.totalCents, rail: v.rail as Rail, providerPayable: true,
    milestones: v.milestones.map((m) => ({ code: m.code, type: m.type, day: m.targetDay, bps: m.bps, amountCents: m.amountCents, active: m.active, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn })),
    clauses: v.clauses.map((c) => ({ category: c.category, code: c.code, body: c.body, active: c.active, protective: c.protective })),
  }, tier);
  return RISK_PARTS.map((p) => ({ label: p.label, weight: p.weight, value: r.parts[p.key] ?? 0, points: p.weight * (r.parts[p.key] ?? 0) }));
}

function plannedTranches(v: View): PairSide["tranches"] {
  if (v.tranches.length) return v.tranches.map((t) => ({ idx: t.idx, amountCents: t.amountCents, startDay: t.startDay, endDay: t.endDay }));
  const by = new Map<number, { amountCents: number; startDay: number; endDay: number }>();
  for (const m of v.milestones.filter((x) => x.active)) {
    const t = by.get(m.trancheIdx) ?? { amountCents: 0, startDay: Number.MAX_SAFE_INTEGER, endDay: 0 };
    t.amountCents += m.amountCents; t.startDay = Math.min(t.startDay, Math.max(0, m.targetDay - 1)); t.endDay = Math.max(t.endDay, m.targetDay);
    by.set(m.trancheIdx, t);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([idx, t]) => ({ idx, ...t }));
}

function side(key: PairKey, label: string, v: View, bp: BlueprintMilestone[], blueprintClauses: string[], tier: Tier): PairSide {
  const base = new Map(bp.map((m) => [m.code, m]));
  const act = v.milestones.filter((m) => m.active);
  const feeCents = act.filter((m) => m.type === "PAY").reduce((s, m) => s + feeFor(m.amountCents, v.feeBps), 0);
  const ofBase = v.milestones.filter((m) => base.has(m.code));
  return {
    key, label, workspaceId: v.id, title: v.title, state: v.state, revision: v.revision, totalCents: v.totalCents,
    days: Math.max(0, ...act.map((m) => m.targetDay)), risk: v.riskScore, riskParts: riskBreakdown(v, tier), feeCents, providerNetCents: v.totalCents - feeCents,
    client: v.client.name, provider: v.provider?.name ?? "invited provider",
    tranches: plannedTranches(v),
    pruned: ofBase.filter((m) => !m.active).map((m) => ({ code: m.code, title: m.title })),
    appended: v.milestones.filter((m) => !base.has(m.code) && m.active).map((m) => ({ code: m.code, title: m.title, type: m.type, day: m.targetDay, bps: m.bps, amountCents: m.amountCents })),
    moved: ofBase.filter((m) => m.active && m.targetDay !== base.get(m.code)!.day).length,
    reweighted: ofBase.filter((m) => m.active && m.bps !== base.get(m.code)!.bps).length,
    clausesOff: v.clauses.filter((c) => blueprintClauses.includes(c.code) && !c.active).map((c) => c.title),
    clausesAdded: v.clauses.filter((c) => c.category === "CUSTOM").map((c) => c.title),
    violations: v.violations.map((x) => ({ rule: x.rule, message: x.message })),
    activeMilestones: act.length,
  };
}

function cell(v: View, code: string, b: BlueprintMilestone): PairCell | null {
  const m = v.milestones.find((x) => x.code === code);
  if (!m) return null;
  const changed: PairCell["changed"] = [];
  if (m.targetDay !== b.day) changed.push("day");
  if (m.bps !== b.bps) changed.push("bps");
  return { active: m.active, day: m.targetDay, bps: m.bps, amountCents: m.amountCents, changed };
}

/** Side-by-side diff of two contracts built from the same blueprint: rows per blueprint milestone plus each side's appended items. */
export function diffPairs(bp: { code: string; milestones: BlueprintMilestone[]; clauses: { code: string }[] }, a: View, b: View, tiers: { A: Tier; B: Tier } = { A: "new", B: "new" }): PairDiff {
  const clauseCodes = bp.clauses.map((c) => c.code);
  return {
    blueprint: bp.code,
    rows: bp.milestones.map((m) => ({ code: m.code, title: m.title, type: m.type, base: { day: m.day, bps: m.bps }, a: cell(a, m.code, m), b: cell(b, m.code, m) })),
    sides: [side("A", PAIR_A.label, a, bp.milestones, clauseCodes, tiers.A), side("B", PAIR_B.label, b, bp.milestones, clauseCodes, tiers.B)],
  };
}
