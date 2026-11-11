/** Waits until Postgres accepts connections (up to ~60 s). Used by start-windows.bat. */
import { Client } from "pg";
try { process.loadEnvFile(".env.local"); } catch { /* defaults */ }
const url = new URL(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/paysettle"); url.pathname = "/postgres";
async function main() {
  for (let i = 0; i < 30; i++) {
    const c = new Client({ connectionString: url.toString() });
    try { await c.connect(); await c.end(); console.log("database server is ready"); return; } catch { await new Promise((r) => setTimeout(r, 2000)); }
  }
  console.error(`Could not reach PostgreSQL at ${url.host}. Start Docker Desktop (or your Postgres) and try again.`); process.exit(1);
}
main();
