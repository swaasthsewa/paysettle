/**
 * Control-plane demo data (F5.01–F5.05, F5.09, F5.10, F2.11, F2.12), idempotent:
 *  - switchboard flag defaults and the fee schedule (250 bps per vertical);
 *  - 16 contracts between non-persona demo clients/providers across both blueprints, so the funnel and the pruning
 *    heatmap clear the N = 5 suppression line; funded ones are driven through the real money services on the mock rail;
 *  - one injected ledger drift (a duplicate release posting), two disputes, one escalated review, two contracts in Ops clearance;
 *  - PayPal webhook events including two dead letters; one four-eyes request waiting for approval;
 *  - one reconciliation run (trips the breaker on the drifted tranche).
 * P4: every release is backed by the client's signed approval recorded by the evidence module (submit →
 * approve → release; soft rejections are a real fix request and resubmission; the escalated review is escalated by the
 * review timer); workspaces.risk_score is the policy risk score (riskScore() from src/lib/policy, the value
 * /ops/clearance shows). The two contracts waiting for Ops clearance carry the terms that make them high risk.
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/seed-control.ts   (refused when PAYSETTLE_ENV=production)
 */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { blueprints, disputes, dualControl, ledgerEntries, paypalLinks, releases, revisions, tranches, users, webhookEvents, workspaces, wsClauses, wsMilestones } from "../src/db/schema";
import { runReviewTimers } from "../src/server/evidence";
import { deliver, deliverAndApprove, recordPackage } from "./lib/evidence-kit";
import { syncRisk } from "./lib/risk";
import { feeFor, splitByBps } from "../src/lib/money";
import { idemKey } from "../src/lib/ids";
import { canonicalHash } from "../src/lib/canonical";
import { HOUR } from "../src/lib/clock";
import { confirmTranche, fundTranche } from "../src/server/money";
import { ensureFlagDefaults } from "../src/server/control/flags";
import { ensureFeeDefaults, DEFAULT_FEE_BPS } from "../src/server/control/fees";
import { propose } from "../src/server/control/dual";
import { runReconcile } from "../src/server/control/recon";
import type { Dbx } from "../src/server/control/common";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

const CLIENTS = [["u_ctl_c1", "Avery Brooks"], ["u_ctl_c2", "Noor Haddad"], ["u_ctl_c3", "Lucas Meyer"], ["u_ctl_c4", "Grace Okoye"], ["u_ctl_c5", "Ravi Menon"], ["u_ctl_c6", "Elena Petrova"]] as const;
const PROVIDERS = [["u_ctl_p1", "Sofia Reyes", "standard"], ["u_ctl_p2", "Tomás Lindqvist", "probation"], ["u_ctl_p3", "Hana Kim", "new"]] as const;

