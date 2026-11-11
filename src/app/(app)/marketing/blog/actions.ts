"use server";
/**
 * Blog studio — server actions. Each one re-reads the session (never trusts the client), validates its arguments with
 * zod, calls the blog service (which checks blog.write / blog.publish and writes the audit chain) and returns a plain result
 * the editor can announce. Requirement ids: P10 (claim guard result returned as a list), P3 (AI drafts stay DRAFT).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/session";
import { TOPICS, type Block, type Topic } from "@/lib/blog/blocks";
import { DomainError, type Actor } from "@/server/types";
import { createPost, deletePost, listRevisions, setStatus, updatePost, type PostInput, type PostStatus, type Revision } from "@/server/blog";
import { ClaimGuardError, BlogInputError, draftWithAiDetailed } from "@/server/blog/service";
import { OUTLINE_MARK, type Problem } from "@/server/blog/lint";

async function me(): Promise<Actor> { const v = await requireViewer(); return { id: v.id, role: v.role, name: v.name }; }
const PostId = z.string().regex(/^post_[a-z0-9]{6,40}$/, "Unknown post.");
const refresh = (slug?: string) => { revalidatePath("/marketing/blog", "layout"); revalidatePath("/blog", "layout"); if (slug) revalidatePath(`/blog/${slug}`); };

export type ActionResult =
  | { ok: true; message: string; version?: number }
  | { ok: false; code: string; message: string; problems?: Problem[]; issues?: { path: (string | number)[]; message: string }[] };

function failure(e: unknown): ActionResult {
  if (e instanceof ClaimGuardError) return { ok: false, code: e.code, message: `Not published: ${e.problems.length} ${e.problems.length === 1 ? "thing needs" : "things need"} fixing first.`, problems: e.problems };
  if (e instanceof BlogInputError) return { ok: false, code: e.code, message: e.message, issues: e.issues };
  if (e instanceof DomainError) return { ok: false, code: e.code, message: e.message };
  if (e instanceof z.ZodError) return { ok: false, code: "BAD_INPUT", message: e.issues[0]?.message ?? "Some fields are not valid." };
  console.error("blog studio action failed", e);
  return { ok: false, code: "ERROR", message: "That did not work and nothing was changed. Try again; if it keeps failing, reload the page." };
}

/* ─── new post forms (useActionState) ─── */

export interface FormState { error?: string; fieldErrors?: Record<string, string> }
const NewManual = z.object({
  title: z.string().trim().min(3, "Give the post a title of at least 3 characters.").max(140, "Keep the title under 140 characters."),
  dek: z.string().trim().max(300, "Keep the summary under 300 characters."),
  topic: z.enum(TOPICS, "Pick a topic."),
});
const fieldErrors = (e: z.ZodError) => Object.fromEntries(e.issues.map((i) => [String(i.path[0] ?? "form"), i.message]));

export async function createManualAction(_prev: FormState, f: FormData): Promise<FormState> {
  const a = await me();
  const p = NewManual.safeParse({ title: f.get("title") ?? "", dek: f.get("dek") ?? "", topic: f.get("topic") ?? "" });
  if (!p.success) return { error: "Check the highlighted fields.", fieldErrors: fieldErrors(p.error) };
  let id: string;
  try {
    const blocks: Block[] = [
      { id: "intro", type: "tldr", title: "In short", items: [`${OUTLINE_MARK} The one point a reader should remember.`] },
      { id: "s1", type: "heading", level: 2, text: "First section" },
      { id: "p1", type: "text", body: `${OUTLINE_MARK} Write the first paragraph here.` },
    ];
    id = await createPost(a, { title: p.data.title, dek: p.data.dek, topic: p.data.topic as Topic, blocks });
  } catch (e) { return { error: failure(e).message }; }
  refresh();
  redirect(`/marketing/blog/${id}?ok=${encodeURIComponent("Draft created. Write the sections, then save.")}`);
}

export async function draftAiAction(_prev: FormState, f: FormData): Promise<FormState> {
  const a = await me();
  const raw = { title: String(f.get("title") ?? ""), angle: String(f.get("angle") ?? ""), topic: String(f.get("topic") ?? "") as Topic };
  let to: string;
  try {
    const r = await draftWithAiDetailed(a, raw);
    const msg = r.usedAi
      ? `AI draft saved as a draft (${r.model}). Check every figure and source before you publish; AI never publishes.`
      : `${r.reason ?? "AI was not available."} Fill in each section before you publish.`;
    to = `/marketing/blog/${r.id}?${r.usedAi ? "ok" : "warn"}=${encodeURIComponent(msg.slice(0, 300))}`;
  } catch (e) {
    if (e instanceof BlogInputError) return { error: "Check the highlighted fields.", fieldErrors: Object.fromEntries(e.issues.map((i) => [String(i.path[0] ?? "form"), i.message])) };
    return { error: failure(e).message };
  }
  refresh();
  redirect(to);
}

/* ─── editor actions (called with arguments from the client editor) ─── */

const SaveArgs = z.object({
  id: PostId,
  version: z.number().int().min(1),
  input: z.object({
    slug: z.string().max(200).optional(), title: z.string().max(400), dek: z.string().max(1000), topic: z.string(),
    blocks: z.array(z.unknown()).max(200), heroSrc: z.string().max(300).nullable().optional(), heroAlt: z.string().max(600).nullable().optional(),
    seo: z.object({ title: z.string().max(300).optional(), description: z.string().max(600).optional() }).nullable().optional(),
  }),
});

export async function saveAction(id: string, version: number, input: unknown): Promise<ActionResult> {
  try {
    const a = await me();
    const args = SaveArgs.parse({ id, version, input });
    const r = await updatePost(a, args.id, args.input as unknown as PostInput, args.version);
    refresh(args.input.slug);
    return { ok: true, version: r.version, message: r.version === args.version ? "No changes to save." : `Saved as version ${r.version}.` };
  } catch (e) { return failure(e); }
}

const STATUS_DONE: Record<PostStatus, string> = { DRAFT: "Moved back to draft. It is no longer on the public blog.", REVIEW: "Sent for review.", PUBLISHED: "Published. The post is live on /blog.", ARCHIVED: "Archived. It is no longer on the public blog." };
export async function statusAction(id: string, status: PostStatus): Promise<ActionResult> {
  try {
    const a = await me();
    const args = z.object({ id: PostId, status: z.enum(["DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"]) }).parse({ id, status });
    await setStatus(a, args.id, args.status);
    refresh();
    return { ok: true, message: STATUS_DONE[args.status] };
  } catch (e) { return failure(e); }
}

export async function deleteAction(id: string): Promise<ActionResult> {
  let ok = false;
  try {
    const a = await me();
    await deletePost(a, PostId.parse(id));
    ok = true;
  } catch (e) { return failure(e); }
  refresh();
  if (ok) redirect(`/marketing/blog?ok=${encodeURIComponent("Draft deleted. Its revision history is kept.")}`);
  return { ok: true, message: "Deleted." };
}

export async function revisionsAction(id: string): Promise<Revision[]> {
  const a = await me();
  return listRevisions(a, PostId.parse(id));
}
