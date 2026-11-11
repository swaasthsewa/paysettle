/**
 * F3.04 / F3.06 demo seed for the evidence module (logic in src/server/evidence/seed.ts). On the seeded LOCKED web-MVP
 * contract ("Booking app MVP"), when its tranche is HELD and M02 has no evidence yet, M02 evidence is submitted so the
 * client review screen has content. Idempotent; skips quietly when the contract or its hold is not there.
 * Usage: npx tsx --env-file-if-exists=.env.local scripts/seed-evidence.ts
 */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { pool } from "../src/db/client";
import { seedEvidence } from "../src/server/evidence/seed";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

seedEvidence()
  .then((msg) => console.log(`seed-evidence: ${msg}`))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
