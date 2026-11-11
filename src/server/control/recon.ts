/**
 * F5.01 Three-way reconciliation (P6). Per tranche:
 *   Plane A — the signed contract: Σ PAY milestone amounts in the tranche (and how much is still unpaid).
 *   Plane B — the internal ledger: HOLD = RELEASE (net) + FEE + returned (REFUND + VOID) + remaining.
 *   Plane C — PayPal: rail.transactions() for the window (MockRail: its in-memory transactions; PayPal: reporting rows).
 * Ledger entries are grouped by paypalRef; a capture's gross must equal RELEASE + FEE under the same ref.
 * Differences younger than 15 minutes are IN_FLIGHT (reporting lag handled explicitly); older ones are DRIFT, which
 * trips the tranche's circuit breaker (trancheMachine 'drift') and is written to the audit chain.
 */
import { withDeadlineAdjustments } from "@/lib/deadline";
import { and, desc, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ledgerEntries, reconRuns, tranches, workspaces, wsMilestones } from "@/db/schema";
import { reconLines, type PlaneA, type PlaneB, type PlaneC } from "@/db/schema-control";
import { railFor, type PaypalTxn, type Rail, type RailId } from "@/lib/rails";
import { trancheMachine } from "@/lib/fsm";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { DAY } from "@/lib/clock";
import { formatCents } from "@/lib/money";
import type { Actor } from "../types";
import { auditActor, mustWrite, notTestOrg, type Dbx } from "./common";

export const IN_FLIGHT_MS = 15 * 60_000;
/** PayPal's reporting API indexes transactions with a delay; a hold missing from it is not drift until this passes. */
export const REPORTING_LAG_MS = 3 * 3_600_000;
export const DEFAULT_WINDOW_MS = 31 * DAY;
const FUNDED = new Set(["HELD", "PARTIALLY_RELEASED", "ROLLED_OVER", "SETTLING", "CLOSED", "BREAKER"]);
const DONE = new Set(["RELEASED", "SETTLED_BY_VERDICT", "REFUNDED"]);
type TrancheState = (typeof trancheMachine.states)[number];

export type LineStatus = "MATCHED" | "IN_FLIGHT" | "DRIFT" | "UNAVAILABLE";
export interface Issue { plane: string; expected: number; actual: number; note: string; ageMs: number; lagMs: number }
export interface TrancheInput {
  tranche: { id: string; workspaceId: string; idx: number; rail: string; amountCents: number; state: string; paypalOrderId: string | null; authorizationId: string | null; captureId: string | null; heldAt: Date | null; /** F2.13 cents signed change orders returned from this hold */ amendedOutCents?: number };
  milestones: { amountCents: number; state: string; type: string; active: boolean }[];
  ledger: { type: string; amountCents: number; paypalRef: string | null; milestoneId: string | null; at: Date }[];
  rail: { kind: "mock" | "paypal"; txns: PaypalTxn[] | null; error?: string };
  now: Date; windowFrom: Date;
}
export interface Evaluation { status: LineStatus; issues: Issue[]; notes: string[]; planeA: PlaneA; planeB: PlaneB; planeC: PlaneC }

const sum = (xs: { amountCents: number }[]) => xs.reduce((a, x) => a + x.amountCents, 0);
const maxAt = (ds: Date[]) => ds.reduce((a, d) => (d > a ? d : a), new Date(0));

