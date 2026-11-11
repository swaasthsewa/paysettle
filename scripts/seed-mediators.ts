/**
 * F4.05 F4.06 — demo seed for the mediator network (idempotent; refused when PAYSETTLE_ENV=production).
 *  - 10 mediators in org_demo: the two seeded personas (Marcus Bell, Lena Park) plus 8 more created here with the demo
 *    password, across automotive, construction and engineering, telecom, interiors and furniture, digital and code,
 *    travel (and events); 3 firms plus independents; statuses Senior, Active, Probation, Calibrating, Verifying, one on leave.
 *  - credentials (verified, one expired, one expiring soon, one waiting for Ops), availability, 4 public applications.
 *  - backfill: every real (non-playground) case that already has a mediator gets an ACCEPTED offer with the router's
 *    breakdown computed now (source BACKFILL), so the "why this mediator" card has data; verdicts signed before the
 *    network get their co-sign flags and mediator fee recorded; verdict counts are recounted from the verdicts table.
 * Run before seed-disputes on a fresh database to route the demo cases through the network; after it, it backfills.
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/seed-mediators.ts
 */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { auditChain, disputes, users, verdicts, workspaces, wsMilestones } from "../src/db/schema";
import { mediatorApplications, mediatorAvailability, mediatorCaseFlags, mediatorCredentials, mediatorFees, mediatorOffers, mediatorProfiles, type MediatorStatus } from "../src/db/schema-mediators";
import { hashPasswordStrong } from "../src/lib/identity/password";
import { sha256 } from "../src/lib/ids";
import { isSimWorkspaceSql } from "../src/lib/sim";
import { COSIGN_ABOVE_CENTS } from "../src/server/disputes/rules";
import { acceptOffer, coiHistory, loadCandidates, partiesOf } from "../src/server/mediators";
import { breakdownFor, rankMediators } from "../src/server/mediators/router";
import { MEDIATOR_FEE_CENTS, cosignReasons, feeTier } from "../src/server/mediators/rules";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

const ORG = "org_demo";
const DAYMS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => iso(new Date(Date.now() + n * DAYMS));

