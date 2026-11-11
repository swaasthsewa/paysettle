/**
 * A1 Contract Drafter · A2 Criteria Compiler · A3 Evidence Verifier · A4 Dispute Mediator · A7 cost/safety.
 *
 * P3: advisory only. These functions READ blueprints and WRITE only ai_calls (through the gateway). They never touch
 * contracts, ledger, signatures, releases or verdicts; callers show the output as suggestions.
 *
 * Availability contract (every function):
 *   - AI answered and the answer validated → { available: true, model, data, confidence? }
 *   - no key / cap reached / provider failed / invalid output twice → { available: false, reason, model: "rules", data }
 *     where data is the deterministic rule-based result (src/lib/ai/rules.ts) so screens still show something useful.
 *     The AI part is honestly reported unavailable; the rule output is labelled model "rules" and is never presented as AI.
 *
 * compileCriteria returns ONE ROW PER CRITERION, code = `${item.code}#${n}` (n from 1; `#0` when an item has no criteria).
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { blueprints, type ProofSpec } from "@/db/schema";
import { formatCents } from "@/lib/money";
import { PROMPTS, purposeOf } from "@/lib/ai/prompts";
import { compileSchema, draftSchema, mediateSchema, verifySchema } from "@/lib/ai/schemas";
import {
  compileRules, criterionId, evidenceRules, lintCriterion, mediateRules, normalizeDraft, pickBlueprint, rankBlueprints, scaleDays,
  signalsOf, titleFromBrief, type BlueprintLite, type DraftMilestone, type EvidenceFile,
} from "@/lib/ai/rules";
import type { Part } from "@/lib/ai/gateway";
import { neutralise } from "@/lib/ai/untrusted";
import { gateway } from "./store";

export interface AiResult<T> { available: boolean; reason?: string; data?: T; model?: string; confidence?: number }
export { setGateway } from "./store";
export { listAgentApprovals, resolveAgentApproval } from "./agent";

export async function aiStatus(): Promise<{ available: boolean; model?: string; reason?: string; usedTokensToday: number; capTokens: number }> {
  const s = await gateway().status();
  return { available: s.available, model: s.model, reason: s.reason, usedTokensToday: s.usedTokensToday, capTokens: s.capTokens };
}

/* ───────────── A1 ───────────── */

type DraftData = { blueprintCode: string; title: string; milestones: DraftMilestone[]; assumptions: string[] };

async function loadBlueprints(): Promise<BlueprintLite[]> {
  const rows = await db.select().from(blueprints).where(eq(blueprints.active, true));
  return rows.map((r) => ({ code: r.code, title: r.title, vertical: r.vertical, kind: r.kind, summary: r.summary, recommendedDays: r.recommendedDays, milestones: r.milestones.map((m) => ({ title: m.title, type: m.type, day: m.day, bps: m.bps, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule })) }));
}

export function rulesDraft(brief: string, budgetCents: number, days: number, list: BlueprintLite[]): DraftData | null {
  const bp = pickBlueprint(brief, list);
  if (!bp) return null;
  const maxDay = Math.max(...bp.milestones.map((m) => m.day), 1);
  const ms = normalizeDraft(scaleDays(bp.milestones, days, maxDay), days);
  return {
    blueprintCode: bp.code, title: titleFromBrief(brief, bp.title), milestones: ms,
    assumptions: [
      `Blueprint "${bp.title}" picked by keyword match with the brief (rule-based; no AI judgement).`,
      maxDay !== days ? `Target days scaled from the blueprint's ${maxDay} days to the requested ${days} days.` : `Timeline kept at ${days} days.`,
      `Budget ${formatCents(budgetCents)} split by the blueprint's shares; adjust shares during negotiation.`,
      "Scope, exclusions and change-request pricing still need to be agreed by both parties.",
    ],
  };
}

export async function draftContract(brief: string, budgetCents: number, days: number): Promise<AiResult<DraftData>> {
  const list = await loadBlueprints();
  const D = Math.max(1, Math.min(365, Math.floor(days)));
  const fallback = rulesDraft(brief, budgetCents, D, list);
  if (!fallback) return { available: false, reason: "No blueprints are published yet.", model: "rules" };
  const ranked = rankBlueprints(brief, list).slice(0, 3).map((r) => r.code);
  const blank = list.find((b) => /blank|guided/i.test(b.code + b.title));
  const candidates = list.filter((b) => ranked.includes(b.code) || b.code === blank?.code);
  const out = await gateway().structured({
    purpose: purposeOf(PROMPTS.draft), system: PROMPTS.draft.system, schema: draftSchema, maxTokens: 4_000,
    parts: [
      { kind: "text", text: `Budget: ${formatCents(budgetCents)} (${budgetCents} cents). Duration: ${D} days.\nCandidate blueprints (JSON):\n${JSON.stringify(candidates)}` },
      { kind: "untrusted", source: "client brief", text: brief },
    ],
  });
  if (!out.ok) return { available: false, reason: out.reason, model: "rules", data: fallback };
  const known = list.find((b) => b.code === out.data.blueprintCode);
  const assumptions = [...out.data.assumptions];
  if (!known) assumptions.unshift(`The AI named an unknown blueprint; "${fallback.blueprintCode}" is used instead.`);
  const milestones = normalizeDraft(out.data.milestones.map((m) => ({ ...m, proof: m.proof as ProofSpec })), D);
  return { available: true, model: out.model, data: { blueprintCode: known ? known.code : fallback.blueprintCode, title: out.data.title, milestones, assumptions } };
}

