/**
 * Blog service. Implements the contract in src/server/blog/index.ts. Requirement ids: P5, P10, P3, F2.12.
 *
 * - Every write validates the post with the Blocks zod union (src/lib/blog/blocks.ts) plus the structural checks in lint.ts
 *   (unique block ids, case studies on real blueprints, no secrets in API samples, alt text on the hero).
 * - updatePost is optimistic: the caller sends the version it edited; a different stored version → DomainError("STALE").
 *   Each create and each update appends one blog_revisions row (append-only, P5: trigger blog_revisions_immutable).
 * - setStatus("PUBLISHED") runs the claim guard (claimProblems) and the copy lint (same banned list as tools/copy-lint.mjs)
 *   and refuses with ClaimGuardError (code "CLAIM_GUARD") listing every problem. Edits to a published post run it too.
 * - RBAC: blog.write for drafting and editing, blog.publish for publishing, unpublishing and archiving (src/lib/rbac).
 * - audit() for every mutation, in the same transaction as the change. Detail carries ids, versions and counts, never body text.
 * - Blog posts are platform content, not workspace data, so timestamps use the real clock (no workspace virtual clock).
 * - Public reads expose no author ids and no reader data (F2.12: no reader tracking).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, ne, notInArray } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { users } from "@/db/schema";
import { blogPosts, blogRevisions, type BlogOrigin } from "@/db/schema-blog";
import { Blocks, readingMinutes, TOPICS, type Block, type Topic } from "@/lib/blog/blocks";
import { can, canWrite, type Permission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { DomainError, type Actor } from "@/server/types";
import { flagOn } from "@/server/control/flags";
import { gateway } from "@/server/ai/store";
import type { Post, PostInput, PostStatus, PostSummary, Revision } from "./index";
import { BlogInputError, BriefSchema, cleanInput, type CleanInput } from "./input";
import { publishProblems, type Problem } from "./lint";
import { nthSlug, SLUG_MAX, SLUG_RE, slugify } from "./slug";
export { BlogInputError, BriefSchema, PostInputSchema, cleanInput } from "./input";
import { blogPurpose, draftBlocks } from "./ai";
import { stable } from "./diff";

/* ───────────── errors ───────────── */

/** Publish refused: code "CLAIM_GUARD"; `problems` lists each block and what is missing. */
export class ClaimGuardError extends DomainError {
  constructor(readonly problems: Problem[]) {
    super("CLAIM_GUARD", `Not published. Fix ${problems.length === 1 ? "this" : `these ${problems.length}`} first: ${problems.map((p) => p.message).join(" ")}`);
  }
}
/** Image files the post points at that are not in public/ (checked at publish, server-side). */
function missingImages(p: { heroSrc: string | null; blocks: Block[] }): Problem[] {
  const out: Problem[] = [];
  const has = (src: string) => existsSync(path.join(process.cwd(), "public", src));
  if (p.heroSrc && !has(p.heroSrc)) out.push({ blockId: null, message: `The hero image ${p.heroSrc} is not in public/blog.` });
  for (const b of p.blocks) if (b.type === "image" && !has(b.src)) out.push({ blockId: b.id, message: `Image ${b.src} is not in public/blog.` });
  return out;
}

/** The full publish check for stored or about-to-be-stored content. Empty = publishable. */
export function publishCheck(p: { title: string; dek: string; blocks: Block[]; heroSrc: string | null; heroAlt: string | null; seo: { title?: string; description?: string } | null }): Problem[] {
  return [...publishProblems(p), ...missingImages(p)];
}

/* ───────────── access ───────────── */

function need(a: Actor, p: Permission, mode: "read" | "write" = "write") {
  const ok = mode === "read" ? can(a.role, p) : canWrite(a.role, p);
  if (!ok) throw new DomainError("FORBIDDEN", p === "blog.publish" ? "Only the marketing team or an admin can publish, unpublish or archive posts." : "Only the marketing team or an admin can work on blog posts.");
}
const who = (a: Actor) => ({ id: a.id, role: a.role, requestId: a.requestId });

