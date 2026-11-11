/** Blog studio — list of every post (drafts, reviews, published, archived) with status counts. Roles with blog.write. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { can } from "@/lib/rbac";
import { homeFor, requireViewer } from "@/lib/session";
import { TOPIC_LABEL } from "@/lib/blog/blocks";
import { listStudio } from "@/server/blog/service";
import type { PostStatus } from "@/server/blog";
import { Flash, Head, Stat, one, type SP } from "@/components/console/parts";
import { DataTable } from "@/components/console/DataTable";
import { ORIGIN_LABEL, STATUS_CHIP } from "@/components/blog-studio/model";
import "@/styles/blog-studio.css";

export const metadata = { title: "Blog studio" };


export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer();
  if (!can(v.role, "blog.write")) redirect(homeFor(v.role));
  const sp = await searchParams;
  const posts = await listStudio({ id: v.id, role: v.role, name: v.name });
  const count = (s: PostStatus) => posts.filter((p) => p.status === s).length;
  const rows = posts.map((p) => ({
    id: p.id,
    title: { href: `/marketing/blog/${p.id}`, label: p.title },
    topic: TOPIC_LABEL[p.topic],
    status: STATUS_CHIP[p.status],
    origin: ORIGIN_LABEL[p.origin],
    updated: p.updatedAt,
    version: p.version,
    minutes: p.readingMinutes,
    author: p.authorName ?? "—",
    edit: { href: `/marketing/blog/${p.id}`, label: "Edit" },
    live: p.status === "PUBLISHED" ? { href: `/blog/${p.slug}`, label: "View on site" } : "—",
  }));
  return (
    <>
      <Head title="Blog studio" sub="Drafts stay private until someone with publishing rights presses Publish. Every figure needs a source or an Illustrative / How PaySettle works label before a post can go live.">
        <div className="row">
          <Link className="btn btn-g btn-sm" href="/marketing/blog/new">New post</Link>
          <Link className="btn btn-sm" href="/marketing/blog/new#brief">Draft from a brief</Link>
          <Link className="btn btn-sm btn-gh" href="/blog">Public blog</Link>
        </div>
      </Head>
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <div className="cx-stats">
        <Stat label="Published" value={count("PUBLISHED")} tone={count("PUBLISHED") ? "ok" : undefined} detail="live on /blog" />
        <Stat label="Drafts" value={count("DRAFT")} detail="private" />
        <Stat label="In review" value={count("REVIEW")} tone={count("REVIEW") ? "warn" : undefined} detail="waiting for a publisher" />
        <Stat label="Archived" value={count("ARCHIVED")} detail="off the site, kept" />
      </div>
      <section className="c">
        <DataTable
          caption="Blog posts"
          getRowId="id"
          rowData={rows}
          initialSort={{ field: "updated", dir: "desc" }}
          emptyText="No posts yet. Start one with New post, or draft from a brief."
          columnDefs={[
            { field: "title", headerName: "Title", type: "link", width: 340 },
            { field: "topic", headerName: "Topic", filter: true },
            { field: "status", headerName: "Status", type: "chip", filter: true },
            { field: "updated", headerName: "Updated", type: "date" },
            { field: "version", headerName: "Version", type: "number", width: 100 },
            { field: "minutes", headerName: "Read (min)", type: "number", width: 110, hide: true },
            { field: "origin", headerName: "Started as", filter: true, hide: true },
            { field: "author", headerName: "Author", hide: true },
            { field: "edit", headerName: "Edit", type: "link", width: 90, sortable: false },
            { field: "live", headerName: "Public page", type: "link", width: 140, sortable: false },
          ]}
        />
      </section>
    </>
  );
}
