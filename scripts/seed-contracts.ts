/**
 * F2.02 F2.04 F2.05 F2.10 F2.11 — demo contracts for the contracts module, built through the service functions so every
 * state, revision, signature and tranche is consistent. Idempotent: a contract with the same client and title is skipped.
 * F2.13 F2.14: "Clinic website build" (locked, tranche 1 held on the mock rail) is where change orders are shown;
 * "Monthly marketing retainer" (locked, period 1) is where a contract continues into its next period.
 * F2.13 F2.04: "Patient portal build" (locked, tranche 1 held) has change order 1 waiting for signatures (Meera
 * proposed it; nobody has signed), so its timeline can show the proposed plan against the signed one.
 * Usage (after npm run db:seed): npx tsx --env-file-if-exists=.env.local scripts/seed-contracts.ts
 */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { workspaces } from "../src/db/schema";
import { applyChange, createWorkspace, getWorkspace, sign } from "../src/server/contracts";
import { confirmTranche, fundTranche } from "../src/server/money";
import { proposeChangeOrder } from "../src/server/contracts/change-orders";
import type { Actor } from "../src/server/types";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

const priya: Actor = { id: "u_priya", role: "client" }, dan: Actor = { id: "u_dan", role: "client" };
const meera: Actor = { id: "u_meera", role: "provider" }, arjun: Actor = { id: "u_arjun", role: "provider" };

async function existing(clientId: string, title: string) {
  const [w] = await db.select({ id: workspaces.id, state: workspaces.state }).from(workspaces).where(and(eq(workspaces.orgId, "org_demo"), eq(workspaces.clientId, clientId), eq(workspaces.title, title))).limit(1);
  return w;
}
async function signBoth(id: string, first: Actor, second: Actor) {
  let v = await getWorkspace(first, id);
  v = await sign({ ...first, mfa: true } as Actor, id, v.revision, v.canonicalHash!);
  return sign({ ...second, mfa: true } as Actor, id, v.revision, v.canonicalHash!);
}

async function bookingApp() {
  const title = "Booking app MVP";
  const e = await existing(priya.id, title);
  if (e) return `${title}: kept (${e.state})`;
  const id = await createWorkspace(priya, { blueprintCode: "UC_WEB_MVP", title, totalCents: 600_000, providerId: meera.id });
  const v = await signBoth(id, priya, meera);
  return `${title}: ${v.state}, ${v.tranches.length} tranche(s) planned`;
}

async function planningSprint() {
  const title = "Demand planning sprint";
  const e = await existing(dan.id, title);
  if (e) return `${title}: kept (${e.state})`;
  const id = await createWorkspace(dan, { blueprintCode: "UC_CONSULTING_SPRINT", title, totalCents: 1_200_000, providerId: arjun.id });
  await applyChange(arjun, id, { action: "PRUNE", milestoneCode: "M09" });
  await applyChange(arjun, id, {
    action: "APPEND", milestone: {
      title: "Forecast accuracy dashboard live", type: "PAY", day: 23, bps: 1000, afterCode: "M08",
      proof: { artifacts: [{ kind: "LINK", min: 1, note: "Dashboard URL" }, { kind: "IMAGE", min: 2, note: "MAPE by product family" }], criteria: ["Dashboard shows forecast accuracy (MAPE) for every product family in scope", "Data refreshes from the planning system nightly"] },
      lockRule: "Client approves the dashboard.", disputeRule: "Missing product families listed; fix within 72 hours.",
    },
  });
  const v = await applyChange(dan, id, { action: "APPEND_CLAUSE", title: "Data stays in the client tenant", body: "Planning data is analysed inside the client's own planning system; extracts leave it only with written approval.", linkedMilestone: "M02" });
  await sign({ ...dan, mfa: true } as Actor, id, v.revision, v.canonicalHash!);
  const after = await getWorkspace(dan, id);
  return `${title}: ${after.state} at revision ${after.revision}`;
}