export interface Demo {
  id: string; title: string; bp: "UC_WEB_MVP" | "UC_CONSULTING_SPRINT"; client: string; provider: string | null; state: string; total: number;
  prune?: string[]; heldDaysAgo?: number; release?: string[] | "all"; riskyTerms?: boolean; waitingMin?: number;
  dispute?: { code: string; state: "TIER1" | "TIER2"; hoursLeft: number }; escalate?: string; drift?: boolean; softRejected?: string[];
}
const D: Demo[] = [
  { id: "ws_ctl_w1", title: "Bakery ordering site", bp: "UC_WEB_MVP", client: "u_ctl_c1", provider: null, state: "DRAFT", total: 600_000, prune: ["M05"] },
  { id: "ws_ctl_w2", title: "Tutor marketplace MVP", bp: "UC_WEB_MVP", client: "u_ctl_c2", provider: "u_ctl_p3", state: "DRAFT", total: 900_000, prune: ["M05", "M07"] },
  { id: "ws_ctl_w3", title: "Field service app", bp: "UC_WEB_MVP", client: "u_ctl_c3", provider: "u_ctl_p1", state: "PARTIALLY_SIGNED", total: 1_100_000, prune: ["M05"] },
  { id: "ws_ctl_w4", title: "Fintech onboarding flow", bp: "UC_WEB_MVP", client: "u_ctl_c4", provider: "u_ctl_p2", state: "PENDING_OPS", total: 1_850_000, riskyTerms: true, waitingMin: 100 },
  { id: "ws_ctl_w5", title: "Event ticketing MVP", bp: "UC_WEB_MVP", client: "u_ctl_c5", provider: "u_meera", state: "LOCKED", total: 800_000, prune: ["M05"], heldDaysAgo: 12, release: ["M01", "M02", "M03"] },
  { id: "ws_ctl_w6", title: "Recipe subscription app", bp: "UC_WEB_MVP", client: "u_ctl_c6", provider: "u_arjun", state: "LOCKED", total: 700_000, prune: ["M05"], heldDaysAgo: 22, release: "all" },
  { id: "ws_ctl_w7", title: "Clinic intake portal", bp: "UC_WEB_MVP", client: "u_ctl_c1", provider: "u_arjun", state: "LOCKED", total: 950_000, prune: ["M05", "M07"], heldDaysAgo: 18, release: "all" },
  { id: "ws_ctl_w8", title: "Gym class booking", bp: "UC_WEB_MVP", client: "u_ctl_c2", provider: "u_ctl_p3", state: "LOCKED", total: 650_000, heldDaysAgo: 3, release: ["M01"], dispute: { code: "M02", state: "TIER2", hoursLeft: 30 } },
  { id: "ws_ctl_w9", title: "Inventory dashboard", bp: "UC_WEB_MVP", client: "u_ctl_c3", provider: "u_ctl_p3", state: "LOCKED", total: 500_000, heldDaysAgo: 8, release: ["M01", "M02"], drift: true },
  { id: "ws_ctl_k1", title: "S/4 planning assessment", bp: "UC_CONSULTING_SPRINT", client: "u_ctl_c4", provider: null, state: "DRAFT", total: 1_200_000, prune: ["M04"] },
  { id: "ws_ctl_k2", title: "Demand planning tune-up", bp: "UC_CONSULTING_SPRINT", client: "u_ctl_c5", provider: "u_ctl_p1", state: "READY_TO_SIGN", total: 900_000, prune: ["M04", "M09"] },
  { id: "ws_ctl_k3", title: "IBP supply review", bp: "UC_CONSULTING_SPRINT", client: "u_ctl_c6", provider: "u_ctl_p2", state: "PENDING_OPS", total: 2_400_000, prune: ["M04"], riskyTerms: true, waitingMin: 20 },
  { id: "ws_ctl_k4", title: "Warehouse rollout sprint", bp: "UC_CONSULTING_SPRINT", client: "u_ctl_c1", provider: "u_ctl_p1", state: "LOCKED", total: 1_000_000, prune: ["M09"], heldDaysAgo: 14, release: ["M01", "M02", "M03", "M04"], softRejected: ["M02"], dispute: { code: "M05", state: "TIER1", hoursLeft: 10 } },
  { id: "ws_ctl_k5", title: "Forecast model handover", bp: "UC_CONSULTING_SPRINT", client: "u_ctl_c2", provider: "u_ctl_p2", state: "LOCKED", total: 750_000, prune: ["M04"], heldDaysAgo: 20, release: "all" },
  { id: "ws_ctl_k6", title: "Order-to-cash fix sprint", bp: "UC_CONSULTING_SPRINT", client: "u_ctl_c3", provider: "u_arjun", state: "LOCKED", total: 1_300_000, prune: ["M04"], heldDaysAgo: 24, release: ["M01", "M02", "M03", "M05"], escalate: "M06" },
  { id: "ws_ctl_k7", title: "Supplier portal sprint", bp: "UC_CONSULTING_SPRINT", client: "u_ctl_c4", provider: "u_meera", state: "LOCKED", total: 850_000, prune: ["M09"], heldDaysAgo: 10, release: ["M01", "M02", "M03", "M04"] },
];

