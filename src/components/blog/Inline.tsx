/* P11 — renders the parsed blog text tree (src/lib/blog/format.ts) as React elements. Server-safe.
 * Text is passed to React as strings, so "<script>" or "&lt;" in a post stays visible text, never markup. */
import Link from "next/link";
import type { ReactNode } from "react";
import { parseBody, parseInline, type Inline as Node } from "@/lib/blog/format";

export function InlineNodes({ nodes, k = "n" }: { nodes: Node[]; k?: string }): ReactNode {
  return nodes.map((n, i) => {
    const key = `${k}-${i}`;
    switch (n.t) {
      case "text": return n.v;
      case "b": return <strong key={key}><InlineNodes nodes={n.c} k={key} /></strong>;
      case "i": return <em key={key}><InlineNodes nodes={n.c} k={key} /></em>;
      case "a":
        return n.external
          ? <a key={key} href={n.href} rel="noopener noreferrer" target="_blank"><InlineNodes nodes={n.c} k={key} /><span className="bl-sr"> (opens in a new tab)</span></a>
          : <Link key={key} href={n.href}><InlineNodes nodes={n.c} k={key} /></Link>;
    }
  });
}

/** One line of inline text (titles, list items, answers). */
export function InlineText({ text }: { text: string }) {
  return <InlineNodes nodes={parseInline(text)} />;
}

/** A text body: paragraphs and bullet lists. */
export function Prose({ body, k }: { body: string; k: string }) {
  return parseBody(body).map((p, i) =>
    p.kind === "p"
      ? <p key={`${k}-p${i}`}><InlineNodes nodes={p.inline} k={`${k}-p${i}`} /></p>
      : <ul key={`${k}-u${i}`}>{p.items.map((it, j) => <li key={j}><InlineNodes nodes={it} k={`${k}-u${i}-${j}`} /></li>)}</ul>,
  );
}