/* ───────────── A2 ───────────── */

export async function compileCriteria(items: { code: string; title: string; criteria: string[] }[]): Promise<AiResult<{ code: string; verifiable: boolean; reason: string; rewrite?: string }[]>> {
  const rules = compileRules(items);
  const rows = items.flatMap((it) => it.criteria.map((c, i) => ({ id: criterionId(it.code, i + 1), milestone: it.title, criterion: c })));
  if (!rows.length) return { available: false, reason: "Nothing to check.", model: "rules", data: rules };
  const out = await gateway().structured({
    purpose: purposeOf(PROMPTS.compile), system: PROMPTS.compile.system, schema: compileSchema, maxTokens: Math.min(6_000, 300 + rows.length * 160),
    parts: [
      { kind: "text", text: `Lint these ${rows.length} criteria. Ids: ${rows.map((r) => r.id).join(", ")}.` },
      { kind: "untrusted", source: "milestone criteria (JSON)", text: JSON.stringify(rows) },
    ],
  });
  if (!out.ok) return { available: false, reason: out.reason, model: "rules", data: rules };
  const byId = new Map(out.data.results.map((r) => [r.id, r]));
  const merged = rules.map((rule) => {
    const ai = byId.get(rule.code);
    if (!ai) return rule;
    const src = rows.find((r) => r.id === rule.code)?.criterion ?? "";
    const lint = lintCriterion(src);
    // The AI decides, except that a taste word or hedge with nothing measurable is never let through (recall first).
    const strongVague = !lint.verifiable && (lint.hedges.length > 0 || lint.vague.length > 0);
    const verifiable = ai.verifiable && !strongVague;
    const flags = ai.riskFlags?.length ? ` Risk: ${ai.riskFlags.join("; ")}.` : "";
    const reason = verifiable === ai.verifiable ? ai.reason + flags : `${lint.reason} (AI rated it checkable; the vague wording rule overrides.)`;
    const rewrite = verifiable ? undefined : (ai.rewrite ?? undefined) || rule.rewrite;
    return { code: rule.code, verifiable, reason, ...(rewrite ? { rewrite } : {}) };
  });
  return { available: true, model: out.model, data: merged };
}

/* ───────────── A3 ───────────── */

type VerifyData = { criteria: { criterion: string; verdict: "met" | "not_met" | "unclear"; confidence: number; cites: string[] }[]; recommendation: "approve" | "request_fix" | "unclear"; summary: string };
const MAX_IMAGE_B64 = 6_000_000;

