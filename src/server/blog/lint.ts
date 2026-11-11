/**
 * P10 · P8 — publish-time checks for blog posts. Pure (no database), so the studio's claim-guard panel runs the
 * exact same checks live in the browser that the service runs at publish.
 *
 * COPY_LINT_BANNED mirrors the BANNED list in tools/copy-lint.mjs. That script runs on import (it scans git files and
 * exits), so it cannot be imported; blog.test.ts reads the script and fails if the two lists drift apart.
 */
import { BLOCK_META, claimProblems, type Block } from "@/lib/blog/blocks";
import { BLUEPRINTS } from "@/data/blueprints";

/** Same patterns, same order, as tools/copy-lint.mjs (P10: no unsupported guarantees). */
export const COPY_LINT_BANNED: RegExp[] = [
  /zero regulatory overhead/i, /100\s*%\s*irreversible/i, /guaranteed? (payment|refund)/i, /fully compliant/i, /bank[- ]grade/i,
  /never (lose|lost) (money|a cent)/i, /risk[- ]free/i, /fedramp/i,
];

/** P8: strings that look like credentials. Wider than the claim guard's check: applied to every API sample on every write. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-z0-9]{8,}/i, /Bearer\s+[A-Za-z0-9._-]{12,}/, /client_secret/i, /-----BEGIN/, /\bAKIA[0-9A-Z]{16}\b/,
  /"access_token"\s*:\s*"[A-Za-z0-9._-]{12,}"/i, /\bA21AA[A-Za-z0-9._-]{20,}/,
];

export const BLUEPRINT_CODES: ReadonlySet<string> = new Set(BLUEPRINTS.map((b) => b.code));

export interface Problem { blockId: string | null; message: string }

/** Marks text written by the rule-based outline (src/server/blog/ai.ts). A post still carrying it cannot be published. */
export const OUTLINE_MARK = "[Outline]";

/** Keys whose values are addresses, not reader-facing words: the copy lint skips them. */
const NON_COPY_KEYS = new Set(["id", "url", "src", "href", "type", "anim", "claimStatus", "tone", "method", "rail", "blueprintCode"]);

/** Every reader-facing string inside a value (deep), so the copy lint sees headings, captions, button labels and alt text too. */
export function copyStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => copyStrings(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (!NON_COPY_KEYS.has(k)) copyStrings(x, out); }
  return out;
}

/** The banned phrases found in a text (each reported once, with the matched words). */
export function bannedIn(text: string): string[] {
  const hits: string[] = [];
  for (const re of COPY_LINT_BANNED) { const m = text.match(re); if (m) hits.push(m[0]); }
  return hits;
}

export function looksSecret(text: string): boolean { return SECRET_PATTERNS.some((re) => re.test(text)); }

const label = (b: Block) => BLOCK_META[b.type]?.label ?? b.type;

/**
 * Structural checks that apply to EVERY write (draft or not): unique block ids, case studies point at a real blueprint,
 * API samples carry no secrets, a hero image has alt text.
 */
export function writeProblems(p: { blocks: Block[]; heroSrc?: string | null; heroAlt?: string | null }): Problem[] {
  const out: Problem[] = [];
  const seen = new Set<string>();
  for (const b of p.blocks) {
    if (seen.has(b.id)) out.push({ blockId: b.id, message: `Two blocks share the id “${b.id}”. Duplicate the block again or give it a new id.` });
    seen.add(b.id);
    if (b.type === "caseStudy" && !BLUEPRINT_CODES.has(b.blueprintCode)) out.push({ blockId: b.id, message: `Case study points at blueprint “${b.blueprintCode}”, which does not exist.` });
    if (b.type === "moneyFlow" && b.releasedBps + b.refundedBps > 10_000) out.push({ blockId: b.id, message: "Money flow: released and refunded together cannot pass 100% (10,000 basis points)." });
    if (b.type === "apiSnippet" && looksSecret(`${b.path} ${b.request ?? ""} ${b.response ?? ""} ${b.note ?? ""}`)) out.push({ blockId: b.id, message: "API sample looks like it contains a key or token (P8). Replace it with a placeholder such as <ACCESS_TOKEN>." });
  }
  if (p.heroSrc && !p.heroAlt?.trim()) out.push({ blockId: null, message: "The hero image needs alt text." });
  return out;
}

/**
 * Everything that must be true before a post is public: the structural checks, the claim guard from blocks.ts
 * (figures need a source or an Illustrative / How PaySettle works label) and the copy lint over every reader-facing string.
 */
export function publishProblems(p: { title: string; dek: string; blocks: Block[]; heroSrc?: string | null; heroAlt?: string | null; seo?: { title?: string; description?: string } | null }): Problem[] {
  const out: Problem[] = [...writeProblems(p), ...claimProblems(p.blocks)];
  const head = bannedIn([p.title, p.dek, p.heroAlt ?? "", p.seo?.title ?? "", p.seo?.description ?? ""].join("\n"));
  if (head.length) out.push({ blockId: null, message: `Title, summary or SEO text uses language we do not publish: “${head.join("”, “")}”.` });
  for (const b of p.blocks) {
    const hits = bannedIn(copyStrings(b).join("\n"));
    if (hits.length) out.push({ blockId: b.id, message: `“${label(b)}” block uses language we do not publish (P10): “${hits.join("”, “")}”.` });
    if (copyStrings(b).some((t) => t.includes(OUTLINE_MARK))) out.push({ blockId: b.id, message: `“${label(b)}” block is still an outline placeholder. Write the section or remove the block.` });
  }
  if (!p.dek.trim()) out.push({ blockId: null, message: "Add a one-line summary (dek): it shows on the post card and in search results." });
  return out;
}
