/* P11 · blog text format (pure, no React). Text blocks are data, never HTML:
 *   paragraphs  separated by a blank line
 *   lists       a paragraph whose every line starts with "- " becomes a bullet list
 *   **bold**    *italic*    [label](/path-on-this-site) or [label](https://…)
 * Anything else — including "<script>", HTML entities or a javascript: link — stays literal text. The renderer turns
 * this tree into React elements, so nothing is ever injected as markup (no dangerouslySetInnerHTML).
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "a"; href: string; external: boolean; c: Inline[] };

export type Para = { kind: "p"; inline: Inline[] } | { kind: "ul"; items: Inline[][] };

/** A link target we render: a path on this site (not protocol-relative) or an http(s) address. Everything else → null. */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const h = raw.trim();
  if (/^\/(?!\/)[^\s<>"'`\\]*$/.test(h)) return { href: h, external: false };
  if (/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[^\s<>"'`\\]*)?$/i.test(h)) {
    try { const u = new URL(h); return u.protocol === "https:" || u.protocol === "http:" ? { href: u.toString(), external: true } : null; } catch { return null; }
  }
  return null;
}

const LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/y;
const BOLD = /\*\*(?=\S)([^*\n]*?\S)\*\*/y;
const ITALIC = /\*(?=[^\s*])([^*\n]*?[^\s*])\*/y;

/** Inline tokens of one line or paragraph. Unmatched markers stay as literal characters. */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "[" ) {
      LINK.lastIndex = i;
      const m = LINK.exec(src);
      const target = m ? safeHref(m[2]) : null;
      if (m && target) {
        flush();
        out.push({ t: "a", href: target.href, external: target.external, c: depth < 2 ? parseInline(m[1], depth + 1).filter((x) => x.t !== "a") : [{ t: "text", v: m[1] }] });
        i += m[0].length;
        continue;
      }
    } else if (ch === "*" && depth < 3) {
      if (src[i + 1] === "*") {
        BOLD.lastIndex = i;
        const m = BOLD.exec(src);
        if (m) { flush(); out.push({ t: "b", c: parseInline(m[1], depth + 1) }); i += m[0].length; continue; }
      } else {
        ITALIC.lastIndex = i;
        const m = ITALIC.exec(src);
        if (m) { flush(); out.push({ t: "i", c: parseInline(m[1], depth + 1) }); i += m[0].length; continue; }
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/** Paragraphs and bullet lists of a text block body. Single line breaks inside a paragraph read as spaces. */
export function parseBody(body: string): Para[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p): Para => {
      const lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0 && lines.every((l) => /^[-•]\s+/.test(l))) return { kind: "ul", items: lines.map((l) => parseInline(l.replace(/^[-•]\s+/, ""))) };
      return { kind: "p", inline: parseInline(lines.join(" ")) };
    });
}

/** Plain text of an inline tree (for counting and accessible names). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === "text" ? n.v : inlineText(n.c))).join("");
}

/** A block id as a safe HTML id fragment. */
export function anchorId(blockId: string, prefix = "h"): string {
  const s = blockId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${prefix}-${s || "x"}`;
}

/** "8 November 2026" — fixed locale and UTC, so server and client render the same text. */
export function niceDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Machine date for <time dateTime>. */
export function isoDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Words in a string (for the reading-length checks on sample content). */
export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
