/**
 * A7 rule-based fallback (no key, cap reached, invalid output) and deterministic post-processing for A1–A4.
 * Pure functions: no database, no network. The policy gate (R01–R07 in src/lib/policy.ts) stays the real gate;
 * these rules only suggest.
 *
 * A2 criteria linter (compileRules): a criterion is VERIFIABLE when a third person could check it yes/no from the
 * evidence: it names a number with a unit or threshold, a pass rate, a URL, a named artifact (report, log, photo,
 * signed sheet, CI run …), a sign-off, or a quantifier over listed things ("every backlog feature …").
 * It is NOT verifiable when it rests on taste words (fast, modern, user-friendly, robust, scalable, high quality …)
 * without a number to check them against, uses open-ended hedges (as needed, ASAP, where possible, etc.), or names
 * nothing observable at all.
 */
import type { ProofSpec } from "@/db/schema";

/* ───────────────────────────── A2 · criteria linter ───────────────────────────── */

/** Taste words: vague unless a measurable threshold sits next to them. */
export const VAGUE_TERMS = [
  "fast", "faster", "quick", "quickly", "rapid", "speedy", "snappy", "good", "great", "nice", "excellent", "awesome", "amazing",
  "modern", "sleek", "beautiful", "attractive", "elegant", "stunning", "pretty", "clean", "polished", "professional", "professionally",
  "user-friendly", "user friendly", "intuitive", "easy to use", "easy", "simple", "seamless", "seamlessly", "smooth", "smoothly",
  "robust", "scalable", "reliable", "stable", "flexible", "secure", "high quality", "high-quality", "top quality", "quality work",
  "premium", "luxury", "luxurious", "top-notch", "world-class", "world class", "state of the art", "state-of-the-art", "cutting-edge", "cutting edge",
  "best", "best practices", "best practice", "industry standard", "industry-standard", "timely", "promptly", "soon", "reasonable", "reasonably",
  "adequate", "adequately", "sufficient", "appropriate", "appropriately", "satisfactory", "satisfaction", "optimal", "optimized", "optimised",
  "efficient", "efficiently", "improved", "enhanced", "better", "significant", "significantly", "substantially", "mostly", "generally",
  "approximately", "roughly", "various", "several", "many", "few", "minimal", "responsive", "engaging", "impressive", "innovative",
  "delightful", "works well", "looks good", "looks great", "properly", "correctly", "fully functional", "functional", "smart", "cool",
  "neat", "tidy", "solid", "decent", "comfortable", "pleasant", "lovely", "perfect", "perfectly", "flawless", "flawlessly", "seamless experience",
  "durable", "long-lasting", "sturdy", "strong", "on time", "in good condition", "good condition", "high standard", "to a high standard",
];
/** Words that name nothing specific: a criterion made only of these cannot be checked ("Work is done as agreed"). */
const GENERIC = new Set("work works job jobs project everything things thing stuff task tasks it done complete completed finished delivered ready time ok okay fine item items deliverable deliverables as agreed expected requirements requirement scope spec specification milestone phase whole entire properly all".split(" "));
/** Open-ended hedges: never verifiable, even with a number. */
export const HEDGES = [
  "as needed", "as required", "as appropriate", "as necessary", "where possible", "if possible", "when possible", "asap", "as soon as possible",
  "etc", "and so on", "and more", "to the client's satisfaction", "to the satisfaction of", "at the provider's discretion", "at provider's discretion",
  "sole discretion", "if time permits", "time permitting", "where applicable", "and similar", "or similar", "tbd", "to be decided", "to be agreed",
];
const ARTIFACT_WORDS = [
  "report", "pdf", "log", "logs", "screenshot", "screenshots", "photo", "photos", "photograph", "photographs", "image", "images", "video",
  "recording", "walkthrough", "invoice", "invoices", "receipt", "receipts", "certificate", "certificates", "permit", "permits", "inspection",
  "sign-off", "signoff", "signed", "signs", "sign", "signature", "approves", "approved", "approval", "marks", "checklist", "document",
  "documentation", "spreadsheet", "csv", "url", "link", "repository", "repo", "commit", "pull request", "ci", "pipeline", "test report",
  "test cases", "test case", "tests", "test", "suite", "lighthouse", "scan", "audit", "readme", "runbook", "minutes", "drawing", "drawings",
  "floor plan", "bill of materials", "tracking number", "waybill", "booking", "confirmation", "voucher", "tickets", "ticket", "gps",
  "timestamp", "exif", "oracle", "endpoint", "api", "transport", "defect log", "uat", "script", "scripts", "staging", "production",
  "backlog", "prototype", "manifest", "itinerary", "statement", "export", "dump", "backup", "backups", "monitoring", "reachable",
  "listed", "listing", "list", "reading", "readings", "measurement", "measurements", "measured", "dyno", "map", "dossier", "sheet", "form", "file", "files", "folder", "handover", "hand-over", "keys", "meter",
];
const QUANTIFIERS = /\b(every|each|all|zero|none of|named|both|no (?:open|serious|critical|high|failing|known|severity|unresolved))\b/;
const UNIT = String.raw`(%|percent|ms|millis(?:econds?)?|s\b|secs?|seconds?|mins?|minutes?|h\b|hrs?|hours?|days?|weeks?|months?|px|kb|mb|gb|tb|users?|pages?|items?|screens?|photos?|images?|tests?|cases?|scripts?|tickets?|defects?|issues?|features?|endpoints?|rooms?|units?|km|m\b|cm|mm|kg|g\b|lbs?|°|kwh|kw|w\b|v\b|amps?|fps|rps|requests?|req\/s|points?|languages?|locales?|sessions?|people|guests?|nights?|panels?|sq\s?ft|sqm|m2|m²|ft|inches|in\b|liters?|litres?|stars?|lux|db|dpi|records?|rows?|transactions?|orders?|downloads?|calls?|messages?|microns?|µm|nm|psi|bar\b|hp|nm\b|rpm|mph|km\/h|kph|°c|°f|mbps|gbps)`;
const NUMERIC_ANCHOR = new RegExp(
  String.raw`(≥|≤|>=|<=|<|>|at least|at most|no more than|no less than|not more than|minimum(?: of)?|maximum(?: of)?|under|below|above|over|within|up to|less than|more than|exactly)\s*\$?\d` +
  String.raw`|\d[\d,]*(\.\d+)?\s*${UNIT}` + String.raw`|\bbetween\s+\$?\d[\d,.]*\s*\S*\s+and\s+\$?\d|\$\s?\d|\b\d+\s*(of|out of|\/)\s*\d+\b|\bp(50|90|95|99)\b|\bday \d+|\bby day\b|\bv?\d+\.\d+(\.\d+)?\b|\b(iso|wcag|en|astm|iec|ieee|rfc)\s?[\d.]+`,
  "i",
);
const RISK = [
  { re: /deemed (accepted|approved|complete)/i, flag: "Deemed acceptance: payment without an explicit approval" },
  { re: /non-?refundable|no refunds?/i, flag: "Refund waiver: conflicts with dispute rules" },
  { re: /unlimited (revisions|changes|rounds)/i, flag: "Unlimited revisions: scope has no end" },
  { re: /(sole|provider'?s|client'?s) discretion/i, flag: "One party's discretion decides" },
  { re: /\b(upfront|up-front|in advance|before (any )?work)\b/i, flag: "Payment before delivery: check front-loading (R04)" },
  { re: /\bregardless\b/i, flag: "'Regardless' overrides other conditions" },
];

