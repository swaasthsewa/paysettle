"use client";
/**
 * P5 — revision history. Every saved version is an append-only snapshot; each row shows a block-level diff against
 * the version before it (added / removed / changed / moved block ids). "Load into editor" copies a snapshot into the unsaved
 * editor state; saving it creates a new version, so history is never rewritten.
 */
import { useState } from "react";
import type { Block } from "@/lib/blog/blocks";
import type { Revision } from "@/server/blog";
import { diffBlocks, isEmptyDiff, type BlockDiff } from "@/server/blog/diff";
import { labelOf } from "./model";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function DiffList({ d, prev, next }: { d: BlockDiff; prev: Block[]; next: Block[] }) {
  if (isEmptyDiff(d)) return <p className="small muted">No content changes (details such as the web address or SEO text may have changed).</p>;
  const find = (id: string, list: Block[]) => labelOf(list.find((b) => b.id === id));
  const row = (title: string, ids: string[], list: Block[], tone: string) => ids.length ? (
    <li><span className="chip" data-b={tone}>{title} {ids.length}</span> {ids.map((id) => <code key={id} className="bs-id" title={find(id, list)}>{id} · {find(id, list)}</code>)}</li>
  ) : null;
  return (
    <ul className="bs-diff">
      {d.titleChanged && <li><span className="chip" data-b="plain">Title changed</span></li>}
      {d.dekChanged && <li><span className="chip" data-b="plain">Summary changed</span></li>}
      {row("Added", d.added, next, "ok")}
      {row("Removed", d.removed, prev, "danger")}
      {row("Changed", d.changed, next, "warn")}
      {row("Moved", d.moved, next, "plain")}
    </ul>
  );
}

export function History({ revisions, current, onLoad }: { revisions: Revision[]; current: { title: string; blocks: Block[] }; onLoad: (r: Revision) => void }) {
  const [compare, setCompare] = useState<string | null>(null);
  if (!revisions.length) return <p className="muted small">No saved versions yet.</p>;
  return (
    <ol className="bs-history">
      {revisions.map((r, i) => {
        const prev = revisions[i + 1] ?? null;
        const d = diffBlocks(prev, r);
        const vsNow = compare === r.id ? diffBlocks(r, current) : null;
        return (
          <li key={r.id}>
            <div className="row">
              <b>Version {r.version}</b>
              <span className="small muted">{r.editorName ?? "Unknown editor"} · {when(r.createdAt)} · {r.blocks.length} blocks</span>
              <span className="sp" />
              <button type="button" className="btn btn-sm btn-gh" aria-expanded={compare === r.id} onClick={() => setCompare(compare === r.id ? null : r.id)}>{compare === r.id ? "Hide comparison" : "Compare with editor"}</button>
              <button type="button" className="btn btn-sm" onClick={() => onLoad(r)}>Load into editor</button>
            </div>
            <p className="small">“{r.title}”{prev ? ` · changes since version ${prev.version}:` : " · first version"}</p>
            {prev && <DiffList d={d} prev={prev.blocks} next={r.blocks} />}
            {vsNow && (
              <div className="bs-vsnow" aria-live="polite">
                <p className="small"><b>Editor now compared with version {r.version}:</b></p>
                <DiffList d={vsNow} prev={r.blocks} next={current.blocks} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
