import { readFileSync } from "node:fs";
import { pool } from "../src/db/client";
try { process.loadEnvFile(".env.local"); } catch { /* defaults */ }
pool.query(readFileSync("src/db/sql/guards.sql", "utf8")).then(() => { console.log("guards applied"); return pool.end(); }).catch((e) => { console.error(e); process.exit(1); });
