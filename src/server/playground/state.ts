/**
 * The four-quadrant view of one sim (F5.06) — Q1 client, Q2 provider, Q3 ledger + reconciliation, Q4 wire log —
 * plus step status, the simulated clock and the scenario list. Read-only; refuses to run outside sandbox mode (P9).
 */
import { desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { reconRuns, refunds, releases, users } from "@/db/schema";
import { reconLines } from "@/db/schema-control";
import type { SimStepRecord } from "@/db/schema-playground";
import { liveAvailable } from "@/lib/rails";
import type { WorkspaceView } from "../types";
import * as contracts from "../contracts";
import * as money from "../money";
import { SCENARIOS, SCENARIO_IDS, scenarioOf, type ScenarioId } from "./scenarios";
import { WaitingFor, actorFor, assertSandbox, eventsOf, getSim, progressOf, simDay, simNow, moduleCall } from "./session";

export interface PlaygroundState {
  sim: { id: string; scenario: string; mode: "LIVE" | "MOCK"; offsetHours: number; day: number; simulatedNow: string; faults: string[]; workspaceId: string | null; createdAt: string } | null;
  liveAvailable: boolean;
  scenarios: { id: ScenarioId; title: string; proves: string; seconds: number; steps: number }[];
  steps: { id: string; label: string; explain: string; who: string; whoName: string; status: string; detail: string; simDay: number | null; ms: number | null; link?: string }[];
  next: string | null;
  client: null | { waiting?: string; title?: string; state?: string; blueprint?: string; revision?: number; risk?: number; totalCents?: number; clientName?: string; providerName?: string;
    signatures?: { role: string; revNo: number; voided: boolean }[];
    tranches?: { id: string; idx: number; state: string; amountCents: number; heldCents: number; releasedCents: number; returnedCents: number; startDay: number; endDay: number; windowEndsAt: string | null; approveUrl: string | null }[] };
  provider: null | { waiting?: string; name?: string; milestones?: { code: string; title: string; type: string; amountCents: number; state: string; targetDay: number }[];
    payouts?: { code: string; kind: string; grossCents: number; feeCents: number; netCents: number; status: string; ref: string | null }[]; netCents?: number };
  ledger: null | { waiting?: string; rows: { at: string; type: string; debit: string; credit: string; amountCents: number; paypalRef: string | null; milestone: string | null; tranche: number }[];
    totals: Record<string, number>; accounts: Record<string, number>;
    recon: null | { id: string; verdict: string; matched: number; inFlight: number; at: string; exceptions: { trancheId: string; plane: string; expected: number; actual: number; note: string }[]; mine: number } };
  wire: { id: number; step: string; kind: string; request: string; response: string; ok: boolean; day: number; at: string }[];
}

export function scenarioList(): PlaygroundState["scenarios"] {
  return SCENARIO_IDS.map((id) => { const s = SCENARIOS[id]; return { id, title: s.title, proves: s.proves, seconds: s.seconds, steps: s.steps.length }; });
}

export async function playgroundState(simId: string | null): Promise<PlaygroundState> {
  assertSandbox();
  const base: PlaygroundState = { sim: null, liveAvailable: liveAvailable(), scenarios: scenarioList(), steps: [], next: null, client: null, provider: null, ledger: null, wire: [] };
  if (!simId) return base;
  const sim = await getSim(simId);
  const scenario = scenarioOf(sim.scenario);
  const prog = await progressOf(simId);
  const recs = prog.steps as Record<string, SimStepRecord>;
  const names = new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, Object.values(scenario.personas)))).map((u) => [u.id, u.name]));
  base.sim = { id: sim.id, scenario: sim.scenario, mode: sim.mode, offsetHours: sim.clockOffsetHours, day: simDay(sim), simulatedNow: simNow(sim).toISOString(), faults: sim.faults ?? [], workspaceId: sim.workspaceId, createdAt: sim.createdAt.toISOString() };
  base.steps = scenario.steps.map((s) => {
    const r = recs[s.id];
    const who = s.who === "system" ? "System (timers)" : s.who === "judge" ? "You (judge)" : `${names.get(scenario.personas[s.who]) ?? s.who} (${s.who === "cosigner" ? "co-signer" : s.who})`;
    return { id: s.id, label: s.label, explain: s.explain, who: s.who, whoName: who, status: r?.status ?? "pending", detail: r?.detail ?? "", simDay: r?.simDay ?? null, ms: r?.ms ?? null, link: r?.link };
  });
  base.next = base.steps.find((s) => !["done", "skipped"].includes(s.status))?.id ?? null;
  const ev = await eventsOf(simId, 400);
  base.wire = ev.map((e) => ({ id: e.id, step: e.step, kind: e.kind, request: e.request, response: e.response, ok: e.ok, day: Math.round((e.simOffsetHours / 24) * 10) / 10, at: e.at.toISOString() }));
  const wsId = sim.workspaceId;
  if (!wsId) return base;

  let v: WorkspaceView;
  try { v = await moduleCall("contracts", async () => contracts.getWorkspace(await actorFor(scenario.personas.client), wsId)); }
  catch (e) {
    const w = e instanceof WaitingFor ? e.message : `Contract unavailable: ${(e as Error).message}`;
    base.client = { waiting: w }; base.provider = { waiting: w }; base.ledger = { waiting: w, rows: [], totals: {}, accounts: {}, recon: null };
    return base;
  }
  const mIds = v.milestones.map((m) => m.id), tIds = v.tranches.map((t) => t.id);
  const rel = mIds.length ? await db.select().from(releases).where(inArray(releases.milestoneId, mIds)) : [];
  const rf = tIds.length ? await db.select().from(refunds).where(inArray(refunds.trancheId, tIds)) : [];
  const code = new Map(v.milestones.map((m) => [m.id, m.code]));
  const tIdx = new Map(v.tranches.map((t) => [t.id, t.idx]));

  base.client = {
    title: v.title, state: v.state, blueprint: v.blueprintCode, revision: v.revision, risk: v.riskScore, totalCents: v.totalCents,
    clientName: v.client.name, providerName: v.provider?.name ?? v.inviteEmail ?? "invited",
    signatures: v.signatures.map((s) => ({ role: s.role, revNo: s.revNo, voided: s.voided })),
    tranches: v.tranches.map((t) => {
      const released = rel.filter((r) => r.trancheId === t.id && r.status === "COMPLETED").reduce((a, r) => a + r.grossCents, 0);
      const returned = rf.filter((r) => r.trancheId === t.id && r.status !== "FAILED").reduce((a, r) => a + r.amountCents, 0);
      const holding = ["HELD", "PARTIALLY_RELEASED", "SETTLING", "BREAKER"].includes(t.state);
      return { id: t.id, idx: t.idx, state: t.state, amountCents: t.amountCents, heldCents: holding ? Math.max(0, t.amountCents - released - returned) : 0, releasedCents: released, returnedCents: returned, startDay: t.startDay, endDay: t.endDay, windowEndsAt: t.windowEndsAt ? new Date(t.windowEndsAt).toISOString() : null, approveUrl: t.approveUrl };
    }),
  };
  const payouts = rel.map((r) => ({ code: code.get(r.milestoneId) ?? "?", kind: r.kind, grossCents: r.grossCents, feeCents: r.feeCents, netCents: r.netCents, status: r.status, ref: r.paypalRef }));
  base.provider = {
    name: v.provider?.name ?? "invited provider",
    milestones: v.milestones.filter((m) => m.active).sort((a, b) => a.seq - b.seq).map((m) => ({ code: m.code, title: m.title, type: m.type, amountCents: m.amountCents, state: m.state, targetDay: m.targetDay })),
    payouts, netCents: payouts.filter((p) => p.status === "COMPLETED").reduce((a, p) => a + p.netCents, 0),
  };

  const ledger: NonNullable<PlaygroundState["ledger"]> = { rows: [], totals: {}, accounts: {}, recon: null };
  try {
    for (const t of v.tranches) {
      const rows = await moduleCall("money", () => money.ledgerFor(t.id));
      for (const r of rows) ledger.rows.push({ at: new Date(r.at).toISOString(), type: r.type, debit: r.debit, credit: r.credit, amountCents: r.amountCents, paypalRef: r.paypalRef, milestone: r.milestoneId ? code.get(r.milestoneId) ?? null : null, tranche: tIdx.get(r.trancheId) ?? 0 });
    }
    ledger.rows.sort((a, b) => a.at.localeCompare(b.at));
    for (const r of ledger.rows) { ledger.totals[r.type] = (ledger.totals[r.type] ?? 0) + r.amountCents; ledger.accounts[r.debit] = (ledger.accounts[r.debit] ?? 0) + r.amountCents; ledger.accounts[r.credit] = (ledger.accounts[r.credit] ?? 0) - r.amountCents; }
  } catch (e) { ledger.waiting = e instanceof WaitingFor ? e.message : `Ledger unavailable: ${(e as Error).message}`; }
  // the latest reconciliation run that checked one of this run's tranches (not the platform's latest run)
  const [run] = tIds.length ? await db.select().from(reconRuns).where(inArray(reconRuns.id, db.select({ id: reconLines.runId }).from(reconLines).where(inArray(reconLines.trancheId, tIds)))).orderBy(desc(reconRuns.createdAt)).limit(1) : [];
  if (run) {
    const mine = (run.exceptions ?? []).filter((x) => tIds.includes(x.trancheId));
    ledger.recon = { id: run.id, verdict: run.verdict, matched: run.matched, inFlight: run.inFlight, at: run.createdAt.toISOString(), exceptions: mine.slice(0, 10), mine: mine.length };
  }
  base.ledger = ledger;
  return base;
}


/** The scenario a `/playground?scenario=` link asks for, when it names a defined scenario (S1…S7); anything else → null. */
export function scenarioFromQuery(raw: string | string[] | undefined, ids: readonly string[] = SCENARIO_IDS): string | null {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
  return v && /^S\d{1,2}$/.test(v) && ids.includes(v) ? v : null;
}
