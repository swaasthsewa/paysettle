/**
 * GET /api/blog — published post summaries as JSON, newest first. Optional ?topic= (one of TOPICS).
 * Public and read-only: no session, no cookies set, nothing about the reader is stored or logged (F2.12).
 * Drafts, reviews and archived posts are never returned; summaries carry no author ids.
 */
import { NextResponse } from "next/server";
import { TOPICS, type Topic } from "@/lib/blog/blocks";
import { listPublished } from "@/server/blog";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const topic = new URL(req.url).searchParams.get("topic");
  if (topic !== null && topic !== "" && !(TOPICS as readonly string[]).includes(topic)) {
    return NextResponse.json({ error: "unknown_topic", message: `Unknown topic. Use one of: ${TOPICS.join(", ")}.`, topics: TOPICS }, { status: 400 });
  }
  try {
    const posts = await listPublished(topic ? { topic: topic as Topic } : {});
    return NextResponse.json(
      { posts: posts.map((p) => ({ slug: p.slug, title: p.title, dek: p.dek, topic: p.topic, publishedAt: p.publishedAt, readingMinutes: p.readingMinutes, heroSrc: p.heroSrc, heroAlt: p.heroAlt, url: `/blog/${p.slug}` })) },
      { headers: { "cache-control": "public, max-age=60, s-maxage=300" } },
    );
  } catch {
    return NextResponse.json({ error: "unavailable", message: "The blog list is not available right now. Try again in a minute." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
