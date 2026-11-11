/**
 * Deadline-terms demo data, idempotent: one Web MVP contract between Priya (client) and Meera (provider) in negotiation, with both
 * deadline terms switched on through the contracts service (so the revision, the clause text and the canonical hash are
 * real) and waiting for signatures — the room's "Deadline terms" panel and policy gate show live values. The full funded
 * flow (pool, late deduction, early bonus, zero drift) is playground scenario S7.
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/seed-deadline.ts   (refused when PAYSETTLE_ENV=production)
 */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { workspaces } from "../src/db/schema";
import { applyChange, createWorkspace } from "../src/server/contracts";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

const TITLE = "Patient portal MVP (deadline terms)";
async function main() {
  const client = { id: "u_priya", role: "client" as const };
  const [have] = await db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.clientId, client.id), eq(workspaces.title, TITLE))).limit(1);
  if (have) { console.log(`seed-deadline: ${have.id} already exists`); return; }
  const id = await createWorkspace(client, { blueprintCode: "UC_WEB_MVP", title: TITLE, totalCents: 800_000, providerId: "u_meera" });
  const v = await applyChange(client, id, { action: "SET_DEADLINE_TERMS", terms: {
    late: { rateBps: 50, graceDays: 1, capBps: 1000, milestones: "ALL" },
    early: { poolCents: 16_000, rateBps: 25, minDaysEarly: 2, capBps: 100, milestones: "ALL" },
  } });
  console.log(`seed-deadline: ${id} revision ${v.revision}, state ${v.state}, ${v.violations.length} policy item(s)`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
