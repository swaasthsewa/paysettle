/* /blog/[slug] — one published post: reading progress, breadcrumb, head (topic, title, dek, byline, reading
 * time), contents from the headings, the block flow (BlockRenderer + BlogReveal), numbered sources, the claim-label
 * legend, related posts and a call to the Judge Playground. Article, BreadcrumbList and (with a FAQ block) FAQPage
 * JSON-LD. Anything not PUBLISHED is a 404. P10: every figure in a post carries a source or a label. */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BlockRenderer, Footnotes, collectSources, headingsOf } from "@/components/blog/BlockRenderer";
import { PostCard } from "@/components/blog/PostCard";
import { ReadingProgress } from "@/components/blog/ReadingProgress";
import { BlogReveal } from "@/components/blog/Reveal";
import { Toc } from "@/components/blog/Toc";
import { SiteMain } from "@/components/site/parts";
import { CLAIM_META, CLAIM_STATUSES, TOPIC_LABEL } from "@/lib/blog/blocks";
import { isoDate, niceDate } from "@/lib/blog/format";
import { abs, articleJsonLd, breadcrumbJsonLd, description, faqJsonLd, jsonLd, postPath } from "@/lib/blog/seo";
import { scriptNonce } from "@/lib/nonce";
import { getPublishedBySlug, listRelated, type Post } from "@/server/blog";
import "@/styles/blog.css";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

async function load(slug: string): Promise<Post | null> {
  const p = await getPublishedBySlug(slug);
  return p && p.status === "PUBLISHED" ? p : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const p = await load(slug);
  if (!p) return { title: "Post not found", robots: { index: false, follow: true } };
  const title = p.seo?.title ?? p.title;
  const desc = description(p);
  const url = abs(postPath(p.slug));
  return {
    title,
    description: desc,
    alternates: { canonical: url },
    openGraph: {
      type: "article", title, description: desc, url, siteName: "PaySettle",
      publishedTime: p.publishedAt ?? undefined, modifiedTime: p.updatedAt, section: TOPIC_LABEL[p.topic],
      ...(p.heroSrc ? { images: [{ url: abs(p.heroSrc), alt: p.heroAlt ?? "" }] } : {}),
    },
    twitter: { card: p.heroSrc ? "summary_large_image" : "summary", title, description: desc },
  };
}

export default async function PostPage({ params }: Params) {
  const { slug } = await params;
  const post = await load(slug);
  if (!post) notFound();
  const related = await listRelated(post, 3);
  const sources = collectSources(post.blocks);
  const toc = headingsOf(post.blocks);
  const used = CLAIM_STATUSES.filter((c) => post.blocks.some((b) => b.claimStatus === c));
  const faq = faqJsonLd(post.blocks);
  const nonce = await scriptNonce();
  const topic = TOPIC_LABEL[post.topic];

  return (
    <SiteMain>
      <ReadingProgress target="#post" />
      <div className="s-wrap bl-article">
        <nav className="bl-crumb" aria-label="Breadcrumb">
          <ol>
            <li><Link href="/blog">Blog</Link></li>
            <li><Link href={`/blog?topic=${post.topic}`}>{topic}</Link></li>
            <li><span aria-current="page">{post.title}</span></li>
          </ol>
        </nav>

        <div className="bl-layout">
          <article id="post" className="bl-main" aria-labelledby="post-title">
            <header className="bl-head">
              <p className="bl-card-k">{topic}</p>
              <h1 id="post-title">{post.title}</h1>
              <p className="bl-dek">{post.dek}</p>
              <p className="bl-meta">
                <span>By <b>{post.authorName ?? "The PaySettle team"}</b></span>
                {post.publishedAt && <span><time dateTime={isoDate(post.publishedAt)}>{niceDate(post.publishedAt)}</time></span>}
                <span>{post.readingMinutes} min read</span>
              </p>
            </header>

            {post.heroSrc && (
              <figure className="bl-hero">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={post.heroSrc} alt={post.heroAlt ?? ""} />
              </figure>
            )}

            <BlockRenderer blocks={post.blocks} />

            <Footnotes sources={sources} />

            {used.length > 0 && (
              <section className="bl-legend" aria-labelledby="legend-h">
                <h2 id="legend-h">How we label claims</h2>
                <dl>
                  {used.map((c) => (
                    <div key={c} style={{ display: "contents" }}>
                      <dt><span className="bl-claim" data-c={c}>{CLAIM_META[c].label}</span></dt>
                      <dd>{CLAIM_META[c].hint}.</dd>
                    </div>
                  ))}
                </dl>
                <p className="bl-note-small">A figure in this post either links to its source, describes behaviour you can check in the app, or is a worked example with made-up numbers. Nothing here is legal or financial advice.</p>
              </section>
            )}
          </article>

          <aside className="bl-side" aria-label="Contents and next step">
            <Toc items={toc} />
            <div className="bl-side-cta">
              <b>Try it with sandbox money</b>
              Run a contract from blueprint to release in the Judge Playground.
              <div><Link className="btn btn-sm btn-g" href="/playground">Open the playground</Link></div>
            </div>
          </aside>
        </div>

        {related.length > 0 && (
          <section className="bl-related" aria-labelledby="related-h">
            <h2 id="related-h">Keep reading</h2>
            <div className="bl-grid">{related.map((r) => <PostCard key={r.id} post={r} />)}</div>
          </section>
        )}
      </div>

      <section className="s-section" aria-labelledby="post-cta-h">
        <div className="s-wrap">
          <div className="s-cta">
            <h2 id="post-cta-h">See the money move, milestone by milestone</h2>
            <p>The Judge Playground runs ready-made scenarios on sandbox money: a happy path, a photo taken far from the shop, hold-window pressure and a rollover, a dispute, failure drills and an AI agent working over MCP.</p>
            <div className="s-ctas">
              <Link className="btn btn-g s-btn-lg" href="/playground">Open the Judge Playground</Link>
              <Link className="btn s-btn-lg" href="/blog">More posts</Link>
            </div>
          </div>
        </div>
      </section>

      <BlogReveal />
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLd(articleJsonLd(post)) }} />
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbJsonLd(post)) }} />
      {faq && <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLd(faq) }} />}
    </SiteMain>
  );
}
