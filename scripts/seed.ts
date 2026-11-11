/**
 * Demo seed: one demo org, a person for every role, PayPal links, all blueprints. Safe to re-run (upserts).
 * Usage: npm run db:seed   (refused when PAYSETTLE_ENV=production)
 */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { blueprints, orgs, paypalLinks, users } from "../src/db/schema";
import { BLUEPRINTS, SYSTEM_CLAUSES } from "../src/data/blueprints";
import { hashPasswordStrong } from "../src/lib/identity/password";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

export const PERSONAS = [
  { id: "u_priya", email: "priya@client.demo", name: "Priya Shah", role: "client", persona: "1-client", tier: "standard", blurb: "Product owner, buys an MVP build" },
  { id: "u_dan", email: "dan@client.demo", name: "Dan Okafor", role: "client", persona: "2-client", tier: "standard", blurb: "Operations head, buys an ERP sprint" },
  { id: "u_arjun", email: "arjun@provider.demo", name: "Arjun Rao", role: "provider", persona: "3-provider", tier: "platinum", blurb: "Independent ERP planning consultant" },
  { id: "u_meera", email: "meera@provider.demo", name: "Meera Iyer", role: "provider", persona: "4-provider", tier: "standard", blurb: "Studio owner, web and interiors" },
  { id: "u_ops", email: "olivia@ops.demo", name: "Olivia Grant", role: "ops", persona: "5-ops", tier: "standard", blurb: "Clears risky contracts, watches holds" },
  { id: "u_med", email: "marcus@mediator.demo", name: "Marcus Bell", role: "mediator", persona: "6-mediator", tier: "standard", blurb: "Resolves disputes" },
  { id: "u_med2", email: "lena@mediator.demo", name: "Lena Park", role: "mediator", persona: "7-mediator", tier: "standard", blurb: "Senior mediator, co-signs large verdicts" },
  { id: "u_fin", email: "farah@finance.demo", name: "Farah Ali", role: "finance", persona: "8-finance", tier: "standard", blurb: "Ledger, reconciliation, fees" },
  { id: "u_admin", email: "alex@admin.demo", name: "Alex Chen", role: "admin", persona: "9-admin", tier: "standard", blurb: "Platform health, webhooks, audit" },
  { id: "u_mkt", email: "maya@growth.demo", name: "Maya Lopez", role: "marketing", persona: "10-marketing", tier: "standard", blurb: "Blueprints and funnel" },
  { id: "u_judge", email: "judge@paysettle.demo", name: "Hackathon Judge", role: "judge", persona: "0-judge", tier: "standard", blurb: "Runs the playground scenarios" },
] as const;

async function main() {
  await db.insert(orgs).values({ id: "org_demo", name: "PaySettle demo", demo: true }).onConflictDoNothing();
  const pw = await hashPasswordStrong("demo-password-1");
  for (const p of PERSONAS) {
    await db.insert(users).values({ id: p.id, orgId: "org_demo", email: p.email, name: p.name, role: p.role, persona: p.persona, tier: p.tier, passwordHash: pw, onboardingState: "ACTIVE", profile: { blurb: p.blurb } })
      .onConflictDoUpdate({ target: users.id, set: { name: p.name, role: p.role, persona: p.persona, tier: p.tier, profile: sql`${users.profile} || ${JSON.stringify({ blurb: p.blurb })}::jsonb` } });
  }
  const links = [
    { id: "pl_priya", userId: "u_priya", kind: "buyer" as const, email: "buyer@personal.example.com", receivable: false, emailConfirmed: true },
    { id: "pl_dan", userId: "u_dan", kind: "buyer" as const, email: "buyer2@personal.example.com", receivable: false, emailConfirmed: true },
    { id: "pl_arjun", userId: "u_arjun", kind: "merchant" as const, email: process.env.PAYPAL_PROVIDER1_EMAIL ?? "provider-1@business.example.com", receivable: true, emailConfirmed: true },
    { id: "pl_meera", userId: "u_meera", kind: "merchant" as const, email: process.env.PAYPAL_PROVIDER2_EMAIL ?? "provider-2@business.example.com", receivable: true, emailConfirmed: true },
  ];
  for (const l of links) await db.insert(paypalLinks).values(l).onConflictDoUpdate({ target: paypalLinks.id, set: { email: l.email } });
  for (const b of BLUEPRINTS) {
    const row = { code: b.code, title: b.title, vertical: b.vertical, kind: b.kind, summary: b.summary, recommendedDays: b.recommendedDays, milestones: b.milestones, clauses: [...SYSTEM_CLAUSES, ...b.clauses], depth: b.depth };
    await db.insert(blueprints).values(row).onConflictDoUpdate({ target: blueprints.code, set: row });
  }
  console.log(`Seeded ${PERSONAS.length} people and ${BLUEPRINTS.length} blueprints. Demo password for email sign-in: demo-password-1`);
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