async function people() {
  for (const [id, name] of CLIENTS) await db.insert(users).values({ id, orgId: "org_demo", email: `${id.slice(6)}@ctl-demo.example`, name, role: "client", tier: "standard", onboardingState: "ACTIVE", profile: { blurb: "Analytics demo client (not a sign-in persona)" } }).onConflictDoNothing();
  for (const [id, name, tier] of PROVIDERS) {
    await db.insert(users).values({ id, orgId: "org_demo", email: `${id.slice(6)}@ctl-demo.example`, name, role: "provider", tier, onboardingState: "ACTIVE", profile: { blurb: "Analytics demo provider (not a sign-in persona)" } }).onConflictDoNothing();
    await db.insert(paypalLinks).values({ id: `pl_${id}`, userId: id, kind: "merchant", email: `${id.slice(6)}@business.example.com`, receivable: true, emailConfirmed: true }).onConflictDoNothing();
  }
}

async function contract(d: Demo) {
  const [bp] = await db.select().from(blueprints).where(eq(blueprints.code, d.bp)).limit(1);
  if (!bp) throw new Error(`blueprint ${d.bp} missing — run npm run db:seed first`);
  const [exists] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, d.id)).limit(1);
  if (!exists) {
    const pruned = new Set(d.prune ?? []);
    const active = bp.milestones.filter((m) => !pruned.has(m.code));
    const pay = active.filter((m) => m.type === "PAY");
    const bps = splitByBps(10_000, pay.map((m) => m.bps));
    const amounts = splitByBps(d.total, bps);
    const locked = ["SIGNED", "PENDING_OPS", "LOCKED"].includes(d.state);
    const since = new Date(Date.now() - (d.waitingMin ?? 60 * 24 * 3) * 60_000);
    await db.insert(workspaces).values({ id: d.id, orgId: "org_demo", blueprintCode: d.bp, title: d.title, clientId: d.client, providerId: d.provider, inviteEmail: d.provider ? null : "invitee@business.example.com", totalCents: d.total, feeBps: DEFAULT_FEE_BPS, rail: "MOCK", state: d.state, revision: 1 + pruned.size, riskScore: 0, canonicalHash: locked ? canonicalHash({ ws: d.id, rev: 1 + pruned.size }) : null, createdAt: new Date(since.getTime() - 2 * HOUR), updatedAt: since });
    let k = 0;
    await db.insert(wsMilestones).values(bp.milestones.map((m, i) => {
      const isActive = !pruned.has(m.code), isPay = m.type === "PAY" && isActive;
      const idx = isPay ? k++ : -1;
      return { id: `${d.id}_${m.code}`, workspaceId: d.id, seq: i + 1, code: m.code, origin: "BASELINE" as const, active: isActive, prunedBy: isActive ? null : d.client, type: m.type, title: m.title, targetDay: m.day, bps: isPay ? bps[idx] : 0, amountCents: isPay ? amounts[idx] : 0, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn ?? [], trancheIdx: 1, state: d.state === "LOCKED" ? "LOCKED" : "DRAFT" };
    }));
    /* riskyTerms: the client pruned the protective baseline clauses and two custom clauses were added (both raise the policy risk score) */
    await db.insert(wsClauses).values(bp.clauses.map((c) => ({ id: `${d.id}_${c.code}`, workspaceId: d.id, category: c.category, code: c.code, title: c.title, body: c.body, active: !(d.riskyTerms && c.category === "BASELINE" && c.protective), protective: c.protective ?? false, byUser: d.riskyTerms && c.category === "BASELINE" && c.protective ? d.client : null }))).onConflictDoNothing();
    if (d.riskyTerms) await db.insert(wsClauses).values([
      { id: `${d.id}_CUST1`, workspaceId: d.id, category: "CUSTOM" as const, code: "CUST1", title: "Extra revision rounds", body: "The client may ask for up to five extra revision rounds per milestone at no added cost.", active: true, protective: false, byUser: d.client },
      { id: `${d.id}_CUST2`, workspaceId: d.id, category: "CUSTOM" as const, code: "CUST2", title: "Source code escrow", body: "The provider deposits the source code with a named third party at each payment milestone.", active: true, protective: false, byUser: d.client },
    ]).onConflictDoNothing();
    const revs = [{ action: "CREATE", detail: { blueprint: d.bp } }, ...[...pruned].map((code) => ({ action: "PRUNE", target: code, milestoneCode: code }))];
    await db.insert(revisions).values(revs.map((change, i) => ({ workspaceId: d.id, revNo: i + 1, hash: canonicalHash({ ws: d.id, rev: i + 1, change }), canonical: { workspace: d.id, rev: i + 1 }, authorId: d.client, change }))).onConflictDoNothing();
    if (d.state === "LOCKED") {
      const days = active.map((m) => m.day);
      await db.insert(tranches).values({ id: `${d.id}_t1`, workspaceId: d.id, idx: 1, rail: "MOCK", amountCents: d.total, startDay: 1, endDay: Math.max(...days), state: "PLANNED" }).onConflictDoNothing();
    }
  }
  const risk = await syncRisk(d.id);
  if (d.state !== "LOCKED") return `${d.id}: ${d.state} · risk ${risk}`;

  const client = { id: d.client, role: "client" as const };
  const trId = `${d.id}_t1`;
  let [t] = await db.select().from(tranches).where(eq(tranches.id, trId)).limit(1);
  if (d.drift) { await historical(d, trId); [t] = await db.select().from(tranches).where(eq(tranches.id, trId)).limit(1); return `${d.id}: ${d.title} · tranche ${t.state} (historical ledger with injected drift)`; }
  /* money through the real services on the mock rail (P1, P2) */
  if (t.state === "PLANNED") {
    const { approveUrl } = await fundTranche(client, t.id);
    await confirmTranche(client, t.id, new URL(approveUrl).searchParams.get("token") ?? undefined);
    if (d.heldDaysAgo) {
      const heldAt = new Date(Date.now() - d.heldDaysAgo * 24 * HOUR);
      await db.update(tranches).set({ heldAt, windowEndsAt: new Date(heldAt.getTime() + 29 * 24 * HOUR) }).where(eq(tranches.id, t.id));
    }
  }
  const ms = await db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, d.id));
  const codes = d.release === "all" ? ms.filter((m) => m.active).sort((a, b) => a.seq - b.seq).map((m) => m.code) : d.release ?? [];
  const parties = { clientId: d.client, providerId: d.provider!, title: d.title };
  for (const code of codes) {
    const m = ms.find((x) => x.code === code && x.active);
    if (!m || m.state === "RELEASED") continue;
    /* P4: evidence → the client's signed approval → release; a soft rejection is a real fix request and resubmission */
    await deliverAndApprove(parties, m.id, { fixFirst: d.softRejected?.includes(code) ? "Add the missing acceptance evidence for the second process area." : undefined });
  }
  if (d.escalate) {
    const m = ms.find((x) => x.code === d.escalate && x.active)!;
    const [cur] = await db.select().from(wsMilestones).where(eq(wsMilestones.id, m.id)).limit(1);
    if (cur.state !== "ESCALATED") {
      await deliver(parties, m.id); // in review, then the client's 72 hours pass with no decision → the review timer escalates (contract rule ESCALATE)
      await db.update(wsMilestones).set({ reviewDueAt: new Date(Date.now() - 30 * HOUR) }).where(and(eq(wsMilestones.id, m.id), eq(wsMilestones.state, "SUBMITTED")));
      await runReviewTimers(new Date(), d.id);
    }
  }
  if (d.dispute) {
    const m = ms.find((x) => x.code === d.dispute!.code)!;
    const [cur] = await db.select().from(wsMilestones).where(eq(wsMilestones.id, m.id)).limit(1);
    if (cur.state !== "DISPUTED") await deliver(parties, m.id); // the dispute is about submitted evidence
    await db.update(wsMilestones).set({ state: "DISPUTED", reviewDueAt: null }).where(eq(wsMilestones.id, m.id));
    const left = d.dispute.hoursLeft * HOUR;
    await db.insert(disputes).values({ id: `dsp_${d.id}`, milestoneId: m.id, openedBy: d.client, reason: "Acceptance criteria not met", narrative: "The delivered work does not meet the agreed acceptance criteria for this milestone.", amountCents: m.amountCents, tier: d.dispute.state === "TIER1" ? 1 : 2, state: d.dispute.state,
      tier1Until: new Date(Date.now() + (d.dispute.state === "TIER1" ? left : -2 * HOUR)), vaultUntil: new Date(Date.now() + (d.dispute.state === "TIER2" ? left : left + 48 * HOUR)), createdAt: new Date(Date.now() - 20 * HOUR) }).onConflictDoNothing();
  }
  [t] = await db.select().from(tranches).where(eq(tranches.id, trId)).limit(1);
  return `${d.id}: ${d.title} · tranche ${t.state}`;
}

