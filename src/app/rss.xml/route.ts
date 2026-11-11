/* /rss.xml: RSS 2.0 feed of published blog posts (newest 30). Text is XML-escaped; an empty channel is returned
 * when the blog service is not built yet or the database cannot be reached. */
import { rssXml } from "@/lib/blog/seo";
import { listPublished, type PostSummary } from "@/server/blog";

export const dynamic = "force-dynamic";

export async function GET() {
  let posts: PostSummary[] = [];
  try { posts = await listPublished(); } catch { posts = []; }
  return new Response(rssXml(posts), { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=600" } });
}
