/**
 * Blog studio — client-side model helpers (pure): starter blocks per type, list snippets, per-block issues, dollars ↔ cents.
 * Starter blocks are valid against Blocks but deliberately unpublishable where they hold placeholder figures or text
 * (no source/label, or the outline mark), so the claim guard keeps a half-written post private.
 */
import { Block, BLOCK_META, newBlockId, type BlockType } from "@/lib/blog/blocks";
import { formatCents } from "@/lib/money";
import { OUTLINE_MARK } from "@/server/blog/lint";

export type EditablePost = {
  id: string; slug: string; title: string; dek: string; topic: import("@/lib/blog/blocks").Topic;
  heroSrc: string; heroAlt: string; seoTitle: string; seoDescription: string; blocks: Block[];
};

export const STATUS_CHIP: Record<"DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED", { label: string; tone: "plain" | "warn" | "ok" | "none" }> = {
  DRAFT: { label: "Draft", tone: "plain" }, REVIEW: { label: "In review", tone: "warn" }, PUBLISHED: { label: "Published", tone: "ok" }, ARCHIVED: { label: "Archived", tone: "none" },
};
export const ORIGIN_LABEL = { MANUAL: "Written", AI: "AI draft", OUTLINE: "Outline", SEED: "Seeded" } as const;

export function blankBlock(type: BlockType): Block {
  const id = newBlockId();
  switch (type) {
    case "tldr": return { id, type, title: "In short", items: [`${OUTLINE_MARK} The one point a reader should remember.`] };
    case "heading": return { id, type, level: 2, text: "New section" };
    case "text": return { id, type, body: `${OUTLINE_MARK} Write the paragraph here.` };
    case "image": return { id, type, src: "/blog/placeholder.svg", alt: "Describe what the image shows" };
    case "quote": return { id, type, text: `${OUTLINE_MARK} The words being quoted.`, by: "Name, role" };
    case "callout": return { id, type, tone: "info", title: "Good to know", body: `${OUTLINE_MARK} What the reader should keep in mind.` };
    case "statRow": return { id, type, stats: [{ value: "0", label: "First figure" }, { value: "0", label: "Second figure" }] };
    case "stepList": return { id, type, title: "Step by step", steps: [{ title: "First step", body: `${OUTLINE_MARK} What happens.` }, { title: "Second step", body: `${OUTLINE_MARK} What happens next.` }] };
    case "faq": return { id, type, items: [{ q: "A question readers ask?", a: `${OUTLINE_MARK} The answer.` }] };
    case "divider": return { id, type };
    case "cta": return { id, type, title: "See it with simulated money", body: "Run the scenario in the Judge Playground.", label: "Open the playground", href: "/playground" };
    case "caseStudy": return { id, type, blueprintCode: "UC_CLASSIC_CAR", totalCents: 1_450_000, before: `${OUTLINE_MARK} How the job was paid before.`, after: `${OUTLINE_MARK} How it is paid milestone by milestone.`, claimStatus: "illustrative" };
    case "moneyFlow": return { id, type, totalCents: 1_000_000, releasedBps: 10_000, refundedBps: 0, feeBps: 250, interactive: true, claimStatus: "illustrative" };
    case "trancheTimeline": return { id, type, totalDays: 40, rail: "A1", claimStatus: "product" };
    case "apiSnippet": return { id, type, method: "POST", path: "/v2/checkout/orders", request: '{\n  "intent": "AUTHORIZE"\n}', note: "Sandbox request. Headers and tokens are left out." };
    case "compareTable": return { id, type, columns: ["Paid up front", "Paid per milestone"], rows: [["Money leaves on day one", "Money is held until the client approves"]] };
  }
}

/** A deep copy with a fresh id (duplicate). */
export const cloneBlock = (b: Block): Block => ({ ...(JSON.parse(JSON.stringify(b)) as Block), id: newBlockId() });

const cut = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export function snippet(b: Block): string {
  switch (b.type) {
    case "tldr": return cut(b.items[0] ?? "");
    case "heading": return cut(b.text);
    case "text": return cut(b.body.replace(/\s+/g, " "));
    case "image": return cut(b.alt);
    case "quote": return cut(`${b.text} — ${b.by}`);
    case "callout": return cut(b.title || b.body);
    case "statRow": return b.stats.map((s) => s.value).join(" · ");
    case "stepList": return `${b.steps.length} steps`;
    case "faq": return `${b.items.length} question${b.items.length === 1 ? "" : "s"}`;
    case "divider": return "Section break";
    case "cta": return `${b.label} → ${b.href}`;
    case "caseStudy": return `${b.blueprintCode} · ${formatCents(b.totalCents)}`;
    case "moneyFlow": return `${formatCents(b.totalCents)} · ${b.releasedBps / 100}% released`;
    case "trancheTimeline": return `${b.totalDays} days · rail ${b.rail}`;
    case "apiSnippet": return `${b.method} ${b.path}`;
    case "compareTable": return `${b.columns.length} columns · ${b.rows.length} rows`;
  }
}
export const labelOf = (b: Block | undefined) => (b ? BLOCK_META[b.type].label : "Removed block");

export interface Issue { path: (string | number)[]; message: string }
/** zod issues of one block, with paths relative to the block. */
export function blockIssues(b: unknown): Issue[] {
  const r = Block.safeParse(b);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)), message: i.message }));
}
/** Messages for one field (path prefix). */
export const issuesAt = (list: Issue[], ...prefix: (string | number)[]) => list.filter((i) => prefix.every((p, k) => i.path[k] === p)).map((i) => i.message);

/** "14,500.00" / "14500" / "14500.5" → 1450000 cents. null when not a plain amount. Integer arithmetic only (P6). */
export function dollarsToCents(s: string): number | null {
  const m = s.replace(/[$,\s]/g, "").match(/^(\d{1,7})(?:\.(\d{0,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
export const centsToDollars = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;

export const toInput = (p: EditablePost) => ({
  slug: p.slug, title: p.title, dek: p.dek, topic: p.topic, blocks: p.blocks,
  heroSrc: p.heroSrc || null, heroAlt: p.heroAlt || null,
  seo: p.seoTitle || p.seoDescription ? { title: p.seoTitle || undefined, description: p.seoDescription || undefined } : null,
});
