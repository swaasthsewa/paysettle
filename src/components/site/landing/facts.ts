/**
 * F3 · everything the landing page shows as a number or a name, read from the database on the server:
 * the blueprint library, one published blueprint split into money, the waitlist count, and the live trust facts.
 * If the database is unreachable the page still renders with honest empty values.
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditChain, blueprints, reconRuns, waitlist } from "@/db/schema";
import { feeFor, splitByBps } from "@/lib/money";

export interface LandingFacts {
  blueprints: number;
  example: { title: string; days: number; totalCents: number; milestones: { code: string; title: string; type: "GATE" | "PAY"; day: number; bps: number; amountCents: number }[] } | null;
  waitlist: number;
  auditRows: number;
  recon: string | null;
  feeExample: { totalCents: number; feeCents: number };
}

const EXAMPLE_TOTAL = 600_000; /* $6,000, the MVP brief in */

export async function waitlistCount(): Promise<number> {
  try { const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(waitlist); return r?.n ?? 0; } catch { return 0; }
}

export async function landingFacts(): Promise<LandingFacts> {
  const feeExample = { totalCents: 800_000, feeCents: feeFor(800_000, 250) };
  try {
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(blueprints).where(eq(blueprints.active, true));
    const [bp] = await db.select().from(blueprints).where(eq(blueprints.code, "UC_WEB_MVP")).limit(1);
    const first = bp ?? (await db.select().from(blueprints).where(eq(blueprints.depth, "full")).orderBy(asc(blueprints.code)).limit(1))[0];
    const [audits] = await db.select({ n: sql<number>`count(*)::int` }).from(auditChain);
    const [recon] = await db.select({ v: reconRuns.verdict }).from(reconRuns).orderBy(desc(reconRuns.createdAt)).limit(1);
    let example: LandingFacts["example"] = null;
    if (first) {
      const ms = first.milestones;
      const amounts = splitByBps(EXAMPLE_TOTAL, ms.map((m) => m.bps));
      example = { title: first.title, days: first.recommendedDays, totalCents: EXAMPLE_TOTAL, milestones: ms.map((m, i) => ({ code: m.code, title: m.title, type: m.type, day: m.day, bps: m.bps, amountCents: amounts[i] })) };
    }
    return { blueprints: count?.n ?? 0, example, waitlist: await waitlistCount(), auditRows: audits?.n ?? 0, recon: recon?.v ?? null, feeExample };
  } catch {
    return { blueprints: 0, example: null, waitlist: 0, auditRows: 0, recon: null, feeExample };
  }
}
