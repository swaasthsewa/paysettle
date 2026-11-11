/**
 * Registration seed (F1.1 registration, F2.02 invite linking, F1.4 OCR assist). Safe to re-run (looks up before it writes).
 *  1. An open invite: Priya (demo client) invites studio.new@invite.demo to a web MVP contract. Sign up with the demo
 *     identity provider using that address and the contract links to you and opens in the negotiation room.
 *  2. A self-registered provider, Sana Mirza (sana@studio.demo, demo password), own organisation, e-mail confirmed,
 *     terms accepted, onboarding SUBMITTED, with two licences whose suggested number / expiry / issuer come from the
 *     same rule reader the upload uses (no AI needed) — what Ops sees in the identity auditor.
 * Run after scripts/seed.ts:  npx tsx scripts/seed-reg.ts
 */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { orgs, paypalLinks, users, workspaces } from "../src/db/schema";
import { recordTermsDecision, termsState } from "../src/lib/identity/handshake";
import { hashPasswordStrong } from "../src/lib/identity/password";
import { readLicenceFields, type LicenceSuggestion } from "../src/lib/identity/ocr";
import { maskTaxId, taxIdFingerprint, type LicenceRecord } from "../src/lib/identity/provider";
import { createWorkspace } from "../src/server/contracts";
import { DEMO_INVITE_EMAIL, DEMO_INVITE_TITLE, DEMO_REG_PROVIDER as P } from "../src/server/identity/demo";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

const LICENCES = [
  { id: "lic_reg_sana_1", name: "Udyam registration certificate.pdf", size: 96_211, sha256: "4f7c2b1d9a0e3c5b8d6f1a2e4c7b9d0f3a5c8e1b2d4f6a8c0e2b4d6f8a1c3e5b",
    text: "Government of India\nMinistry of Micro, Small and Medium Enterprises\nUdyam Registration Number: UDYAM-MH-26-0049217\nName of enterprise: Mirza Interiors Studio\nDate of registration: 12/01/2025" },
  { id: "lic_reg_sana_2", name: "Shop and establishment licence exp2026-11-30.pdf", size: 143_090, sha256: "9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d",
    text: "Brihanmumbai Municipal Corporation\nShops and Establishments Licence No: 760331229\nIssued by: Shops and Establishments Department, BMC\nValid until: 30/11/2026" },
];

function suggestion(name: string, text: string): LicenceSuggestion {
  const f = readLicenceFields({ filename: name, text });
  const parts = [f.number, f.expiry, f.issuer].filter(Boolean) as { confidence: number }[];
  return {
    number: f.number?.value, expiry: f.expiry?.value, issuer: f.issuer?.value,
    sources: { ...(f.number ? { number: f.number.source } : {}), ...(f.expiry ? { expiry: f.expiry.source } : {}), ...(f.issuer ? { issuer: f.issuer.source } : {}) },
    model: "rules", confidence: parts.length ? Math.round((parts.reduce((a, p) => a + p.confidence, 0) / parts.length) * 100) / 100 : 0,
    textChars: text.length, at: new Date().toISOString(),
  };
}

async function main() {
  /* 1. the open invite */
  const [open] = await db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.inviteEmail, DEMO_INVITE_EMAIL), isNull(workspaces.providerId))).limit(1);
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_INVITE_EMAIL)).limit(1);
  if (open) console.log(`invite: ${open.id} already waiting for ${DEMO_INVITE_EMAIL}`);
  else if (taken) console.log(`invite: ${DEMO_INVITE_EMAIL} already has an account (someone registered it); reset the demo to try again`);
  else {
    const id = await createWorkspace({ id: "u_priya", role: "client" }, { blueprintCode: "UC_WEB_MVP", title: DEMO_INVITE_TITLE, totalCents: 840_000, inviteEmail: DEMO_INVITE_EMAIL });
    console.log(`invite: ${id} created for ${DEMO_INVITE_EMAIL}`);
  }

  /* 2. a self-registered provider with OCR suggestions on their licences */
  await db.insert(orgs).values({ id: P.orgId, name: P.name }).onConflictDoNothing();
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, P.id)).limit(1);
  const licences: LicenceRecord[] = LICENCES.map((l) => ({ id: l.id, name: l.name, kind: "application/pdf", size: l.size, sha256: l.sha256, at: "2026-11-06T09:30:00.000Z", review: "QUEUED", suggest: suggestion(l.name, l.text) }));
  const provider = { businessName: "Mirza Interiors Studio", category: "design", country: "IN", taxIdMasked: maskTaxId("27AAKFM4421Q1Z9"), taxIdFingerprint: taxIdFingerprint("27AAKFM4421Q1Z9"), licences, submittedAt: "2026-11-06T09:31:00.000Z" };
  const profile = { country: "IN", billingCountry: "IN", timezone: "Asia/Kolkata", currency: "USD", registeredVia: "password", registeredAt: "2026-11-06T09:12:00.000Z", emailVerifiedAt: "2026-11-06T09:14:00.000Z", emailVerifiedBy: "link", blurb: "Self-registered interiors studio, waiting for Ops review", provider };
  if (!u) {
    await db.insert(users).values({ id: P.id, orgId: P.orgId, email: P.email, name: P.name, role: "provider", tier: "new", onboardingState: "SUBMITTED", passwordHash: await hashPasswordStrong("demo-password-1"), profile });
    console.log(`provider: ${P.name} created (${P.email}, demo password)`);
  } else {
    await db.update(users).set({ profile: sql`${users.profile} || ${JSON.stringify({ provider })}::jsonb` }).where(eq(users.id, P.id));
    console.log(`provider: ${P.name} licences refreshed`);
  }
  await db.insert(paypalLinks).values({ id: "pl_reg_sana", userId: P.id, kind: "merchant", email: "sana-business@business.example.com", receivable: true, emailConfirmed: true }).onConflictDoNothing();
  if ((await termsState(P.id)) !== "ACCEPTED") await recordTermsDecision({ userId: P.id, role: "provider", decision: "ACCEPTED", ip: "seed", userAgent: "scripts/seed-reg.ts" });
}
main().then(() => pool.end(), (e) => { console.error(e); pool.end(); process.exit(1); });
