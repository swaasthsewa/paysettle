/**
 * A6 · Compiler vs plain LLM. Runs the same acceptance criteria through two paths and scores both the same way.
 *
 *   (a) PaySettle Criteria Compiler: the rule-based linter (always), and with AI_API_KEY the full compileCriteria path
 *       (rules + AI rewrite, where a taste word or hedge with nothing measurable is never let through).
 *   (b) Plain LLM baseline (needs AI_API_KEY): one plain prompt, same model and gateway, no rules, no post-processing.
 *
 * Scores per side: precision and recall on the VAGUE class, agreement with the labels, and for every rewrite offered,
 * whether the rewrite itself is checkable. "Checkable" is judged by the rule linter (lintCriterion). The rules side
 * wrote its own rewrites with the same rules, so for that side this is a consistency check, not an independent one.
 *
 * Without a key the rules side runs and every AI side is reported as "pending: needs AI_API_KEY". Nothing is estimated.
 *
 * Usage:
 *   npm run eval:compare                                         # evals/golden/compile.json (60 labelled criteria)
 *   npm run eval:compare -- --file evals/golden/real-criteria.json   # your own labelled criteria (same format)
 *   npm run eval:compare -- --text "The website should be fast and modern."   # one criterion, printed, nothing written
 * Results: evals/compare-results.json (or evals/compare-results.<file name>.json for --file).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { z } from "zod";
import { compileRules, lintCriterion } from "../src/lib/ai/rules";
import { configFromEnv } from "../src/lib/ai/config";
import { AiGateway, memoryStore } from "../src/lib/ai/gateway";
import { EMPTY_PEOPLE } from "../src/lib/ai/redact";

try { process.loadEnvFile(".env.local"); } catch { /* optional */ }
const dir = path.dirname(new URL(import.meta.url).pathname);
const argOf = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const PENDING = "pending: needs AI_API_KEY";

export const BASELINE_PROMPT = {
  id: "eval.baseline", version: "v1",
  system: `You review acceptance criteria for freelance and service contracts. For each criterion id, say whether it is clear enough to check (verifiable true or false), give a one-sentence reason, and if it is not, suggest a better wording.
Return one result per id given, using the same ids.`,
};
const baselineSchema = z.object({
  results: z.array(z.object({ id: z.string().max(80), verifiable: z.boolean(), reason: z.string().max(400), rewrite: z.string().max(400).nullable().optional() })).max(200),
});

export interface Item { id: string; text: string; verifiable: boolean }
export interface Pred { id: string; verifiable: boolean; rewrite?: string }

export function score(items: Item[], preds: Pred[]) {
  const by = new Map(preds.map((p) => [p.id, p]));
  let tp = 0, fp = 0, fn = 0, agree = 0, answered = 0, rewrites = 0, rewritesCheckable = 0, vagueWithoutRewrite = 0;
  const misses: string[] = [], uncheckableRewrites: string[] = [];
  for (const it of items) {
    const p = by.get(it.id);
    if (!p) { misses.push(`${it.id} no answer`); continue; }
    answered++;
    const vt = !it.verifiable, vp = !p.verifiable;
    if (vp && vt) tp++; else if (vp && !vt) fp++; else if (!vp && vt) fn++;
    if (p.verifiable === it.verifiable) agree++; else misses.push(`${it.id} "${it.text}" labelled ${it.verifiable ? "verifiable" : "vague"}`);
    if (vp) {
      if (!p.rewrite) { vagueWithoutRewrite++; continue; }
      rewrites++;
      if (lintCriterion(p.rewrite).verifiable) rewritesCheckable++; else uncheckableRewrites.push(`${it.id} "${p.rewrite}"`);
    }
  }
  return {
    n: items.length, answered, precisionVague: r3(tp / Math.max(1, tp + fp)), recallVague: r3(tp / Math.max(1, tp + fn)), agreement: r3(agree / Math.max(1, items.length)),
    rewrites, rewritesCheckable, rewriteCheckableRate: rewrites ? r3(rewritesCheckable / rewrites) : null, flaggedWithoutRewrite: vagueWithoutRewrite, misses, uncheckableRewrites,
  };
}

