/**
 * Blog post input validation (pure; shared by the service and the studio so the browser shows the same errors the
 * server enforces). Every write is validated with the Blocks zod union plus the structural checks in lint.ts.
 */
import { z } from "zod";
import { Blocks, TOPICS } from "@/lib/blog/blocks";
import { DomainError } from "@/server/types";
import type { PostInput } from "./index";
import { writeProblems } from "./lint";
import { SLUG_MAX, SLUG_RE } from "./slug";

/** Input refused by validation: code "BAD_INPUT"; `issues` keeps the zod paths so the studio can point at the field. */
export class BlogInputError extends DomainError {
  constructor(readonly issues: { path: (string | number)[]; message: string }[]) {
    super("BAD_INPUT", issues.slice(0, 4).map((i) => (i.path.length ? `${pathText(i.path)}: ${i.message}` : i.message)).join(" · "));
  }
}
function pathText(p: (string | number)[]): string {
  if (p[0] === "blocks" && typeof p[1] === "number") return [`Block ${p[1] + 1}`, ...p.slice(2)].join(" › ");
  return p.join(" › ");
}

/* ───────────── input ───────────── */

const ImgSrc = z.string().regex(/^\/blog\/[a-z0-9\-_.]+\.(png|jpe?g|webp|svg)$/i, "Images live under /public/blog, e.g. /blog/tranches.svg");
export const PostInputSchema = z.object({
  slug: z.string().max(SLUG_MAX, `Keep the web address under ${SLUG_MAX} characters.`).regex(SLUG_RE, "Use lowercase letters, digits and single hyphens, e.g. day-28-tranches.").optional(),
  title: z.string().min(3, "Give the post a title of at least 3 characters.").max(140, "Keep the title under 140 characters."),
  dek: z.string().max(300, "Keep the summary under 300 characters."),
  topic: z.enum(TOPICS, "Pick a topic."),
  blocks: Blocks,
  heroSrc: ImgSrc.nullable(),
  heroAlt: z.string().max(240, "Keep alt text under 240 characters.").nullable(),
  seo: z.object({ title: z.string().max(70, "Keep the SEO title under 70 characters.").optional(), description: z.string().max(170, "Keep the SEO description under 170 characters.").optional() }).nullable(),
});
export type CleanInput = z.infer<typeof PostInputSchema>;

const blank = (v: string | null | undefined) => { const t = (v ?? "").trim(); return t ? t : null; };

/** Trim, turn empty strings into "not set", validate with zod and run the structural checks. Throws BlogInputError. */
export function cleanInput(i: PostInput): CleanInput {
  const seo = i.seo ? { title: blank(i.seo.title) ?? undefined, description: blank(i.seo.description) ?? undefined } : null;
  const raw = {
    slug: blank(i.slug)?.toLowerCase() ?? undefined,
    title: (i.title ?? "").trim(), dek: (i.dek ?? "").trim(), topic: i.topic, blocks: i.blocks,
    heroSrc: blank(i.heroSrc), heroAlt: blank(i.heroAlt),
    seo: seo && (seo.title || seo.description) ? seo : null,
  };
  const r = PostInputSchema.safeParse(raw);
  if (!r.success) throw new BlogInputError(r.error.issues.map((x) => ({ path: x.path.map((p) => (typeof p === "symbol" ? String(p) : p)), message: x.message })));
  const structural = writeProblems(r.data);
  if (structural.length) throw new BlogInputError(structural.map((p) => ({ path: p.blockId ? ["blocks", r.data.blocks.findIndex((b) => b.id === p.blockId)] : [], message: p.message })));
  return r.data;
}

export const BriefSchema = z.object({
  topic: z.enum(TOPICS, "Pick a topic."),
  title: z.string().trim().min(3, "Give the post a working title of at least 3 characters.").max(140, "Keep the title under 140 characters."),
  angle: z.string().trim().min(12, "Say in a sentence or two what the post should explain.").max(2000, "Keep the brief under 2,000 characters."),
});
