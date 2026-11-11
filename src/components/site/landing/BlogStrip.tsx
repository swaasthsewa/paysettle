/* The landing page's strip of the three newest published posts. Server component; renders nothing when the
 * blog service is not built yet, the database cannot be reached, or nothing is published. */
import Link from "next/link";
import { PostCard } from "@/components/blog/PostCard";
import { listPublished, type PostSummary } from "@/server/blog";
import "@/styles/blog.css";

export async function BlogStrip({ count = 3 }: { count?: number }) {
  let posts: PostSummary[] = [];
  try { posts = (await listPublished()).slice(0, count); } catch { return null; }
  if (!posts.length) return null;
  return (
    <section className="lp-scene" aria-labelledby="lp-blog-h" data-scene="blog">
      <div className="lp-wrap">
        <div className="bl-strip-head">
          <div>
            <p className="lp-kicker">From the blog</p>
            <h2 id="lp-blog-h">How it works, one question at a time</h2>
          </div>
          <Link className="btn" href="/blog">All posts</Link>
        </div>
        <div className="bl-grid">{posts.map((p) => <PostCard key={p.id} post={p} />)}</div>
      </div>
    </section>
  );
}
export default BlogStrip;
