/** Drops and recreates a database, pushes the schema, applies guards and seeds demo data. Usage: tsx scripts/reset-db.ts [dbname] [--no-seed] */
import { execSync } from "node:child_process";
import { Client } from "pg";
try { process.loadEnvFile(".env.local"); } catch { /* defaults */ }
const base = new URL(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/paysettle");
const name = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : base.pathname.slice(1);
if (process.env.PAYSETTLE_ENV === "production") throw new Error("refusing to reset in production");
const admin = new URL(base); admin.pathname = "/postgres";
const target = new URL(base); target.pathname = "/" + name;
async function main() {
const c = new Client({ connectionString: admin.toString() });
await c.connect();
await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
await c.query(`DROP DATABASE IF EXISTS "${name}"`); await c.query(`CREATE DATABASE "${name}"`); await c.end();
const env = { ...process.env, DATABASE_URL: target.toString() };
execSync("npx drizzle-kit push --force", { stdio: "inherit", env });
execSync("npx tsx scripts/guards.ts", { stdio: "inherit", env });
if (process.argv.includes("--base")) execSync("npx tsx scripts/seed.ts", { stdio: "inherit", env });
else if (!process.argv.includes("--no-seed")) execSync("npx tsx scripts/seed.ts && npx tsx scripts/seed-all.ts", { stdio: "inherit", env });
console.log(`database ${name} ready`);
}
main().catch((e) => { console.error(e); process.exit(1); });
