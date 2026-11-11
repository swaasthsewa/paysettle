/**
 * F3.04 evidence spec checks (pure; safe to import from client components for the live checklist).
 * - Allowed types (P11): image/jpeg, image/png, application/pdf, text/plain, video/mp4. Types are sniffed from bytes;
 *   a declared type that disagrees with the bytes is refused. Nothing uploaded is ever executed or rendered as HTML.
 * - Counts per artifact kind of the milestone's proof spec: IMAGE↔image/*, PDF↔application/pdf, VIDEO↔video/*,
 *   LOG↔text/plain; LINK / SIGNATURE / ORACLE are satisfied by a URL in the note or by an explicit confirmation box.
 * A count signal at level "fail" blocks submission.
 */
import type { ProofSpec } from "@/db/schema";

export type Level = "ok" | "warn" | "fail";
export interface Signal { code: string; level: Level; detail: string }
export type ArtifactKind = ProofSpec["artifacts"][number]["kind"];
export type FileKind = "IMAGE" | "PDF" | "VIDEO" | "LOG";
export type ConfirmKind = "LINK" | "SIGNATURE" | "ORACLE";

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_FILES = 20;
export const MAX_NOTE = 4000;
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf", "text/plain", "video/mp4"] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];
export const FILE_KINDS: FileKind[] = ["IMAGE", "PDF", "VIDEO", "LOG"];
export const CONFIRM_KINDS: ConfirmKind[] = ["LINK", "SIGNATURE", "ORACLE"];
export const ACCEPT_ATTR = ".jpg,.jpeg,.png,.pdf,.txt,.log,.mp4,image/jpeg,image/png,application/pdf,text/plain,video/mp4";

export const KIND_LABEL: Record<ArtifactKind, [string, string]> = {
  IMAGE: ["photo", "photos"], PDF: ["PDF", "PDFs"], VIDEO: ["video", "videos"], LOG: ["log file", "log files"],
  LINK: ["link", "links"], SIGNATURE: ["signature", "signatures"], ORACLE: ["external check", "external checks"],
};
export const plural = (k: ArtifactKind, n: number) => `${n} ${KIND_LABEL[k][n === 1 ? 0 : 1]}`;

export function normalizeType(t: string): string {
  const s = (t || "").toLowerCase().split(";")[0].trim();
  return s === "image/jpg" || s === "image/pjpeg" ? "image/jpeg" : s;
}
export const isAllowedType = (t: string): t is AllowedType => (ALLOWED_TYPES as readonly string[]).includes(t);

/** Type from the first bytes. text/plain only for valid UTF-8 without NUL bytes. */
export function sniffType(b: Uint8Array): AllowedType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "video/mp4";
  const head = b.subarray(0, 65536);
  if (head.includes(0)) return null;
  try { new TextDecoder("utf-8", { fatal: true }).decode(head.length < b.length ? trimUtf8(head) : head); return "text/plain"; } catch { return null; }
}
/** Drop a partial multi-byte character at the end of a sample. */
function trimUtf8(b: Uint8Array): Uint8Array {
  let i = b.length - 1, back = 0;
  while (i >= 0 && back < 4 && (b[i] & 0xc0) === 0x80) { i--; back++; }
  return i >= 0 && b[i] >= 0xc0 ? b.subarray(0, i) : b;
}

export function kindOfType(t: string): FileKind | null {
  const n = normalizeType(t);
  if (n.startsWith("image/")) return "IMAGE";
  if (n === "application/pdf") return "PDF";
  if (n.startsWith("video/")) return "VIDEO";
  if (n === "text/plain") return "LOG";
  return null;
}

/* ── note markers: the upload form turns its confirmation boxes into markers inside the note ── */
const CONFIRM_RE = /\[confirmed:(LINK|SIGNATURE|ORACLE)\]/g;
const WAIVER = "[gps-waiver]";
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
export interface ParsedNote { text: string; urls: string[]; confirmed: ConfirmKind[]; gpsWaiver: boolean }
export function parseNote(note: string): ParsedNote {
  const raw = note ?? "";
  const confirmed = [...new Set([...raw.matchAll(CONFIRM_RE)].map((m) => m[1] as ConfirmKind))];
  const gpsWaiver = raw.includes(WAIVER);
  const text = raw.replace(CONFIRM_RE, "").split(WAIVER).join("").trim();
  const urls = [...new Set(text.match(URL_RE) ?? [])];
  return { text, urls, confirmed, gpsWaiver };
}
export function buildNote(text: string, confirmed: ConfirmKind[] = [], gpsWaiver = false): string {
  const markers = [...new Set(confirmed)].filter((k) => CONFIRM_KINDS.includes(k)).map((k) => `[confirmed:${k}]`);
  if (gpsWaiver) markers.push(WAIVER);
  return [text.replace(CONFIRM_RE, "").split(WAIVER).join("").trim(), markers.join(" ")].filter(Boolean).join("\n");
}

/** Required count per artifact kind (duplicates of a kind add up). */
export function requiredCounts(proof: ProofSpec): Map<ArtifactKind, { min: number; notes: string[] }> {
  const m = new Map<ArtifactKind, { min: number; notes: string[] }>();
  for (const a of proof.artifacts ?? []) {
    if (!a || a.min <= 0) continue;
    const cur = m.get(a.kind) ?? { min: 0, notes: [] };
    cur.min += a.min;
    if (a.note) cur.notes.push(a.note);
    m.set(a.kind, cur);
  }
  return m;
}

/** Count and type signals for a package against the proof spec. */
export function specSignals(proof: ProofSpec, files: { name: string; type: string }[], note: string): Signal[] {
  const out: Signal[] = [];
  const parsed = parseNote(note);
  const have: Record<FileKind, number> = { IMAGE: 0, PDF: 0, VIDEO: 0, LOG: 0 };
  for (const f of files) { const k = kindOfType(f.type); if (k) have[k] += 1; }
  const req = requiredCounts(proof);
  for (const [kind, r] of req) {
    const what = r.notes.length ? ` — ${r.notes.join("; ")}` : "";
    if ((FILE_KINDS as string[]).includes(kind)) {
      const n = have[kind as FileKind];
      out.push({ code: `COUNT_${kind}`, level: n >= r.min ? "ok" : "fail", detail: `${plural(kind, n)} of ${r.min} required${what}` });
    } else {
      const k = kind as ConfirmKind;
      const byBox = parsed.confirmed.includes(k);
      const n = parsed.urls.length;
      const ok = byBox || n >= r.min;
      const how = byBox ? "confirmed by the provider" : n ? `${n} link${n === 1 ? "" : "s"} in the note` : "no link in the note and not confirmed";
      out.push({ code: `COUNT_${kind}`, level: ok ? "ok" : "fail", detail: `${KIND_LABEL[k][1][0].toUpperCase()}${KIND_LABEL[k][1].slice(1)}: ${how} (${r.min} required)${what}` });
    }
  }
  if (proof.oracle && !req.has("ORACLE"))
    out.push({ code: "ORACLE_PENDING", level: "warn", detail: `External check ${proof.oracle} is not run on upload; the client should confirm it.` });
  for (const k of FILE_KINDS) if (have[k] && !req.has(k)) out.push({ code: `EXTRA_${k}`, level: "ok", detail: `${plural(k, have[k])} not named in the spec (kept as extra context)` });
  return out;
}

export const blocks = (s: Signal[]) => s.some((x) => x.level === "fail");
