"use client";
/**
 * Tier 2 vault entry with the spatial annotation tool (F4.03, F4.04). Click and drag on an evidence image to
 * mark a region, attach a clause and a comment. Boxes are stored as fractions of the image, bound to the file's
 * SHA-256 from the Phase 3 evidence record (the server refuses a hash it does not know).
 */
import { useRef, useState } from "react";
import { rebuttalAction } from "@/server/disputes/actions";

export interface AnnImage { sha: string; name: string; url: string | null; kind: string }
interface Mark { fileSha: string; box: [number, number, number, number]; clause?: string; comment: string }
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

export function RebuttalForm({ disputeId, images, clauses }: { disputeId: string; images: AnnImage[]; clauses: { code: string; title: string }[] }) {
  const [sel, setSel] = useState(images[0]?.sha ?? "");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
  const [clause, setClause] = useState("");
  const [comment, setComment] = useState("");
  const start = useRef<[number, number] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const img = images.find((i) => i.sha === sel);

  const point = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)] as [number, number];
  };
  const down = (e: React.PointerEvent) => { box.current?.setPointerCapture(e.pointerId); start.current = point(e); setDraft([...start.current, 0, 0]); };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    const [x0, y0] = start.current, [x1, y1] = point(e);
    setDraft([r3(Math.min(x0, x1)), r3(Math.min(y0, y1)), r3(Math.abs(x1 - x0)), r3(Math.abs(y1 - y0))]);
  };
  const up = () => { start.current = null; setDraft((d) => (d && d[2] > 0.01 && d[3] > 0.01 ? d : null)); };
  const add = () => {
    if (!draft || !comment.trim() || !sel) return;
    setMarks((m) => [...m, { fileSha: sel, box: draft, clause: clause || undefined, comment: comment.trim() }]);
    setDraft(null); setComment("");
  };
  const shown = marks.filter((m) => m.fileSha === sel);

  return (
    <form action={rebuttalAction} className="stack">
      <input type="hidden" name="disputeId" value={disputeId} />
      <input type="hidden" name="annotations" value={marks.length ? JSON.stringify(marks) : ""} />
      <div className="field">
        <label htmlFor="dz-narr">Your note for the mediator</label>
        <textarea id="dz-narr" name="narrative" required maxLength={4000} className="input" placeholder="What the evidence shows, and which clause or criterion it meets or misses." />
      </div>
      <div className="field">
        <label htmlFor="dz-file">Attach a file (optional — PNG, JPEG, WebP, PDF or text, up to 1 MB)</label>
        <input id="dz-file" name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" />
      </div>

      {images.length > 0 && (
        <fieldset className="dz-ann">
          <legend>Mark a region on the evidence (optional)</legend>
          <div className="row">
            <label className="small" htmlFor="dz-img">Image</label>
            <select id="dz-img" className="input dz-select" value={sel} onChange={(e) => { setSel(e.target.value); setDraft(null); }}>
              {images.map((i) => <option key={i.sha} value={i.sha}>{i.name} · {i.sha.slice(0, 10)}…</option>)}
            </select>
          </div>
          <div ref={box} className="dz-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} role="img"
            aria-label={`Evidence image ${img?.name ?? ""}. Drag to draw a box, or use the Mark whole image button.`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- evidence served from our own routes; next/image would proxy untrusted bytes */}
            {img?.url ? <img src={img.url} alt="" draggable={false} /> : <div className="dz-ph"><b>{img?.name}</b><span className="small">Preview not stored here — the mark is still bound to this file&apos;s hash.</span></div>}
            {shown.map((m, i) => <i key={i} className="dz-box" style={{ left: `${m.box[0] * 100}%`, top: `${m.box[1] * 100}%`, width: `${m.box[2] * 100}%`, height: `${m.box[3] * 100}%` }}><span>{marks.indexOf(m) + 1}</span></i>)}
            {draft && <i className="dz-box dz-draft" style={{ left: `${draft[0] * 100}%`, top: `${draft[1] * 100}%`, width: `${draft[2] * 100}%`, height: `${draft[3] * 100}%` }} />}
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => setDraft([0, 0, 1, 1])}>Mark whole image</button>
            <span className="small muted">{draft ? `Box at ${Math.round(draft[0] * 100)}%, ${Math.round(draft[1] * 100)}% · ${Math.round(draft[2] * 100)} × ${Math.round(draft[3] * 100)}%` : "Drag on the image to draw a box."}</span>
          </div>
          {draft && (
            <div className="dz-markform">
              <div className="field"><label htmlFor="dz-cl">Clause</label>
                <select id="dz-cl" className="input" value={clause} onChange={(e) => setClause(e.target.value)}>
                  <option value="">No clause</option>
                  {clauses.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.title}</option>)}
                </select></div>
              <div className="field"><label htmlFor="dz-cm">Comment</label>
                <input id="dz-cm" className="input" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder="What is wrong or right in this region" /></div>
              <div className="row"><button type="button" className="btn btn-sm btn-d" onClick={add} disabled={!comment.trim()}>Add mark</button>
                <button type="button" className="btn btn-sm btn-gh" onClick={() => setDraft(null)}>Cancel</button></div>
            </div>
          )}
          {marks.length > 0 && (
            <ol className="dz-marks">
              {marks.map((m, i) => (
                <li key={i}><b>{i + 1}.</b> {m.clause ? <span className="chip" data-b="plain">{m.clause}</span> : null} {m.comment} <span className="small muted">on {images.find((x) => x.sha === m.fileSha)?.name}</span>
                  <button type="button" className="btn btn-sm btn-gh" onClick={() => setMarks((all) => all.filter((_, j) => j !== i))} aria-label={`Remove mark ${i + 1}`}>Remove</button></li>
              ))}
            </ol>
          )}
        </fieldset>
      )}
      <p className="small muted">The vault is write-once: what you add is hashed into the dossier and cannot be edited or removed.</p>
      <div className="row"><button className="btn btn-g" type="submit">Add to the vault</button></div>
    </form>
  );
}
