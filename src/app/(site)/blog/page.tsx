/* /blog — the public blog index: topic filter (?topic=), the newest post featured, the rest as cards, an empty
 * state, and Blog JSON-LD. PUBLISHED posts only (from the blog service). */
import type { Metadata } from "next";
import Link from "next/link";
import { Cta, PageHero, SiteMain } from "@/components/site/parts";
import { PostCard } from "@/components/blog/PostCard";
import { TOPICS, TOPIC_LABEL, type Topic } from "@/lib/blog/blocks";
import { BLOG_DESCRIPTION, BLOG_NAME, abs, blogJsonLd, jsonLd } from "@/lib/blog/seo";
import { scriptNonce } from "@/lib/nonce";
import { listPublished } from "@/server/blog";
import "@/styles/blog.css";

export const dynamic = "force-dynamic";

const topicOf = (v: string | string[] | undefined): Topic | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return (TOPICS as readonly string[]).includes(s ?? "") ? (s as Topic) : undefined;
};

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ topic?: string | string[] }> }): Promise<Metadata> {
  const topic = topicOf((await searchParams).topic);
  const title = topic ? `${TOPIC_LABEL[topic]} · Blog` : "Blog";
  const path = topic ? `/blog?topic=${topic}` : "/blog";
  return {
    title,
    description: BLOG_DESCRIPTION,
    alternates: { canonical: abs(path), types: { "application/rss+xml": [{ url: abs("/rss.xml"), title: BLOG_NAME }] } },
    openGraph: { type: "website", title: `${title} · PaySettle`, description: BLOG_DESCRIPTION, url: abs(path), siteName: "PaySettle" },
  };
}

export default async function BlogIndex({ searchParams }: { searchParams: Promise<{ topic?: string | string[] }> }) {
  const active = topicOf((await searchParams).topic);
  const all = await listPublished();
  const posts = active ? all.filter((p) => p.topic === active) : all;
  const counts = new Map<Topic, number>(TOPICS.map((t) => [t, all.filter((p) => p.topic === t).length]));
  const [first, ...rest] = posts;
  const nonce = await scriptNonce();

  return (
    <SiteMain>
      <PageHero kicker="Blog" title="Notes on paying for work you can check"
        lead="How milestone contracts behave in practice: PayPal hold windows, proof both sides agree on, sealed-bid disputes, reconciliation to the cent, and the limits we set for our own AI.">
        <nav className="bl-filter" aria-label="Filter posts by topic">
          <Link href="/blog" aria-current={!active ? "page" : undefined}>All posts <small>{all.length}</small></Link>
          {TOPICS.map((t) => (
            <Link key={t} href={`/blog?topic=${t}`} aria-current={active === t ? "page" : undefined}>{TOPIC_LABEL[t]} <small>{counts.get(t) ?? 0}</small></Link>
          ))}
        </nav>
      </PageHero>

      <section className="s-section tight" aria-labelledby="bl-list-h">
        <div className="s-wrap">
          <h2 id="bl-list-h" className="bl-sr">{active ? `${TOPIC_LABEL[active]} posts` : "All posts"}</h2>
          {!first ? (
            <div className="bl-empty" role="status">
              <h3>{active ? `No ${TOPIC_LABEL[active].toLowerCase()} posts yet` : "No posts yet"}</h3>
              <p>{active ? "Nothing is published under this topic so far. The other topics have posts you can read now." : "The first posts are on their way. Meanwhile, the live demo shows every step of a contract."}</p>
              {active ? <Link className="btn" href="/blog">See all posts</Link> : <Link className="btn btn-g" href="/login">Try the live demo</Link>}
            </div>
          ) : (
            <>
              <p className="bl-count" aria-live="polite">{posts.length} {posts.length === 1 ? "post" : "posts"}{active ? ` in ${TOPIC_LABEL[active]}` : ""}</p>
              <div className="bl-grid">
                <PostCard post={first} feature={!active} />
                {rest.map((p) => <PostCard key={p.id} post={p} />)}
              </div>
            </>
          )}
        </div>
      </section>

      <Cta />
      {all.length > 0 && <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLd(blogJsonLd(all)) }} />}
    </SiteMain>
  );
}