const HARBOR = "Harbor Mediation Group", KESTREL = "Kestrel ADR Partners", NORTHGATE = "Northgate Dispute Services";
interface Spec {
  id: string; name: string; email?: string; status: MediatorStatus; firm: string | null; domains: string[]; languages: string[]; timezone: string; maxOpen: number; bio: string;
  creds: { type: string; issuer: string; number: string; expires: string | null; status: "VERIFIED" | "PENDING" | "REJECTED" }[];
  weeklyHours: number; leave?: [string, string]; paused?: boolean; conflicts?: string[]; calibration?: number;
}
const MEDIATORS: Spec[] = [
  { id: "u_med", name: "Marcus Bell", status: "ACTIVE", firm: HARBOR, domains: ["digital", "UC_WEB_MVP"], languages: ["en"], timezone: "America/New_York", maxOpen: 5, weeklyHours: 20,
    bio: "Former engineering manager; mediates software delivery and SaaS build disputes.", calibration: 100,
    creds: [{ type: "Mediation accreditation", issuer: "Civil Mediation Council", number: "CMC-2219-4410", expires: inDays(400), status: "VERIFIED" }] },
  { id: "u_med2", name: "Lena Park", status: "SENIOR", firm: KESTREL, domains: ["digital", "interiors", "UC_CONSULTING_SPRINT"], languages: ["en", "ko"], timezone: "Asia/Seoul", maxOpen: 6, weeklyHours: 25,
    bio: "Senior mediator and arbitrator for technology and fit-out contracts; co-signs large verdicts.", calibration: 100,
    creds: [{ type: "Chartered arbitrator", issuer: "Chartered Institute of Arbitrators", number: "FCIARB-88123", expires: inDays(700), status: "VERIFIED" }, { type: "Mediator licence", issuer: "Korean Commercial Arbitration Board", number: "KCAB-M-30917", expires: inDays(250), status: "VERIFIED" }] },
  { id: "u_med_ravi", name: "Ravi Menon", status: "ACTIVE", firm: NORTHGATE, domains: ["telecom", "construction", "UC_TELECOM_TOWER"], languages: ["en", "hi"], timezone: "Asia/Kolkata", maxOpen: 4, weeklyHours: 15,
    bio: "Civil and RF engineer; 12 years of tower roll-outs and site acceptance.", calibration: 100,
    creds: [{ type: "Chartered engineer", issuer: "Institution of Engineers (India)", number: "IEI-CE-5521873", expires: inDays(40), status: "VERIFIED" }] },
  { id: "u_med_sofia", name: "Sofia Alvarez", status: "SENIOR", firm: HARBOR, domains: ["construction", "UC_HOME_ROOFING", "UC_KITCHEN_REMODEL"], languages: ["en", "es"], timezone: "America/Mexico_City", maxOpen: 5, weeklyHours: 20,
    bio: "Construction claims specialist; residential roofing, remodels and solar.", calibration: 100,
    creds: [{ type: "Construction mediator certificate", issuer: "American Arbitration Association", number: "AAA-CM-77310", expires: inDays(500), status: "VERIFIED" }] },
  { id: "u_med_tom", name: "Tomasz Nowak", status: "ACTIVE", firm: null, domains: ["automotive", "UC_CLASSIC_CAR"], languages: ["en", "de"], timezone: "Europe/Warsaw", maxOpen: 3, weeklyHours: 10,
    bio: "Restoration workshop owner for 20 years; engine swaps and EV conversions.", calibration: 100,
    creds: [{ type: "Master mechanic", issuer: "Polish Chamber of Crafts", number: "PCC-MM-104422", expires: inDays(-30), status: "VERIFIED" }, { type: "Vehicle assessor licence", issuer: "Polish Chamber of Crafts", number: "PCC-VA-209981", expires: inDays(900), status: "VERIFIED" }] },
  { id: "u_med_aiko", name: "Aiko Tanaka", status: "PROBATION", firm: KESTREL, domains: ["travel", "events"], languages: ["en", "ja"], timezone: "Asia/Tokyo", maxOpen: 3, weeklyHours: 8,
    bio: "Tour operator turned mediator; travel packages and event production.", calibration: 100,
    creds: [{ type: "Mediation certificate", issuer: "Japan Commercial Arbitration Association", number: "JCAA-M-6630", expires: inDays(600), status: "VERIFIED" }] },
  { id: "u_med_omar", name: "Omar Haddad", status: "ACTIVE", firm: NORTHGATE, domains: ["interiors", "UC_INTERIOR_MILLWORK", "UC_FURNITURE_MFG"], languages: ["en", "ar"], timezone: "Asia/Dubai", maxOpen: 4, weeklyHours: 15,
    bio: "Joinery and fit-out project manager; millwork, finishes and furniture making.", calibration: 100,
    creds: [{ type: "Mediator accreditation", issuer: "Dubai International Arbitration Centre", number: "DIAC-M-41207", expires: inDays(450), status: "VERIFIED" }] },
  { id: "u_med_grace", name: "Grace Okoye", status: "CALIBRATING", firm: null, domains: ["digital", "professional"], languages: ["en"], timezone: "Africa/Lagos", maxOpen: 3, weeklyHours: 10,
    bio: "Software contracts lawyer; new to the network, working through calibration.",
    creds: [{ type: "Barrister and solicitor", issuer: "Nigerian Bar Association", number: "NBA-SCN-082214", expires: null, status: "VERIFIED" }] },
  { id: "u_med_henrik", name: "Henrik Larsen", status: "VERIFYING", firm: HARBOR, domains: ["telecom"], languages: ["en", "de"], timezone: "Europe/Copenhagen", maxOpen: 3, weeklyHours: 6,
    bio: "Network engineer; application approved, credentials with Ops.",
    creds: [{ type: "Telecom engineer certification", issuer: "IDA Denmark", number: "IDA-TE-55102", expires: inDays(800), status: "PENDING" }] },
  { id: "u_med_jules", name: "Jules Moreau", status: "ACTIVE", firm: KESTREL, domains: ["travel", "automotive"], languages: ["en", "fr"], timezone: "Europe/Paris", maxOpen: 3, weeklyHours: 12, leave: [inDays(-2), inDays(12)],
    bio: "Travel and motorsport event disputes; on leave this fortnight.", calibration: 100,
    creds: [{ type: "Médiateur agréé", issuer: "Centre de Médiation et d'Arbitrage de Paris", number: "CMAP-2017-0331", expires: inDays(300), status: "VERIFIED" }] },
];