export async function verifyEvidence(spec: ProofSpec, files: { name: string; type: string; text?: string; imageBase64?: string; signals: unknown[] }[]): Promise<AiResult<VerifyData>> {
  const rules = evidenceRules(spec, files as EvidenceFile[]);
  const fallback: VerifyData = { criteria: rules.criteria, recommendation: rules.recommendation, summary: rules.summary };
  const parts: Part[] = [{ kind: "text", text: `Proof spec (JSON): ${JSON.stringify({ artifacts: spec.artifacts, criteria: spec.criteria, gpsRadiusM: spec.gpsRadiusM, oracle: spec.oracle })}\nRule checks already run: ${rules.summary}\nFiles follow (${files.length}).` }];
  for (const f of files) {
    const sig = signalsOf(f as EvidenceFile);
    parts.push({ kind: "text", text: `File "${neutralise(f.name).slice(0, 120)}" (${neutralise(f.type || "unknown type").slice(0, 60)}). Metadata signals: ${sig.length ? sig.map((s) => `${s.code}=${s.level}${s.detail ? ` (${s.detail})` : ""}`).join("; ") : "none"}.` });
    if (f.imageBase64 && f.imageBase64.length <= MAX_IMAGE_B64) parts.push({ kind: "image", source: f.name, mediaType: f.type?.startsWith("image/") ? f.type : "image/jpeg", base64: f.imageBase64 });
    else if (f.imageBase64) parts.push({ kind: "text", text: `(Image "${f.name}" is too large to send; judge it unclear.)` });
    if (f.text) parts.push({ kind: "untrusted", source: `file ${f.name}`, text: f.text });
  }
  const out = await gateway().structured({ purpose: purposeOf(PROMPTS.verify), system: PROMPTS.verify.system, schema: verifySchema, parts, maxTokens: 2_500 });
  if (!out.ok) return { available: false, reason: out.reason, model: "rules", data: fallback };

  // Grounding (port of the reference checker): cites must name files we were given; failed signals cannot support "met".
  const names = files.map((f) => f.name);
  const failedFiles = new Set(rules.failed.map((s) => s.file));
  const anyFail = rules.failed.length > 0;
  const criteria = out.data.criteria.map((c) => {
    const cites = c.cites.filter((x) => names.some((n) => x === n || x.startsWith(n) || x.includes(n)));
    const fileOf = (x: string) => names.find((n) => x === n || x.startsWith(n) || x.includes(n));
    let verdict = c.verdict;
    if (verdict === "met" && (!cites.length || cites.every((x) => failedFiles.has(fileOf(x))))) verdict = "unclear";
    return { criterion: c.criterion, verdict, confidence: verdict === c.verdict ? c.confidence : Math.min(c.confidence, 0.4), cites };
  });
  for (const sc of spec.criteria ?? []) if (!criteria.some((c) => c.criterion.trim().toLowerCase() === sc.trim().toLowerCase())) criteria.push({ criterion: sc, verdict: "unclear", confidence: 0, cites: [] });
  let recommendation = out.data.recommendation;
  if (recommendation === "approve" && (anyFail || rules.missing.length || criteria.some((c) => c.verdict !== "met"))) recommendation = criteria.some((c) => c.verdict === "not_met") || anyFail || rules.missing.length ? "request_fix" : "unclear";
  const notes = [out.data.summary, anyFail ? `A metadata signal failed (${rules.failed.map((s) => s.code).join(", ")}), so approval is not recommended.` : "", rules.missing.length ? `Missing: ${rules.missing.join("; ")}.` : "", out.data.injectionDetected ? "A file contained instructions aimed at the AI; they were ignored." : ""].filter(Boolean);
  const mean = criteria.length ? criteria.reduce((s, c) => s + c.confidence, 0) / criteria.length : 0;
  return { available: true, model: out.model, confidence: Math.round(mean * 100) / 100, data: { criteria, recommendation, summary: notes.join(" ").slice(0, 1500) } };
}

/* ───────────── A4 ───────────── */

type MediateData = { providerShareBps: number; findings: string[]; missing: string[]; confidence: number };

export async function mediate(input: { disputeRule: string; clauses: string[]; evidence: string[]; rebuttals: string[]; bids: { role: string; shareBps: number }[]; amountCents: number }): Promise<AiResult<MediateData>> {
  const rules = mediateRules(input);
  const parts: Part[] = [
    { kind: "text", text: `Disputed amount: ${formatCents(input.amountCents)}. Bids (provider share): ${input.bids.length ? input.bids.map((b) => `${b.role} ${b.shareBps / 100}%`).join(", ") : "none"} [bids].` },
    { kind: "untrusted", source: "rule", text: input.disputeRule },
    ...input.clauses.map((c, i) => ({ kind: "untrusted" as const, source: `clause ${i + 1}`, text: c })),
    ...input.evidence.map((c, i) => ({ kind: "untrusted" as const, source: `evidence ${i + 1}`, text: c })),
    ...input.rebuttals.map((c, i) => ({ kind: "untrusted" as const, source: `rebuttal ${i + 1}`, text: c })),
  ];
  const out = await gateway().structured({ purpose: purposeOf(PROMPTS.mediate), system: PROMPTS.mediate.system, schema: mediateSchema, parts, maxTokens: 2_000 });
  if (!out.ok) return { available: false, reason: out.reason, model: "rules", data: rules, confidence: rules.confidence };
  // Citation grounding: markers must name an input that exists; unknown markers are removed and the finding flagged.
  const valid = new Set(["rule", "bids", ...input.clauses.map((_, i) => `clause ${i + 1}`), ...input.evidence.map((_, i) => `evidence ${i + 1}`), ...input.rebuttals.map((_, i) => `rebuttal ${i + 1}`)]);
  let uncited = 0;
  const findings = out.data.findings.map((f) => {
    let ok = 0;
    const cleaned = f.replace(/\[([^\]]{1,60})\]/g, (m, inner: string) => {
      const keep = inner.split(",").map((x) => x.trim().toLowerCase()).filter((x) => valid.has(x));
      ok += keep.length;
      return keep.length ? `[${keep.join(", ")}]` : "";
    }).replace(/\s{2,}/g, " ").trim();
    if (!ok) { uncited++; return `(no citation) ${cleaned}`; }
    return cleaned;
  });
  const share = Math.max(0, Math.min(10_000, Math.round(out.data.providerShareBps)));
  const confidence = Math.max(0, Math.min(1, out.data.confidence - (findings.length ? (uncited / findings.length) * 0.3 : 0.3)));
  return { available: true, model: out.model, confidence: Math.round(confidence * 100) / 100, data: { providerShareBps: share, findings, missing: out.data.missing, confidence: Math.round(confidence * 100) / 100 } };
}

export { mintAgentToken } from "./agent";
