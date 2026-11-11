/**
 * F1.4 OCR assist · read the text layer of a PDF in the browser, so licence number, expiry and issuer can be
 * suggested without the file leaving the device. Small on purpose: no PDF library, only what text-based licences need.
 *   · streams compressed with FlateDecode are inflated with the platform's DecompressionStream ("deflate" = zlib,
 *     which is what PDF uses); uncompressed content streams are read as they are; images and fonts are skipped
 *   · text comes from the show-text operators Tj, TJ, ' and " (literal strings with their escapes); BT/ET, T* and
 *     Td/TD start new lines
 *   · hard limits: 40 streams, 4 MB inflated, TEXT_MAX characters out; text that is mostly unreadable (glyph ids of
 *     embedded fonts) is dropped rather than sent
 * Scanned PDFs and photos have no text layer: they get the file-name reading only (no image leaves the device).
 * Runs in the browser and in Node 18+ (tests), both of which have DecompressionStream.
 */
import { TEXT_MAX } from "@/lib/identity/ocr";

const MAX_STREAMS = 40, MAX_INFLATED = 4 * 1024 * 1024;

/** A PDF literal string's body (between the outer parentheses) → text. */
export function unescapePdfString(s: string): string {
  return s.replace(/\\(\d{1,3}|[\s\S])/g, (_m, e: string) => {
    if (/^\d/.test(e)) return String.fromCharCode(parseInt(e, 8) & 0xff);
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\", "\n": "", "\r": "" } as Record<string, string>)[e] ?? e;
  });
}

/** Read balanced (…) literal strings starting at `i` (which must point at "("). Returns the body and the next index. */
function literalAt(src: string, i: number): { body: string; next: number } {
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") { j++; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) break; }
  }
  return { body: src.slice(i + 1, j), next: j + 1 };
}

/** The text a page content stream shows. Pure. */
export function textFromContent(content: string): string {
  const out: string[] = [];
  let line = "", pending: string[] = [];
  const flush = () => { if (line.trim()) out.push(line.trim()); line = ""; };
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === "(") { const r = literalAt(content, i); pending.push(unescapePdfString(r.body)); i = r.next - 1; continue; }
    if (c === "%") { while (i < content.length && content[i] !== "\n" && content[i] !== "\r") i++; continue; }
    if (/[A-Za-z'"*]/.test(c)) {
      let j = i; while (j < content.length && /[A-Za-z'"*]/.test(content[j])) j++;
      const op = content.slice(i, j);
      if (op === "Tj" || op === "TJ" || op === "'" || op === '"') {
        if (op === "'" || op === '"') flush();
        line += (line && !line.endsWith(" ") ? " " : "") + pending.join("");
        pending = [];
      } else if (op === "BT" || op === "ET" || op === "T*" || op === "Td" || op === "TD") { flush(); pending = []; }
      else if (op !== "Tf" && op !== "Tc" && op !== "Tw" && op !== "TL" && op !== "Tz" && op !== "Ts" && op !== "Tm") pending = [];
      i = j - 1;
    }
  }
  flush();
  return out.join("\n");
}

const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return s; };

/** Inflate a zlib stream. Bytes after the end of the compressed data (common in real PDFs) end it without an error. */
async function inflate(bytes: Uint8Array, budget: number): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = []; let n = 0;
  try {
    const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); n += value.length;
      if (n > budget) { await reader.cancel().catch(() => undefined); break; }
    }
  } catch { if (!n) return null; }
  const all = new Uint8Array(Math.min(n, budget)); let o = 0;
  for (const c of chunks) { const take = Math.min(c.length, all.length - o); all.set(c.subarray(0, take), o); o += take; }
  return all;
}

/** Share of characters a person can read (letters, digits, common punctuation, spaces). */
export const readableShare = (s: string) => (s.length ? (s.match(/[\p{L}\p{N}\s.,:;/#()&'-]/gu)?.length ?? 0) / s.length : 0);

/** The PDF's text layer, at most TEXT_MAX characters; "" when there is none (scans, images, unreadable fonts). */
export async function pdfTextLayer(file: Uint8Array): Promise<string> {
  const src = latin1(file);
  const parts: string[] = [];
  let budget = MAX_INFLATED, streams = 0, total = 0;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) && streams < MAX_STREAMS && total < TEXT_MAX) {
    const start = m.index + m[0].length;
    const end = src.indexOf("endstream", start);
    if (end < 0) break;
    const dict = src.slice(Math.max(0, m.index - 400), m.index);
    const head = dict.slice(dict.lastIndexOf("<<"));
    re.lastIndex = end + 9;
    if (/\/Subtype\s*\/(Image|Form)|\/Length1|\/FontFile|\/DCTDecode|\/JPXDecode|\/CCITTFax/.test(head)) continue;
    streams++;
    /* the end-of-line before "endstream" is not part of the data; /Length, when it fits, is exact */
    const len = Number(head.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)?.[1] ?? NaN);
    let stop = end;
    if (Number.isInteger(len) && len > 0 && start + len <= end) stop = start + len;
    else while (stop > start && (file[stop - 1] === 0x0a || file[stop - 1] === 0x0d)) stop--;
    let body = file.subarray(start, stop);
    if (/\/FlateDecode/.test(head)) {
      const inf = await inflate(body, budget);
      if (!inf) continue;
      budget -= inf.length; body = inf;
    } else if (/\/Filter/.test(head)) continue;
    const text = textFromContent(latin1(body));
    if (text && readableShare(text) >= 0.85) { parts.push(text); total += text.length; }
    if (budget <= 0) break;
  }
  return parts.join("\n").replace(/[ \t]+/g, " ").slice(0, TEXT_MAX);
}
