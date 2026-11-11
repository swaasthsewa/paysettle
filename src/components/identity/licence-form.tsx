"use client";
/**
 * F1.4 · add a licence or registration document. The file is read and fingerprinted (SHA-256) in the browser;
 * only its name, type, size and fingerprint are sent. The document itself never leaves the device, so PaySettle holds
 * no copy to leak; Ops matches the fingerprint against the copy shown at review. Type and size are checked here and
 * again on the server (P11).
 * OCR assist (F1.4): for a PDF with a text layer, up to 4,000 characters of its text are read here (pdf-text.ts) and,
 * only while the box is ticked, sent with the fingerprint so licence number, expiry and issuer can be suggested to Ops.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionAnswer } from "./action-form";
import { pdfTextLayer } from "./pdf-text";

type Action = (prev: ActionAnswer | null, form: FormData) => Promise<ActionAnswer>;
const KINDS = ["application/pdf", "image/png", "image/jpeg"];
const MAX = 10 * 1024 * 1024;

async function sha256Hex(file: File): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function LicenceForm({ action }: { action: Action }) {
  const [file, setFile] = useState<{ name: string; kind: string; size: number; sha256: string; text: string } | null>(null);
  const [allowRead, setAllowRead] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const answer = useRef<HTMLDivElement>(null);
  const [state, run, pending] = useActionState(async (prev: ActionAnswer | null, form: FormData) => {
    const r = await action(prev, form);
    if (r.ok) { setFile(null); if (picker.current) picker.current.value = ""; }
    return r;
  }, null);

  useEffect(() => { if (state) answer.current?.focus(); }, [state]);

  async function pick(f: File | undefined) {
    setFile(null); setProblem(null);
    if (!f) return;
    if (!KINDS.includes(f.type)) { setProblem("Licences are accepted as PDF, PNG or JPEG."); return; }
    if (f.size > MAX) { setProblem("Licence files are limited to 10 MB."); return; }
    setHashing(true);
    try {
      const text = f.type === "application/pdf" ? await pdfTextLayer(new Uint8Array(await f.arrayBuffer())).catch(() => "") : "";
      setFile({ name: f.name, kind: f.type, size: f.size, sha256: await sha256Hex(f), text });
    }
    catch { setProblem("This browser could not read the file. Try another browser."); }
    finally { setHashing(false); }
  }

  return (
    <form action={run} className="stack">
      <div className="field">
        <label htmlFor="lic-file">Licence or registration document (PDF, PNG or JPEG, up to 10 MB)</label>
        {/* no name: the file itself is never posted */}
        <input ref={picker} id="lic-file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(e) => pick(e.currentTarget.files?.[0])} aria-describedby="lic-help" />
        <span id="lic-help" className="small muted">The file stays on your device. PaySettle keeps its name, size and SHA-256 fingerprint.</span>
      </div>
      <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" name="ocr" checked={allowRead} onChange={(e) => setAllowRead(e.currentTarget.checked)} style={{ marginTop: 4 }} aria-describedby="lic-ocr-help" />
        <span className="small">Suggest the licence number, expiry and issuer to Ops<span id="lic-ocr-help" className="muted" style={{ display: "block" }}>Reads the file name and, for a PDF with selectable text, up to 4,000 characters of that text. Only the suggestion is kept; Ops still checks the document.</span></span>
      </label>
      {hashing && <p className="small muted" role="status">Reading the file{"…"}</p>}
      {problem && <p className="notice" data-b="warn" role="alert">{problem}</p>}
      {file && (
        <>
          <input type="hidden" name="name" value={file.name} />
          <input type="hidden" name="kind" value={file.kind} />
          <input type="hidden" name="size" value={file.size} />
          <input type="hidden" name="sha256" value={file.sha256} />
          {allowRead && file.text && <input type="hidden" name="text" value={file.text} />}
          <p className="small"><b>{file.name}</b> · {(file.size / 1024).toFixed(0)} KB<br /><code className="id-uri">{file.sha256}</code>
            {file.kind === "application/pdf" && <><br /><span className="muted">{file.text ? `${file.text.length.toLocaleString("en-US")} characters of text found${allowRead ? " and sent for the suggestion" : "; not sent"}.` : "No selectable text found; only the file name is read."}</span></>}</p>
        </>
      )}
      <div className="row"><button className="btn btn-d" type="submit" disabled={!file || pending}>{pending ? "Adding…" : "Add to my documents"}</button></div>
      <div ref={answer} role="status" tabIndex={-1} style={{ outline: "none" }}>
        {state && (
          <div className="notice" data-b={state.ok ? "ok" : "warn"}>
            <p>{state.message}</p>
            {state.problems && <ul style={{ margin: "6px 0 0", paddingLeft: "1.2em" }}>{state.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
        )}
      </div>
    </form>
  );
}