/* ───────────── mapping ───────────── */

type PostRow = typeof blogPosts.$inferSelect;
const summary = (r: PostRow): PostSummary => ({
  id: r.id, slug: r.slug, title: r.title, dek: r.dek, topic: r.topic, publishedAt: r.publishedAt?.toISOString() ?? null,
  readingMinutes: r.readingMinutes, heroSrc: r.heroSrc, heroAlt: r.heroAlt, status: r.status,
});
const full = (r: PostRow, authorName: string | null): Post => ({ ...summary(r), blocks: r.blocks, authorName, updatedAt: r.updatedAt.toISOString(), version: r.version, seo: r.seo ?? null });
const SUMMARY_COLS = {
  id: blogPosts.id, slug: blogPosts.slug, title: blogPosts.title, dek: blogPosts.dek, topic: blogPosts.topic, publishedAt: blogPosts.publishedAt,
  readingMinutes: blogPosts.readingMinutes, heroSrc: blogPosts.heroSrc, heroAlt: blogPosts.heroAlt, status: blogPosts.status,
};
type SummaryRow = Pick<PostRow, keyof typeof SUMMARY_COLS>;
const summaryOf = (r: SummaryRow): PostSummary => ({ ...r, publishedAt: r.publishedAt?.toISOString() ?? null });

/** Stable post order for the public list: newest publication first, then title. */
const PUBLIC_ORDER = [desc(blogPosts.publishedAt), blogPosts.title] as const;
const isTopic = (t: unknown): t is Topic => typeof t === "string" && (TOPICS as readonly string[]).includes(t);

/* ───────────── public reads ───────────── */

export async function listPublished(o: { topic?: Topic } = {}): Promise<PostSummary[]> {
  if (o.topic !== undefined && !isTopic(o.topic)) return [];
  const where = o.topic ? and(eq(blogPosts.status, "PUBLISHED"), eq(blogPosts.topic, o.topic)) : eq(blogPosts.status, "PUBLISHED");
  const rows = await db.select(SUMMARY_COLS).from(blogPosts).where(where).orderBy(...PUBLIC_ORDER);
  return rows.map(summaryOf);
}

export async function getPublishedBySlug(slug: string): Promise<Post | null> {
  if (typeof slug !== "string" || !SLUG_RE.test(slug) || slug.length > SLUG_MAX) return null;
  const [r] = await db.select({ p: blogPosts, author: users.name }).from(blogPosts).leftJoin(users, eq(users.id, blogPosts.authorId))
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.status, "PUBLISHED"))).limit(1);
  return r ? full(r.p, r.author) : null;
}

/** Same topic first (newest first), then other published posts, never the post itself. */
export async function listRelated(post: Pick<Post, "id" | "topic">, n = 3): Promise<PostSummary[]> {
  const take = Math.max(0, Math.min(12, Math.floor(n)));
  if (!take) return [];
  const same = await db.select(SUMMARY_COLS).from(blogPosts)
    .where(and(eq(blogPosts.status, "PUBLISHED"), eq(blogPosts.topic, post.topic), ne(blogPosts.id, post.id))).orderBy(...PUBLIC_ORDER).limit(take);
  if (same.length >= take) return same.map(summaryOf);
  const skip = [post.id, ...same.map((s) => s.id)];
  const fill = await db.select(SUMMARY_COLS).from(blogPosts)
    .where(and(eq(blogPosts.status, "PUBLISHED"), notInArray(blogPosts.id, skip))).orderBy(...PUBLIC_ORDER).limit(take - same.length);
  return [...same, ...fill].map(summaryOf);
}

/* ───────────── studio reads ───────────── */

export interface StudioRow extends PostSummary { version: number; updatedAt: string; origin: BlogOrigin; authorName: string | null }