/** Pure: compare the three planes for one tranche. No database, no network. */
export function evaluateTranche(i: TrancheInput): Evaluation {
  const t = i.tranche, now = i.now.getTime();
  const pay = i.milestones.filter((m) => m.active && m.type === "PAY");
  /* F2.13 a signed change order that reduced or removed milestones in a held tranche returned that part to the client:
     the contract still accounts for it (amended_out_cents), so the hold matches the signed contract plus what it gave back */
  const planeA: PlaneA = { contractCents: sum(pay) + Math.max(0, t.amendedOutCents ?? 0), trancheCents: t.amountCents, openCents: sum(pay.filter((m) => !DONE.has(m.state))) };
  const of = (type: string) => sum(i.ledger.filter((e) => e.type === type));
  const hold = of("HOLD"), release = of("RELEASE"), fee = of("FEE"), returned = of("REFUND") + of("VOID");
  const planeB: PlaneB = { holdCents: hold, releaseCents: release, feeCents: fee, returnedCents: returned, remainingCents: hold - release - fee - returned, entries: i.ledger.length };
  const lastLedger = maxAt(i.ledger.map((e) => e.at));
  const issues: Issue[] = [], notes: string[] = [];
  const issue = (plane: string, expected: number, actual: number, note: string, at: Date, lagMs = IN_FLIGHT_MS) =>
    issues.push({ plane, expected, actual, note, ageMs: now - at.getTime(), lagMs });

  /* Plane A ↔ Plane B */
  const rolled = t.state === "ROLLED_OVER";
  if (FUNDED.has(t.state) || i.ledger.length > 0) {
    const expectedHold = rolled ? t.amountCents : planeA.contractCents;
    const touched = i.ledger.length ? lastLedger : (t.heldAt ?? new Date(0));
    if (hold !== expectedHold) issue("A↔B", expectedHold, hold, `Ledger holds ${formatCents(hold)}; the signed contract puts ${formatCents(expectedHold)} in this tranche.`, touched);
    if (!rolled && t.amountCents !== planeA.contractCents) issue("A", planeA.contractCents, t.amountCents, `Tranche amount ${formatCents(t.amountCents)} differs from its signed payment milestones (${formatCents(planeA.contractCents)}).`, touched);
    if (planeB.remainingCents < 0) issue("B", 0, planeB.remainingCents, `More left the hold (${formatCents(release + fee + returned)}) than went into it (${formatCents(hold)}).`, touched);
    /* What is still held must equal the unpaid milestones. A tranche-level return (no milestone named) may stand for
       unpaid milestones that the contract has not marked refunded yet (termination), so that reading is accepted too. */
    const unattributed = sum(i.ledger.filter((e) => (e.type === "REFUND" || e.type === "VOID") && !e.milestoneId));
    const rem = planeB.remainingCents;
    if (rolled) {
      if (rem !== 0) issue("A↔B", 0, rem, `Rolled-over tranche still shows ${formatCents(rem)} held; the remainder should have moved to the next tranche.`, touched);
    } else if (rem >= 0 && rem !== planeA.openCents) {
      if (unattributed > 0 && rem === Math.max(0, planeA.openCents - unattributed)) notes.push(`${formatCents(unattributed)} returned to the client without naming milestones accounts for unpaid milestones not yet marked refunded.`);
      else if (t.state === "CLOSED" && rem === 0) notes.push(`Tranche closed with nothing held; ${formatCents(planeA.openCents)} of milestones are not yet marked paid or refunded in the contract.`);
      else issue("A↔B", planeA.openCents, rem, `Ledger shows ${formatCents(rem)} still held; unpaid milestones add up to ${formatCents(planeA.openCents)}.`, touched);
    }
  }

  /* Plane C — PayPal (or the simulated rail) */
  const planeC: PlaneC = { available: false, source: i.rail.kind === "mock" ? "Simulated PayPal (mock rail)" : "PayPal reporting API", authorizedCents: 0, capturedCents: 0, returnedCents: 0, txns: 0 };
  let cInFlight = false;
  if (!i.rail.txns) {
    notes.push(`PayPal plane not available: ${i.rail.error ?? "no data"}.`);
  } else {
    const txns = i.rail.txns;
    const releaseRef = new Map<string, string>();
    for (const e of i.ledger) if (e.type === "RELEASE" && e.paypalRef && e.milestoneId) releaseRef.set(e.milestoneId, e.paypalRef);
    const groups = new Map<string, { sum: number; last: Date; types: Set<string> }>();
    let noRef = 0;
    /* money module refs: "void:<authorizationId>" for a void of the remainder; "recorded:<id>" for a return that stays
       authorized and is voided together with the last remainder — both grouped under the authorization's void */
    const voidKey = t.authorizationId ? `void:${t.authorizationId}` : null;
    for (const e of i.ledger) {
      let key = e.paypalRef?.startsWith("recorded:") ? (e.type === "VOID" ? voidKey : null) : (e.paypalRef ?? (e.milestoneId ? releaseRef.get(e.milestoneId) : undefined));
      if (e.type === "VOID" && e.paypalRef?.startsWith("void:")) key = e.paypalRef;
      if (!key) { noRef += 1; continue; }
      const g = groups.get(key) ?? { sum: 0, last: new Date(0), types: new Set<string>() };
      g.sum += e.amountCents; if (e.at > g.last) g.last = e.at; g.types.add(e.type); groups.set(key, g);
    }
    if (noRef) notes.push(`${noRef} ledger ${noRef === 1 ? "entry has" : "entries have"} no PayPal reference and could not be matched.`);
    const linkedIds = new Set([t.paypalOrderId, t.authorizationId, t.captureId, ...groups.keys()].filter((x): x is string => Boolean(x)));
    for (let pass = 0; pass < 2; pass++) for (const x of txns) if (linkedIds.has(x.ref)) linkedIds.add(x.id);
    const linked = txns.filter((x) => linkedIds.has(x.id) || linkedIds.has(x.ref));
    planeC.txns = linked.length;
    planeC.authorizedCents = sum(linked.filter((x) => x.type === "AUTHORIZATION"));
    planeC.capturedCents = sum(linked.filter((x) => x.type === "CAPTURE"));
    planeC.returnedCents = sum(linked.filter((x) => x.type === "REFUND" || x.type === "VOID"));
    const sinceHold = now - (t.heldAt ?? lastLedger).getTime();
    if (linked.length === 0 && hold > 0 && i.rail.kind === "mock") {
      notes.push("Simulated PayPal has no record of this hold. The mock rail keeps its records in memory, so a restart since funding clears them; the ledger was still checked against the contract.");
    } else if (linked.length === 0 && hold > 0 && sinceHold < REPORTING_LAG_MS) {
      planeC.available = true; cInFlight = true;
      notes.push("PayPal reporting has not indexed this hold yet (it can take up to 3 hours).");
    } else {
      planeC.available = true;
      const used = new Set<string>();
      for (const [key, g] of groups) {
        if (g.last < i.windowFrom) { notes.push(`Ledger ref ${key} is older than the window and was not re-checked.`); continue; }
        const onlyHold = g.types.size === 1 && g.types.has("HOLD");
        if (onlyHold && i.rail.kind === "paypal") continue; /* authorizations are not part of the reporting feed */
        if (g.types.size === 1 && g.types.has("FEE") && t.rail === "A1") { notes.push(`Fee ref ${key} is invoiced separately on Rail A1.`); continue; }
        const isVoid = key.startsWith("void:");
        const cands = txns.filter((x) => x.id === key || (onlyHold && x.type === "AUTHORIZATION" && x.ref === key) || (isVoid && x.type === "VOID" && x.ref === key.slice(5)));
        if (isVoid && cands.length === 0 && !i.ledger.some((e) => e.type === "VOID" && e.paypalRef === key)) { notes.push(`${formatCents(g.sum)} returned and recorded; PayPal voids it together with the last remainder.`); continue; }
        cands.forEach((x) => used.add(x.id));
        const actual = sum(cands);
        if (actual !== g.sum) {
          const at = maxAt([g.last, ...cands.map((x) => new Date(x.at))]);
          issue("C", g.sum, actual, cands.length ? `PayPal shows ${formatCents(actual)} for ${key}; the ledger says ${formatCents(g.sum)}.` : `No PayPal transaction found for ledger ref ${key} (${formatCents(g.sum)}).`,
            at, !cands.length && i.rail.kind === "paypal" ? REPORTING_LAG_MS : IN_FLIGHT_MS);
        }
      }
      for (const x of linked) {
        if (used.has(x.id) || x.amountCents === 0 || new Date(x.at) < i.windowFrom) continue;
        issue("C", 0, x.amountCents, `PayPal ${x.type.toLowerCase()} ${x.id} (${formatCents(x.amountCents)}) has no ledger entry.`, new Date(x.at));
      }
    }
  }

  const drift = issues.some((x) => x.ageMs >= x.lagMs);
  const status: LineStatus = drift ? "DRIFT" : issues.length || cInFlight ? "IN_FLIGHT" : !planeC.available && hold > 0 ? "UNAVAILABLE" : "MATCHED";
  return { status, issues, notes, planeA, planeB, planeC };
}

