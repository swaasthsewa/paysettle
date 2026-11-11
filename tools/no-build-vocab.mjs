#!/usr/bin/env node
// Fails when words from how PaySettle was built (work-package and wave ids, build zones, internal plans) show up in
// files people can see. Code and comments should describe what the code does, with requirement IDs (F1.2, P4, …)
// as the only cross-reference.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const RULES = [
  ["work-package id", /\bWP-[A-Z0-9]+\b|\bBLOG-(CORE|PUBLIC)\b/],
  ["build zone", /\b[Zz]one [A-Z]\d{1,2}\b|\bbuild zone\b|\bzone agents?\b/],
  ["wave id", /\bW\d[A-Z]\b|\b[Ww]ave (W?\d)\b/],
  ["orchestrator", /\borchestrator\b/i],
  ["internal plan", /\bPRD v\d\b|\bBuild Plan\b|\bAGENT-BRIEF\b|\bplan\/[A-Za-z0-9-]+\.md\b/],
  ["reuse wording", /\breference build\b|\bsame author\b|\bIO (reference|components)\b/i],
  ["build tool", /\bClaude Code\b|\bCo-Authored-By:/i],
];
const ALLOW = new Set(["tools/no-build-vocab.mjs"]);
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean);
const hits = [];
for (const f of files) {
  if (ALLOW.has(f) || !existsSync(f)) continue;
  const buf = readFileSync(f); if (buf.includes(0)) continue;
  buf.toString("utf8").split("\n").forEach((line, i) => {
    for (const [name, re] of RULES) { const m = line.match(re); if (m) { hits.push(`${f}:${i + 1}: ${name} (${m[0]})`); break; } }
  });
}
if (hits.length) { console.error(`Build vocabulary found on ${hits.length} line(s):`); hits.slice(0, Number(process.env.GATE_MAX ?? 120)).forEach((h) => console.error("  " + h)); process.exit(1); }
console.log(`no-build-vocab: clean (${files.length} files)`);
