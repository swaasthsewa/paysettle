"use client";
/**
 * P10 · P5 blog studio editor: post details, block list, live preview (the public BlockRenderer), inspector, live claim
 * guard, explicit Save (optimistic version; a stale save is refused and explained), status moves (review, publish, unpublish,
 * archive, restore), delete for drafts, and the revision history with block diffs. Unsaved edits are kept in the tab and
 * guarded with a leave-page warning. Ctrl/Cmd+S saves.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { TOPICS, TOPIC_LABEL, type Block, type BlockType, type Topic } from "@/lib/blog/blocks";
import type { PostStatus, Revision } from "@/server/blog";
import { publishProblems, type Problem } from "@/server/blog/lint";
import { deleteAction, revisionsAction, saveAction, statusAction, type ActionResult } from "@/app/(app)/marketing/blog/actions";
import { BlockList } from "./BlockList";
import { Inspector } from "./Inspector";
import { GuardPanel } from "./GuardPanel";
import { History } from "./History";
import { Preview } from "./Preview";
import { AreaField, SelectField, TextField } from "./fields";
import { blankBlock, blockIssues, cloneBlock, ORIGIN_LABEL, STATUS_CHIP, toInput, type EditablePost } from "./model";

export interface EditorProps {
  initial: EditablePost;
  status: PostStatus; version: number; origin: keyof typeof ORIGIN_LABEL; publishedAt: string | null; authorName: string | null; updatedAt: string;
  revisions: Revision[]; canPublish: boolean; flash: { ok?: string; warn?: string; err?: string };
}

type Note = { tone: "ok" | "warn" | "danger"; text: string } | null;
const snapshot = (p: EditablePost) => JSON.stringify(toInput(p));

export function Editor(props: EditorProps) {
  const router = useRouter();
  const [post, setPost] = useState<EditablePost>(props.initial);
  const [saved, setSaved] = useState(() => snapshot(props.initial));
  const [version, setVersion] = useState(props.version);
  const [status, setStatusState] = useState<PostStatus>(props.status);
  const [revisions, setRevisions] = useState(props.revisions);
  const [selected, setSelected] = useState<string | null>(props.initial.blocks[0]?.id ?? null);
  const [note, setNote] = useState<Note>(props.flash.err ? { tone: "danger", text: props.flash.err } : props.flash.warn ? { tone: "warn", text: props.flash.warn } : props.flash.ok ? { tone: "ok", text: props.flash.ok } : null);
  const [serverProblems, setServerProblems] = useState<Problem[] | null>(null);
  const [stale, setStale] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [undo, setUndo] = useState<{ block: Block; index: number } | null>(null);
  const [pending, start] = useTransition();
  const ids = useId();
  const noteRef = useRef<HTMLDivElement>(null);

  const dirty = snapshot(post) !== saved;
  const invalid = useMemo(() => post.blocks.map((b) => ({ blockId: b.id, count: blockIssues(b).length })).filter((x) => x.count > 0), [post.blocks]);
  const validBlocks = useMemo(() => post.blocks.filter((b) => !invalid.some((x) => x.blockId === b.id)), [post.blocks, invalid]);
  const problems = useMemo(() => {
    const i = toInput(post);
    return publishProblems({ title: i.title, dek: i.dek, blocks: validBlocks, heroSrc: i.heroSrc, heroAlt: i.heroAlt, seo: i.seo });
  }, [post, validBlocks]);
  const flagged = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of invalid) m.set(x.blockId, x.count);
    for (const p of problems) if (p.blockId) m.set(p.blockId, (m.get(p.blockId) ?? 0) + 1);
    return m;
  }, [invalid, problems]);
  const index = post.blocks.findIndex((b) => b.id === selected);
  const block = index >= 0 ? post.blocks[index] : null;

  const announce = (n: Note) => { setNote(n); requestAnimationFrame(() => noteRef.current?.focus()); };
  const patch = (p: Partial<EditablePost>) => setPost((x) => ({ ...x, ...p }));
  const setBlocks = (f: (b: Block[]) => Block[]) => setPost((x) => ({ ...x, blocks: f(x.blocks) }));

  /* block operations */
  const add = (t: BlockType) => { const nb = blankBlock(t); setBlocks((bs) => { const at = index >= 0 ? index + 1 : bs.length; return [...bs.slice(0, at), nb, ...bs.slice(at)]; }); setSelected(nb.id); };
  const move = (id: string, d: -1 | 1) => setBlocks((bs) => { const i = bs.findIndex((b) => b.id === id), j = i + d; if (i < 0 || j < 0 || j >= bs.length) return bs; const n = [...bs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const duplicate = (id: string) => { const i = post.blocks.findIndex((b) => b.id === id); if (i < 0) return; const c = cloneBlock(post.blocks[i]); setBlocks((bs) => [...bs.slice(0, i + 1), c, ...bs.slice(i + 1)]); setSelected(c.id); };
  const remove = (id: string) => {
    const i = post.blocks.findIndex((b) => b.id === id);
    if (i < 0 || post.blocks.length <= 1) return;
    setUndo({ block: post.blocks[i], index: i });
    setBlocks((bs) => bs.filter((b) => b.id !== id));
    setSelected(post.blocks[i + 1]?.id ?? post.blocks[i - 1]?.id ?? null);
  };
  const restoreRemoved = () => { if (!undo) return; const u = undo; setBlocks((bs) => [...bs.slice(0, u.index), u.block, ...bs.slice(u.index)]); setSelected(u.block.id); setUndo(null); };
  const replace = (b: Block) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? b : x)));

  /* server calls */
  const afterResult = (r: ActionResult, okText?: string) => {
    if (r.ok) { setServerProblems(null); announce({ tone: "ok", text: okText ?? r.message }); return true; }
    if (r.code === "STALE") setStale(true);
    if (r.problems) setServerProblems(r.problems);
    announce({ tone: r.code === "CLAIM_GUARD" ? "warn" : "danger", text: r.message });
    return false;
  };
  const save = useCallback(() => {
    if (invalid.length) { announce({ tone: "warn", text: `Fix ${invalid.length} block${invalid.length === 1 ? "" : "s"} with field errors before saving (see the claim guard).` }); return; }
    const snap = snapshot(post), input = toInput(post);
    start(async () => {
      const r = await saveAction(post.id, version, input);
      if (afterResult(r) && r.ok && r.version) {
        setVersion(r.version); setSaved(snap); setUndo(null);
        setRevisions(await revisionsAction(post.id).catch(() => revisions));
      }
    });
  }, [post, version, invalid.length, revisions]); // eslint-disable-line react-hooks/exhaustive-deps

  const move_ = (s: PostStatus, okText?: string) => start(async () => {
    const r = await statusAction(post.id, s);
    if (afterResult(r, okText)) { setStatusState(s); router.refresh(); }
  });
  const del = () => start(async () => { const r = await deleteAction(post.id); if (!r.ok) afterResult(r); });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!pending) save(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, pending]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const chip = STATUS_CHIP[status];
  const publishBlocked = dirty ? "Save your changes first." : problems.length || invalid.length ? "Fix the claim guard list first." : !props.canPublish ? "You do not have publishing rights." : "";
  const live = status === "PUBLISHED";

  return (
    <div className="bs-editor">
      <header className="bs-top">
        <div className="bs-top-l">
          <Link className="btn btn-sm btn-gh" href="/marketing/blog">← All posts</Link>
          <span className="chip" data-b={chip.tone}>{chip.label}</span>
          <span className="small muted">Version {version}{dirty ? " · unsaved changes" : " · saved"} · {ORIGIN_LABEL[props.origin]}{props.authorName ? ` · by ${props.authorName}` : ""}</span>
        </div>
        <div className="bs-top-r" role="group" aria-label="Post actions">
          {live && <Link className="btn btn-sm btn-gh" href={`/blog/${post.slug}`} target="_blank" rel="noopener">View on site<span className="sr-only"> (opens in a new tab)</span></Link>}
          <button type="button" className="btn btn-sm btn-g" onClick={save} disabled={pending || !dirty} aria-keyshortcuts="Control+S Meta+S">{pending ? "Working…" : dirty ? "Save" : "Saved"}</button>
          {status === "DRAFT" && <button type="button" className="btn btn-sm" disabled={pending || dirty} onClick={() => move_("REVIEW")}>Send for review</button>}
          {(status === "DRAFT" || status === "REVIEW") && <button type="button" className="btn btn-sm" disabled={pending || !!publishBlocked} aria-describedby={`${ids}-pubwhy`} onClick={() => move_("PUBLISHED")}>Publish</button>}
          {status === "REVIEW" && <button type="button" className="btn btn-sm btn-gh" disabled={pending} onClick={() => move_("DRAFT", "Moved back to draft.")}>Back to draft</button>}
          {live && <button type="button" className="btn btn-sm" disabled={pending || !props.canPublish} onClick={() => move_("DRAFT")}>Unpublish</button>}
          {status !== "ARCHIVED" && <button type="button" className="btn btn-sm btn-gh" disabled={pending || !props.canPublish} onClick={() => move_("ARCHIVED")}>Archive</button>}
          {status === "ARCHIVED" && <button type="button" className="btn btn-sm" disabled={pending} onClick={() => move_("DRAFT", "Restored as a draft.")}>Restore to draft</button>}
          {status === "DRAFT" && !confirmDelete && <button type="button" className="btn btn-sm btn-gh" disabled={pending} onClick={() => setConfirmDelete(true)}>Delete draft</button>}
        </div>
      </header>
      <p id={`${ids}-pubwhy`} className="small muted bs-pubwhy">{(status === "DRAFT" || status === "REVIEW") ? (publishBlocked ? `Publish is not available: ${publishBlocked}` : "Ready: publishing makes the post public on /blog.") : live ? "This post is live. Saved edits go live at once and must pass the claim guard." : "Archived posts are not on the site."}</p>

      {confirmDelete && (
        <div className="notice" data-b="danger" role="alertdialog" aria-labelledby={`${ids}-delh`}>
          <p id={`${ids}-delh`}><b>Delete this draft?</b> The post disappears from the studio. Its saved versions stay in the history log.</p>
          <div className="row"><button type="button" className="btn btn-sm btn-d" onClick={del} disabled={pending} autoFocus>Delete draft</button><button type="button" className="btn btn-sm btn-gh" onClick={() => setConfirmDelete(false)}>Keep it</button></div>
        </div>
      )}
      <div ref={noteRef} tabIndex={-1} className="bs-note" aria-live="polite">
        {note && <div className="notice" data-b={note.tone === "ok" ? "ok" : note.tone} role={note.tone === "danger" ? "alert" : "status"}>{note.text}
          {stale && <> <button type="button" className="btn btn-sm" onClick={() => { if (!dirty || confirm("Reloading drops your unsaved edits in this tab. Continue?")) { window.location.reload(); } }}>Reload the latest version</button></>}
        </div>}
        {undo && <div className="notice" role="status">Deleted a {undo.block.type} block. <button type="button" className="btn btn-sm" onClick={restoreRemoved}>Undo</button></div>}
      </div>
      {(props.origin === "AI" || props.origin === "OUTLINE") && status !== "PUBLISHED" && (
        <div className="notice" data-b="warn">{props.origin === "AI" ? "Drafted by AI. Check every figure, quote and source link yourself before publishing; AI never publishes." : "Started from a rule-based outline. Replace every [Outline] placeholder before publishing."}</div>
      )}

      <details className="c bs-meta" open={!post.dek}>
        <summary><h2>Post details</h2><span className="small muted">title, summary, topic, web address, hero image, search text</span></summary>
        <div className="bs-meta-grid">
          <TextField label="Title" value={post.title} max={140} onChange={(v) => patch({ title: v })} errs={post.title.trim().length < 3 ? ["At least 3 characters."] : []} />
          <SelectField<Topic> label="Topic" value={post.topic} onChange={(v) => patch({ topic: v })} options={TOPICS.map((t) => ({ value: t, label: TOPIC_LABEL[t] }))} />
          <AreaField label="Summary (dek)" rows={2} value={post.dek} max={300} onChange={(v) => patch({ dek: v })} hint="Shown on the post card and as the search description." />
          <TextField label="Web address" value={post.slug} max={80} mono onChange={(v) => patch({ slug: v.toLowerCase() })} hint={`/blog/${post.slug}${live ? " · changing it breaks existing links" : ""}`} errs={/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug) ? [] : ["Lowercase letters, digits and single hyphens only."]} />
          <TextField label="Hero image (optional)" value={post.heroSrc} mono onChange={(v) => patch({ heroSrc: v })} hint="A file in public/blog, e.g. /blog/tranches.svg" />
          <TextField label="Hero alt text" value={post.heroAlt} max={240} onChange={(v) => patch({ heroAlt: v })} errs={post.heroSrc && !post.heroAlt.trim() ? ["Needed when there is a hero image."] : []} />
          <TextField label="Search title (optional)" value={post.seoTitle} max={70} onChange={(v) => patch({ seoTitle: v })} hint="Defaults to the title." />
          <AreaField label="Search description (optional)" rows={2} value={post.seoDescription} max={170} onChange={(v) => patch({ seoDescription: v })} hint="Defaults to the summary." />
        </div>
      </details>

      <div className="bs-panes">
        <BlockList blocks={post.blocks} selectedId={selected} flagged={flagged} onSelect={setSelected} onMove={move} onDuplicate={duplicate} onRemove={remove} onAdd={add} />
        <div className="bs-center">
          <GuardPanel problems={problems} invalid={invalid} serverProblems={serverProblems} blocks={post.blocks} onShow={(id) => { setSelected(id); document.getElementById("bs-inspector")?.focus(); }} />
          <Preview title={post.title} dek={post.dek} blocks={validBlocks} skipped={invalid.length} />
        </div>
        <div id="bs-inspector" tabIndex={-1} className="bs-ins-wrap">
          <Inspector block={block} index={index} total={post.blocks.length} onChange={replace} onDuplicate={() => block && duplicate(block.id)} onRemove={() => block && remove(block.id)} />
        </div>
      </div>

      <section className="c" aria-labelledby={`${ids}-hist`}>
        <div className="c-head"><h2 id={`${ids}-hist`}>History</h2><span className="small muted">Every save is kept as a version and cannot be changed afterwards.</span></div>
        <History revisions={revisions} current={{ title: post.title, blocks: post.blocks }}
          onLoad={(r) => { setPost((p) => ({ ...p, title: r.title, blocks: r.blocks })); setSelected(r.blocks[0]?.id ?? null); announce({ tone: "ok", text: `Version ${r.version} loaded into the editor. Save to make it version ${version + 1}.` }); }} />
      </section>
    </div>
  );
}
