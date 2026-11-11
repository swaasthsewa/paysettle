/* One post on the blog index, the related list and the landing strip. The whole card is one link whose name
 * is the title; topic, reading time and date follow as plain text. The art is drawn here (two strands meeting over
 * a row of milestones, the site's motif), seeded by the slug: no stock images, decorative only. Server-safe. */
import Link from "next/link";
import { TOPIC_LABEL } from "@/lib/blog/blocks";
import { isoDate, niceDate } from "@/lib/blog/format";
import type { PostSummary } from "@/server/blog";

function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Deterministic decorative art for a post: same slug, same picture on server and client. */
function lcg(start: number): () => number {
  let x = start;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}

export function PostArt({ slug, topic }: { slug: string; topic: PostSummary["topic"] }) {
  const rnd = lcg(seed(slug));
  const steps = 5 + Math.floor(rnd() * 4);
  const meet = 150 + rnd() * 100;
  const a = 18 + rnd() * 30, b = 102 - rnd() * 30;
  const dots = Array.from({ length: steps }, (_, i) => ({ cx: meet + ((400 - meet - 24) * (i + 1)) / (steps + 0.5), big: rnd() > 0.62 }));
  return (
    <svg className="bl-art" data-topic={topic} viewBox="0 0 400 120" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="120" className="bl-art-bg" />
      <path d={`M-10 ${a} C ${meet * 0.45} ${a}, ${meet * 0.6} 60, ${meet} 60`} className="bl-art-a" />
      <path d={`M-10 ${b} C ${meet * 0.45} ${b}, ${meet * 0.6} 60, ${meet} 60`} className="bl-art-b" />
      <path d={`M${meet} 60 H410`} className="bl-art-c" />
      {dots.map((d, i) => <circle key={i} cx={d.cx.toFixed(1)} cy="60" r={d.big ? 7 : 4.5} className={d.big ? "bl-art-pay" : "bl-art-gate"} />)}
    </svg>
  );
}

export function PostCard({ post, level = 3, feature = false }: { post: PostSummary; level?: 2 | 3; feature?: boolean }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <article className={`bl-card${feature ? " is-feature" : ""}`}>
      <PostArt slug={post.slug} topic={post.topic} />
      <div className="bl-card-in">
        <p className="bl-card-k">{TOPIC_LABEL[post.topic]}</p>
        <H className="bl-card-t"><Link href={`/blog/${post.slug}`} className="bl-card-link">{post.title}</Link></H>
        <p className="bl-card-d">{post.dek}</p>
        <p className="bl-card-m">
          <span>{post.readingMinutes} min read</span>
          {post.publishedAt && <><span aria-hidden="true"> · </span><time dateTime={isoDate(post.publishedAt)}>{niceDate(post.publishedAt)}</time></>}
        </p>
      </div>
    </article>
  );
}
export default PostCard;
