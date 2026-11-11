/**
 * Identity demo seed (F1.3 profiles, F1.4 provider records, F1.6 merchant links, F1 overviews). Safe to re-run.
 * Run after scripts/seed.ts (which resets profiles to { blurb }):  npx tsx scripts/seed-identity.ts
 *
 *  1. Profiles for the personas: currency, time zone, billing country (merged into users.profile, blurb kept).
 *  2. Provider records for Arjun and Meera (validated by Ops), and one provider waiting for Ops review (Noor, no
 *     persona, so not on the sandbox picker; signs in by e-mail with the demo password).
 *  3. Eight demo contracts (ids ws_demo_*; two of them feed the mediator demo in seed-disputes.ts) covering every overview state: live with an approval due, live with a dispute
 *     and a fix request, signed but unfunded, an invite, waiting for a signature, and completed with a voided remainder.
 *     Revisions are hashed with the contracts module's canonical document and signatures with its signing function, so
 *     they verify. Ledger rows follow the money module's accounts (paypal:hold:<tranche>, client:, provider:, platform:fees).
 *     A contract that already exists is left as it is, except that a still-open review or bid clock is moved forward.
 *     P4: every milestone with history has an evidence package (real sample files, signals from the
 *     evidence spec functions); approved and released ones carry the client's APPROVE review signed with the evidence
 *     module's approvalSignature, and each release row stores that same signature. risk_score is the policy risk score.
 * The waitlist is never seeded: its public count must only show real sign-ups.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { blueprints, disputes, ledgerEntries, orgs, paypalLinks, refunds, releases, revisions, signatures, tranches, users, workspaces, wsClauses, wsMilestones } from "../src/db/schema";
import { SYSTEM_CLAUSES } from "../src/data/blueprints";
import { canonical, canonicalHash } from "../src/lib/canonical";
import { DAY, HOUR } from "../src/lib/clock";
import { idemKey, sha256 } from "../src/lib/ids";
import { feeFor } from "../src/lib/money";
import { hashPasswordStrong } from "../src/lib/identity/password";
import { maskTaxId, taxIdFingerprint, type ProviderProfile } from "../src/lib/identity/provider";
import { canonicalDoc, evaluate, recomputeAmounts, recomputeTranches, type ClDraft, type MsDraft, type WsHead } from "../src/server/contracts/core";
import type { Tier } from "../src/lib/policy";
import { recordPackage } from "./lib/evidence-kit";
import { signatureFor } from "../src/server/contracts";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

const now = Date.now();
const at = (h: number) => new Date(now + h * HOUR);
const merge = (patch: Record<string, unknown>) => sql`${users.profile} || ${JSON.stringify(patch)}::jsonb`;

/* ── 1 and 2: people ── */
const PROFILES: Record<string, Record<string, unknown>> = {
  u_priya: { currency: "USD", timezone: "America/New_York", billingName: "Shah Product Studio", billingCountry: "US" },
  u_dan: { currency: "USD", timezone: "Europe/London", billingName: "Okafor Logistics Ltd", billingCountry: "GB" },
  u_arjun: { currency: "USD", timezone: "Asia/Kolkata", billingCountry: "IN" },
  u_meera: { currency: "USD", timezone: "Asia/Kolkata", billingCountry: "IN" },
  u_ops: { currency: "USD", timezone: "America/Chicago", billingCountry: "US" },
  u_med: { currency: "USD", timezone: "America/New_York", billingCountry: "US" },
  u_med2: { currency: "USD", timezone: "Asia/Seoul", billingCountry: "KR" },
  u_fin: { currency: "USD", timezone: "Asia/Dubai", billingCountry: "AE" },
  u_admin: { currency: "USD", timezone: "America/Los_Angeles", billingCountry: "US" },
  u_mkt: { currency: "USD", timezone: "America/Mexico_City", billingCountry: "MX" },
  u_judge: { currency: "USD", timezone: "UTC", billingCountry: "US" },
};
const licence = (id: string, name: string, kind: string, size: number, daysAgo: number, review: "QUEUED" | "ACCEPTED") =>
  ({ id, name, kind, size, sha256: sha256(`seed-licence:${id}`), at: new Date(now - daysAgo * DAY).toISOString(), review });
