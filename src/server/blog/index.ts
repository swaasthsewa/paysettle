/* Blog service — cross-module contract (signatures fixed here; ./service.ts implements, the public blog pages call).
 * Implementations live in ./service.ts and are re-exported here. Requirement ids: P5, P10. */
import type { Block, Topic } from "@/lib/blog/blocks";

export type PostStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED";
export interface PostSummary { id: string; slug: string; title: string; dek: string; topic: Topic; publishedAt: string | null; readingMinutes: number; heroSrc: string | null; heroAlt: string | null; status: PostStatus }
export interface Post extends PostSummary { blocks: Block[]; authorName: string | null; updatedAt: string; version: number; seo: { title?: string; description?: string } | null }
export interface Revision { id: string; version: number; title: string; editorName: string | null; createdAt: string; blocks: Block[] }
export interface PostInput { slug?: string; title: string; dek: string; topic: Topic; blocks: Block[]; heroSrc?: string | null; heroAlt?: string | null; seo?: { title?: string; description?: string } | null }

/* public (published only): listPublished(o?: { topic? }), getPublishedBySlug(slug), listRelated(post, n = 3)
 * studio (blog.write / blog.publish): listAll(a), getById(a, id), createPost(a, i), updatePost(a, id, i, expectedVersion),
 *   setStatus(a, id, s) — PUBLISHED runs claimProblems() + copy-lint over the post; throws DomainError("CLAIM_GUARD", …) listing problems,
 *   deletePost(a, id) — drafts only, listRevisions(a, id),
 *   draftWithAi(a, brief) — AI draft through the AI gateway; rule-based outline when AI is off. Always saved as DRAFT; returns new post id. */
export {
  listPublished, getPublishedBySlug, listRelated,
  listAll, getById, createPost, updatePost, setStatus, deletePost, listRevisions, draftWithAi,
} from "./service";
