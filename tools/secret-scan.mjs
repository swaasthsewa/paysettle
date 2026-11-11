#!/usr/bin/env node
// P8 · Fails when something that looks like a real secret is in a file git would publish.
// `node tools/secret-scan.mjs` scans tracked and new files; `--staged` scans only what is about to be committed
// (used by the pre-commit hook in .githooks/). A line can opt out with the marker `secret-scan: allow`
// (for test fixtures that must look like a key).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const KEYS = [
  ["private key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY-----/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Stripe live key", /\b[rs]k_live_[A-Za-z0-9]{20,}/],
  ["connection string with password", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:([^\s@/]{6,})@(?!localhost|127\.0\.0\.1|db\b|postgres\b)/],
];
// name = "long random value" (a quoted literal; in env, YAML and Docker files a bare value), where the name says it
// is a secret. Not applied to test files, whose made-up passwords are part of the fixtures; the key patterns above are.
const ASSIGN = /\b([A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY|CLIENT_?SECRET)[A-Za-z0-9_]*)["']?\s*[:=]\s*["'`]([A-Za-z0-9+/_=.-]{20,})["'`]/i;
const ENV_ASSIGN = /^\s*([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_?KEY|PRIVATE_?KEY)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"'#,}]{12,})/;
const isTest = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || f.startsWith("e2e/");
const entropy = (s) => { const n = {}; for (const c of s) n[c] = (n[c] ?? 0) + 1; return Object.values(n).reduce((e, k) => e - (k / s.length) * Math.log2(k / s.length), 0); };
const looksFake = (v) => /^(x+|0+|test|fake|dummy|example|placeholder|changeme|your|sample|demo|local|dev)/i.test(v) || /(example|placeholder|fake|dummy|test)/i.test(v);

const staged = process.argv.includes("--staged");
const list = staged
  ? execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], { encoding: "utf8" })
  : execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" });
const files = list.split("\n").filter(Boolean);
const hits = [];
for (const f of files) {
  if (f === "tools/secret-scan.mjs" || f === "package-lock.json" || !existsSync(f)) continue;
  if (/(^|\/)\.env(\.|$)/.test(f) && f !== ".env.example") { hits.push(`${f}: an env file must never be committed`); continue; }
  const buf = readFileSync(f); if (buf.includes(0)) continue;
  buf.toString("utf8").split("\n").forEach((line, i) => {
    if (line.includes("secret-scan: allow")) return;
    for (const [name, re] of KEYS) if (re.test(line)) { hits.push(`${f}:${i + 1}: ${name}`); return; }
    if (isTest(f)) return;
    const m = line.match(/\.env|\.ya?ml$|Dockerfile/.test(f) ? ENV_ASSIGN : ASSIGN);
    if (m && !looksFake(m[2]) && entropy(m[2]) > 3.5 && !/^process\.env|^env\./.test(m[2])) hits.push(`${f}:${i + 1}: ${m[1]} looks like a real secret`);
  });
}
if (hits.length) { console.error(`Possible secrets (${hits.length}):`); hits.forEach((h) => console.error("  " + h)); process.exit(1); }
console.log(`secret-scan: clean (${files.length} files${staged ? ", staged" : ""})`);
