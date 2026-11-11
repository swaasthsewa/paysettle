/**
 * Money demo data (F3.01–F3.11), idempotent: four locked contracts between the demo personas, driven through the real
 * money services on the mock rail (fund → confirm → releases), so receipts, payouts, the ledger and the radar show
 * real figures. One contract is left unfunded so it can be funded live in the app.
 * P4: every released milestone goes through the evidence module — the provider submits generated
 * evidence that meets the proof spec, the client approves with a signed approval, and that approval triggers the release.
 * A milestone left "in client review" has a real evidence package (submitEvidence), never a bare state change.
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/seed-money.ts   (refused when PAYSETTLE_ENV=production)
 */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { blueprints, tranches, workspaces, wsMilestones } from "../src/db/schema";
import { splitByBps } from "../src/lib/money";
import { confirmTranche, fundTranche } from "../src/server/money";
import { makeContract } from "../src/server/money/fixtures";
import { deliver, deliverAndApprove } from "./lib/evidence-kit";
import { syncRisk } from "./lib/risk";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

interface Demo { id: string; title: string; blueprint: string; client: string; provider: string; totalCents: number; rail: "MOCK" | "A1"; fund: boolean; heldDaysAgo?: number; release: string[]; submitted?: string[] }
const DEMOS: Demo[] = [
  { id: "ws_money_demo1", title: "Clinic booking web app", blueprint: "UC_WEB_MVP", client: "u_priya", provider: "u_meera", totalCents: 1_200_000, rail: "MOCK", fund: true, heldDaysAgo: 9, release: ["M01", "M02", "M03"], submitted: ["M04"] },
  { id: "ws_money_demo3", title: "ERP planning sprint", blueprint: "UC_CONSULTING_SPRINT", client: "u_dan", provider: "u_arjun", totalCents: 600_000, rail: "MOCK", fund: true, heldDaysAgo: 23, release: ["M01", "M02", "M03", "M04", "M05"] },
  { id: "ws_money_demo4", title: "Data dashboard sprint", blueprint: "UC_CONSULTING_SPRINT", client: "u_dan", provider: "u_meera", totalCents: 250_000, rail: "MOCK", fund: true, heldDaysAgo: 20, release: ["M01", "M02", "M03", "M04", "M05", "M06", "M07", "M08", "M09"] },
  { id: "ws_money_demo2", title: "Marketing site refresh", blueprint: "UC_WEB_MVP", client: "u_priya", provider: "u_arjun", totalCents: 480_000, rail: "MOCK", fund: false, release: [] },
];

async function ensure(d: Demo) {
  const [exists] = await db.select().from(workspaces).where(eq(workspaces.id, d.id)).limit(1);
  if (!exists) {
    const [bp] = await db.select().from(blueprints).where(eq(blueprints.code, d.blueprint)).limit(1);
    if (!bp) throw new Error(`blueprint ${d.blueprint} missing — run npm run db:seed first`);
    const pay = bp.milestones.filter((m) => m.type === "PAY");
    const amounts = splitByBps(d.totalCents, pay.map((m) => m.bps));
    let k = 0;
    await makeContract({
      orgId: "org_demo", clientId: d.client, providerId: d.provider, workspaceId: d.id, blueprintCode: d.blueprint, title: d.title, rail: d.rail,
      milestones: bp.milestones.map((m) => ({ code: m.code, title: m.title, type: m.type, day: m.day, amountCents: m.type === "PAY" ? amounts[k++] : 0 })),
    });
    for (const m of bp.milestones) await db.update(wsMilestones).set({ bps: m.bps, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule }).where(and(eq(wsMilestones.workspaceId, d.id), eq(wsMilestones.code, m.code)));
  }
  const [t] = await db.select().from(tranches).where(eq(tranches.workspaceId, d.id)).limit(1);
  if (d.fund && t.state === "PLANNED") {
    const client = { id: d.client, role: "client" as const };
    const { approveUrl } = await fundTranche(client, t.id);
    await confirmTranche(client, t.id, new URL(approveUrl).searchParams.get("token") ?? undefined);
    if (d.heldDaysAgo) {
      const heldAt = new Date(Date.now() - d.heldDaysAgo * 86_400_000);
      await db.update(tranches).set({ heldAt, windowEndsAt: new Date(heldAt.getTime() + 29 * 86_400_000) }).where(eq(tranches.id, t.id));
    }
  }
  const ms = await db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, d.id));
  const parties = { clientId: d.client, providerId: d.provider, title: d.title };
  for (const code of d.release) {
    const m = ms.find((x) => x.code === code);
    if (!m || m.state === "RELEASED") continue;
    await deliverAndApprove(parties, m.id); // provider evidence → client's signed approval → release (P4)
  }
  for (const code of d.submitted ?? []) {
    const m = (await db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, d.id))).find((x) => x.code === code);
    if (m && (m.state === "OPEN" || m.state === "LOCKED")) await deliver(parties, m.id); // a real package for the client to review
  }
  const [after] = await db.select().from(tranches).where(eq(tranches.workspaceId, d.id)).limit(1);
  console.log(`${d.id}: ${d.title} · tranche ${after.state} · risk ${await syncRisk(d.id)}`); // stored risk = policy risk
}

async function main() {
  process.env.MONEY_RETRY_MS ??= "50";
  for (const d of DEMOS) await ensure(d);
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
