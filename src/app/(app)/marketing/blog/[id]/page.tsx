/** Blog studio — edit one post (block list, inspector, live preview, claim guard, versions). Roles with blog.write. */
import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/rbac";
import { homeFor, requireViewer } from "@/lib/session";
import { getStudioPost, listRevisions } from "@/server/blog/service";
import { one, type SP } from "@/components/console/parts";
import { Editor } from "@/components/blog-studio/Editor";
import "@/styles/blog-studio.css";

export const metadata = { title: "Edit blog post" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const v = await requireViewer();
  if (!can(v.role, "blog.write")) redirect(homeFor(v.role));
  const { id } = await params;
  if (!/^post_[a-z0-9]{6,40}$/.test(id)) notFound();
  const actor = { id: v.id, role: v.role, name: v.name };
  const [post, revisions, sp] = await Promise.all([getStudioPost(actor, id), listRevisions(actor, id), searchParams]);
  if (!post) notFound();
  return (
    <>
      <h1 className="sr-only">Edit “{post.title}”</h1>
      <Editor
        key={post.id}
        initial={{
          id: post.id, slug: post.slug, title: post.title, dek: post.dek, topic: post.topic, blocks: post.blocks,
          heroSrc: post.heroSrc ?? "", heroAlt: post.heroAlt ?? "", seoTitle: post.seo?.title ?? "", seoDescription: post.seo?.description ?? "",
        }}
        status={post.status} version={post.version} origin={post.origin} publishedAt={post.publishedAt} authorName={post.authorName} updatedAt={post.updatedAt}
        revisions={revisions} canPublish={can(v.role, "blog.publish")}
        flash={{ ok: one(sp.ok) || undefined, warn: one(sp.warn) || undefined, err: one(sp.err) || undefined }}
      />
    </>
  );
}
