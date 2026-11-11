/* Blog typed content blocks (the contract shared by service, studio, renderer, seed and AI draft).
 * See REUSE.md for provenance; the block set is PaySettle's own.
 * A post body is an ORDERED array of typed blocks, validated with the zod union below and stored as jsonb.
 * Content is data, never raw HTML. Every block may carry anim, sources[] (footnotes) and claimStatus.
 * Claim guard (P10 + red team 1/13): a block with a digit-bearing claim (statRow, or text/callout/tldr containing a % or $ figure)
 * must have sources[] or claimStatus "illustrative" or "product" before publish — see claimProblems().
 */
import { z } from "zod";

export const ANIM_KEYS = ["none", "fadeUp", "fadeIn", "slideLeft", "slideRight", "stagger", "countUp"] as const;
export type AnimKey = (typeof ANIM_KEYS)[number];
export const ANIM_META: Record<AnimKey, { label: string; hint: string }> = {
  none: { label: "Still", hint: "No motion" },
  fadeUp: { label: "Rise", hint: "Rises softly into place" },
  fadeIn: { label: "Appear", hint: "A plain fade" },
  slideLeft: { label: "Drift in from right", hint: "Slides in from the right" },
  slideRight: { label: "Drift in from left", hint: "Slides in from the left" },
  stagger: { label: "Cascade", hint: "List items arrive one by one" },
  countUp: { label: "Count up", hint: "Numbers count up once (statRow, moneyFlow)" },
};

