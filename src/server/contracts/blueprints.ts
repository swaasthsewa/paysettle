/**
 * F2.01 blueprint discovery: faceted search (vertical, kind, maximum days) with simple relevance ranking over
 * title, vertical, summary and milestone text (Postgres ILIKE; no vector index needed at this catalogue size).
 * Zero hits → the screen offers the blank guided builder.
 */
import { and, asc, eq, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { blueprints } from "@/db/schema";

export interface BlueprintHit { code: string; title: string; vertical: string; kind: string; summary: string; recommendedDays: number; depth: string; milestones: number; payMilestones: number; score: number; related?: boolean }

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/** Zero-hit fallback (F2.01): everyday words mapped to catalogue words, so "booking app" still finds the web MVP. */
const RELATED: Record<string, string[]> = {
  app: ["web", "software"], booking: ["web", "software"], website: ["web"], site: ["web"], saas: ["web"], mvp: ["web"], portal: ["web"], shop: ["web"], ecommerce: ["web"],
  sap: ["consulting", "erp"], erp: ["consulting"], planning: ["consulting"], forecast: ["consulting", "planning"], demand: ["planning"], implementation: ["consulting"], rollout: ["consulting"],
  kitchen: ["interior", "millwork"], cabinet: ["millwork"], renovation: ["interior", "roofing"], car: ["classic car"], restoration: ["classic car"], tour: ["travel"], trip: ["travel"], holiday: ["travel"], tower: ["telecom"], roof: ["roofing"],
};
export const relatedTerms = (terms: string[]) => [...new Set(terms.flatMap((t) => RELATED[t] ?? []))].filter((t) => !terms.includes(t));

export async function searchBlueprints(f: { q?: string; vertical?: string; kind?: string; maxDays?: number }): Promise<BlueprintHit[]> {
  const hits = await rankedSearch(f, (f.q ?? "").toLowerCase().split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 1).slice(0, 8));
  if (hits.length || !f.q) return hits;
  const rel = relatedTerms((f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  return rel.length ? (await rankedSearch(f, rel)).map((h) => ({ ...h, related: true })) : [];
}

async function rankedSearch(f: { vertical?: string; kind?: string; maxDays?: number }, terms: string[]): Promise<BlueprintHit[]> {
  const where: SQL[] = [eq(blueprints.active, true)];
  if (f.vertical) where.push(eq(blueprints.vertical, f.vertical));
  if (f.kind) where.push(eq(blueprints.kind, f.kind as "DIGITAL"));
  if (f.maxDays && Number.isSafeInteger(f.maxDays) && f.maxDays > 0) where.push(lte(blueprints.recommendedDays, f.maxDays));
  let score: SQL = sql`0`;
  if (terms.length) {
    const parts = terms.map((t) => {
      const p = `%${escapeLike(t)}%`;
      return sql`(CASE WHEN ${blueprints.title} ILIKE ${p} THEN 3 ELSE 0 END + CASE WHEN ${blueprints.vertical} ILIKE ${p} THEN 2 ELSE 0 END + CASE WHEN ${blueprints.summary} ILIKE ${p} THEN 1 ELSE 0 END + CASE WHEN ${blueprints.milestones}::text ILIKE ${p} THEN 1 ELSE 0 END)`;
    });
    score = sql.join(parts, sql` + `);
  }
  const rows = await db.select({ b: blueprints, score: sql<number>`(${score})::int` }).from(blueprints).where(and(...where)).orderBy(...(terms.length ? [sql`(${score}) DESC`, asc(blueprints.title)] : [asc(blueprints.title)]));
  return rows.filter((r) => !terms.length || r.score > 0).map(({ b, score }) => ({
    code: b.code, title: b.title, vertical: b.vertical, kind: b.kind, summary: b.summary, recommendedDays: b.recommendedDays, depth: b.depth,
    milestones: b.milestones.length, payMilestones: b.milestones.filter((m) => m.type === "PAY").length, score,
  }));
}

export async function blueprintFacets(): Promise<{ verticals: string[]; kinds: string[] }> {
  const rows = await db.select({ v: blueprints.vertical, k: blueprints.kind }).from(blueprints).where(eq(blueprints.active, true));
  return { verticals: [...new Set(rows.map((r) => r.v))].sort(), kinds: [...new Set(rows.map((r) => r.k))].sort() };
}

export async function getBlueprint(code: string) {
  const [b] = await db.select().from(blueprints).where(and(eq(blueprints.code, code), eq(blueprints.active, true))).limit(1);
  return b ?? null;
}
export async function listBlueprintOptions(): Promise<{ code: string; title: string; recommendedDays: number }[]> {
  return db.select({ code: blueprints.code, title: blueprints.title, recommendedDays: blueprints.recommendedDays }).from(blueprints).where(eq(blueprints.active, true)).orderBy(asc(blueprints.title));
}