const provider = (businessName: string, category: ProviderProfile["category"], country: string, taxId: string, licences: ProviderProfile["licences"]): ProviderProfile =>
  ({ businessName, category, country, taxIdMasked: maskTaxId(taxId), taxIdFingerprint: taxIdFingerprint(taxId), licences, submittedAt: new Date(now - 40 * DAY).toISOString() });

async function people() {
  for (const [id, p] of Object.entries(PROFILES)) await db.update(users).set({ profile: merge(p) }).where(eq(users.id, id));
  await db.update(users).set({ onboardingState: "PROVIDER_VALIDATED", profile: merge({ provider: provider("Rao Planning Advisory", "consulting", "IN", "AAKPR4821C", [licence("lic_seed_arjun_1", "GST registration certificate.pdf", "application/pdf", 182_311, 41, "ACCEPTED"), licence("lic_seed_arjun_2", "Professional indemnity insurance 2026.pdf", "application/pdf", 402_118, 41, "ACCEPTED")]) }) }).where(eq(users.id, "u_arjun"));
  await db.update(users).set({ onboardingState: "PROVIDER_VALIDATED", profile: merge({ provider: provider("Iyer Studio LLP", "design", "IN", "27AAGFI9035K1Z2", [licence("lic_seed_meera_1", "LLP incorporation certificate.pdf", "application/pdf", 254_904, 60, "ACCEPTED"), licence("lic_seed_meera_2", "Trade licence Mumbai.jpg", "image/jpeg", 1_204_551, 60, "ACCEPTED")]) }) }).where(eq(users.id, "u_meera"));

  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, "org_demo")).limit(1);
  if (!org) throw new Error("Run scripts/seed.ts first: the demo organisation is missing.");
  const pw = await hashPasswordStrong("demo-password-1");
  const noor = provider("Haddad Restorations", "automotive", "US", "84-2219034", [licence("lic_seed_noor_1", "State business registration.pdf", "application/pdf", 98_220, 1, "QUEUED")]);
  await db.insert(users).values({ id: "u_noor", orgId: "org_demo", email: "noor@provider.demo", name: "Noor Haddad", role: "provider", persona: null, tier: "new", passwordHash: pw, onboardingState: "SUBMITTED", profile: { blurb: "Classic car restoration shop, waiting for Ops review", currency: "USD", timezone: "America/Denver", billingCountry: "US", provider: { ...noor, submittedAt: new Date(now - 20 * HOUR).toISOString() } } })
    .onConflictDoNothing({ target: users.id });
  const [link] = await db.select({ id: paypalLinks.id }).from(paypalLinks).where(and(eq(paypalLinks.userId, "u_noor"), eq(paypalLinks.kind, "merchant"))).limit(1);
  if (!link) await db.insert(paypalLinks).values({ id: "pl_noor", userId: "u_noor", kind: "merchant", email: "noor-restorations@business.example.com", receivable: true, emailConfirmed: true });
}

/* ── 3: contracts ── */
type MsState = "DRAFT" | "LOCKED" | "OPEN" | "SUBMITTED" | "REMEDIATION" | "APPROVED" | "RELEASED" | "DISPUTED" | "REFUNDED";
interface Spec {
  id: string; title: string; blueprint: string; client: string; provider: string | null; invite?: string; totalCents: number;
  state: "DRAFT" | "PARTIALLY_SIGNED" | "LOCKED"; signed: ("client" | "provider")[];
  /** milestone states by code; others LOCKED when sealed, DRAFT otherwise */
  ms?: Record<string, MsState>; attempts?: Record<string, number>;
  tranche?: { state: "PLANNED" | "HELD" | "PARTIALLY_RELEASED" | "CLOSED"; heldDaysAgo?: number };
  reviewDue?: { code: string; inHours: number }; dispute?: { code: string; reason: string; narrative: string };
  /** F4.02 F4.03 contested history for a DISPUTED milestone, or a SUBMITTED one that scripts/seed-disputes.ts disputes through
   *  the disputes services: attempt 1 got a fix request (fix), attempt 2 is the resubmission (note). */
  contested?: Record<string, { fix: string; note: string }>;
}

