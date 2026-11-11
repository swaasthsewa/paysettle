/** Runs every module's demo seed in dependency order (each is idempotent). */
import "./lib/demo-rail"; // first: demo seeds always use the mock rail
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { demoSeedEnv } from "./lib/demo-rail";
/* Run tsx through the current node binary: execFileSync("npx") fails on Windows (npx is npx.cmd there → spawn ENOENT). */
const TSX = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const ORDER = ["seed-identity", "seed-identity-gaps", "seed-contracts", "seed-reg", "seed-money", "seed-deadline", "seed-link", "seed-evidence", "seed-mediators", "seed-disputes", "seed-mediators", "seed-control", "seed-chargeback", "seed-playground", "seed-blog"];
for (const s of ORDER) {
  const f = `scripts/${s}.ts`;
  if (!existsSync(f)) continue;
  console.log(`→ ${s}`);
  execFileSync(process.execPath, [TSX, "--env-file-if-exists=.env.local", f], { stdio: "inherit", env: demoSeedEnv(process.env) });
}
