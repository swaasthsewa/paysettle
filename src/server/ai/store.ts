/**
 * A7 · Database side of the AI gateway: the daily-cap counter and call log read/write ai_calls; the people list for
 * redaction comes from the users table (names and e-mails → role labels). The gateway instance is a singleton that
 * tests replace with setGateway() (fake fetch + memory store).
 */
import { flagOn } from "@/server/control/flags";
import { and, gte, sql, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { aiCalls, users } from "@/db/schema";
import { newId } from "@/lib/ids";
import { configFromEnv } from "@/lib/ai/config";
import { AiGateway, type AiStore } from "@/lib/ai/gateway";
import { buildPeople, type People } from "@/lib/ai/redact";

let peopleCache: { at: number; people: People } | null = null;
const PEOPLE_TTL_MS = 60_000;

export const dbStore: AiStore = {
  async tokensSince(since) {
    const [r] = await db.select({ n: sql<string>`coalesce(sum(${aiCalls.tokensIn} + ${aiCalls.tokensOut}), 0)` }).from(aiCalls).where(and(gte(aiCalls.createdAt, since)));
    return Number(r?.n ?? 0);
  },
  async log(c) {
    await db.insert(aiCalls).values({ id: newId("aic"), purpose: c.purpose, model: c.model, tokensIn: c.tokensIn, tokensOut: c.tokensOut, costMicros: c.costMicros, inputHash: c.inputHash, output: c.output as object, ok: c.ok, latencyMs: c.latencyMs });
  },
  async people() {
    if (peopleCache && Date.now() - peopleCache.at < PEOPLE_TTL_MS) return peopleCache.people;
    const rows = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role }).from(users);
    peopleCache = { at: Date.now(), people: buildPeople(rows) };
    return peopleCache.people;
  },
};

let current: AiGateway | null = null;
/** The gateway in use: built from the environment on first use. */
export function gateway(): AiGateway { return (current ??= new AiGateway(configFromEnv(), { store: dbStore, enabled: () => flagOn("ai.enabled") })); }
/** Tests and the evaluation runner inject their own gateway (fake LLM, memory store). Pass null to rebuild from env. */
export function setGateway(g: AiGateway | null) { current = g; }

export async function recentCalls(limit = 20) {
  return db.select({ id: aiCalls.id, purpose: aiCalls.purpose, model: aiCalls.model, tokensIn: aiCalls.tokensIn, tokensOut: aiCalls.tokensOut, costMicros: aiCalls.costMicros, ok: aiCalls.ok, latencyMs: aiCalls.latencyMs, createdAt: aiCalls.createdAt })
    .from(aiCalls).orderBy(desc(aiCalls.createdAt)).limit(limit);
}

export async function usageSince(since: Date) {
  const [r] = await db.select({
    calls: sql<string>`count(*)`, ok: sql<string>`count(*) filter (where ${aiCalls.ok})`,
    tokens: sql<string>`coalesce(sum(${aiCalls.tokensIn} + ${aiCalls.tokensOut}), 0)`, cost: sql<string>`coalesce(sum(${aiCalls.costMicros}), 0)`,
  }).from(aiCalls).where(gte(aiCalls.createdAt, since));
  return { calls: Number(r?.calls ?? 0), ok: Number(r?.ok ?? 0), tokens: Number(r?.tokens ?? 0), costMicros: Number(r?.cost ?? 0) };
}
