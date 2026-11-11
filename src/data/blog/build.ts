/* Small constructors for the sample posts, so each post file reads like an outline. They return fully typed
 * blocks (every defaulted field written out), which the blog service validates again with Blocks on seed (P10, P11). */
import type { AnimKey, Block, BlogSource, ClaimStatus, Topic } from "@/lib/blog/blocks";

export interface SeedPost { slug: string; title: string; dek: string; topic: Topic; heroSrc?: string; heroAlt?: string; blocks: Block[] }

type Extra = { anim?: AnimKey; sources?: BlogSource[]; claimStatus?: ClaimStatus };
type B<T extends Block["type"]> = Extract<Block, { type: T }>;

export const tldr = (id: string, items: string[], x: Extra = {}): B<"tldr"> => ({ id, type: "tldr", title: "In short", items, ...x });
export const h2 = (id: string, text: string): B<"heading"> => ({ id, type: "heading", level: 2, text });
export const h3 = (id: string, text: string): B<"heading"> => ({ id, type: "heading", level: 3, text });
export const text = (id: string, body: string, x: Extra = {}): B<"text"> => ({ id, type: "text", body, ...x });
export const callout = (id: string, tone: "info" | "warn" | "ok", title: string | undefined, body: string, x: Extra = {}): B<"callout"> => ({ id, type: "callout", tone, ...(title ? { title } : {}), body, ...x });
export const quote = (id: string, q: string, by: string, x: Extra = {}): B<"quote"> => ({ id, type: "quote", text: q, by, ...x });
export const stats = (id: string, s: { value: string; label: string }[], x: Extra = {}): B<"statRow"> => ({ id, type: "statRow", stats: s, ...x });
export const steps = (id: string, title: string | undefined, s: { title: string; body: string }[], x: Extra = {}): B<"stepList"> => ({ id, type: "stepList", ...(title ? { title } : {}), steps: s, ...x });
export const faq = (id: string, items: { q: string; a: string }[], x: Extra = {}): B<"faq"> => ({ id, type: "faq", items, ...x });
export const divider = (id: string): B<"divider"> => ({ id, type: "divider" });
export const cta = (id: string, title: string, label: string, href: string, body?: string): B<"cta"> => ({ id, type: "cta", title, label, href, ...(body ? { body } : {}) });
export const image = (id: string, src: string, alt: string, caption?: string, x: Extra = {}): B<"image"> => ({ id, type: "image", src, alt, ...(caption ? { caption } : {}), ...x });
export const table = (id: string, columns: string[], rows: string[][], x: Extra = {}): B<"compareTable"> => ({ id, type: "compareTable", columns, rows, ...x });
export const flow = (id: string, totalCents: number, releasedBps: number, refundedBps: number, caption: string, x: Extra & { interactive?: boolean; feeBps?: number } = {}): B<"moneyFlow"> => {
  const { interactive = true, feeBps = 250, ...rest } = x;
  return { id, type: "moneyFlow", totalCents, releasedBps, refundedBps, feeBps, caption, interactive, ...rest };
};
export const tranches = (id: string, totalDays: number, rail: "A1" | "A2" | "B", caption: string, x: Extra = {}): B<"trancheTimeline"> => ({ id, type: "trancheTimeline", totalDays, rail, caption, ...x });
export const caseStudy = (id: string, blueprintCode: string, totalCents: number, before: string, after: string, highlight: string[], x: Extra = {}): B<"caseStudy"> => ({ id, type: "caseStudy", blueprintCode, totalCents, before, after, highlight, ...x });
export const api = (id: string, method: "GET" | "POST" | "PATCH", path: string, request: string | undefined, response: string | undefined, note: string, x: Extra = {}): B<"apiSnippet"> => ({ id, type: "apiSnippet", method, path, ...(request ? { request } : {}), ...(response ? { response } : {}), note, ...x });