const SPECS: Spec[] = [
  { id: "ws_demo_mvp", title: "Booking web app MVP", blueprint: "UC_WEB_MVP", client: "u_priya", provider: "u_meera", totalCents: 600_000, state: "LOCKED", signed: ["client", "provider"],
    ms: { M01: "APPROVED", M02: "RELEASED", M03: "SUBMITTED", M04: "OPEN" }, attempts: { M02: 1, M03: 1 }, tranche: { state: "PARTIALLY_RELEASED", heldDaysAgo: 9 }, reviewDue: { code: "M03", inHours: 31 } },
  { id: "ws_demo_erp", title: "S/4HANA demand planning sprint", blueprint: "UC_CONSULTING_SPRINT", client: "u_dan", provider: "u_arjun", totalCents: 2_400_000, state: "LOCKED", signed: ["client", "provider"],
    ms: { M01: "APPROVED", M02: "RELEASED", M03: "DISPUTED", M04: "APPROVED", M05: "REMEDIATION" }, attempts: { M02: 1, M03: 2, M05: 1 }, tranche: { state: "PARTIALLY_RELEASED", heldDaysAgo: 15 },
    dispute: { code: "M03", reason: "NOT_AS_SPECIFIED", narrative: "The design document leaves out the safety-stock logic agreed in the kickoff minutes. The provider says it was moved to a change request." },
    contested: { M03: { fix: "Include the safety-stock logic agreed in the kickoff minutes.", note: "M03 Solution design sign-off: revised design document; safety stock handled by change request CR-07." } } },
  { id: "ws_demo_portal", title: "Partner portal MVP", blueprint: "UC_WEB_MVP", client: "u_dan", provider: "u_meera", totalCents: 900_000, state: "LOCKED", signed: ["client", "provider"], tranche: { state: "PLANNED" } },
  { id: "ws_demo_invite", title: "Inventory health check", blueprint: "UC_CONSULTING_SPRINT", client: "u_priya", provider: null, invite: "arjun@provider.demo", totalCents: 1_200_000, state: "DRAFT", signed: [] },
  { id: "ws_demo_sign", title: "Forecast accuracy tune-up", blueprint: "UC_CONSULTING_SPRINT", client: "u_dan", provider: "u_arjun", totalCents: 1_500_000, state: "PARTIALLY_SIGNED", signed: ["provider"] },
  { id: "ws_demo_done", title: "Marketing site rebuild", blueprint: "UC_WEB_MVP", client: "u_priya", provider: "u_meera", totalCents: 500_000, state: "LOCKED", signed: ["client", "provider"],
    ms: { M01: "APPROVED", M02: "RELEASED", M03: "RELEASED", M04: "RELEASED", M05: "RELEASED", M06: "RELEASED", M07: "REFUNDED" }, tranche: { state: "CLOSED", heldDaysAgo: 34 } },
  /* F4.05 F4.06 mediator demo (scripts/seed-disputes.ts takes these to Tier 3): M04 ($5,500) gets a verdict that waits for a co-signature,
     M02 of the pilot is Lena Park's sealed case. Parties are chosen so the conflict-free router sends each case where the demo needs it. */
  { id: "ws_demo_fsm", title: "Field service scheduling app", blueprint: "UC_WEB_MVP", client: "u_priya", provider: "u_meera", totalCents: 2_200_000, state: "LOCKED", signed: ["client", "provider"],
    ms: { M01: "APPROVED", M02: "RELEASED", M03: "RELEASED", M04: "SUBMITTED" }, attempts: { M02: 1, M03: 1, M04: 2 }, tranche: { state: "PARTIALLY_RELEASED", heldDaysAgo: 12 },
    contested: { M04: { fix: "Add the reschedule screen for technicians and fix the job list on phones narrower than 380 px.", note: "M04 Core features on staging: revised build; job list fixed on small phones. Rescheduling moved to change request CR-04." } } },
  { id: "ws_demo_snp", title: "Supply network planning pilot", blueprint: "UC_CONSULTING_SPRINT", client: "u_dan", provider: "u_arjun", totalCents: 1_200_000, state: "LOCKED", signed: ["client", "provider"],
    ms: { M01: "APPROVED", M02: "SUBMITTED" }, attempts: { M02: 2 }, tranche: { state: "HELD", heldDaysAgo: 6 },
    contested: { M02: { fix: "Cover the returns and repairs process and rate each gap by impact.", note: "M02 Current-state assessment: revised report (14 pages); returns and repairs in appendix C." } } },
];

