/** Funds the "Booking app MVP" demo tranche (mock rail) so the evidence seed has a held contract to work on. Idempotent. */
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { tranches, workspaces } from "../src/db/schema";
import { confirmTranche, fundTranche } from "../src/server/money";

async function main() {
  const [w] = await db.select().from(workspaces).where(and(eq(workspaces.title, "Booking app MVP"), eq(workspaces.orgId, "org_demo"))).limit(1);
  if (!w) return console.log("seed-link: no Booking app MVP contract");
  const [t] = await db.select().from(tranches).where(and(eq(tranches.workspaceId, w.id), eq(tranches.idx, 1))).limit(1);
  if (!t || t.state !== "PLANNED") return console.log(`seed-link: tranche is ${t?.state ?? "missing"}; nothing to do`);
  const actor = { id: w.clientId, role: "client" as const, name: "seed" };
  await fundTranche(actor, t.id);
  await confirmTranche(actor, t.id);
  console.log("seed-link: Booking app MVP tranche 1 funded and held (mock rail)");
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
