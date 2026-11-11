/**
 * F4.02 F4.03 F4.04 F4.05 F4.06 demo seed for the disputes module. Three disputes on the seeded demo contracts are taken
 * through the real services (openDispute → placeBid → skipToVault → addRebuttal → lockVault/sealVault → issueVerdict), so
 * every state, audit row, dossier root, routing decision and AI/rule proposal is what the app itself would have written:
 *
 *  1. "Field service scheduling app" M04 ($5,500, Priya v Meera): sealed (Tier 3), routed to Marcus Bell, who signs a
 *     verdict. It is above $5,000, so it waits for a second mediator: Lena Park sees it under "Waiting for your co-signature".
 *  2. "Supply network planning pilot" M02 (Dan v Arjun): sealed and routed to Lena Park (round robin), her own case.
 *  3. "S/4HANA demand planning sprint" M03 (Dan v Arjun, opened by seed-identity): sealed and routed to Marcus Bell
 *     (Lena mediates case 2 with the same parties, so the conflict check sends it to him). No verdict yet: this is the
 *     case a reviewer opens in Marcus's workbench.
 *
 * The order matters for the conflict-free round robin (F4.05): on a fresh database case 1 goes to the first mediator
 * (Marcus), case 2 to the one never assigned (Lena), case 3 to Marcus (Lena is conflicted). Every step checks the
 * current state first, so re-running is a no-op (idempotent). The evidence module's "Booking app MVP" and the approval-due
 * demo ("Booking web app MVP" M03) are never touched.
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/seed-disputes.ts   (refused when PAYSETTLE_ENV=production)
 */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { bids, disputes, evidencePackages, rebuttals, verdicts, workspaces, wsClauses, wsMilestones } from "../src/db/schema";
import { disputeMeta } from "../src/db/schema-disputes";
import { sha256 } from "../src/lib/ids";
import type { Actor } from "../src/server/types";
import { addRebuttal, issueVerdict, lockVault, openDispute, placeBid, skipToVault } from "../src/server/disputes";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

interface CaseSpec {
  label: string;
  milestoneId: string;
  /** opened here through openDispute (the ERP dispute is opened by seed-identity) */
  open?: { reason: string; narrative: string };
  /** round-1 sealed offers, provider share in basis points: far apart, so Tier 1 does not settle */
  offers: { client: number; provider: number };
  rebuttal: { provider: string; client: string; mark?: { clause: string; comment: string } };
  verdict?: { providerShareBps: number; findings: string; rootCause: string; disposition: "RESUME" | "TERMINATE"; fault?: "CLIENT" | "PROVIDER" | "SHARED" };
  /** the mediator the router should pick on a fresh database (reported, never forced) */
  expect: string;
}

const CASES: CaseSpec[] = [
  {
    label: "Field service scheduling app · M04", milestoneId: "ws_demo_fsm_m04", expect: "u_med",
    open: { reason: "QUALITY", narrative: "The technician scheduling flow on staging has no reschedule screen, and two agreed acceptance criteria fail on phones: the job list overflows below 380 px and the walkthrough skips the offline sync case." },
    offers: { client: 3000, provider: 8500 },
    rebuttal: {
      provider: "Every backlog feature is on staging and the walkthrough video covers each acceptance criterion. Rescheduling was moved to change request CR-04 on day 9 with the client's product owner on the call, so it is outside this milestone. The small-phone layout was fixed in attempt 2.",
      client: "We never signed CR-04; the backlog attached to M01 still lists rescheduling under M04. Offline sync is in the acceptance criteria and is not shown in the video.",
      mark: { clause: "TPL_CHANGE", comment: "Rescheduling deferred under the change-request clause." },
    },
    verdict: {
      providerShareBps: 7000, rootCause: "SCOPE_CHANGE", disposition: "RESUME", fault: "SHARED",
      findings: "The M01 backlog lists rescheduling under M04 and CR-04 was never signed, so it stays in scope. The rest of the core features are on staging and the end-to-end report passes; the small-phone layout is fixed in attempt 2. Offline sync is not demonstrated. 70% to the provider for the delivered features, 30% back to the client for rescheduling and offline sync; the contract resumes.",
    },
  },
  {
    label: "Supply network planning pilot · M02", milestoneId: "ws_demo_snp_m02", expect: "u_med2",
    open: { reason: "INCOMPLETE", narrative: "The current-state assessment leaves out the returns and repairs process, which is in scope, and the gap list has no impact ratings, so we cannot plan the design phase from it." },
    offers: { client: 2500, provider: 9000 },
    rebuttal: {
      provider: "The revised report is 14 pages and covers returns and repairs in appendix C. Impact ratings were added in attempt 2 for every gap. Access to the repairs depot data came on day 6, four days late, which is why the first version missed it.",
      client: "Appendix C describes returns only; repairs is two lines. Several impact ratings are 'TBD'.",
    },
  },
  {
    label: "S/4HANA demand planning sprint · M03", milestoneId: "ws_demo_erp_m03", expect: "u_med",
    offers: { client: 2000, provider: 9000 },
    rebuttal: {
      provider: "Safety stock was moved to change request CR-07, which Dan's planning lead acknowledged by e-mail on day 5. The design covers every other gap from the M02 assessment, and attempt 2 references CR-07 explicitly.",
      client: "The kickoff minutes list safety-stock logic as in scope for the design. An e-mail acknowledgement is not a signed change request, and CR-07 has no price or date.",
      mark: { clause: "TPL_CHANGE", comment: "Safety stock handled by change request CR-07." },
    },
  },
];