export const CLAIM_STATUSES = ["research", "product", "illustrative"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_META: Record<ClaimStatus, { label: string; hint: string }> = {
  research: { label: "From research", hint: "Backed by a cited source" },
  product: { label: "How PaySettle works", hint: "Describes product behaviour you can check in the app" },
  illustrative: { label: "Illustrative", hint: "Worked example with made-up numbers" },
};

export const TOPICS = ["explainer", "product", "case-study", "trust", "finance"] as const;
export type Topic = (typeof TOPICS)[number];
export const TOPIC_LABEL: Record<Topic, string> = { explainer: "Explainers", product: "Product", "case-study": "Case studies", trust: "Trust", finance: "Finance" };

const Source = z.object({ title: z.string().min(1).max(200), url: z.url() });
export type BlogSource = z.infer<typeof Source>;
const base = {
  id: z.string().min(1).max(40),
  anim: z.enum(ANIM_KEYS).optional(),
  sources: z.array(Source).max(6).optional(),
  claimStatus: z.enum(CLAIM_STATUSES).optional(),
};
const s = (max: number) => z.string().min(1).max(max);
/** Internal links only (P11): a path on this site. */
const InternalHref = z.string().regex(/^\/[a-z0-9\-/#?=&_.]*$/i, "Use a path on this site, e.g. /playground");
const Cents = z.number().int().min(0).max(100_000_000);

export const TldrBlock = z.object({ ...base, type: z.literal("tldr"), title: z.string().max(60).default("In short"), items: z.array(s(240)).min(1).max(5) });
export const HeadingBlock = z.object({ ...base, type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]).default(2), text: s(140) });
/** Text: paragraphs separated by blank lines; inline **bold**, *italic*, [label](/path or https://url). No HTML. */
export const TextBlock = z.object({ ...base, type: z.literal("text"), body: s(6000) });
export const ImageBlock = z.object({ ...base, type: z.literal("image"), src: z.string().regex(/^\/blog\/[a-z0-9\-_.]+\.(png|jpe?g|webp|svg)$/i, "Images live under /public/blog"), alt: s(240), caption: z.string().max(240).optional() });
export const QuoteBlock = z.object({ ...base, type: z.literal("quote"), text: s(600), by: s(120) });
export const CalloutBlock = z.object({ ...base, type: z.literal("callout"), tone: z.enum(["info", "warn", "ok"]).default("info"), title: z.string().max(80).optional(), body: s(1200) });
export const StatRowBlock = z.object({ ...base, type: z.literal("statRow"), stats: z.array(z.object({ value: s(24), label: s(80) })).min(2).max(4) });
export const StepListBlock = z.object({ ...base, type: z.literal("stepList"), title: z.string().max(100).optional(), steps: z.array(z.object({ title: s(100), body: s(600) })).min(2).max(10) });
export const FaqBlock = z.object({ ...base, type: z.literal("faq"), items: z.array(z.object({ q: s(200), a: s(1200) })).min(1).max(10) });
export const DividerBlock = z.object({ ...base, type: z.literal("divider") });
export const CtaBlock = z.object({ ...base, type: z.literal("cta"), title: s(100), body: z.string().max(300).optional(), label: s(40), href: InternalHref });
/** Renders the blueprint's real milestone list (src/data/blueprints) — blueprint must exist (checked in service). */
export const CaseStudyBlock = z.object({ ...base, type: z.literal("caseStudy"), blueprintCode: s(40), totalCents: Cents, before: s(600), after: s(600), highlight: z.array(z.string().max(40)).max(6).optional() });
/** Client → PayPal hold → provider (+ fee, refund) computed live by src/lib/money from these inputs (P6: integers). */
export const MoneyFlowBlock = z.object({ ...base, type: z.literal("moneyFlow"), totalCents: Cents, releasedBps: z.number().int().min(0).max(10_000), refundedBps: z.number().int().min(0).max(10_000).default(0), feeBps: z.number().int().min(0).max(1_000).default(250), caption: z.string().max(240).optional(), interactive: z.boolean().default(true) });
/** Renders tranche split for a total and day plan via the policy library. */
export const TrancheTimelineBlock = z.object({ ...base, type: z.literal("trancheTimeline"), totalDays: z.number().int().min(1).max(365), rail: z.enum(["A1", "A2", "B"]).default("A1"), caption: z.string().max(240).optional() });
/** Read-only API sample. Never secrets (P8): service rejects strings that look like keys/tokens. */
export const ApiSnippetBlock = z.object({ ...base, type: z.literal("apiSnippet"), method: z.enum(["GET", "POST", "PATCH"]), path: s(200), request: z.string().max(4000).optional(), response: z.string().max(4000).optional(), note: z.string().max(300).optional() });
export const CompareTableBlock = z.object({ ...base, type: z.literal("compareTable"), columns: z.array(s(60)).min(2).max(4), rows: z.array(z.array(z.string().max(160)).min(2).max(4)).min(1).max(12) });

export const Block = z.discriminatedUnion("type", [TldrBlock, HeadingBlock, TextBlock, ImageBlock, QuoteBlock, CalloutBlock, StatRowBlock, StepListBlock, FaqBlock, DividerBlock, CtaBlock, CaseStudyBlock, MoneyFlowBlock, TrancheTimelineBlock, ApiSnippetBlock, CompareTableBlock]);
export type Block = z.infer<typeof Block>;
export type BlockType = Block["type"];
export const Blocks = z.array(Block).min(1).max(80);
export const BLOCK_TYPES = Block.options.map((o) => o.shape.type.value) as BlockType[];

export const BLOCK_META: Record<BlockType, { label: string; hint: string }> = {
  tldr: { label: "In short", hint: "Up to five key points at the top" },
  heading: { label: "Heading", hint: "Section heading, appears in contents" },
  text: { label: "Text", hint: "Paragraphs with bold, italic and links" },
  image: { label: "Image", hint: "Image from /public/blog with alt text" },
  quote: { label: "Quote", hint: "A quote with attribution" },
  callout: { label: "Callout", hint: "Info, warning or success box" },
  statRow: { label: "Numbers", hint: "Two to four figures — each needs a source or an Illustrative label" },
  stepList: { label: "Steps", hint: "Numbered steps" },
  faq: { label: "FAQ", hint: "Questions and answers (FAQ structured data)" },
  divider: { label: "Divider", hint: "Section break" },
  cta: { label: "Button", hint: "Link to a page on this site" },
  caseStudy: { label: "Case study", hint: "Real blueprint milestones with before/after" },
  moneyFlow: { label: "Money flow", hint: "Live cents: client → PayPal hold → provider" },
  trancheTimeline: { label: "Tranche timeline", hint: "How a long job splits into PayPal hold windows" },
  apiSnippet: { label: "API sample", hint: "PayPal request/response, read-only" },
  compareTable: { label: "Comparison table", hint: "Small table" },
};

const FIGURE = /(\d+(\.\d+)?\s?%|\$\s?\d)/;
const SECRETISH = /(sk-[a-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{12,}|client_secret|-----BEGIN)/i;

function textOf(b: Block): string {
  switch (b.type) {
    case "tldr": return b.items.join(" ");
    case "text": return b.body;
    case "callout": return `${b.title ?? ""} ${b.body}`;
    case "quote": return b.text;
    case "statRow": return b.stats.map((x) => `${x.value} ${x.label}`).join(" ");
    case "stepList": return b.steps.map((x) => `${x.title} ${x.body}`).join(" ");
    case "faq": return b.items.map((x) => `${x.q} ${x.a}`).join(" ");
    case "compareTable": return b.rows.flat().join(" ");
    case "caseStudy": return `${b.before} ${b.after}`;
    default: return "";
  }
}

/** Publish-time claim guard. Returns human-readable problems; empty array = OK to publish. */
export function claimProblems(blocks: Block[]): { blockId: string; message: string }[] {
  const out: { blockId: string; message: string }[] = [];
  for (const b of blocks) {
    const hasBacking = (b.sources?.length ?? 0) > 0 || b.claimStatus === "illustrative" || b.claimStatus === "product";
    const t = textOf(b);
    if ((b.type === "statRow" || FIGURE.test(t)) && !hasBacking) out.push({ blockId: b.id, message: `“${BLOCK_META[b.type].label}” block has figures but no source and no Illustrative/Product label.` });
    if (b.claimStatus === "research" && !(b.sources?.length)) out.push({ blockId: b.id, message: `“${BLOCK_META[b.type].label}” block is marked research but lists no source.` });
    if (b.type === "quote" && !b.by.trim()) out.push({ blockId: b.id, message: "Quote needs an attribution." });
    if (b.type === "apiSnippet" && SECRETISH.test(`${b.request ?? ""} ${b.response ?? ""}`)) out.push({ blockId: b.id, message: "API sample looks like it contains a secret (P8)." });
  }
  return out;
}

/** Plain text of a post for copy-lint, search and reading time. */
export function plainText(blocks: Block[]): string { return blocks.map(textOf).filter(Boolean).join("\n"); }
export function readingMinutes(blocks: Block[]): number { return Math.max(1, Math.round(plainText(blocks).split(/\s+/).filter(Boolean).length / 220)); }
export function newBlockId(): string { return Math.random().toString(36).slice(2, 10); }