const APPLICATIONS = [
  { id: "mapp_seed_1", name: "Daniel Reyes", email: "daniel.reyes@example.com", domains: ["construction", "telecom"], languages: ["en", "es"], timezone: "America/Chicago", firm: "Reyes Engineering Advisory", credentials: "Professional Engineer (Texas Board of PE), licence ending 4471, expires 2027-08\nCertified construction mediator, AAA 2022", conflicts: "Lone Star Roofing LLC (former employer)", weeklyHours: 10, status: "NEW" as const },
  { id: "mapp_seed_2", name: "Priyanka Desai", email: "priyanka.desai@example.com", domains: ["digital"], languages: ["en", "hi"], timezone: "Asia/Kolkata", firm: null, credentials: "Accredited mediator, Indian Institute of Arbitration and Mediation, 2021\nPMP, Project Management Institute", conflicts: "", weeklyHours: 6, status: "NEW" as const },
  { id: "mapp_seed_3", name: "Ingrid Sørensen", email: "ingrid.sorensen@example.com", domains: ["interiors", "events"], languages: ["en", "de"], timezone: "Europe/Oslo", firm: KESTREL, credentials: "Interior architect, NIL member 3381\nMediation training, Norwegian Bar Association 2023", conflicts: "Fjord Interiors AS", weeklyHours: 8, status: "NEW" as const },
  { id: "mapp_seed_4", name: "Kevin Brooks", email: "kevin.brooks@example.com", domains: ["automotive"], languages: ["en"], timezone: "America/Denver", firm: null, credentials: "Car enthusiast, 10 years of builds", conflicts: "", weeklyHours: 4, status: "REJECTED" as const },
];

async function upsertPeople() {
  const pw = await hashPasswordStrong("demo-password-1");
  for (const m of MEDIATORS) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, m.id)).limit(1);
    if (!u) {
      await db.insert(users).values({ id: m.id, orgId: ORG, email: m.email ?? `${m.name.split(" ")[0].toLowerCase()}@mediator.demo`, name: m.name, role: "mediator", tier: "standard", passwordHash: pw, onboardingState: "ACTIVE", profile: { blurb: m.bio, timezone: m.timezone, languages: m.languages } })
        .onConflictDoNothing();
    }
    const [vc] = await db.select({ n: sql<number>`count(*)::int` }).from(verdicts).where(and(eq(verdicts.mediatorId, m.id), eq(verdicts.origin, "TIER3")));
    const p = { orgId: ORG, status: m.status, domains: m.domains, languages: m.languages, timezone: m.timezone, maxOpen: m.maxOpen, firm: m.firm, bio: m.bio, declaredConflicts: m.conflicts ?? [], verdictCount: vc?.n ?? 0, calibrationScore: m.calibration ?? null, calibrationAttempts: m.calibration ? 1 : 0 };
    await db.insert(mediatorProfiles).values({ userId: m.id, ...p }).onConflictDoUpdate({ target: mediatorProfiles.userId, set: { ...p, updatedAt: new Date() } });
    await db.insert(mediatorAvailability).values({ userId: m.id, weeklyHours: m.weeklyHours, leaveFrom: m.leave?.[0] ?? null, leaveTo: m.leave?.[1] ?? null, paused: m.paused ?? false })
      .onConflictDoUpdate({ target: mediatorAvailability.userId, set: { weeklyHours: m.weeklyHours, leaveFrom: m.leave?.[0] ?? null, leaveTo: m.leave?.[1] ?? null, paused: m.paused ?? false, updatedAt: new Date() } });
    for (const [i, c] of m.creds.entries()) {
      const id = `mcr_seed_${m.id}_${i}`;
      const masked = `${"•".repeat(Math.min(8, c.number.length - 4))}${c.number.slice(-4)}`;
      await db.insert(mediatorCredentials).values({ id, userId: m.id, type: c.type, issuer: c.issuer, numberMasked: masked, expiresOn: c.expires, fileSha256: sha256(`seed-credential:${id}`), fileName: `${c.type.replace(/[^\w ]+/g, "").replace(/\s+/g, "-").toLowerCase()}.pdf`,
        status: c.status, verifiedBy: c.status === "PENDING" ? null : "u_ops", verifiedAt: c.status === "PENDING" ? null : new Date(Date.now() - 20 * DAYMS) })
        .onConflictDoUpdate({ target: mediatorCredentials.id, set: { expiresOn: c.expires, status: c.status } });
    }
  }
  for (const a of APPLICATIONS) {
    await db.insert(mediatorApplications).values({ ...a, decidedBy: a.status === "NEW" ? null : "u_ops", decidedAt: a.status === "NEW" ? null : new Date(Date.now() - 3 * DAYMS), note: a.status === "REJECTED" ? "No verifiable credential in the domain yet; welcome to reapply." : null, createdAt: new Date(Date.now() - (a.status === "NEW" ? 1 : 6) * DAYMS) }).onConflictDoNothing();
  }
}

