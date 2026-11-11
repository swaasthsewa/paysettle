"use client";
/**
 * Studio live preview: the public BlockRenderer (src/components/blog/BlockRenderer) over the blocks that validate.
 * Blocks with field errors are left out (and listed) so a half-typed block cannot break the page. An error boundary keeps
 * the editor usable if the renderer throws on unusual content.
 */
import { Component, type ReactNode } from "react";
import { BlockRenderer } from "@/components/blog/BlockRenderer";
import type { Block } from "@/lib/blog/blocks";

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: string | null; key: string }> {
  state = { error: null as string | null, key: this.props.resetKey };
  static getDerivedStateFromError(e: Error) { return { error: e.message || "The preview could not render." }; }
  static getDerivedStateFromProps(p: { resetKey: string }, s: { error: string | null; key: string }) { return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null; }
  render() {
    if (this.state.error) return <div className="notice" data-b="warn" role="alert">The preview could not render this content ({this.state.error}). Your edits are kept; check the selected block.</div>;
    return this.props.children;
  }
}

export function Preview({ title, dek, blocks, skipped }: { title: string; dek: string; blocks: Block[]; skipped: number }) {
  return (
    <section className="bs-preview" aria-label="Live preview">
      <div className="bs-preview-head">
        <span className="chip" data-b="plain">Preview</span>
        {skipped > 0 && <span className="small muted">{skipped} block{skipped === 1 ? "" : "s"} with errors left out</span>}
      </div>
      <article className="bs-article">
        <p className="bs-pv-title">{title || "Untitled post"}</p>
        {dek && <p className="bs-pv-dek">{dek}</p>}
        <Boundary resetKey={JSON.stringify(blocks)}>
          {blocks.length ? <BlockRenderer blocks={blocks} preview /> : <p className="muted">No valid blocks to show yet.</p>}
        </Boundary>
      </article>
    </section>
  );
}