async function contract(s: Spec) {
  const [exists] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, s.id)).limit(1);
  if (exists) return refreshClocks(s);
  const [bp] = await db.select().from(blueprints).where(eq(blueprints.code, s.blueprint)).limit(1);
  if (!bp) throw new Error(`blueprint ${s.blueprint} missing: run scripts/seed.ts first`);
  const sealed = s.state === "LOCKED";
  const ms: MsDraft[] = bp.milestones.map((m, i) => ({
    id: `${s.id}_${m.code.toLowerCase()}`, seq: (i + 1) * 10, code: m.code, origin: "BASELINE", active: true, prunedBy: null, type: m.type, title: m.title,
    targetDay: m.day, bps: m.type === "GATE" ? 0 : m.bps, amountCents: 0, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn ?? [], trancheIdx: 1,
    state: s.ms?.[m.code] ?? (sealed ? "LOCKED" : "DRAFT"),
  }));
  const clauses = [...SYSTEM_CLAUSES.filter((c) => !bp.clauses.some((b) => b.code === c.code)), ...bp.clauses];
  const cl: ClDraft[] = clauses.map((c, i) => ({ id: `${s.id}_cl${String(i + 1).padStart(2, "0")}`, category: c.category, code: c.code, title: c.title, body: c.body, active: true, protective: c.category === "SYSTEM" ? true : Boolean(c.protective), linkedMilestone: null, byUser: null }));
  const h: WsHead = { id: s.id, title: s.title, blueprintCode: bp.code, currency: "USD", totalCents: s.totalCents, feeBps: 250, rail: "MOCK", clientId: s.client, providerId: s.provider, inviteEmail: s.invite ?? null, reviewTimeoutRule: "ESCALATE" };
  recomputeAmounts(ms, h.totalCents);
  recomputeTranches(ms, h.rail);
  const doc = canonicalDoc(h, 1, ms, cl);
  const hash = canonicalHash(doc);
  const created = new Date(now - ((s.tranche?.heldDaysAgo ?? 2) + 2) * DAY);
  const facts = await providerFacts(s.provider);
  const risk = evaluate(h, ms, cl, facts.payable, facts.tier).risk.score; // the score /ops/clearance computes

  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({ id: s.id, orgId: "org_demo", blueprintCode: bp.code, title: s.title, clientId: s.client, providerId: s.provider, inviteEmail: h.inviteEmail, currency: "USD", totalCents: s.totalCents, feeBps: 250, rail: "MOCK", state: s.state, revision: 1, riskScore: risk, canonicalHash: hash, createdAt: created, updatedAt: created });
    for (const m of ms) {
      const { id, ...rest } = m;
      await tx.insert(wsMilestones).values({ id, workspaceId: s.id, ...rest, attempts: s.attempts?.[m.code] ?? 0, reviewDueAt: s.reviewDue?.code === m.code ? at(s.reviewDue.inHours) : null });
    }
    for (const c of cl) await tx.insert(wsClauses).values({ ...c, workspaceId: s.id });
    await tx.insert(revisions).values({ workspaceId: s.id, revNo: 1, hash, canonical: JSON.parse(canonical(doc)), authorId: s.client, change: { action: "CREATE", detail: { blueprint: bp.code, source: "blueprint", seed: true } }, createdAt: created });
    for (const role of s.signed) {
      const signer = role === "client" ? s.client : s.provider!;
      await tx.insert(signatures).values({ id: `${s.id}_sig_${role}`, workspaceId: s.id, revNo: 1, hash, signerId: signer, role, signature: signatureFor(s.id, 1, hash, signer, role), mfa: true, ip: "seed", userAgent: "seed-identity", createdAt: new Date(created.getTime() + (role === "client" ? 2 : 1) * HOUR) });
    }
    if (!s.tranche) return;

    /* one tranche (every demo contract fits PayPal's hold window in one) */
    const trId = `${s.id}_tr1`;
    const heldAt = s.tranche.heldDaysAgo != null ? new Date(now - s.tranche.heldDaysAgo * DAY) : null;
    /* F3.08 the MOCKORD-/MOCKAUTH- prefixes mark a mock-rail hold: railOf() then rebuilds it in the mock rail after a restart,
       so these seeded tranches can release, return and void like any other mock hold (any other order id means real PayPal) */
    const auth = heldAt ? `MOCKAUTH-SEED-${sha256(trId).slice(0, 17).toUpperCase()}` : null;
    const days = ms.map((m) => m.targetDay);
    await tx.insert(tranches).values({ id: trId, workspaceId: s.id, idx: 1, rail: "MOCK", amountCents: s.totalCents, startDay: Math.max(0, Math.min(...days) - 1), endDay: Math.max(...days), state: s.tranche.state,
      paypalOrderId: heldAt ? `MOCKORD-SEED-${sha256(trId).slice(0, 17).toUpperCase()}` : null, authorizationId: auth, heldAt, windowEndsAt: heldAt ? new Date(heldAt.getTime() + 29 * DAY) : null });
    if (!heldAt || !auth) return;
    const hold = `paypal:hold:${trId}`;
    await tx.insert(ledgerEntries).values({ trancheId: trId, type: "HOLD", debit: hold, credit: `client:${s.client}`, amountCents: s.totalCents, paypalRef: auth, at: heldAt });
    /* evidence history: approved/released → signed APPROVE review; fix requested → REQUEST_FIX; disputed → two attempts */
    const party = { title: s.title, providerId: s.provider!, clientId: s.client };
    const sigOf = new Map<string, string>();
    for (const m of ms) {
      const when = new Date(heldAt.getTime() + Math.min(m.targetDay, 28) * DAY - 6 * HOUR);
      if (m.state === "RELEASED" || m.state === "APPROVED") {
        const r = await recordPackage(tx, m, { ...party, state: "APPROVED", approve: true, at: when });
        sigOf.set(m.id, r.signature!);
      } else if (m.state === "REMEDIATION") {
        await recordPackage(tx, m, { ...party, state: "FIX_REQUESTED", fixItems: ["Add the cutover dry-run log for the second warehouse."], at: at(-20) });
      } else if (m.state === "DISPUTED" || (m.state === "SUBMITTED" && s.contested?.[m.code])) {
        const k = s.contested?.[m.code] ?? { fix: "Cover every acceptance criterion in the proof.", note: `${m.code} ${m.title}: revised delivery.` };
        await recordPackage(tx, m, { ...party, attempt: 1, state: "FIX_REQUESTED", fixItems: [k.fix], at: at(-60) });
        await recordPackage(tx, m, { ...party, attempt: 2, state: "SUBMITTED", note: k.note, at: at(-26) });
      }
    }
    for (const m of ms.filter((x) => x.state === "RELEASED" && x.amountCents > 0)) {
      const fee = feeFor(m.amountCents, 250), net = m.amountCents - fee, key = idemKey(m.id, "release");
      const cap = `SEEDCAP-${sha256(key).slice(0, 17).toUpperCase()}`, when = new Date(heldAt.getTime() + Math.min(m.targetDay, 28) * DAY - 3 * HOUR);
      await tx.insert(releases).values({ id: `${m.id}_rel`, milestoneId: m.id, trancheId: trId, idemKey: key, kind: "MILESTONE", grossCents: m.amountCents, feeCents: fee, netCents: net, paypalRef: cap, status: "COMPLETED", approvedBy: s.client, approvalSig: sigOf.get(m.id)!, createdAt: when, completedAt: when });
      await tx.insert(ledgerEntries).values([
        { trancheId: trId, milestoneId: m.id, type: "RELEASE", debit: `provider:${s.provider}`, credit: hold, amountCents: net, paypalRef: cap, at: when },
        { trancheId: trId, milestoneId: m.id, type: "FEE", debit: "platform:fees", credit: hold, amountCents: fee, paypalRef: cap, at: when },
      ]);
    }
    for (const m of ms.filter((x) => x.state === "REFUNDED" && x.amountCents > 0)) {
      /* F3.11 a return is two records, as returnFunds writes them: the refunds row (what "Returns match ledger" checks) and the VOID ledger entry */
      const ref = `SEEDVOID-${sha256(m.id).slice(0, 12).toUpperCase()}`, when = new Date(heldAt.getTime() + 27 * DAY);
      await tx.insert(refunds).values({ id: `${m.id}_ret`, trancheId: trId, idemKey: idemKey(m.id, "return"), amountCents: m.amountCents, reason: `${m.code} ${m.title}: not delivered; returned to the client by agreement.`, paypalRef: ref, status: "COMPLETED", createdAt: when });
      await tx.insert(ledgerEntries).values({ trancheId: trId, milestoneId: m.id, type: "VOID", debit: `client:${s.client}`, credit: hold, amountCents: m.amountCents, paypalRef: ref, at: when });
    }
    const sub = s.reviewDue ? ms.find((m) => m.code === s.reviewDue!.code) : undefined;
    if (sub) { // real sample files, signals computed by the evidence spec (specSignals), the staging URL in the note
      await recordPackage(tx, sub, { ...party, state: "SUBMITTED", rawNote: true, at: at(-17),
        note: "API and data model deployed to staging: https://staging.booking-mvp.example.com/api/health\nCI run 1842 green (214 tests)." });
    }
    if (s.dispute) {
      const m = ms.find((x) => x.code === s.dispute!.code)!;
      await tx.insert(disputes).values({ id: `${s.id}_dsp1`, milestoneId: m.id, openedBy: s.client, reason: s.dispute.reason, narrative: s.dispute.narrative, amountCents: m.amountCents, tier: 1, state: "TIER1", tier1Until: at(30), vaultUntil: at(78), createdAt: at(-18) });
    }
  });
  if (s.dispute) await disputeMeta(s);
}