const has = (t: string, w: string) => new RegExp(`(?<![\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}(?![\\w-])`, "i").test(t);

export interface CriterionVerdict { verifiable: boolean; reason: string; rewrite?: string; vague: string[]; hedges: string[]; anchors: string[]; riskFlags: string[] }

const REWRITES: [RegExp, string][] = [
  [/fast|faster|quick|rapid|speedy|snappy|efficient|optimi[sz]ed|responsive/i, "pages load in ≤ 2 s on a mid-range phone (Lighthouse report attached)"],
  [/user[- ]friendly|intuitive|easy|simple|seamless|smooth|engaging|delightful/i, "3 named test users complete the 3 core tasks without help (session recordings attached)"],
  [/robust|reliable|stable|functional|correctly|properly|works well/i, "the agreed test suite passes at ≥ 95% (CI log attached), with no open severity-1 defects"],
  [/scalable/i, "handles 500 concurrent users with p95 response under 800 ms (load-test report attached)"],
  [/secure/i, "no critical or high findings in a dependency scan and a web scan (reports attached)"],
  [/high[- ]quality|top quality|quality work|premium|luxur|top-notch|world[- ]class|professional|excellent|perfect|flawless/i, "matches the approved specification sheet item by item, with zero open defects at handover (signed checklist attached)"],
  [/modern|sleek|beautiful|attractive|elegant|stunning|pretty|clean|polished|nice|good|great|looks|lovely|tidy|neat/i, "matches the approved design file screen by screen / room by room (dated photos or screenshots of each attached)"],
  [/timely|promptly|soon|asap|as soon as possible/i, "delivered by day N of the contract (timestamped delivery record)"],
  [/as needed|as required|as necessary|as appropriate|where possible|if possible|etc|and so on|and more|tbd|to be/i, "the full list of items written out in the milestone, each checked off in a signed checklist"],
  [/satisf|discretion/i, "accepted when the client signs the acceptance checklist; objections must name a failed item within 48 h"],
];

