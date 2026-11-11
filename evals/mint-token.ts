/**
 * A5 · Sandbox helper for the playground and the demo video: mint an MCP agent token for a seeded person without a
 * browser session. Refused outside sandbox mode (P9). Usage: npx tsx evals/mint-token.ts u_dan [spendLimitCents] [label]
 */
try { process.loadEnvFile(".env.local"); } catch { /* optional */ }
import { eq } from "drizzle-orm";

async function main() {
  const [userId = "u_dan", limit, label = "MCP demo agent"] = process.argv.slice(2);
  const { db, pool } = await import("../src/db/client");
  const { users } = await import("../src/db/schema");
  const { mintAgentToken } = await import("../src/server/ai/agent");
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) { console.error(`No user ${userId}. Seeded ids: u_priya, u_dan (clients), u_arjun, u_meera (providers).`); process.exit(1); }
  const t = await mintAgentToken({ id: u.id, role: u.role }, { label, spendLimitCents: limit ? Number(limit) : undefined });
  console.log(`Agent token for ${u.name} (${u.role}), spend limit $${(t.spendLimitCents / 100).toFixed(2)}, expires ${t.expiresAt.toISOString()}:`);
  console.log(t.token);
  console.log(`\nexport PAYSETTLE_AGENT_TOKEN=${t.token}`);
  await pool.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