/** Studio list: every post, most recently edited first. */
export async function listAll(a: Actor): Promise<PostSummary[]> { return listStudio(a); }
export async function listStudio(a: Actor): Promise<StudioRow[]> {
  need(a, "blog.write", "read");
  const rows = await db.select({ p: blogPosts, author: users.name }).from(blogPosts).leftJoin(users, eq(users.id, blogPosts.authorId)).orderBy(desc(blogPosts.updatedAt));
  return rows.map(({ p, author }) => ({ ...summary(p), version: p.version, updatedAt: p.updatedAt.toISOString(), origin: p.origin, authorName: author }));
}

export async function getById(a: Actor, id: string): Promise<Post | null> {
  const s = await getStudioPost(a, id);
  if (!s) return null;
  return { id: s.id, slug: s.slug, title: s.title, dek: s.dek, topic: s.topic, publishedAt: s.publishedAt, readingMinutes: s.readingMinutes, heroSrc: s.heroSrc, heroAlt: s.heroAlt, status: s.status, blocks: s.blocks, authorName: s.authorName, updatedAt: s.updatedAt, version: s.version, seo: s.seo };
}
export async function getStudioPost(a: Actor, id: string): Promise<(Post & { origin: BlogOrigin; createdAt: string }) | null> {
  need(a, "blog.write", "read");
  const [r] = await db.select({ p: blogPosts, author: users.name }).from(blogPosts).leftJoin(users, eq(users.id, blogPosts.authorId)).where(eq(blogPosts.id, id)).limit(1);
  return r ? { ...full(r.p, r.author), origin: r.p.origin, createdAt: r.p.createdAt.toISOString() } : null;
}

/** Newest first. */
export async function listRevisions(a: Actor, id: string): Promise<Revision[]> {
  need(a, "blog.write", "read");
  const rows = await db.select({ r: blogRevisions, editor: users.name }).from(blogRevisions).leftJoin(users, eq(users.id, blogRevisions.editorId))
    .where(eq(blogRevisions.postId, id)).orderBy(desc(blogRevisions.version));
  return rows.map(({ r, editor }) => ({ id: r.id, version: r.version, title: r.title, editorName: editor, createdAt: r.createdAt.toISOString(), blocks: r.blocks }));
}

/* ───────────── writes ───────────── */

function pgCode(e: unknown): { code?: string; constraint?: string } {
  const x = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return x?.cause?.code ? x.cause : x ?? {};
}
const isSlugClash = (e: unknown) => { const c = pgCode(e); return c.code === "23505" && (c.constraint ?? "blog_posts_slug") === "blog_posts_slug"; };

async function lockPost(tx: Tx, id: string): Promise<PostRow> {
  const [row] = await tx.select().from(blogPosts).where(eq(blogPosts.id, id)).for("update").limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "That post does not exist (it may have been deleted).");
  return row;
}

/** Shared by createPost, draftWithAi and the seed: insert under a unique slug, write revision 1, audit. */
async function insertPost(a: Actor, input: PostInput, origin: BlogOrigin, auditDetail: Record<string, unknown> = {}): Promise<string> {
  const c = cleanInput(input);
  const explicit = c.slug !== undefined;
  const base = c.slug ?? slugify(c.title);
  for (let attempt = 0; attempt <= 47; attempt++) {
    const slug = explicit ? base : nthSlug(base, attempt);
    const id = newId("post");
    try {
      await db.transaction(async (tx) => {
        const now = new Date();
        await tx.insert(blogPosts).values({
          id, slug, title: c.title, dek: c.dek, topic: c.topic, status: "DRAFT", blocks: c.blocks, authorId: a.id, heroSrc: c.heroSrc, heroAlt: c.heroAlt,
          seo: c.seo, readingMinutes: readingMinutes(c.blocks), version: 1, origin, createdAt: now, updatedAt: now,
        });
        await tx.insert(blogRevisions).values({ id: newId("brev"), postId: id, version: 1, title: c.title, dek: c.dek, blocks: c.blocks, editorId: a.id, createdAt: now });
        await audit(tx, who(a), "blog.create", id, { slug, topic: c.topic, origin, blocks: c.blocks.length, ...auditDetail });
      });
      return id;
    } catch (e) {
      if (!isSlugClash(e)) throw e;
      if (explicit) throw new DomainError("SLUG_TAKEN", `The web address /blog/${slug} is already used by another post. Choose a different one.`);
    }
  }
  throw new DomainError("SLUG_TAKEN", "Could not find a free web address for this title. Set one by hand.");
}