/** Existing real cases with a mediator and no offer: record an ACCEPTED offer with the router's explanation, flags and fees. */
async function backfill(): Promise<string[]> {
  const out: string[] = [];
  const rows = await db.select({ d: disputes, w: workspaces }).from(disputes).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .where(and(eq(workspaces.orgId, ORG), isNotNull(disputes.mediatorId), inArray(disputes.state, ["TIER3", "EXECUTING", "RESOLVED"]), sql`not ${isSimWorkspaceSql(workspaces.id)}`)).orderBy(asc(disputes.createdAt));
  if (!rows.length) return ["no assigned cases to backfill"];
  const now = new Date();
  const { mode, cands } = await loadCandidates(ORG, now);
  for (const { d, w } of rows) {
    const [had] = await db.select({ id: mediatorOffers.id }).from(mediatorOffers).where(eq(mediatorOffers.disputeId, d.id)).limit(1);
    const [seal] = await db.select({ at: auditChain.at }).from(auditChain).where(and(eq(auditChain.action, "dispute.seal"), eq(auditChain.target, d.id))).limit(1);
    const at = seal?.at ?? d.createdAt;
    if (!had) {
      const k = { blueprintCode: w.blueprintCode, parties: await partiesOf(w), history: (await coiHistory(d.id)).filter((h) => h.at < d.createdAt), now: at };
      /* the assigned mediator is scored as if their own case were not open (it is the case being explained) */
      const adj = cands.map((c) => (c.id === d.mediatorId ? { ...c, openCases: Math.max(0, c.openCases - 1) } : c));
      const r = rankMediators(adj, k);
      const i = r.ranked.findIndex((x) => x.id === d.mediatorId);
      if (i < 0) { out.push(`${d.id}: assigned mediator ${d.mediatorId} is not eligible under the network rules today; no breakdown stored`); continue; }
      await db.insert(mediatorOffers).values({ id: `mof_bf_${d.id}`.slice(0, 40), disputeId: d.id, mediatorId: d.mediatorId!, attempt: 1, source: "BACKFILL", offeredAt: at, expiresAt: new Date(at.getTime() + 2 * 3_600_000), answer: "ACCEPTED", answeredAt: at,
        reason: "Assigned before the network router; breakdown recomputed by the router", breakdown: { ...breakdownFor(r, i, k, mode) } as unknown as Record<string, unknown> }).onConflictDoNothing();
      out.push(`${d.id}: backfilled offer to ${d.mediatorId} (rank ${i + 1}, ${r.ranked[i].total} points)`);
    }
    const [v] = await db.select().from(verdicts).where(eq(verdicts.disputeId, d.id)).limit(1);
    if (v && v.origin === "TIER3" && v.mediatorId) {
      const [prof] = await db.select().from(mediatorProfiles).where(eq(mediatorProfiles.userId, v.mediatorId)).limit(1);
      const reasons = cosignReasons(d.amountCents, COSIGN_ABOVE_CENTS, null); // signed before the network: only the $5,000 rule applied
      await db.insert(mediatorCaseFlags).values({ disputeId: d.id, verdictId: v.id, cosignReasons: reasons, signerTier: prof?.status ?? "UNLISTED" }).onConflictDoNothing();
      const tier = feeTier(prof?.status);
      await db.insert(mediatorFees).values({ id: `mfe_bf_${v.id}`.slice(0, 40), disputeId: d.id, mediatorId: v.mediatorId, verdictId: v.id, role: "VERDICT", tier, amountCents: MEDIATOR_FEE_CENTS[tier], basis: `Flat ${tier.toLowerCase()} verdict fee, paid by PaySettle from its fee income` }).onConflictDoNothing();
    }
  }
  return out;
}

/** Demo cases routed through the network on a fresh database: the offered mediator accepts, so persona walkthroughs
 * find the case in "Your cases" instead of an offer that would expire 2 hours after seeding. Playground/test cases untouched. */
async function acceptSeededOffers(): Promise<string[]> {
  const rows = await db.select({ o: mediatorOffers }).from(mediatorOffers).innerJoin(disputes, eq(disputes.id, mediatorOffers.disputeId)).innerJoin(wsMilestones, eq(wsMilestones.id, disputes.milestoneId)).innerJoin(workspaces, eq(workspaces.id, wsMilestones.workspaceId))
    .where(and(eq(workspaces.orgId, ORG), sql`${mediatorOffers.answer} is null`, eq(disputes.state, "TIER3"), sql`not ${isSimWorkspaceSql(workspaces.id)}`));
  const out: string[] = [];
  for (const { o } of rows) {
    try { await acceptOffer({ id: o.mediatorId, role: "mediator" }, o.id); out.push(`${o.disputeId}: offer accepted by ${o.mediatorId}`); }
    catch (e) { out.push(`${o.disputeId}: offer left open (${(e as Error).message})`); }
  }
  return out;
}

async function main() {
  await upsertPeople();
  const lines = [...(await acceptSeededOffers()), ...(await backfill())];
  console.log(`seed-mediators: ${MEDIATORS.length} mediators, ${APPLICATIONS.length} applications`);
  for (const l of lines) console.log(`seed-mediators: ${l}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