async function rushRebuild() {
  const title = "Clinic booking platform (rush)";
  const e = await existing(priya.id, title);
  if (e) return `${title}: kept (${e.state})`;
  const id = await createWorkspace(priya, { blueprintCode: "UC_WEB_MVP", title, totalCents: 1_800_000, providerId: meera.id });
  for (const k of ["TPL_IP", "TPL_CHANGE", "TPL_WARRANTY"]) await applyChange(priya, id, { action: "TOGGLE_CLAUSE", clauseCode: k, active: false });
  await applyChange(meera, id, { action: "APPEND_CLAUSE", title: "Weekend work", body: "The provider may schedule weekend work to meet the launch date, at no extra charge." });
  await applyChange(meera, id, { action: "APPEND_CLAUSE", title: "Third-party scheduling API", body: "The booking engine uses the client's existing scheduling provider through its public API." });
  await applyChange(priya, id, { action: "APPEND_CLAUSE", title: "Daily status note", body: "The provider posts a short written status note every working day." });
  await applyChange(priya, id, { action: "SET_BPS", shares: { M02: 4000, M03: 2000, M04: 1500, M05: 1000, M06: 1000, M07: 500 } });
  const v = await signBoth(id, priya, meera);
  return `${title}: ${v.state}, risk ${v.riskScore}`;
}

/** F2.13 a locked build with tranche 1 held (mock rail): the place to propose, review and sign change orders. */
async function changeOrderDemo() {
  const title = "Clinic website build";
  const e = await existing(priya.id, title);
  if (e) return `${title}: kept (${e.state})`;
  const id = await createWorkspace(priya, { blueprintCode: "UC_WEB_MVP", title, totalCents: 600_000, providerId: meera.id });
  const v = await signBoth(id, priya, meera);
  const t = v.tranches[0];
  if (v.state === "LOCKED" && t?.state === "PLANNED") { await fundTranche(priya, t.id); await confirmTranche(priya, t.id); }
  return `${title}: ${v.state}, tranche 1 ${(await getWorkspace(priya, id)).tranches[0]?.state ?? "missing"}`;
}

/** F2.14 period 1 of a monthly retainer, locked: the place to continue into the next period. */
async function retainerDemo() {
  const title = "Monthly marketing retainer";
  const e = await existing(dan.id, title);
  if (e) return `${title}: kept (${e.state})`;
  const id = await createWorkspace(dan, { blueprintCode: "UC_MARKETING_CAMPAIGN", title, totalCents: 300_000, providerId: arjun.id });
  const v = await signBoth(id, dan, arjun);
  return `${title}: ${v.state}, risk ${v.riskScore}`;
}

/** F2.13 a locked build with a change order waiting for both signatures: the place to see a proposed plan on the timeline. */
async function pendingChangeOrderDemo() {
  const title = "Patient portal build";
  const e = await existing(priya.id, title);
  if (e) return `${title}: kept (${e.state})`;
  const id = await createWorkspace(priya, { blueprintCode: "UC_WEB_MVP", title, totalCents: 600_000, providerId: meera.id });
  const v = await signBoth(id, priya, meera);
  const t = v.tranches[0];
  if (v.state === "LOCKED" && t?.state === "PLANNED") { await fundTranche(priya, t.id); await confirmTranche(priya, t.id); }
  if (v.state !== "LOCKED") return `${title}: ${v.state} (no change order: not locked)`;
  const coId = await proposeChangeOrder(meera, id, {
    note: "The clinic's records system opens its test access a week late, so the last three steps move later, and the audit findings get their own fix step.",
    items: [
      { action: "EDIT", milestoneCode: "M05", day: 26 },
      { action: "EDIT", milestoneCode: "M06", day: 29 },
      { action: "EDIT", milestoneCode: "M07", day: 31 },
      { action: "ADD", milestone: { title: "Accessibility fixes from the audit", type: "PAY", day: 33, amountCents: 60_000, lockRule: "Client approves.", disputeRule: "Missing fixes listed; fixed within 72 hours.", proof: { artifacts: [{ kind: "PDF", min: 1, note: "Audit re-test report" }], criteria: ["Every audit finding rated serious is fixed or has an agreed plan"] } } },
    ],
  });
  return `${title}: LOCKED, change order ${coId} waiting for signatures`;
}

async function main() {
  for (const step of [bookingApp, planningSprint, rushRebuild, changeOrderDemo, retainerDemo, pendingChangeOrderDemo]) console.log(await step());
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