function rewriteFor(text: string, vague: string[], hedges: string[]): string {
  const terms = [...hedges, ...vague];
  const picked: string[] = [];
  for (const t of terms) {
    const hit = REWRITES.find(([re]) => re.test(t));
    if (hit && !picked.includes(hit[1])) picked.push(hit[1]);
    if (picked.length >= 2) break;
  }
  const base = text.trim().replace(/[.\s]+$/, "");
  if (!picked.length) return `${base}, evidenced by a dated report or signed checklist that lists each item`;
  return `${base} — measured as: ${picked.join("; ")}`;
}

export function lintCriterion(raw: string): CriterionVerdict {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  const t = text.toLowerCase();
  const riskFlags = RISK.filter((r) => r.re.test(text)).map((r) => r.flag);
  if (text.length < 4) return { verifiable: false, reason: "The criterion is empty or too short to check.", vague: [], hedges: [], anchors: [], riskFlags, rewrite: undefined };
  const hedges = HEDGES.filter((h) => has(t, h));
  // a vague word inside a named artifact or a measured phrase does not count ("quality pass report", "Lighthouse performance ≥ 85")
  const vague = VAGUE_TERMS.filter((v) => has(t, v)).filter((v, _, all) => !all.some((o) => o !== v && o.includes(v) && has(t, o)));
  const numeric = NUMERIC_ANCHOR.test(text);
  const url = /https?:\/\/\S+/i.test(text);
  const artifacts = ARTIFACT_WORDS.filter((w) => has(t, w));
  const quant = QUANTIFIERS.test(t);
  const anchors = [...(numeric ? ["number or threshold"] : []), ...(url ? ["URL"] : []), ...artifacts.slice(0, 3), ...(quant ? ["quantifier"] : [])];
  const flagText = riskFlags.length ? ` Risk: ${riskFlags.join("; ")}.` : "";

  if (hedges.length) {
    return { verifiable: false, reason: `Open-ended wording (${hedges.slice(0, 3).join(", ")}) leaves the scope undefined, so no one can check it yes or no.${flagText}`, rewrite: rewriteFor(text, vague, hedges), vague, hedges, anchors, riskFlags };
  }
  if (vague.length && !numeric && !url) {
    return { verifiable: false, reason: `Uses taste words (${vague.slice(0, 3).join(", ")}) with no number, threshold or measurable target to check them against.${flagText}`, rewrite: rewriteFor(text, vague, hedges), vague, hedges, anchors, riskFlags };
  }
  if (!vague.length && !numeric && !url && !artifacts.length && !quant) {
    const specific = tokens(text).filter((w) => !GENERIC.has(w) && !/^\d/.test(w));
    if (specific.length < 2) return { verifiable: false, reason: `Names nothing specific to check (no artifact, number, sign-off or named item).${flagText}`, rewrite: rewriteFor(text, vague, hedges), vague, hedges, anchors, riskFlags };
    return { verifiable: true, reason: `Checkable as a yes/no observation of named items; make sure the proof spec says which file shows it.${flagText}`, vague, hedges, anchors: ["observable statement"], riskFlags };
  }
  const why = vague.length
    ? `Checkable because of the measurable target; consider dropping "${vague[0]}", which adds nothing to the check.`
    : `Checkable: ${anchors.slice(0, 3).join(", ")}.`;
  return { verifiable: true, reason: why + flagText, vague, hedges, anchors, riskFlags };
}

export interface CompileItem { code: string; title: string; criteria: string[] }
export interface CompileRow { code: string; verifiable: boolean; reason: string; rewrite?: string }

