/**
 * Blog tables, additive to schema.ts. Requirement ids: P5 (append-only revisions), P10 (claim guard at publish).
 *
 * blog_posts      one row per post. blocks is the typed block array from src/lib/blog/blocks.ts (validated with zod on every
 *                 write). version is the optimistic-lock counter: every saved change bumps it and appends a revision.
 *                 origin records how the post started (MANUAL, AI draft, rule OUTLINE when AI was off, SEED) so the studio can
 *                 warn that an AI draft still needs a human to check every figure and source before publishing.
 * blog_revisions  append-only snapshot of a post at each version (title, dek, blocks, editor). Protected by the trigger
 *                 blog_revisions_immutable (BEFORE UPDATE OR DELETE → ps_refuse_change, see src/server/blog/guards.ts).
 *                 post_id carries no foreign key on purpose: deleting a DRAFT post leaves its revision trail in place.
 *
 * Blog content is platform content, not tenant data, so it carries no org_id. No reader analytics are stored here (F2.12).
 */
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Block, Topic } from "@/lib/blog/blocks";
import { users } from "./schema";

export type BlogStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "ARCHIVED";
export type BlogOrigin = "MANUAL" | "AI" | "OUTLINE" | "SEED";
export interface BlogSeo { title?: string; description?: string }

export const blogPosts = pgTable("blog_posts", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  dek: text("dek").notNull().default(""),
  topic: text("topic").$type<Topic>().notNull(),
  status: text("status").$type<BlogStatus>().notNull().default("DRAFT"),
  blocks: jsonb("blocks").$type<Block[]>().notNull(),
  authorId: text("author_id").references(() => users.id),
  heroSrc: text("hero_src"),
  heroAlt: text("hero_alt"),
  seo: jsonb("seo").$type<BlogSeo | null>(),
  readingMinutes: integer("reading_minutes").notNull().default(1),
  version: integer("version").notNull().default(1),
  origin: text("origin").$type<BlogOrigin>().notNull().default("MANUAL"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("blog_posts_slug").on(t.slug),
  index("blog_posts_status_published").on(t.status, t.publishedAt),
  index("blog_posts_topic").on(t.topic),
]);

export const blogRevisions = pgTable("blog_revisions", {
  id: text("id").primaryKey(),
  postId: text("post_id").notNull(),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  dek: text("dek").notNull().default(""),
  blocks: jsonb("blocks").$type<Block[]>().notNull(),
  editorId: text("editor_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("blog_revisions_post_version").on(t.postId, t.version)]);
