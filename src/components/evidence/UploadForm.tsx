"use client";
/**
 * F3.04 provider upload form with a live spec checklist. The checklist uses the same rules as the server
 * (src/server/evidence/spec.ts) on the declared file types; the server re-checks the actual bytes before accepting.
 */
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProofSpec } from "@/db/schema";
import {
  ACCEPT_ATTR, CONFIRM_KINDS, KIND_LABEL, MAX_FILE_BYTES, MAX_FILES, MAX_NOTE, blocks, buildNote, normalizeType, isAllowedType,
  requiredCounts, specSignals, type ConfirmKind, type Signal,
} from "@/server/evidence/spec";
import { SignalList } from "./SignalList";

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const guessType = (f: File) => {
  const t = normalizeType(f.type);
  if (t) return t;
  const ext = f.name.toLowerCase().split(".").pop();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf", txt: "text/plain", log: "text/plain", mp4: "video/mp4" } as Record<string, string>)[ext ?? ""] ?? "";
};

export function UploadForm({ milestoneId, code, proof, attempt }: { milestoneId: string; code: string; proof: ProofSpec; attempt: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState<ConfirmKind[]>([]);
  const [waiver, setWaiver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverSignals, setServerSignals] = useState<Signal[] | null>(null);

  const req = useMemo(() => requiredCounts(proof), [proof]);
  const confirmKinds = CONFIRM_KINDS.filter((k) => req.has(k));
  const problems = files.flatMap((f) => {
    const t = guessType(f);
    if (!isAllowedType(t)) return [`${f.name}: this type is not accepted`];
    if (f.size > MAX_FILE_BYTES) return [`${f.name}: larger than 15 MB`];
    return [];
  });
  const live = useMemo(() => specSignals(proof, files.map((f) => ({ name: f.name, type: guessType(f) })), buildNote(note, confirmed, waiver)), [proof, files, note, confirmed, waiver]);
  const ready = !blocks(live) && !problems.length && files.length <= MAX_FILES;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((cur) => [...cur, ...Array.from(list)].slice(0, MAX_FILES));
    setServerSignals(null);
    if (input.current) input.current.value = "";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setServerSignals(null);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    fd.set("note", note);
    confirmed.forEach((k) => fd.append("confirm", k));
    if (waiver) fd.set("gpsWaiver", "on");
    try {
      const res = await fetch(`/api/evidence/${encodeURIComponent(milestoneId)}`, { method: "POST", body: fd });
      const body = (await res.json().catch(() => ({}))) as { error?: string; signals?: Signal[] };
      if (!res.ok) { setError(body.error ?? "The upload did not go through."); if (body.signals) setServerSignals(body.signals); return; }
      setFiles([]); setNote(""); setConfirmed([]); setWaiver(false);
      router.refresh();
    } catch {
      setError("The upload did not go through. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={submit} aria-describedby={`ev-up-${milestoneId}`}>
      <p id={`ev-up-${milestoneId}`} className="muted small">Attempt {attempt} of 3 for {code}. Accepted: JPEG, PNG, PDF, plain text logs, MP4 — up to 15 MB each, {MAX_FILES} files.</p>
      <div className="field">
        <label htmlFor={`ev-files-${milestoneId}`}>Files</label>
        <input ref={input} id={`ev-files-${milestoneId}`} className="input" type="file" multiple accept={ACCEPT_ATTR} onChange={(e) => addFiles(e.currentTarget.files)} />
      </div>
      {files.length > 0 && (
        <ul className="ev-files" aria-label="Selected files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className="ev-file-name">{f.name}</span>
              <span className="muted small tnum">{guessType(f) || "unknown type"} · {kb(f.size)}</span>
              <button type="button" className="btn btn-gh btn-sm" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="field">
        <label htmlFor={`ev-note-${milestoneId}`}>Note for the client {req.has("LINK") ? "(paste links here)" : ""}</label>
        <textarea id={`ev-note-${milestoneId}`} maxLength={MAX_NOTE} value={note} onChange={(e) => setNote(e.target.value)} placeholder={req.has("LINK") ? "https://… and anything the client should know" : "What you delivered and how to check it"} />
      </div>
      {confirmKinds.length > 0 && (
        <fieldset className="ev-confirm">
          <legend className="small">Confirm items that are not files</legend>
          {confirmKinds.map((k) => (
            <label key={k} className="row small">
              <input type="checkbox" checked={confirmed.includes(k)} onChange={(e) => setConfirmed((c) => (e.target.checked ? [...c, k] : c.filter((x) => x !== k)))} />
              {k === "LINK" ? "The link(s) named in the spec are shared with the client" : k === "SIGNATURE" ? "The required signature is attached or was given in writing" : "The external check passed and the client can see it"}
              {req.get(k)?.notes.length ? <span className="muted">— {req.get(k)!.notes.join("; ")}</span> : null}
            </label>
          ))}
        </fieldset>
      )}
      {proof.gpsRadiusM ? (
        <label className="row small">
          <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} />
          GPS waiver: photos may lack a position or be outside {proof.gpsRadiusM} m of the site — I explain why in the note (the client sees this).
        </label>
      ) : null}

      <section aria-label="Spec checklist" className="ev-checklist">
        <h3 className="small">Spec checklist {ready ? <span className="chip" data-b="ok">ready</span> : <span className="chip" data-b="warn">incomplete</span>}</h3>
        <SignalList signals={live} />
        {problems.map((p) => <p key={p} className="notice" data-b="danger">{p}</p>)}
        <p className="muted small">{Array.from(req.keys()).map((k) => KIND_LABEL[k][1]).join(", ") || "No artifacts"} named in the contract. EXIF and GPS are checked after upload; they are hints, not proof.</p>
      </section>

      {error && <div className="notice" data-b="danger" role="alert">{error}</div>}
      {serverSignals && <SignalList signals={serverSignals} title="What the server found" />}
      <div className="row">
        <button className="btn btn-g" type="submit" disabled={!ready || busy} aria-disabled={!ready || busy}>{busy ? "Uploading…" : `Submit evidence for ${code}`}</button>
        <span className="muted small">Files are hashed (SHA-256) and kept unchanged. Submitting starts the client&apos;s 48-hour review.</span>
      </div>
    </form>
  );
}