/** Row ids: one row per criterion, `${item.code}#${n}` with n counted from 1; an item without criteria gives `${code}#0`. */
export const criterionId = (code: string, n: number) => `${code}#${n}`;

export function compileRules(items: CompileItem[]): CompileRow[] {
  const out: CompileRow[] = [];
  for (const it of items) {
    if (!it.criteria.length) { out.push({ code: criterionId(it.code, 0), verifiable: false, reason: `"${it.title}" has no acceptance criteria; add at least one checkable criterion.` }); continue; }
    it.criteria.forEach((c, i) => {
      const v = lintCriterion(c);
      out.push({ code: criterionId(it.code, i + 1), verifiable: v.verifiable, reason: v.reason, ...(v.rewrite && !v.verifiable ? { rewrite: v.rewrite } : {}) });
    });
  }
  return out;
}

/* ───────────────────────────── A1 · drafting helpers ───────────────────────────── */

export interface DraftMilestone { title: string; type: "GATE" | "PAY"; day: number; bps: number; proof: ProofSpec; lockRule: string; disputeRule: string }
export interface BlueprintLite { code: string; title: string; vertical: string; kind: string; summary: string; recommendedDays: number; milestones: DraftMilestone[] }

/** PAY shares become integers that sum to exactly 10,000 (largest remainder; ties to the later milestone). GATE = 0. */
export function normalizeBps(ms: DraftMilestone[]): DraftMilestone[] {
  const list = ms.map((m) => ({ ...m, bps: m.type === "GATE" ? 0 : Math.max(0, Math.round(m.bps)) }));
  let pay = list.map((m, i) => ({ m, i })).filter((x) => x.m.type === "PAY");
  if (!pay.length && list.length) { list[list.length - 1].type = "PAY"; pay = [{ m: list[list.length - 1], i: list.length - 1 }]; }
  const sum = pay.reduce((s, x) => s + x.m.bps, 0);
  const weights = sum > 0 ? pay.map((x) => x.m.bps) : pay.map(() => 1);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (w * 10_000) / wsum);
  const base = exact.map(Math.floor);
  let left = 10_000 - base.reduce((a, b) => a + b, 0);
  const order = exact.map((e, k) => ({ k, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || b.k - a.k);
  for (const o of order) { if (left <= 0) break; base[o.k]++; left--; }
  pay.forEach((x, k) => (list[x.i].bps = base[k]));
  return list;
}

/** Target days scaled into 1..days, whole numbers, non-decreasing in milestone order, last one ≤ days. */
export function scaleDays(ms: DraftMilestone[], days: number, fromDays?: number): DraftMilestone[] {
  const D = Math.max(1, Math.floor(days));
  const src = Math.max(1, fromDays ?? Math.max(...ms.map((m) => m.day), 1));
  let prev = 1;
  return ms.map((m) => {
    const d = Math.min(D, Math.max(prev, Math.max(1, Math.round((m.day * D) / src))));
    prev = d;
    return { ...m, day: d };
  });
}

/** Clamp an already-planned list into 1..days without rescaling (for AI output), keeping order non-decreasing. */
export function clampDays(ms: DraftMilestone[], days: number): DraftMilestone[] {
  const D = Math.max(1, Math.floor(days));
  const max = Math.max(...ms.map((m) => m.day), 1);
  if (max > D) return scaleDays(ms, D, max);
  let prev = 1;
  return ms.map((m) => { const d = Math.min(D, Math.max(prev, Math.round(m.day) || 1)); prev = d; return { ...m, day: d }; });
}

/** Concrete proof for every PAY milestone (R05) and both rules present (R06). */
export function concreteProof(ms: DraftMilestone[]): DraftMilestone[] {
  return ms.map((m) => {
    const artifacts = m.proof?.artifacts?.length ? m.proof.artifacts : m.type === "PAY" ? [{ kind: "PDF" as const, min: 1, note: "Completion report listing each deliverable" }] : [{ kind: "SIGNATURE" as const, min: 1, note: "Both parties confirm" }];
    const criteria = (m.proof?.criteria ?? []).filter((c) => c && c.trim()).length ? m.proof.criteria : [`${m.title}: every listed deliverable is attached and checked off in a signed checklist`];
    return {
      ...m,
      proof: { ...m.proof, artifacts, criteria },
      lockRule: m.lockRule?.trim() || (m.type === "PAY" ? "Client approves the evidence." : "Both parties confirm."),
      disputeRule: m.disputeRule?.trim() || "Missing items are listed; the provider fixes them within 72 hours.",
    };
  });
}

export const normalizeDraft = (ms: DraftMilestone[], days: number) => normalizeBps(concreteProof(clampDays(ms, days)));

const STOP = new Set("the and for with from into that this our your their a an of to in on at by is are be we i my need needs want build new project work using over under per who will can also about have has get make".split(" "));
const SYNONYMS: string[][] = [
  ["erp", "sap", "s/4hana", "s4hana", "ibp", "oracle", "netsuite", "dynamics", "planning", "consulting", "consultant", "implementation", "sprint", "supply", "configuration", "cutover", "uat"],
  ["web", "website", "saas", "app", "mvp", "frontend", "backend", "api", "startup", "software", "platform", "dashboard", "portal", "react", "next.js"],
  ["interior", "millwork", "cabinet", "cabinets", "joinery", "furniture", "fit-out", "fitout", "kitchen", "wardrobe", "design"],
  ["car", "vehicle", "restoration", "restomod", "classic", "engine", "garage", "modernization", "modernisation", "ev conversion"],
  ["travel", "tour", "trip", "itinerary", "holiday", "vacation", "hotel", "safari", "guide"],
  ["tower", "telecom", "antenna", "site", "5g", "rf"],
  ["roof", "roofing", "shingles", "gutter"],
  ["solar", "pv", "inverter", "panels"],
  ["event", "conference", "wedding", "venue"],
  ["video", "film", "edit", "post-production", "footage"],
  ["localisation", "localization", "translation", "languages", "locale"],
  ["migration", "data", "etl", "warehouse"],
  ["legal", "contract review", "lawyer", "documents"],
  ["landscaping", "garden", "lawn", "yard"],
  ["marketing", "campaign", "ads", "seo"],
  ["freight", "shipping", "forwarding", "logistics", "container"],
];
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9/.+-]*/g) ?? []).map((w) => w.replace(/[.]+$/, "")).filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Keyword score of each blueprint against a brief; synonyms widen the brief. Highest first. */
export function rankBlueprints(brief: string, list: BlueprintLite[]): { code: string; score: number }[] {
  const b = new Set(tokens(brief));
  for (const group of SYNONYMS) if (group.some((g) => b.has(g) || brief.toLowerCase().includes(g))) group.forEach((g) => b.add(g));
  return list.map((bp) => {
    const head = new Set(tokens(`${bp.title} ${bp.vertical}`));
    const sum = new Set(tokens(bp.summary));
    const ms = new Set(tokens(bp.milestones.map((m) => m.title).join(" ")));
    let score = 0;
    for (const w of b) score += (head.has(w) ? 3 : 0) + (sum.has(w) ? 2 : 0) + (ms.has(w) ? 1 : 0);
    if (/blank|guided/i.test(bp.code + bp.title)) score = Math.min(score, 0.5);
    return { code: bp.code, score };
  }).sort((x, y) => y.score - x.score);
}