/** Same facts the contracts module uses for the policy check: provider tier and whether PayPal can pay them. */
async function providerFacts(providerId: string | null): Promise<{ payable: boolean; tier: Tier }> {
  if (!providerId) return { payable: false, tier: "new" };
  const [u] = await db.select({ tier: users.tier }).from(users).where(eq(users.id, providerId)).limit(1);
  const [l] = await db.select({ id: paypalLinks.id }).from(paypalLinks).where(and(eq(paypalLinks.userId, providerId), eq(paypalLinks.kind, "merchant"), eq(paypalLinks.receivable, true))).limit(1);
  return { payable: Boolean(l), tier: (u?.tier ?? "new") as Tier };
}

/** The disputes module keeps deadlines it has no core column for in dispute_meta; add the row when that table exists. */
async function disputeMeta(s: Spec) {
  try {
    await pool.query(
      `INSERT INTO dispute_meta (dispute_id, workspace_id, tranche_id, opened_role, tier3_until) VALUES ($1, $2, $3, 'client', $4) ON CONFLICT (dispute_id) DO NOTHING`,
      [`${s.id}_dsp1`, s.id, `${s.id}_tr1`, at(78 + 48)],
    );
  } catch (e) { console.warn(`dispute_meta not written (${(e as Error).message}); the disputes module can backfill it.`); }
}

/** Re-runs keep the demo alive: an open review clock or bid window is moved forward again. */
async function refreshClocks(s: Spec) {
  if (s.reviewDue) await db.update(wsMilestones).set({ reviewDueAt: at(s.reviewDue.inHours) }).where(and(eq(wsMilestones.id, `${s.id}_${s.reviewDue.code.toLowerCase()}`), eq(wsMilestones.state, "SUBMITTED")));
  if (s.dispute) await db.update(disputes).set({ tier1Until: at(30), vaultUntil: at(78) }).where(and(eq(disputes.id, `${s.id}_dsp1`), eq(disputes.state, "TIER1")));
}

async function main() {
  await people();
  for (const s of SPECS) await contract(s);
  console.log(`Identity seed: ${Object.keys(PROFILES).length} profiles, 3 provider records (Noor waits for Ops review), ${SPECS.length} demo contracts (ws_demo_*). Waitlist left untouched.`);
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