/**
 * A contract whose money moved days ago (history written as the money module writes it: HOLD on the authorization,
 * RELEASE net + FEE on the capture), plus the F5.01 / S5 chaos case: a duplicate release posting two hours ago with
 * no PayPal capture behind it. Written once; the ledger is append-only.
 */
export async function historical(d: Demo, trId: string, dbx: Dbx = db) {
  const db = dbx;
  const have = await db.select({ id: ledgerEntries.id }).from(ledgerEntries).where(eq(ledgerEntries.trancheId, trId)).limit(1);
  if (have.length) return;
  const heldAt = new Date(Date.now() - (d.heldDaysAgo ?? 8) * 24 * HOUR);
  const auth = `MOCKAUTH-HIST-${d.id.slice(-2).toUpperCase()}`;
  await db.update(tranches).set({ state: "PARTIALLY_RELEASED", paypalOrderId: `MOCKORD-HIST-${d.id.slice(-2).toUpperCase()}`, authorizationId: auth, heldAt, windowEndsAt: new Date(heldAt.getTime() + 29 * 24 * HOUR) }).where(eq(tranches.id, trId));
  await db.insert(ledgerEntries).values({ trancheId: trId, type: "HOLD", debit: `hold:${trId}`, credit: `client:${d.client}`, amountCents: d.total, paypalRef: auth, at: heldAt });
  const ms = (await db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, d.id))).sort((a, b) => a.seq - b.seq);
  const rel = new Set(d.release === "all" ? ms.map((m) => m.code) : d.release ?? []);
  let opened = false, day = 1;
  for (const m of ms) {
    if (!m.active) continue;
    if (rel.has(m.code)) {
      const at = new Date(heldAt.getTime() + day++ * 24 * HOUR);
      await db.update(wsMilestones).set({ state: "RELEASED", attempts: 1 }).where(eq(wsMilestones.id, m.id));
      /* P4: the history carries the client's recorded, signed approval (same signature as the release row) */
      const ok = await recordPackage(db, m, { title: d.title, providerId: d.provider!, clientId: d.client, state: "APPROVED", approve: true, at: new Date(at.getTime() - 2 * HOUR) });
      if (m.amountCents > 0) {
        const fee = feeFor(m.amountCents, DEFAULT_FEE_BPS), cap = `MOCKCAP-HIST-${m.id.slice(-6).toUpperCase()}`;
        await db.insert(releases).values({ id: `rel_${m.id}`, milestoneId: m.id, trancheId: trId, idemKey: idemKey("release", m.id, "MILESTONE"), kind: "MILESTONE", grossCents: m.amountCents, feeCents: fee, netCents: m.amountCents - fee, paypalRef: cap, status: "COMPLETED", approvedBy: d.client, approvalSig: ok.signature!, createdAt: at, completedAt: at }).onConflictDoNothing();
        await db.insert(ledgerEntries).values([
          { trancheId: trId, milestoneId: m.id, type: "RELEASE", debit: `provider:${d.provider}`, credit: `hold:${trId}`, amountCents: m.amountCents - fee, paypalRef: cap, at },
          { trancheId: trId, milestoneId: m.id, type: "FEE", debit: "platform:fees", credit: `hold:${trId}`, amountCents: fee, paypalRef: cap, at },
        ]);
      }
    } else if (!opened) { opened = true; await db.update(wsMilestones).set({ state: "OPEN" }).where(eq(wsMilestones.id, m.id)); }
  }
  const m2 = ms.find((x) => x.code === "M02")!;
  await db.insert(ledgerEntries).values({ trancheId: trId, milestoneId: null, type: "RELEASE", debit: `provider:${d.provider}`, credit: `hold:${trId}`, amountCents: Math.round(m2.amountCents / 4), paypalRef: null, at: new Date(Date.now() - 2 * HOUR) });
}

