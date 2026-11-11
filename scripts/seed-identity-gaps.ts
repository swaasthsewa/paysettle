/**
 * Wave-2 identity seed (F1.8 baseline handshake, F1.7 demo IdP). Safe to re-run.
 *  1. Demo personas (users with a persona) accept the current platform terms, so the persona picker goes straight in.
 *     People without a persona (e.g. Noor, the ctl-demo accounts) are left to accept on their first sign-in.
 *  2. The sandbox demo identity provider's signing key is created on first use, not here.
 * Run after scripts/seed.ts:  npx tsx scripts/seed-identity-gaps.ts
 */
import { isNotNull } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { users } from "../src/db/schema";
import { recordTermsDecision, TERMS_VERSION, termsState } from "../src/lib/identity/handshake";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

async function main() {
  const personas = await db.select({ id: users.id, role: users.role }).from(users).where(isNotNull(users.persona));
  let n = 0;
  for (const p of personas) {
    if ((await termsState(p.id)) === "ACCEPTED") continue;
    await recordTermsDecision({ userId: p.id, role: p.role, decision: "ACCEPTED", ip: "seed", userAgent: "scripts/seed-identity-gaps.ts" });
    n++;
  }
  console.log(`terms ${TERMS_VERSION}: ${n} persona(s) accepted, ${personas.length - n} already had`);
}
main().then(() => pool.end(), (e) => { console.error(e); pool.end(); process.exit(1); });
