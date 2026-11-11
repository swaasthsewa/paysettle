/* /sitemap.xml: the public site pages plus every published blog post. When the blog service is not built yet
 * (NotBuilt) or the database cannot be reached, the static pages are still listed. */
import type { MetadataRoute } from "next";
import { SITE_PAGES, abs, postPath } from "@/lib/blog/seo";
import { listPublished, type PostSummary } from "@/server/blog";

export const dynamic = "force-dynamic";

async function publishedOrEmpty(): Promise<PostSummary[]> {
  try { return await listPublished(); } catch { return []; }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await publishedOrEmpty();
  const newest = posts.reduce<string | null>((a, p) => (p.publishedAt && (!a || p.publishedAt > a) ? p.publishedAt : a), null);
  return [
    ...SITE_PAGES.map((p) => ({ url: abs(p.path), changeFrequency: p.freq, priority: p.priority, ...(p.path === "/blog" && newest ? { lastModified: new Date(newest) } : {}) })),
    ...posts.map((p) => ({ url: abs(postPath(p.slug)), changeFrequency: "monthly" as const, priority: 0.6, ...(p.publishedAt ? { lastModified: new Date(p.publishedAt) } : {}) })),
  ];
}