export function pickBlueprint(brief: string, list: BlueprintLite[]): BlueprintLite | null {
  if (!list.length) return null;
  const ranked = rankBlueprints(brief, list);
  const top = ranked[0];
  if (top.score <= 0.5) return list.find((b) => /blank|guided/i.test(b.code + b.title)) ?? list.find((b) => b.code === top.code) ?? null;
  return list.find((b) => b.code === top.code) ?? null;
}

export const titleFromBrief = (brief: string, fallback: string) => {
  const first = brief.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  const t = first.replace(/[.!?]+$/, "").slice(0, 80).trim();
  return t.length >= 6 ? t[0].toUpperCase() + t.slice(1) : fallback;
};

/* ───────────────────────────── A3 · evidence rule checks ───────────────────────────── */

export interface EvidenceFile { name: string; type: string; text?: string; imageBase64?: string; signals: unknown[] }
export interface Signal { code: string; level: "ok" | "warn" | "fail"; detail: string; file?: string }

export function kindOf(f: { name: string; type: string }): string {
  const t = (f.type || "").toLowerCase(), n = f.name.toLowerCase();
  if (t.startsWith("image/") || /\.(jpe?g|png|webp|heic|gif)$/.test(n)) return "IMAGE";
  if (t.startsWith("video/") || /\.(mp4|mov|webm)$/.test(n)) return "VIDEO";
  if (t === "application/pdf" || n.endsWith(".pdf")) return "PDF";
  if (t === "text/uri-list" || n.endsWith(".url") || /^link/.test(n)) return "LINK";
  if (/signature|signed|sign-off|signoff/.test(n)) return "SIGNATURE";
  return "LOG";
}

