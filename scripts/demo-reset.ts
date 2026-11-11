/**
 * F5.06, P9: put the DEMO database back to the clean seeded demo, removing everything the judge
 * playground (sim_workspaces), the e2e runs and any automated test (orgs org_test_* / org_t_*) left behind.
 * The ledger, audit chain and verdicts are append-only (P5, P6), so rows are never deleted one by one: the database is
 * dropped, recreated and fully seeded by scripts/reset-db.ts.
 * Usage: npm run demo:reset   (= npx tsx scripts/demo-reset.ts; refused when PAYSETTLE_ENV=production)
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Client } from "pg";
import { TEST_ORG_PATTERN } from "../src/lib/sim";

try { process.loadEnvFile(".env.local"); } catch { /* defaults */ }
if (process.env.PAYSETTLE_ENV === "production") { console.error("demo-reset: refusing to reset in production."); process.exit(1); }
const url = new URL(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/paysettle");
const name = url.pathname.slice(1);
if (/test/i.test(name)) { console.error(`demo-reset: ${name} looks like a test database; use npm run db:reset:test for that.`); process.exit(1); }

async function count(): Promise<string> {
  const c = new Client({ connectionString: url.toString() });
  try {
    await c.connect();
    const sim = await c.query(`select count(*)::int as n from sim_workspaces`).then((r) => r.rows[0].n as number).catch(() => 0);
    const test = await c.query(`select count(*)::int as n from workspaces where org_id ~ $1`, [TEST_ORG_PATTERN]).then((r) => r.rows[0].n as number).catch(() => 0);
    return `${sim} playground contract(s), ${test} test-org contract(s)`;
  } catch { return "database not reachable yet"; }
  finally { await c.end().catch(() => undefined); }
}

async function main() {
  console.log(`demo-reset: ${name} holds ${await count()}; resetting to the seeded demo…`);
  /* node + tsx cli directly: execFileSync("npx") fails on Windows (npx.cmd). */
  execFileSync(process.execPath, [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/reset-db.ts", name], { stdio: "inherit" });
  console.log(`demo-reset: done; ${name} now holds ${await count()}.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