export async function createPost(a: Actor, i: PostInput): Promise<string> {
  need(a, "blog.write");
  return insertPost(a, i, "MANUAL");
}
/** Seed path (scripts/seed-blog.ts): same checks, origin SEED. */
export async function createSeedPost(a: Actor, i: PostInput): Promise<string> {
  need(a, "blog.write");
  return insertPost(a, i, "SEED");
}

const sameContent = (row: PostRow, c: CleanInput, slug: string) =>
  row.slug === slug && row.title === c.title && row.dek === c.dek && row.topic === c.topic && row.heroSrc === c.heroSrc && row.heroAlt === c.heroAlt
  && stable(row.seo ?? null) === stable(c.seo ?? null) && stable(row.blocks) === stable(c.blocks);

export async function updatePost(a: Actor, id: string, i: PostInput, expectedVersion: number): Promise<{ version: number }> {
  need(a, "blog.write");
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new DomainError("BAD_INPUT", "The editor sent no version number. Reload the post.");
  const c = cleanInput(i);
  try {
    return await db.transaction(async (tx) => {
      const row = await lockPost(tx, id);
      if (row.version !== expectedVersion) throw new DomainError("STALE", `Someone saved this post after you opened it (now version ${row.version}, you edited version ${expectedVersion}). Reload to see their changes; copy your edits first.`);
      const slug = c.slug ?? row.slug;
      if (sameContent(row, c, slug)) return { version: row.version };
      if (row.status === "PUBLISHED") {
        const problems = publishCheck({ ...c });
        if (problems.length) throw new ClaimGuardError(problems);
      }
      if (slug !== row.slug) {
        const [clash] = await tx.select({ id: blogPosts.id }).from(blogPosts).where(and(eq(blogPosts.slug, slug), ne(blogPosts.id, id))).limit(1);
        if (clash) throw new DomainError("SLUG_TAKEN", `The web address /blog/${slug} is already used by another post. Choose a different one.`);
      }
      const version = row.version + 1, now = new Date();
      const done = await tx.update(blogPosts).set({
        slug, title: c.title, dek: c.dek, topic: c.topic, blocks: c.blocks, heroSrc: c.heroSrc, heroAlt: c.heroAlt, seo: c.seo,
        readingMinutes: readingMinutes(c.blocks), version, updatedAt: now,
      }).where(and(eq(blogPosts.id, id), eq(blogPosts.version, expectedVersion))).returning({ id: blogPosts.id });
      if (!done.length) throw new DomainError("STALE", "Someone saved this post at the same moment. Reload to see their changes.");
      await tx.insert(blogRevisions).values({ id: newId("brev"), postId: id, version, title: c.title, dek: c.dek, blocks: c.blocks, editorId: a.id, createdAt: now });
      await audit(tx, who(a), "blog.update", id, { version, slug, slugChanged: slug !== row.slug, blocks: c.blocks.length, status: row.status });
      return { version };
    });
  } catch (e) {
    if (isSlugClash(e)) throw new DomainError("SLUG_TAKEN", "That web address was just taken by another post. Choose a different one.");
    throw e;
  }
}

/** Allowed moves. Same-status calls are a no-op. */
export const STATUS_MOVES: Record<PostStatus, PostStatus[]> = {
  DRAFT: ["REVIEW", "PUBLISHED", "ARCHIVED"],
  REVIEW: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};
const STATUS_WORD: Record<PostStatus, string> = { DRAFT: "draft", REVIEW: "in review", PUBLISHED: "published", ARCHIVED: "archived" };
/** Moves that change what the public sees need blog.publish; the rest need blog.write. */
export const needsPublishRight = (from: PostStatus, to: PostStatus) => to === "PUBLISHED" || to === "ARCHIVED" || from === "PUBLISHED";