const rulesSide = (items: Item[]): Pred[] =>
  compileRules(items.map((i) => ({ code: i.id, title: "", criteria: [i.text] }))).map((r) => ({ id: r.code.replace(/#1$/, ""), verifiable: r.verifiable, rewrite: r.rewrite }));

async function main() {
  const cfg = configFromEnv();
  const mem = memoryStore(EMPTY_PEOPLE);
  const gw = cfg.apiKey ? new AiGateway(cfg, { store: mem }) : null;
  const ai = gw ? await import("../src/server/ai") : null;
  if (ai && gw) ai.setGateway(gw);

  const text = argOf("--text");
  if (text) {
    const v = lintCriterion(text);
    console.log(`criterion: ${text}\nrules:     ${v.verifiable ? "checkable" : "REJECTED"} · ${v.reason}${v.rewrite ? `\nrewrite:   ${v.rewrite}` : ""}`);
    if (ai) {
      const r = await ai.compileCriteria([{ code: "X", title: "", criteria: [text] }]);
      const d = r.data?.[0];
      console.log(`compiler:  ${r.available ? `${d?.verifiable ? "checkable" : "REJECTED"} · ${d?.reason}${d?.rewrite ? `\nrewrite:   ${d.rewrite}` : ""}` : `AI unavailable (${r.reason}); rules result above`}`);
    } else console.log(`compiler (rules + AI): ${PENDING}`);
    return;
  }

  const file = argOf("--file") ?? path.join(dir, "golden", "compile.json");
  const set = JSON.parse(readFileSync(file, "utf8")) as { items: Item[] };
  const items = set.items.filter((i) => typeof i.id === "string" && typeof i.text === "string" && typeof i.verifiable === "boolean");
  if (items.length !== set.items.length) console.log(`warning: ${set.items.length - items.length} row(s) skipped: each row needs id, text and verifiable (true/false).`);
  let commit = "unknown"; try { commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
  const out: Record<string, unknown> = { at: new Date().toISOString(), commit, file: path.relative(process.cwd(), file), n: items.length, model: cfg.apiKey ? cfg.model : null, rewriteJudge: "rule linter (lintCriterion)" };

  const rules = score(items, rulesSide(items));
  out.compilerRules = rules;
  const line = (name: string, s: ReturnType<typeof score>) =>
    console.log(`${name.padEnd(22)} precision(vague)=${s.precisionVague} recall(vague)=${s.recallVague} agreement=${s.agreement} rewrites checkable=${s.rewritesCheckable}/${s.rewrites}${s.flaggedWithoutRewrite ? ` (flagged without a rewrite: ${s.flaggedWithoutRewrite})` : ""}`);
  console.log(`n=${items.length} from ${out.file}`);
  line("compiler · rules only", rules);

  if (!ai || !gw) {
    out.compilerAi = { pending: PENDING };
    out.baseline = { pending: PENDING, prompt: `${BASELINE_PROMPT.id}@${BASELINE_PROMPT.version}` };
    console.log(`compiler · rules + AI   ${PENDING}`);
    console.log(`plain LLM baseline      ${PENDING}`);
  } else {
    const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
    const cPred: Pred[] = []; let cAvail = true;
    for (const c of chunks(items, 20)) {
      const r = await ai.compileCriteria(c.map((i) => ({ code: i.id, title: "", criteria: [i.text] })));
      if (!r.available) cAvail = false;
      r.data?.forEach((d) => cPred.push({ id: d.code.replace(/#1$/, ""), verifiable: d.verifiable, rewrite: d.rewrite }));
    }
    const bPred: Pred[] = []; let bFailed = 0;
    for (const c of chunks(items, 20)) {
      const r = await gw.structured({
        purpose: `${BASELINE_PROMPT.id}@${BASELINE_PROMPT.version}`, system: BASELINE_PROMPT.system, schema: baselineSchema, maxTokens: Math.min(6_000, 300 + c.length * 160),
        parts: [{ kind: "text", text: `Criteria ids: ${c.map((i) => i.id).join(", ")}.` }, { kind: "untrusted", source: "acceptance criteria (JSON)", text: JSON.stringify(c.map((i) => ({ id: i.id, criterion: i.text }))) }],
      });
      if (!r.ok) { bFailed += c.length; continue; }
      r.data.results.forEach((d) => bPred.push({ id: d.id, verifiable: d.verifiable, rewrite: d.rewrite ?? undefined }));
    }
    const cs = score(items, cPred), bs = score(items, bPred);
    out.compilerAi = { ...cs, available: cAvail, note: cAvail ? undefined : "AI unavailable for part of the run: rule output used for those rows" };
    out.baseline = { ...bs, prompt: `${BASELINE_PROMPT.id}@${BASELINE_PROMPT.version}`, unanswered: bFailed };
    line("compiler · rules + AI", cs);
    line("plain LLM baseline", bs);
    if (!cAvail) console.log("   note: AI was unavailable for part of the compiler run; rule output was used for those rows.");
    if (bFailed) console.log(`   note: the baseline gave no valid answer for ${bFailed} row(s); they count as unanswered.`);
    const calls = mem.calls;
    out.cost = { calls: calls.length, tokens: calls.reduce((s, x) => s + x.tokensIn + x.tokensOut, 0), costMicros: calls.reduce((s, x) => s + x.costMicros, 0) };
  }

  const base = argOf("--file") ? `compare-results.${path.basename(file).replace(/\.json$/, "")}.json` : "compare-results.json";
  writeFileSync(path.join(dir, base), JSON.stringify(out, null, 2) + "\n");
  console.log(`results written to evals/${base}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(2); });