export interface ReconOptions { dbx?: Dbx; now?: Date; trancheIds?: string[]; rail?: (id: RailId) => Rail }
export interface ReconResult { runId: string; verdict: "CLEAN" | "IN_FLIGHT" | "DRIFT"; lines: (Evaluation & { trancheId: string; tripped: boolean })[] }

export async function runReconcile(a: Actor | null, window: { from: Date; to: Date } | undefined, o: ReconOptions = {}): Promise<ReconResult> {
  if (a) mustWrite(a, "recon.run");
  const dbx = o.dbx ?? db;
  const now = o.now ?? window?.to ?? new Date();
  const from = window?.from ?? new Date(now.getTime() - DEFAULT_WINDOW_MS), to = window?.to ?? now;

  const withLedger = dbx.select({ id: ledgerEntries.trancheId }).from(ledgerEntries);
  /* explicit tranche ids (tests, a single-tranche check) or every tranche of a real org */
  const scope = o.trancheIds?.length ? inArray(tranches.id, o.trancheIds) : inArray(tranches.workspaceId, dbx.select({ id: workspaces.id }).from(workspaces).where(notTestOrg(workspaces.orgId)));
  const ts = await dbx.select().from(tranches)
    .where(and(scope, or(notInArray(tranches.state, ["PLANNED", "AWAITING_APPROVAL"]), inArray(tranches.id, withLedger))));
  const ids = ts.map((t) => t.id);
  const wsIds = [...new Set(ts.map((t) => t.workspaceId))];
  const ms = wsIds.length ? await dbx.select({ workspaceId: wsMilestones.workspaceId, trancheIdx: wsMilestones.trancheIdx, amountCents: wsMilestones.amountCents, state: wsMilestones.state, type: wsMilestones.type, active: wsMilestones.active }).from(wsMilestones).where(inArray(wsMilestones.workspaceId, wsIds)) : [];
  const led = ids.length ? await dbx.select().from(ledgerEntries).where(inArray(ledgerEntries.trancheId, ids)) : [];

  /* Plane C: one transactions() call per rail */
  const pick = o.rail ?? ((id: RailId) => railFor(id));
  const railData = new Map<string, TrancheInput["rail"]>();
  for (const id of [...new Set(ts.map((t) => t.rail))] as RailId[]) {
    let rail: Rail | null = null;
    try {
      rail = pick(id);
      const txns = await rail.transactions(from.toISOString(), to.toISOString());
      railData.set(id, { kind: rail.id === "MOCK" ? "mock" : "paypal", txns: txns.filter((x) => { const d = new Date(x.at); return d >= from && d <= to; }) });
    } catch (e) {
      railData.set(id, { kind: rail?.id === "MOCK" ? "mock" : "paypal", txns: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const lines = ts.flatMap((t) => {
    const ledger = led.filter((e) => e.trancheId === t.id);
    if (t.state === "CLOSED" && ledger.length && maxAt(ledger.map((e) => e.at)) < from) return []; /* settled long ago */
    const ev = evaluateTranche(withDeadlineAdjustments({ tranche: t, milestones: ms.filter((m) => m.workspaceId === t.workspaceId && m.trancheIdx === t.idx), ledger, rail: railData.get(t.rail)!, now, windowFrom: from }, t.bonusPoolCents));
    return [{ ...ev, trancheId: t.id, workspaceId: t.workspaceId, state: t.state, tripped: false }];
  });

  const verdict: ReconResult["verdict"] = lines.some((l) => l.status === "DRIFT") ? "DRIFT" : lines.some((l) => l.status !== "MATCHED") ? "IN_FLIGHT" : "CLEAN";
  const runId = newId("recon");
  const exceptions = lines.filter((l) => l.status === "DRIFT").flatMap((l) => l.issues.filter((x) => x.ageMs >= x.lagMs).map((x) => ({ trancheId: l.trancheId, plane: x.plane, expected: x.expected, actual: x.actual, note: x.note })));

  const write = async (tx: Dbx) => {
    await tx.insert(reconRuns).values({ id: runId, windowStart: from, windowEnd: to, matched: lines.filter((l) => l.status === "MATCHED").length, inFlight: lines.filter((l) => l.status === "IN_FLIGHT" || l.status === "UNAVAILABLE").length, exceptions, verdict });
    for (const l of lines) {
      if (l.status === "DRIFT" && trancheMachine.allows(l.state as TrancheState, "drift")) {
        const next = trancheMachine.next(l.state as TrancheState, "drift");
        const r = await tx.update(tranches).set({ state: next }).where(and(eq(tranches.id, l.trancheId), eq(tranches.state, l.state))).returning({ id: tranches.id });
        if (r.length) {
          l.tripped = true;
          await audit(tx, auditActor(a), "recon.breaker_tripped", l.trancheId, { runId, from: l.state, to: next, issues: l.issues.map(({ plane, expected, actual, note }) => ({ plane, expected, actual, note })) });
        }
      }
    }
    if (lines.length) await tx.insert(reconLines).values(lines.map((l) => ({ runId, trancheId: l.trancheId, workspaceId: l.workspaceId, status: l.status, planeA: l.planeA, planeB: l.planeB, planeC: l.planeC, notes: [...l.issues.map((x) => `${x.plane}: ${x.note}${x.ageMs < x.lagMs ? " (in flight)" : ""}`), ...l.notes], trippedBreaker: l.tripped })));
    await audit(tx, auditActor(a), "recon.run", runId, { verdict, tranches: lines.length, drift: exceptions.length, window: { from: from.toISOString(), to: to.toISOString() } });
  };
  if (o.dbx) await write(o.dbx); else await db.transaction(write);
  return { runId, verdict, lines };
}

/** Recent runs, newest first (finance/recon history). */
export async function reconHistory(limit = 20, dbx: Dbx = db) {
  return dbx.select().from(reconRuns).orderBy(desc(reconRuns.createdAt)).limit(limit);
}
/**
 * Lines of one run. The run itself checks every tranche (playground ones too: chaos scenario S5 relies on it), but the
 * default view leaves out tranches of playground simulations; pass includeSim to see them.
 */
export async function reconRunLines(runId: string, dbx: Dbx = db, opts: { includeSim?: boolean } = {}) {
  const notSim = sql`not exists (select 1 from tranches st join sim_workspaces sw on sw.workspace_id = st.workspace_id where st.id = ${reconLines.trancheId})`;
  return dbx.select().from(reconLines).where(opts.includeSim ? eq(reconLines.runId, runId) : and(eq(reconLines.runId, runId), notSim)).orderBy(sql`case ${reconLines.status} when 'DRIFT' then 0 when 'IN_FLIGHT' then 1 when 'UNAVAILABLE' then 2 else 3 end`, reconLines.trancheId);
}