export async function setStatus(a: Actor, id: string, s: PostStatus): Promise<void> {
  need(a, "blog.write");
  if (!(s in STATUS_MOVES)) throw new DomainError("BAD_INPUT", "Unknown status.");
  await db.transaction(async (tx) => {
    const row = await lockPost(tx, id);
    if (row.status === s) return;
    need(a, needsPublishRight(row.status, s) ? "blog.publish" : "blog.write");
    if (!STATUS_MOVES[row.status].includes(s)) throw new DomainError("STATE", `A post that is ${STATUS_WORD[row.status]} cannot move to ${STATUS_WORD[s]} directly.`);
    if (s === "PUBLISHED") {
      const parsed = Blocks.safeParse(row.blocks);
      if (!parsed.success) throw new ClaimGuardError([{ blockId: null, message: "The stored blocks no longer validate. Open the post, fix the flagged blocks and save." }]);
      const problems = publishCheck({ title: row.title, dek: row.dek, blocks: parsed.data, heroSrc: row.heroSrc, heroAlt: row.heroAlt, seo: row.seo ?? null });
      if (problems.length) throw new ClaimGuardError(problems);
    }
    const now = new Date();
    await tx.update(blogPosts).set({ status: s, updatedAt: now, ...(s === "PUBLISHED" && !row.publishedAt ? { publishedAt: now } : {}) }).where(eq(blogPosts.id, id));
    await audit(tx, who(a), "blog.status", id, { from: row.status, to: s, version: row.version, slug: row.slug });
  });
}

export async function deletePost(a: Actor, id: string): Promise<void> {
  need(a, "blog.write");
  await db.transaction(async (tx) => {
    const row = await lockPost(tx, id);
    if (row.status !== "DRAFT") throw new DomainError("NOT_DRAFT", `Only drafts can be deleted. This post is ${STATUS_WORD[row.status]}; archive it instead.`);
    await tx.delete(blogPosts).where(eq(blogPosts.id, id));
    await audit(tx, who(a), "blog.delete", id, { slug: row.slug, version: row.version, note: "revision trail kept" });
  });
}

/* ───────────── AI draft ───────────── */


export async function draftWithAiDetailed(a: Actor, brief: { topic: Topic; title: string; angle: string }): Promise<{ id: string; usedAi: boolean; reason?: string; model?: string }> {
  need(a, "blog.write");
  const b = BriefSchema.safeParse(brief);
  if (!b.success) throw new BlogInputError(b.error.issues.map((x) => ({ path: x.path.map(String), message: x.message })));
  const allowed = await flagOn("ai.enabled").catch(() => false);
  const out = await draftBlocks(gateway(), b.data, allowed);
  const detail = out.usedAi ? { usedAi: true, model: out.model, purpose: blogPurpose } : { usedAi: false, reason: out.reason.slice(0, 200), purpose: blogPurpose };
  const id = await insertPost(a, { title: b.data.title, dek: out.draft.dek, topic: b.data.topic, blocks: out.draft.blocks, heroSrc: null, heroAlt: null, seo: null }, out.usedAi ? "AI" : "OUTLINE", detail);
  return out.usedAi ? { id, usedAi: true, model: out.model } : { id, usedAi: false, reason: out.reason };
}

export async function draftWithAi(a: Actor, brief: { topic: Topic; title: string; angle: string }): Promise<{ id: string; usedAi: boolean }> {
  const r = await draftWithAiDetailed(a, brief);
  return { id: r.id, usedAi: r.usedAi };
}

/* ───────────── seed support ───────────── */

/** Look up posts by slug (seed upsert). */
export async function postsBySlug(slugs: string[]): Promise<Map<string, PostRow>> {
  if (!slugs.length) return new Map();
  const rows = await db.select().from(blogPosts).where(inArray(blogPosts.slug, slugs));
  return new Map(rows.map((r) => [r.slug, r]));
}
