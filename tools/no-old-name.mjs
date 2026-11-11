#!/usr/bin/env node
// Fails when names of the source projects (reused code) or their clients leak into PaySettle files people can see.
// Reuse is disclosed in REUSE.md, which is the only file allowed to name the source projects.
//
// The names are kept as SHA-256 prefixes, so this file does not publish them. Each line is split into words
// (letters and digits, lower case); every single word and every pair of neighbouring words is hashed and looked up.
// More names can be added without publishing them: one per line in `.names.local` (ignored by git), or
// space-separated words / comma-separated phrases in the NAME_GATE_EXTRA environment variable (a CI secret).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const norm = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(" ");

const BANNED = new Set([
  "b32ff4ddc844365382cae521", "f3b74e076367bda789ab7e78", "07edd9e3131342c309b6da95", "2662a586dfb8cb7c3da69d62",
  "6b20e9b742e448a5040d026a", "9ad529ec4b3366f7901b1ab7", "c29e1581e159651284dff262", "f405e57cf3fd3d5c51f9ccb2",
  "771a200dc570c42dbea8ac98", "c7e96c85e5059d6d59a7f363", "15d8e727aac4c628dc43f156", "f1bb86a346fb8c6d5e8ce1ab",
  "54c9cea7d38d3918dd8e237a", "65df7f2e608914e87df98b84", "8c7cdc05e2fcf0ae32bb943d",
]);
const extra = [
  ...(existsSync(".names.local") ? readFileSync(".names.local", "utf8").split(/\r?\n/) : []),
  ...(process.env.NAME_GATE_EXTRA ?? "").split(","),
].map(norm).filter(Boolean);
for (const n of extra) BANNED.add(sha(n));

const ALLOW = new Set(["REUSE.md", "tools/no-old-name.mjs"]);
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean);
const hits = [];
for (const f of files) {
  if (ALLOW.has(f) || !existsSync(f)) continue;
  const buf = readFileSync(f); if (buf.includes(0)) continue;
  buf.toString("utf8").split("\n").forEach((line, i) => {
    const w = norm(line).split(" ");
    for (let j = 0; j < w.length; j++) {
      if (BANNED.has(sha(w[j])) || (j + 1 < w.length && BANNED.has(sha(`${w[j]} ${w[j + 1]}`)))) { hits.push(`${f}:${i + 1}`); return; }
    }
  });
}
if (hits.length) { console.error(`Source-project names found on ${hits.length} line(s):`); hits.slice(0, 80).forEach((h) => console.error("  " + h)); process.exit(1); }
console.log(`no-old-name: clean (${files.length} files)`);
