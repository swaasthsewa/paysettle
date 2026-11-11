/** Fee schedule per vertical (F3.11 / F5.x). Default 250 bps (2.5%), deducted from the provider's side. Finance only; audited. */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { blueprints, workspaces } from "@/db/schema";
import { feeSchedule } from "@/db/schema-control";
import { audit } from "@/lib/audit";
import { DomainError, type Actor } from "../types";
import { auditActor, mustWrite, realWorkspace, type Dbx } from "./common";

export const DEFAULT_FEE_BPS = 250;
export const MAX_FEE_BPS = 1500;

/** Fee for new contracts in a vertical. Contracts keep the fee they were signed with (workspaces.fee_bps). */
export async function feeBpsFor(vertical: string, dbx: Dbx = db): Promise<number> {
  const [r] = await dbx.select({ bps: feeSchedule.feeBps }).from(feeSchedule).where(eq(feeSchedule.vertical, vertical)).limit(1);
  return r?.bps ?? DEFAULT_FEE_BPS;
}

export async function feeTable(dbx: Dbx = db) {
  const verticals = await dbx.select({ vertical: blueprints.vertical, n: sql<number>`count(*)::int` }).from(blueprints).groupBy(blueprints.vertical).orderBy(blueprints.vertical);
  const rows = await dbx.select().from(feeSchedule);
  const live = await dbx.select({ vertical: blueprints.vertical, n: sql<number>`count(*)::int`, avg: sql<number>`coalesce(round(avg(${workspaces.feeBps})),0)::int` })
    .from(workspaces).innerJoin(blueprints, eq(blueprints.code, workspaces.blueprintCode)).where(realWorkspace(workspaces.id, workspaces.orgId)).groupBy(blueprints.vertical);
  const names = [...new Set([...verticals.map((v) => v.vertical), ...rows.map((r) => r.vertical)])].sort();
  return names.map((v) => {
    const r = rows.find((x) => x.vertical === v);
    const l = live.find((x) => x.vertical === v);
    return { vertical: v, blueprints: verticals.find((x) => x.vertical === v)?.n ?? 0, feeBps: r?.feeBps ?? DEFAULT_FEE_BPS, stored: Boolean(r), note: r?.note ?? null, updatedBy: r?.updatedBy ?? null, updatedAt: r?.updatedAt ?? null, contracts: l?.n ?? 0, contractAvgBps: l?.avg ?? null };
  });
}

const SetFee = z.object({ vertical: z.string().trim().min(1).max(80), feeBps: z.number().int().min(0).max(MAX_FEE_BPS), note: z.string().trim().min(5, "Say why the fee changes (at least 5 characters).").max(300) });

export async function setFee(a: Actor, input: { vertical: string; feeBps: number; note: string }, dbx: Dbx = db) {
  mustWrite(a, "fee.configure");
  const p = SetFee.safeParse(input);
  if (!p.success) throw new DomainError("INVALID", p.error.issues[0]?.message ?? "Invalid fee.");
  const before = await feeBpsFor(p.data.vertical, dbx);
  await dbx.insert(feeSchedule).values({ vertical: p.data.vertical, feeBps: p.data.feeBps, note: p.data.note, updatedBy: a.id, updatedAt: new Date() })
    .onConflictDoUpdate({ target: feeSchedule.vertical, set: { feeBps: p.data.feeBps, note: p.data.note, updatedBy: a.id, updatedAt: new Date() } });
  await audit(dbx, auditActor(a), "fee.configured", p.data.vertical, { from: before, to: p.data.feeBps, note: p.data.note });
  return { from: before, to: p.data.feeBps };
}

export async function ensureFeeDefaults(dbx: Dbx = db) {
  const vs = await dbx.selectDistinct({ vertical: blueprints.vertical }).from(blueprints);
  for (const v of vs) await dbx.insert(feeSchedule).values({ vertical: v.vertical, feeBps: DEFAULT_FEE_BPS, note: "Default platform fee", updatedBy: "system" }).onConflictDoNothing();
}
