/**
 * Blog demo data (P5, P10), idempotent. Usage: npx tsx --env-file-if-exists=.env.local scripts/seed-blog.ts
 *  - applies the blog revision trigger (P5, src/server/blog/guards.ts);
 *  - loads every post exported as POSTS by src/data/blog/posts/index.ts (the public blog module). When that file is not there yet,
 *    one sample post of our own is used instead;
 *  - inserts or updates each post BY SLUG through the blog service (same zod and structure checks as the studio), then
 *    publishes it through setStatus, so the claim guard and the copy lint run on seed content too. A post that fails the
 *    guard is reported and left as a draft; the script then exits with code 1 so the problem is not missed.
 *  - posts an editor archived are left archived; the built-in sample is archived once the real posts exist. Publication dates are spread three days apart, first post newest.
 * Acts as the seeded marketing persona (u_mkt, Maya Lopez). Refused when PAYSETTLE_ENV=production.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db/client";
import { users } from "../src/db/schema";
import { blogPosts } from "../src/db/schema-blog";
import type { Block, Topic } from "../src/lib/blog/blocks";
import { ensureBlogGuards } from "../src/server/blog/guards";
import { ClaimGuardError, createSeedPost, postsBySlug, setStatus, updatePost } from "../src/server/blog/service";
import { stable } from "../src/server/blog/diff";
import type { Actor } from "../src/server/types";

if (process.env.PAYSETTLE_ENV === "production") { console.error("Refusing to seed demo data in production."); process.exit(1); }

interface SeedPost { slug: string; title: string; dek: string; topic: Topic; heroSrc?: string; heroAlt?: string; blocks: Block[] }

const PP_AUTH = { title: "PayPal Developer: Authorize a payment and capture funds later", url: "https://developer.paypal.com/docs/checkout/standard/customize/authorization/" };

/** Used only when src/data/blog/posts/index.ts does not exist yet. Facts match src/lib/policy.ts and src/server/control/fees.ts. */
const SAMPLE: SeedPost = {
  slug: "how-paysettle-holds-money-between-milestones",
  title: "How PaySettle holds money between milestones",
  dek: "Where the client's money sits from funding to the last approval, and why long jobs are split into hold windows.",
  topic: "explainer",
  blocks: [
    { id: "t1", type: "tldr", title: "In short", claimStatus: "product", items: [
      "The client funds each tranche through PayPal; the money is held, not paid out, until the client approves a milestone.",
      "Long jobs are split into tranches of at most 26 days on rail A and 25 days on rail B, so no hold outlives its window.",
      "The platform fee is charged only on amounts released to the provider.",
    ] },
    { id: "h1", type: "heading", level: 2, text: "Funding is a hold, not a payment" },
    { id: "p1", type: "text", claimStatus: "product", sources: [PP_AUTH], body: "When the client funds a tranche, PayPal authorizes the amount and holds it. Nothing reaches the provider yet. Each milestone has evidence the parties agreed before signing; when the provider submits it and the client approves, that milestone's amount is captured and released.\n\nIf the client and provider disagree, the disputed amount stays held while a human mediator decides. AI can summarise the evidence, but it never releases or refunds money." },
    { id: "h2", type: "heading", level: 2, text: "A worked example" },
    { id: "f1", type: "moneyFlow", totalCents: 500_000, releasedBps: 6_000, refundedBps: 0, feeBps: 250, interactive: true, claimStatus: "illustrative", caption: "A $5,000.00 tranche after the first two milestones (60%) are approved." },
    { id: "tl", type: "trancheTimeline", totalDays: 40, rail: "A1", claimStatus: "product", caption: "A 40-day job on rail A1 becomes two hold windows." },
    { id: "c1", type: "cta", title: "See it with simulated money", body: "Run a full contract in the Judge Playground.", label: "Open the playground", href: "/playground" },
  ],
};

async function loadPosts(): Promise<{ posts: SeedPost[]; source: string }> {
  const file = path.resolve(process.cwd(), "src/data/blog/posts/index.ts");
  if (!existsSync(file)) return { posts: [SAMPLE], source: "built-in sample (src/data/blog/posts/index.ts not found)" };
  const mod = (await import(pathToFileURL(file).href)) as { POSTS?: SeedPost[] };
  if (!Array.isArray(mod.POSTS) || mod.POSTS.length === 0) return { posts: [SAMPLE], source: "built-in sample (POSTS is empty)" };
  return { posts: mod.POSTS, source: "src/data/blog/posts/index.ts" };
}

const asInput = (p: SeedPost) => ({ slug: p.slug, title: p.title, dek: p.dek, topic: p.topic, blocks: p.blocks, heroSrc: p.heroSrc ?? null, heroAlt: p.heroAlt ?? null, seo: null });

async function main() {
  await ensureBlogGuards(db);
  const [author] = await db.select({ id: users.id, role: users.role, name: users.name }).from(users).where(eq(users.id, "u_mkt")).limit(1);
  if (!author) throw new Error("The marketing persona u_mkt is missing. Run scripts/seed.ts first.");
  const actor: Actor = { id: author.id, role: author.role, name: author.name };
  const { posts, source } = await loadPosts();
  console.log(`seed-blog: ${posts.length} post(s) from ${source}`);
  const existing = await postsBySlug(posts.map((p) => p.slug));
  const failed: string[] = [];
  const now = Date.now();

  for (const [i, p] of posts.entries()) {
    try {
      const row = existing.get(p.slug);
      let id: string;
      if (!row) { id = await createSeedPost(actor, asInput(p)); console.log(`  + ${p.slug}`); }
      else {
        id = row.id;
        const same = row.title === p.title && row.dek === p.dek && row.topic === p.topic && (row.heroSrc ?? null) === (p.heroSrc ?? null) && (row.heroAlt ?? null) === (p.heroAlt ?? null) && stable(row.blocks) === stable(p.blocks);
        if (!same) { const v = await updatePost(actor, id, asInput(p), row.version); console.log(`  ~ ${p.slug} (now version ${v.version})`); }
        else console.log(`  = ${p.slug}`);
        if (row.status === "ARCHIVED") { console.log(`    left archived (an editor archived it)`); continue; }
      }
      const wasLive = row?.status === "PUBLISHED";
      if (!wasLive) {
        await setStatus(actor, id, "PUBLISHED");
        await db.update(blogPosts).set({ publishedAt: new Date(now - i * 3 * 86_400_000) }).where(eq(blogPosts.id, id));
        console.log(`    published`);
      }
    } catch (e) {
      failed.push(p.slug);
      if (e instanceof ClaimGuardError) { console.error(`  ! ${p.slug}: claim guard refused publishing:`); e.problems.forEach((x) => console.error(`      - [${x.blockId ?? "post"}] ${x.message}`)); }
      else console.error(`  ! ${p.slug}: ${(e as Error).message}`);
    }
  }
  /* The built-in sample only stands in until the real posts exist: once they do, take it off the site (kept, archived). */
  if (!posts.some((p) => p.slug === SAMPLE.slug)) {
    const stand = (await postsBySlug([SAMPLE.slug])).get(SAMPLE.slug);
    if (stand && stand.origin === "SEED" && stand.status !== "ARCHIVED") { await setStatus(actor, stand.id, "ARCHIVED"); console.log(`  - ${SAMPLE.slug} archived (real posts are seeded now)`); }
  }
  if (failed.length) { console.error(`seed-blog: ${failed.length} post(s) not published: ${failed.join(", ")}`); process.exitCode = 1; }
  else console.log("seed-blog: done");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