const people = (w: { clientId: string; providerId: string | null }) => ({
  client: { id: w.clientId, role: "client" as const, name: "seed" } satisfies Actor,
  provider: { id: w.providerId!, role: "provider" as const, name: "seed" } satisfies Actor,
});

async function stateOf(id: string) {
  const [d] = await db.select().from(disputes).where(eq(disputes.id, id)).limit(1);
  return d;
}

async function drive(c: CaseSpec): Promise<string> {
  const [row] = await db.select({ m: wsMilestones, w: workspaces }).from(wsMilestones).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId)).where(eq(wsMilestones.id, c.milestoneId)).limit(1);
  if (!row || !row.w.providerId) return `${c.label}: contract not seeded; skipped`;
  const p = people(row.w);

  /* open (F4.01) */
  let [d] = await db.select().from(disputes).where(eq(disputes.milestoneId, c.milestoneId)).limit(1);
  if (!d) {
    if (!c.open) return `${c.label}: no dispute to drive; skipped`;
    if (row.m.state !== "SUBMITTED") return `${c.label}: milestone is ${row.m.state}, not SUBMITTED; skipped`;
    await openDispute(p.client, c.milestoneId, c.open.reason, c.open.narrative);
    [d] = await db.select().from(disputes).where(eq(disputes.milestoneId, c.milestoneId)).limit(1);
  }
  const id = d.id;

  /* Tier 1 sealed offers (F4.02): one round that does not meet, then the provider skips to the vault */
  if (d.state === "TIER1") {
    const made = await db.select({ role: bids.role, round: bids.round }).from(bids).where(eq(bids.disputeId, id));
    if (!made.some((b) => b.round === 1 && b.role === "client")) await placeBid(p.client, id, c.offers.client);
    if (!made.some((b) => b.round === 1 && b.role === "provider")) await placeBid(p.provider, id, c.offers.provider);
    if ((await stateOf(id)).state === "TIER1") await skipToVault(p.provider, id);
    d = await stateOf(id);
  }

  /* Tier 2 vault (F4.03, F4.04): one rebuttal per side, then both lock, which seals it early (→ Tier 3, routed, AI/rule proposal stored) */
  if (d.state === "TIER2") {
    const have = await db.select({ role: rebuttals.role }).from(rebuttals).where(eq(rebuttals.disputeId, id));
    if (!have.some((r) => r.role === "provider")) {
      const [pkg] = await db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, c.milestoneId)).orderBy(desc(evidencePackages.attempt)).limit(1);
      const image = pkg?.files.find((f) => f.kind === "IMAGE" || f.kind.startsWith("image/"));
      const clauseOk = c.rebuttal.mark ? (await db.select({ code: wsClauses.code }).from(wsClauses).where(and(eq(wsClauses.workspaceId, row.w.id), eq(wsClauses.code, c.rebuttal.mark.clause))).limit(1)).length > 0 : false;
      await addRebuttal(p.provider, id, image && c.rebuttal.mark
        ? { kind: "ANNOTATION", narrative: c.rebuttal.provider, sha256: sha256(`${p.provider.id}:${c.rebuttal.provider}`), annotations: [{ fileSha: image.sha256, box: [0.08, 0.12, 0.42, 0.3], clause: clauseOk ? c.rebuttal.mark.clause : undefined, comment: c.rebuttal.mark.comment }] }
        : { kind: "NOTE", narrative: c.rebuttal.provider, sha256: sha256(`${p.provider.id}:${c.rebuttal.provider}`) });
    }
    if (!have.some((r) => r.role === "client")) await addRebuttal(p.client, id, { kind: "NOTE", narrative: c.rebuttal.client, sha256: sha256(`${p.client.id}:${c.rebuttal.client}`) });
    const [meta] = await db.select({ locks: disputeMeta.vaultLocks }).from(disputeMeta).where(eq(disputeMeta.disputeId, id)).limit(1);
    if (!meta?.locks?.includes("client")) await lockVault(p.client, id);
    if ((await stateOf(id)).state === "TIER2" && !meta?.locks?.includes("provider")) await lockVault(p.provider, id);
    d = await stateOf(id);
  }

  /* Tier 3 verdict (F4.06, F4.07): above $5,000 it waits for a second mediator before any money moves */
  let note = "";
  if (d.state === "TIER3" && c.verdict) {
    const [v] = await db.select({ id: verdicts.id }).from(verdicts).where(eq(verdicts.disputeId, id)).limit(1);
    if (!v) {
      const med: Actor = { id: d.mediatorId ?? c.expect, role: "mediator", name: "seed" };
      await issueVerdict(med, id, c.verdict);
      note = `; verdict signed by ${med.id}, waiting for a co-signature`;
    } else note = "; verdict already signed";
    d = await stateOf(id);
  }
  const routed = d.mediatorId === c.expect ? `routed to ${d.mediatorId}` : `routed to ${d.mediatorId ?? "nobody"} (demo expects ${c.expect}: the database is not fresh)`;
  return `${c.label}: ${id} ${d.state}${d.state === "TIER3" || d.mediatorId ? `, ${routed}` : ""}${note}`;
}

async function main() {
  for (const c of CASES) console.log(`seed-disputes: ${await drive(c)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
