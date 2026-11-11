#!/usr/bin/env node
// P10: no unsupported guarantees in anything a person can read (UI copy, docs). Fails the build on banned phrases.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
const BANNED = [/zero regulatory overhead/i, /100\s*%\s*irreversible/i, /guaranteed? (payment|refund)/i, /fully compliant/i, /bank[- ]grade/i, /never (lose|lost) (money|a cent)/i, /risk[- ]free/i, /fedramp/i];
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n")
  .filter((f) => /^(src\/(app|components|copy|data)\/|README\.md|docs\/)/.test(f) && /\.(tsx?|md|mdx)$/.test(f));
const hits = [];
for (const f of files) { if (!existsSync(f)) continue; readFileSync(f, "utf8").split("\n").forEach((l, i) => BANNED.forEach((b) => { if (b.test(l)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`); })); }
if (hits.length) { console.error("copy-lint: unsupported claims found"); hits.forEach((h) => console.error("  " + h)); process.exit(1); }
console.log("copy-lint: clean");
