/* Blog structured data (JSON-LD) and URLs. Small, dependency-free objects that the public pages inline into
 * <script type="application/ld+json">. The site origin comes from APP_URL (same variable the rest of the app uses).
 * jsonLd() escapes "<", ">" and "&" so a title can never close the script element (P11).
 */
import { plainText, TOPIC_LABEL, type Block } from "./blocks";
import type { Post, PostSummary } from "@/server/blog";

export const SITE_NAME = "PaySettle";
export const BLOG_NAME = "PaySettle blog";
export const BLOG_DESCRIPTION = "How milestone escrow works in practice: PayPal hold windows, checkable proof, sealed-bid disputes, reconciliation and the limits we hold ourselves to.";

export function siteUrl(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
export const abs = (path: string) => `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
export const postPath = (slug: string) => `/blog/${encodeURIComponent(slug)}`;
export const postUrl = (slug: string) => abs(postPath(slug));

/** Serialise for an inline JSON-LD script: valid JSON, and no character that could end the element. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** A meta description: the post's own SEO text, else its dek, cut on a word boundary at 160 characters. */
export function description(p: Pick<Post, "dek" | "seo">): string {
  const d = (p.seo?.description ?? p.dek).replace(/\s+/g, " ").trim();
  if (d.length <= 160) return d;
  const cut = d.slice(0, 157);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 120))}…`;
}

const publisher = () => ({ "@type": "Organization", name: SITE_NAME, url: siteUrl() });

export function articleJsonLd(p: Post): Record<string, unknown> {
  const words = plainText(p.blocks).split(/\s+/).filter(Boolean).length;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: (p.seo?.title ?? p.title).slice(0, 110),
    description: description(p),
    url: postUrl(p.slug),
    mainEntityOfPage: { "@type": "WebPage", "@id": postUrl(p.slug) },
    ...(p.publishedAt ? { datePublished: p.publishedAt } : {}),
    dateModified: p.updatedAt,
    author: { "@type": "Organization", name: p.authorName ? `${p.authorName}, ${SITE_NAME}` : `The ${SITE_NAME} team` },
    publisher: publisher(),
    articleSection: TOPIC_LABEL[p.topic],
    inLanguage: "en",
    wordCount: words,
    timeRequired: `PT${p.readingMinutes}M`,
    ...(p.heroSrc ? { image: abs(p.heroSrc) } : {}),
  };
}

export function faqJsonLd(blocks: Block[]): Record<string, unknown> | null {
  const qa = blocks.flatMap((b) => (b.type === "faq" ? b.items : []));
  if (!qa.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
  };
}

export function breadcrumbJsonLd(p: Pick<Post, "slug" | "title" | "topic">): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: abs("/") },
      { "@type": "ListItem", position: 2, name: "Blog", item: abs("/blog") },
      { "@type": "ListItem", position: 3, name: TOPIC_LABEL[p.topic], item: abs(`/blog?topic=${p.topic}`) },
      { "@type": "ListItem", position: 4, name: p.title, item: postUrl(p.slug) },
    ],
  };
}

export function blogJsonLd(items: PostSummary[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: BLOG_NAME,
    description: BLOG_DESCRIPTION,
    url: abs("/blog"),
    publisher: publisher(),
    blogPost: items.slice(0, 20).map((s) => ({
      "@type": "BlogPosting",
      headline: s.title,
      url: postUrl(s.slug),
      ...(s.publishedAt ? { datePublished: s.publishedAt } : {}),
    })),
  };
}

/* ── sitemap and feed ── */

/** Public pages of the site (src/app/(site)); /trust and /mediators are included. Sign-in and app screens are not listed. */
export const SITE_PAGES: { path: string; freq: "weekly" | "monthly" | "yearly"; priority: number }[] = [
  { path: "/", freq: "weekly", priority: 1 },
  { path: "/how-it-works", freq: "monthly", priority: 0.8 },
  { path: "/for-clients", freq: "monthly", priority: 0.7 },
  { path: "/for-providers", freq: "monthly", priority: 0.7 },
  { path: "/pricing", freq: "monthly", priority: 0.7 },
  { path: "/security", freq: "monthly", priority: 0.6 },
  { path: "/trust", freq: "monthly", priority: 0.6 },
  { path: "/mediators", freq: "monthly", priority: 0.5 },
  { path: "/blog", freq: "weekly", priority: 0.7 },
  { path: "/waitlist", freq: "monthly", priority: 0.5 },
  { path: "/privacy", freq: "yearly", priority: 0.3 },
  { path: "/terms", freq: "yearly", priority: 0.3 },
];

/* RSS 2.0 (src/app/rss.xml/route.ts). */
export const xmlEscape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string)
    // characters XML 1.0 does not allow
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");

export function rssXml(posts: PostSummary[], now = new Date()): string {
  const items = posts.slice(0, 30).map((p) => [
    "    <item>",
    `      <title>${xmlEscape(p.title)}</title>`,
    `      <link>${xmlEscape(postUrl(p.slug))}</link>`,
    `      <guid isPermaLink="true">${xmlEscape(postUrl(p.slug))}</guid>`,
    `      <description>${xmlEscape(p.dek)}</description>`,
    `      <category>${xmlEscape(TOPIC_LABEL[p.topic])}</category>`,
    p.publishedAt ? `      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>` : "",
    "    </item>",
  ].filter(Boolean).join("\n"));
  const last = posts.find((p) => p.publishedAt)?.publishedAt;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xmlEscape(BLOG_NAME)}</title>`,
    `    <link>${xmlEscape(abs("/blog"))}</link>`,
    `    <description>${xmlEscape(BLOG_DESCRIPTION)}</description>`,
    "    <language>en</language>",
    `    <atom:link href="${xmlEscape(abs("/rss.xml"))}" rel="self" type="application/rss+xml" />`,
    `    <lastBuildDate>${(last ? new Date(last) : now).toUTCString()}</lastBuildDate>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