export function signalsOf(f: EvidenceFile): Signal[] {
  return (Array.isArray(f.signals) ? f.signals : []).flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    const level = o.level === "fail" || o.level === "warn" || o.level === "ok" ? o.level : "warn";
    return [{ code: String(o.code ?? "SIGNAL"), level, detail: String(o.detail ?? ""), file: f.name }];
  });
}

export function evidenceRules(spec: ProofSpec, files: EvidenceFile[]) {
  const counts: Record<string, number> = {};
  for (const f of files) { const k = kindOf(f); counts[k] = (counts[k] ?? 0) + 1; }
  const missing = (spec.artifacts ?? []).filter((a) => a.kind !== "ORACLE" && (counts[a.kind] ?? 0) < a.min)
    .map((a) => `${a.kind} × ${a.min} required${a.note ? ` (${a.note})` : ""}, ${counts[a.kind] ?? 0} attached`);
  const signals = files.flatMap(signalsOf);
  const failed = signals.filter((s) => s.level === "fail");
  const recommendation: "request_fix" | "unclear" = failed.length || missing.length ? "request_fix" : "unclear";
  const parts = [
    missing.length ? `Missing: ${missing.join("; ")}.` : "Every required artifact type is attached.",
    failed.length ? `Failed signals: ${failed.map((s) => `${s.code} on ${s.file}${s.detail ? ` (${s.detail})` : ""}`).join("; ")}.` : "",
    "Rule checks only; the criteria themselves were not judged. The client decides.",
  ].filter(Boolean);
  return {
    criteria: (spec.criteria ?? []).map((c) => ({ criterion: c, verdict: "unclear" as const, confidence: 0, cites: [] as string[] })),
    recommendation, summary: parts.join(" "), missing, failed,
  };
}

/* ───────────────────────────── A4 · mediation rule proposal ───────────────────────────── */

export interface MediateInput { disputeRule: string; clauses: string[]; evidence: string[]; rebuttals: string[]; bids: { role: string; shareBps: number }[]; amountCents: number }

/** A transparent baseline the mediator can compare against: pro-rata where the rule says so, else the bid midpoint, else 50/50. */
export function mediateRules(i: MediateInput): { providerShareBps: number; findings: string[]; missing: string[]; confidence: number } {
  const findings: string[] = [], missing: string[] = [];
  const rule = i.disputeRule.toLowerCase();
  const all = [...i.evidence, ...i.rebuttals].join("\n");
  const ratio = all.match(/\b(\d+)\s*(?:of|out of|\/)\s*(\d+)\b[^.\n]*(pass|passed|complete|completed|delivered|done|closed|installed|signed|working|fixed)/i);
  if (/pro-?rata|per[- ](feature|item|ticket|script|room|unit)|deduct/i.test(rule) && ratio && Number(ratio[2]) > 0) {
    const share = Math.round((Math.min(Number(ratio[1]), Number(ratio[2])) / Number(ratio[2])) * 100) * 100;
    findings.push(`Dispute rule "${i.disputeRule}" sets a proportional outcome; the evidence states ${ratio[1]} of ${ratio[2]} ${ratio[3]} [rule, evidence].`);
    return { providerShareBps: share, findings, missing, confidence: 0.5 };
  }
  const c = i.bids.find((b) => b.role === "client"), p = i.bids.find((b) => b.role === "provider");
  if (c && p) {
    const mid = Math.round((c.shareBps + p.shareBps) / 2 / 100) * 100;
    findings.push(`No proportional rule applies; the midpoint of the last bids (${c.shareBps / 100}% and ${p.shareBps / 100}%) is the neutral baseline [bids].`);
    return { providerShareBps: mid, findings, missing: ["A mediator's reading of the evidence"], confidence: 0.3 };
  }
  missing.push("Bids from both parties", "Evidence that maps to the dispute rule");
  return { providerShareBps: 5_000, findings: ["Not enough structured information for a proposal; 50/50 is shown as a neutral placeholder only."], missing, confidence: 0.1 };
}
