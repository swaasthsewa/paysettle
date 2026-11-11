/**
 * Block-level diff between two versions of a post (studio history panel). Pure. Blocks are matched by id:
 * added = only in `next`, removed = only in `prev`, changed = same id with different content, moved = same content but a
 * different position relative to the blocks both versions share. Client-safe (used by the studio history panel).
 */
import type { Block } from "@/lib/blog/blocks";

/** Stable JSON (sorted keys, undefined dropped). Local rather than @/lib/canonical, which pulls node:crypto into the browser bundle. */
export function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

export interface BlockDiff { added: string[]; removed: string[]; changed: string[]; moved: string[]; titleChanged: boolean; dekChanged: boolean }

export function diffBlocks(prev: { title?: string; dek?: string; blocks: Block[] } | null, next: { title?: string; dek?: string; blocks: Block[] }): BlockDiff {
  const before = prev?.blocks ?? [];
  const a = new Map(before.map((b) => [b.id, b]));
  const b = new Map(next.blocks.map((x) => [x.id, x]));
  const added = next.blocks.filter((x) => !a.has(x.id)).map((x) => x.id);
  const removed = before.filter((x) => !b.has(x.id)).map((x) => x.id);
  const changed = next.blocks.filter((x) => a.has(x.id) && stable(a.get(x.id)) !== stable(x)).map((x) => x.id);
  const sharedBefore = before.filter((x) => b.has(x.id)).map((x) => x.id);
  const sharedAfter = next.blocks.filter((x) => a.has(x.id)).map((x) => x.id);
  const moved = sharedAfter.filter((id, i) => sharedBefore[i] !== id && !changed.includes(id));
  return {
    added, removed, changed, moved,
    titleChanged: prev ? (prev.title ?? "") !== (next.title ?? "") : false,
    dekChanged: prev ? (prev.dek ?? "") !== (next.dek ?? "") : false,
  };
}

export const isEmptyDiff = (d: BlockDiff) => !d.added.length && !d.removed.length && !d.changed.length && !d.moved.length && !d.titleChanged && !d.dekChanged;