async function webhooks() {
  const [cap] = await db.select({ ref: releases.paypalRef }).from(releases).where(eq(releases.milestoneId, "ws_ctl_w5_M03")).limit(1);
  const ago = (h: number) => new Date(Date.now() - h * HOUR);
  const ev = (id: string, type: string, resourceId: string | null, state: "PROCESSED" | "DUPLICATE" | "QUARANTINED" | "DEAD", hoursAgo: number, verified = true, error: string | null = null) =>
    ({ transmissionId: id, type, resourceId, verified, state, error, receivedAt: ago(hoursAgo), payload: { event: { id: `WH-${id}`, event_type: type, resource_type: type.split(".")[1]?.toLowerCase(), resource: { id: resourceId }, create_time: ago(hoursAgo).toISOString() } } });
  const rows = [
    ev("ctl-wh-001", "CHECKOUT.ORDER.APPROVED", "MOCKORD-DEMO-W6", "PROCESSED", 22 * 24),
    ev("ctl-wh-002", "PAYMENT.AUTHORIZATION.CREATED", "MOCKAUTH-DEMO-W6", "PROCESSED", 22 * 24),
    ev("ctl-wh-003", "PAYMENT.CAPTURE.COMPLETED", "MOCKCAP-DEMO-W6-1", "PROCESSED", 15 * 24),
    ev("ctl-wh-004", "PAYMENT.CAPTURE.COMPLETED", "MOCKCAP-DEMO-W6-1", "DUPLICATE", 15 * 24),
    ev("ctl-wh-005", "PAYMENT.CAPTURE.COMPLETED", "MOCKCAP-DEMO-K5-1", "PROCESSED", 9 * 24),
    ev("ctl-wh-006", "CUSTOMER.DISPUTE.CREATED", "PP-D-DEMO-77", "QUARANTINED", 30, false, "Signature verification failed: certificate not issued by PayPal"),
    ev("ctl-wh-dead-1", "PAYMENT.CAPTURE.COMPLETED", cap?.ref ?? "MOCKCAP-DEMO-W5-3", "DEAD", 3, true, "Timed out after 10 s while the release row was locked; retry budget used up"),
    ev("ctl-wh-dead-2", "PAYMENT.CAPTURE.REFUNDED", "MOCKREF-UNKNOWN-42", "DEAD", 1, true, "No refund or capture with this id is known yet (event arrived before the refund was stored)"),
  ];
  for (const r of rows) await db.insert(webhookEvents).values(r).onConflictDoNothing();
  return rows.length;
}

