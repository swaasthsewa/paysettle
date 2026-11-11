/** Funds the "Booking app MVP" demo tranche (mock rail) so the evidence seed has a held contract to work on. Idempotent. */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { tranches, workspaces } from "../src/db/schema";
import { confirmTranche, fundTranche } from "../src/server/money";
import { railFor } from "../src/lib/rails";

async function main() {
  const [w] = await db.select().from(workspaces).where(and(eq(workspaces.title, "Booking app MVP"), eq(workspaces.orgId, "org_demo"))).limit(1);
  if (!w) return console.log("seed-link: no Booking app MVP contract");
  const [t] = await db.select().from(tranches).where(and(eq(tranches.workspaceId, w.id), eq(tranches.idx, 1))).limit(1);
  if (!t || t.state !== "PLANNED") return console.log(`seed-link: tranche is ${t?.state ?? "missing"}; nothing to do`);
  /* guard: this seed funds and confirms in one go, which only the mock rail can do (PayPal needs a buyer approval) */
  if (t.rail !== "MOCK" || railFor(t.rail).id !== "MOCK") throw new Error(`seed-link: tranche 1 is on rail ${t.rail}; demo seeds must run on the mock rail (see scripts/lib/demo-rail.ts)`);
  const actor = { id: w.clientId, role: "client" as const, name: "seed" };
  await fundTranche(actor, t.id);
  await confirmTranche(actor, t.id);
  console.log("seed-link: Booking app MVP tranche 1 funded and held (mock rail)");
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
