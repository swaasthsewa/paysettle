/**
 * F5.01 F3.11 — read-only three-way check (contract ↔ ledger ↔ PayPal) for tranches with deadline terms.
 * Runs the reconciliation's own pure evaluator (src/server/control/recon evaluateTranche) over the tranche, with the
 * ledger kinds expressed in the base kinds by withDeadlineAdjustments (src/lib/deadline). Writes nothing: no recon
 * run row, no breaker. The scheduled reconciliation applies the same view once runReconcile wraps its input (a one-line
 * change).
 */
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { ledgerEntries, tranches, wsMilestones } from "@/db/schema";
import { DAY } from "@/lib/clock";
import { withDeadlineAdjustments } from "@/lib/deadline";
import { railFor, type PaypalTxn, type RailId } from "@/lib/rails";
import { evaluateTranche, type Evaluation } from "../control/recon";

export interface DeadlineReconLine extends Evaluation { trancheId: string; workspaceId: string; state: string }

export async function reconcileTranches(trancheIds: string[], opts: { now?: Date; txns?: PaypalTxn[]; kind?: "mock" | "paypal" } = {}): Promise<DeadlineReconLine[]> {
  if (!trancheIds.length) return [];
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - 31 * DAY);
  const ts = await db.select().from(tranches).where(inArray(tranches.id, trancheIds));
  const wsIds = [...new Set(ts.map((t) => t.workspaceId))];
  const ms = await db.select({ workspaceId: wsMilestones.workspaceId, trancheIdx: wsMilestones.trancheIdx, amountCents: wsMilestones.amountCents, state: wsMilestones.state, type: wsMilestones.type, active: wsMilestones.active }).from(wsMilestones).where(inArray(wsMilestones.workspaceId, wsIds));
  const led = await db.select().from(ledgerEntries).where(inArray(ledgerEntries.trancheId, trancheIds));
  const railData = new Map<string, { kind: "mock" | "paypal"; txns: PaypalTxn[] | null; error?: string }>();
  /* the rail that holds the money: a mock-funded tranche (MOCKORD- order) is checked against the mock, as in recon.ts */
  const railKey = (t: { rail: string; paypalOrderId: string | null }): RailId => (t.paypalOrderId?.startsWith("MOCKORD-") ? "MOCK" : (t.rail as RailId));
  for (const id of [...new Set(ts.map(railKey))]) {
    if (opts.txns) { railData.set(id, { kind: opts.kind ?? "mock", txns: opts.txns }); continue; }
    try {
      const rail = railFor(id);
      railData.set(id, { kind: rail.id === "MOCK" ? "mock" : "paypal", txns: await rail.transactions(from.toISOString(), now.toISOString()) });
    } catch (e) { railData.set(id, { kind: "paypal", txns: null, error: e instanceof Error ? e.message : String(e) }); }
  }
  return ts.map((t) => {
    const input = withDeadlineAdjustments({
      tranche: t, milestones: ms.filter((m) => m.workspaceId === t.workspaceId && m.trancheIdx === t.idx),
      ledger: led.filter((e) => e.trancheId === t.id), rail: railData.get(railKey(t))!, now, windowFrom: from,
    }, t.bonusPoolCents);
    return { ...evaluateTranche(input), trancheId: t.id, workspaceId: t.workspaceId, state: t.state };
  });
}
