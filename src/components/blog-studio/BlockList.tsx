"use client";
/**
 * Blog studio — the post's block list: select, move up/down, duplicate, delete, and add a block from BLOCK_META after the
 * selected one. Keyboard first: every action is a labelled button; the add menu is a disclosure that closes on Escape.
 */
import { useRef } from "react";
import { BLOCK_META, BLOCK_TYPES, type Block, type BlockType } from "@/lib/blog/blocks";
import { snippet } from "./model";

export function BlockList({ blocks, selectedId, flagged, onSelect, onMove, onDuplicate, onRemove, onAdd }: {
  blocks: Block[]; selectedId: string | null; flagged: Map<string, number>;
  onSelect: (id: string) => void; onMove: (id: string, d: -1 | 1) => void; onDuplicate: (id: string) => void; onRemove: (id: string) => void; onAdd: (t: BlockType) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <nav className="bs-list" aria-label="Blocks in this post">
      <div className="bs-list-head"><h2>Blocks</h2><span className="small muted">{blocks.length} of 80</span></div>
      <ol>
        {blocks.map((b, i) => {
          const name = `${BLOCK_META[b.type].label} ${i + 1}`;
          const n = flagged.get(b.id) ?? 0;
          return (
            <li key={b.id} className="bs-li" data-on={b.id === selectedId || undefined}>
              <button type="button" className="bs-li-main" aria-current={b.id === selectedId ? "true" : undefined} onClick={() => onSelect(b.id)}>
                <span className="bs-li-type">{BLOCK_META[b.type].label}{b.claimStatus ? <span className="bs-tag">{b.claimStatus === "illustrative" ? "Illustrative" : b.claimStatus === "product" ? "Product" : "Research"}</span> : null}</span>
                <span className="bs-li-snip">{snippet(b)}</span>
                {n > 0 && <span className="chip" data-b="warn">{n} to fix<span className="sr-only"> in {name}</span></span>}
              </button>
              <span className="bs-li-tools">
                <button type="button" className="btn btn-sm btn-gh" aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => onMove(b.id, -1)}>↑</button>
                <button type="button" className="btn btn-sm btn-gh" aria-label={`Move ${name} down`} disabled={i === blocks.length - 1} onClick={() => onMove(b.id, 1)}>↓</button>
                <button type="button" className="btn btn-sm btn-gh" aria-label={`Duplicate ${name}`} disabled={blocks.length >= 80} onClick={() => onDuplicate(b.id)}>⧉</button>
                <button type="button" className="btn btn-sm btn-gh" aria-label={`Delete ${name}`} disabled={blocks.length <= 1} onClick={() => onRemove(b.id)}>✕</button>
              </span>
            </li>
          );
        })}
      </ol>
      <details ref={menu} className="bs-add" onKeyDown={(e) => { if (e.key === "Escape" && menu.current) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } }}>
        <summary className="btn btn-sm">Add a block</summary>
        <ul className="bs-add-menu" aria-label="Block types">
          {BLOCK_TYPES.map((t) => (
            <li key={t}>
              <button type="button" disabled={blocks.length >= 80} onClick={() => { onAdd(t); if (menu.current) menu.current.open = false; }}>
                <b>{BLOCK_META[t].label}</b><span className="small muted">{BLOCK_META[t].hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  );
}
