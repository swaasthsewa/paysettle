/**
 * F2.10 F5.05 F4.10 — shared PDF writer (pdfkit) for the contract PDF, the compliance pack and the PayPal evidence
 * dossier. Server-only. Standard PDF fonts (Helvetica) only, so no font files are read at request time; text is
 * reduced to the characters those fonts can show (P11: any uploaded or typed text is untrusted and is drawn as text).
 * Tagged PDF with a document title and language, so screen readers announce it.
 */
import PDFDocument from "pdfkit";

export interface PdfMeta { title: string; subject: string; keywords?: string; author?: string }
type Doc = InstanceType<typeof PDFDocument>;

/** Characters the standard fonts (WinAnsi) can draw; the rest become close ASCII stand-ins or "?". */
const STANDINS: Record<string, string> = {
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "−": "-",
  "‐": "-", "‑": "-", "‒": "-", "―": "-", "′": "'", "″": '"', "✓": "v", "✔": "v", "✗": "x", " ": " ",
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", "⁄": "/", "∕": "/", "№": "No.", "₹": "INR ", "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "ı": "i",
};
const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""));
export function pdfText(input: unknown, max = 4000): string {
  const s = String(input ?? "").normalize("NFC").slice(0, max);
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === "\n" || ch === "\t") { out += ch === "\t" ? "  " : "\n"; continue; }
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue; /* control characters are dropped */
    if (code <= 0xff || WINANSI_EXTRA.has(ch)) { out += ch; continue; }
    out += STANDINS[ch] ?? (ch.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "") || "?");
  }
  return out;
}

const INK = "#14201d", MUTED = "#55625e", LINE = "#c9d3cf", ACCENT = "#0f6b5c";
const M = 54; /* page margin in points (0.75 in) */

export class PdfWriter {
  constructor(readonly doc: Doc) {}
  get width() { return this.doc.page.width - M * 2; }
  /** Starts a new page when fewer than `h` points are left. */
  room(h: number) { if (this.doc.y + h > this.doc.page.height - M - 24) this.doc.addPage(); }
  title(text: string, sub?: string) {
    this.doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(pdfText(text), { width: this.width });
    if (sub) this.doc.moveDown(0.2).font("Helvetica").fontSize(10).fillColor(MUTED).text(pdfText(sub), { width: this.width });
    this.doc.moveDown(0.6); this.hr();
  }
  h2(text: string) { this.room(48); this.doc.moveDown(0.6).font("Helvetica-Bold").fontSize(12.5).fillColor(ACCENT).text(pdfText(text), { width: this.width }).moveDown(0.25); }
  h3(text: string) { this.room(32); this.doc.moveDown(0.3).font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(pdfText(text), { width: this.width }).moveDown(0.1); }
  p(text: string, o: { muted?: boolean; size?: number; bold?: boolean } = {}) {
    this.doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size ?? 9.5).fillColor(o.muted ? MUTED : INK).text(pdfText(text), { width: this.width, lineGap: 1.5 }).moveDown(0.3);
  }
  mono(text: string, size = 8) { this.doc.font("Courier").fontSize(size).fillColor(INK).text(pdfText(text), { width: this.width, lineBreak: true }).moveDown(0.2); }
  hr() { const y = this.doc.y; this.doc.save().moveTo(M, y).lineTo(M + this.width, y).lineWidth(0.6).strokeColor(LINE).stroke().restore(); this.doc.moveDown(0.4); }
  /** Label / value rows in two columns. */
  kv(rows: [string, string][], labelWidth = 150) {
    for (const [k, v] of rows) {
      const val = pdfText(v), key = pdfText(k);
      this.doc.font("Helvetica").fontSize(9.5);
      const h = Math.max(this.doc.heightOfString(val, { width: this.width - labelWidth }), 12);
      this.room(h + 4);
      const y = this.doc.y;
      this.doc.font("Helvetica-Bold").fillColor(MUTED).text(key, M, y, { width: labelWidth - 8 });
      this.doc.font("Helvetica").fillColor(INK).text(val, M + labelWidth, y, { width: this.width - labelWidth });
      this.doc.x = M; this.doc.y = y + h + 3;
    }
    this.doc.moveDown(0.2);
  }
  /** A simple ruled table. Widths are fractions of the text width; `align` per column. Repeats the header on new pages. */
  table(cols: { header: string; width: number; align?: "left" | "right" }[], rows: string[][], o: { size?: number } = {}) {
    const size = o.size ?? 8.5, pad = 3;
    const widths = cols.map((c) => c.width * this.width);
    const drawRow = (cells: string[], bold: boolean) => {
      this.doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      const texts = cells.map((c) => pdfText(c, 1500));
      const h = Math.max(...texts.map((t, i) => this.doc.heightOfString(t, { width: widths[i] - pad * 2 }))) + pad * 2;
      if (this.doc.y + h > this.doc.page.height - M - 24) { this.doc.addPage(); if (!bold) drawRow(cols.map((c) => c.header), true); }
      const y = this.doc.y;
      let x = M;
      if (bold) this.doc.save().rect(M, y, this.width, h).fill("#eef3f1").restore();
      texts.forEach((t, i) => {
        this.doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(bold ? MUTED : INK)
          .text(t, x + pad, y + pad, { width: widths[i] - pad * 2, align: cols[i].align ?? "left" });
        x += widths[i];
      });
      this.doc.save().moveTo(M, y + h).lineTo(M + this.width, y + h).lineWidth(0.4).strokeColor(LINE).stroke().restore();
      this.doc.x = M; this.doc.y = y + h;
    };
    this.room(40);
    drawRow(cols.map((c) => c.header), true);
    if (!rows.length) drawRow([cols.length ? "None." : "", ...cols.slice(1).map(() => "")], false);
    for (const r of rows) drawRow(r, false);
    this.doc.moveDown(0.6);
  }
  /** A highlighted notice (where the money is, disclaimers). */
  notice(text: string) {
    const t = pdfText(text);
    this.doc.font("Helvetica").fontSize(9);
    const h = this.doc.heightOfString(t, { width: this.width - 16 }) + 12;
    this.room(h + 6);
    const y = this.doc.y;
    this.doc.save().rect(M, y, this.width, h).fill("#f3f7f5").restore().save().rect(M, y, 3, h).fill(ACCENT).restore();
    this.doc.fillColor(INK).text(t, M + 10, y + 6, { width: this.width - 16 });
    this.doc.x = M; this.doc.y = y + h + 6;
  }
}

/** Renders a PDF to bytes. `footer` is printed on every page with "page n of m". */
export async function renderPdf(meta: PdfMeta, footer: string, draw: (w: PdfWriter) => void | Promise<void>): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER", margins: { top: M, bottom: M, left: M, right: M }, bufferPages: true, tagged: true, lang: "en-US", displayTitle: true, pdfVersion: "1.7",
    info: { Title: pdfText(meta.title, 200), Subject: pdfText(meta.subject, 300), Author: pdfText(meta.author ?? "PaySettle", 100), Keywords: pdfText(meta.keywords ?? "", 300), Creator: "PaySettle", Producer: "PaySettle (pdfkit)" },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("data", (c: Buffer) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  await draw(new PdfWriter(doc));
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; /* the footer sits in the margin; without this pdfkit would start a new page */
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
      .text(`${pdfText(footer, 200)}  ·  page ${i + 1} of ${range.count}`, M, doc.page.height - M + 14, { width: doc.page.width - M * 2, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

/** Display helpers shared by the documents. */
export const fmtIso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
export const short = (h: string | null | undefined, n = 16) => (h ? `${h.slice(0, n)}…` : "—");