async function fourEyes() {
  const [waiting] = await db.select({ id: dualControl.id, expiresAt: dualControl.expiresAt }).from(dualControl).where(and(eq(dualControl.target, "ctl-wh-dead-1"), eq(dualControl.state, "AWAITING"))).limit(1);
  if (waiting && waiting.expiresAt > new Date()) return waiting.id;
  const [e] = await db.select({ state: webhookEvents.state }).from(webhookEvents).where(eq(webhookEvents.transmissionId, "ctl-wh-dead-1")).limit(1);
  if (e?.state !== "DEAD") return "(dead letter already replayed)";
  return propose({ id: "u_admin", role: "admin", name: "Alex Chen" }, "REPLAY_WEBHOOK", "ctl-wh-dead-1", {}, "Handler timed out under load; the payload is verified and safe to re-apply.");
}

async function main() {
  await ensureFlagDefaults();
  await ensureFeeDefaults();
  await people();
  for (const d of D) console.log(await contract(d));
  console.log(`webhook events: ${await webhooks()}`);
  console.log(`four-eyes request waiting: ${await fourEyes()}`);
  const r = await runReconcile(null, undefined);
  const by = r.lines.reduce<Record<string, number>>((a, l) => ({ ...a, [l.status]: (a[l.status] ?? 0) + 1 }), {});
  console.log(`reconciliation ${r.runId}: ${r.verdict} · ${JSON.stringify(by)} · breakers tripped: ${r.lines.filter((l) => l.tripped).map((l) => l.trancheId).join(", ") || "none"}`);
}
if (process.argv[1]?.endsWith("seed-control.ts")) main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
