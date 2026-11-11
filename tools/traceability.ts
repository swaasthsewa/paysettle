/**
 * P12 traceability gate: every requirement id must appear in at least one test name/comment AND in at least one
 * non-test source file. Prints a matrix; exits 1 when anything is untraced (use --report to only print).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const IDS: string[] = ["F1.1", "F1.2", "F1.3", "F1.4", "F1.5", "F1.6", "F1.7", "F1.8", "F1.9", "F1.10", "F2.01", "F2.02", "F2.03", "F2.04", "F2.05", "F2.06", "F2.07", "F2.08", "F2.09", "F2.10", "F2.11", "F2.12", "F3.01", "F3.02", "F3.03", "F3.04", "F3.05", "F3.06", "F3.07", "F3.08", "F3.09", "F3.10", "F3.11", "F3.12", "F4.01", "F4.02", "F4.03", "F4.04", "F4.05", "F4.06", "F4.07", "F4.08", "F4.09", "F4.10", "F4.11", "F4.12", "F5.01", "F5.02", "F5.03", "F5.04", "F5.05", "F5.06", "F5.07", "F5.08", "F5.09", "F5.10", "A1", "A2", "A3", "A4", "A5", "A6", "A7"];
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter((f) => /^(src|scripts|evals|e2e)\/.*\.(ts|tsx)$/.test(f));
const isTest = (f: string) => /\.test\.tsx?$|^e2e\//.test(f);
const rows = IDS.map((id) => {
  const re = new RegExp("\\b" + id.replace(".", "\\.") + "\\b");
  const code = files.filter((f) => !isTest(f) && re.test(readFileSync(f, "utf8"))).length;
  const tests = files.filter((f) => isTest(f) && re.test(readFileSync(f, "utf8"))).length;
  return { id, code, tests };
});
const missing = rows.filter((r) => !r.code || !r.tests);
for (const r of rows) console.log(`${r.id.padEnd(6)} code:${String(r.code).padStart(3)} tests:${String(r.tests).padStart(3)} ${!r.code || !r.tests ? "  ← untraced" : ""}`);
console.log(`\n${rows.length - missing.length}/${rows.length} requirements traced to code and tests`);
if (missing.length && !process.argv.includes("--report")) process.exit(1);
