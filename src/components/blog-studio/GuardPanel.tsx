"use client";
/**
 * P10 — live claim guard. Runs the same pure checks the service runs at publish (src/server/blog/lint.ts:
 * claimProblems + copy lint + structure) on the unsaved editor state, plus zod problems per block. Image files are checked
 * on the server at publish only (the browser cannot see public/).
 */
import { BLOCK_META, type Block } from "@/lib/blog/blocks";
import type { Problem } from "@/server/blog/lint";

export function GuardPanel({ problems, invalid, serverProblems, blocks, onShow }: {
  problems: Problem[]; invalid: { blockId: string; count: number }[]; serverProblems: Problem[] | null; blocks: Block[]; onShow: (id: string) => void;
}) {
  const where = (id: string | null) => {
    if (!id) return "Post details";
    const i = blocks.findIndex((b) => b.id === id);
    return i < 0 ? "A removed block" : `Block ${i + 1} · ${BLOCK_META[blocks[i].type].label}`;
  };
  const total = problems.length + invalid.length;
  return (
    <section className="bs-guard" aria-labelledby="bs-guard-h" data-ok={total === 0 || undefined}>
      <div className="row">
        <h2 id="bs-guard-h">Claim guard</h2>
        <span className="chip" data-b={total ? "warn" : "ok"} role="status">{total ? `${total} to fix before publishing` : "Ready to publish"}</span>
      </div>
      <p className="small muted">Figures need a source or an Illustrative / How PaySettle works label; no guarantee language; no outline placeholders.</p>
      {total > 0 && (
        <ul className="bs-guard-list">
          {invalid.map((x) => (
            <li key={`inv-${x.blockId}`}><span>{where(x.blockId)}: {x.count} field{x.count === 1 ? "" : "s"} not valid, so this block cannot be saved.</span> <button type="button" className="btn btn-sm btn-gh" onClick={() => onShow(x.blockId)}>Show</button></li>
          ))}
          {problems.map((p, i) => (
            <li key={`p-${i}`}><span>{where(p.blockId)}: {p.message}</span> {p.blockId && blocks.some((b) => b.id === p.blockId) ? <button type="button" className="btn btn-sm btn-gh" onClick={() => onShow(p.blockId!)}>Show</button> : null}</li>
          ))}
        </ul>
      )}
      {serverProblems && serverProblems.length > 0 && (
        <div className="notice" data-b="danger" role="alert">
          <b>The server refused to publish:</b>
          <ul>{serverProblems.map((p, i) => <li key={i}>{where(p.blockId)}: {p.message}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
