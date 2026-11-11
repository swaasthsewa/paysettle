/* P10 P11 — renders typed blog blocks (src/lib/blog/blocks.ts) for the public article and the studio preview.
 * PaySettle's own block set and wording (see REUSE.md).
 * Server-safe (no hooks here; the live money block and the motion helpers are their own client components), so it
 * works inside server pages and inside the studio's client preview alike.
 *  - Text is the small format in src/lib/blog/format.ts, parsed to React elements: never dangerouslySetInnerHTML.
 *  - Every block sits in .bl-b[data-anim]; <BlogReveal/> plays the chosen motion on scroll, never under reduced motion.
 *  - Sources become numbered footnote references (collectSources keeps numbering in step with the footnote list);
 *    claimStatus becomes a small label ("Illustrative", "How PaySettle works", "From research").
 *  - Live numbers (moneyFlow, trancheTimeline, caseStudy) are computed from src/lib/money, src/lib/policy and
 *    src/data/blueprints, never typed in by the author.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { CLAIM_META, type Block, type BlogSource } from "@/lib/blog/blocks";
import { anchorId } from "@/lib/blog/format";
import { ApiSnippet } from "./ApiSnippet";
import { CaseStudy } from "./CaseStudy";
import { InlineText, Prose } from "./Inline";
import { MoneyFlow } from "./MoneyFlow";
import { TrancheTimeline } from "./TrancheTimeline";
import "@/styles/blog.css";

export interface NumberedSource extends BlogSource { n: number; blockIds: string[] }

/** Sources of a post, numbered by first appearance; one number per distinct URL. */
export function collectSources(blocks: Block[]): NumberedSource[] {
  const out: NumberedSource[] = [];
  const byUrl = new Map<string, NumberedSource>();
  for (const b of blocks) for (const s of b.sources ?? []) {
    const hit = byUrl.get(s.url);
    if (hit) { if (!hit.blockIds.includes(b.id)) hit.blockIds.push(b.id); continue; }
    const n: NumberedSource = { ...s, n: out.length + 1, blockIds: [b.id] };
    byUrl.set(s.url, n);
    out.push(n);
  }
  return out;
}

/** Headings of a post for the contents list. */
export function headingsOf(blocks: Block[]): { id: string; text: string; level: 2 | 3 }[] {
  return blocks.flatMap((b) => (b.type === "heading" ? [{ id: anchorId(b.id), text: b.text, level: b.level ?? 2 }] : []));
}

export const fnId = (n: number) => `fn-${n}`;
export const fnRefId = (blockId: string, n: number) => anchorId(blockId, `fnref-${n}`);

const TONE_WORD = { info: "Note", warn: "Watch out", ok: "Good to know" } as const;

function Credit({ b, refs }: { b: Block; refs: Map<string, number> }) {
  const nums = [...new Set((b.sources ?? []).map((s) => refs.get(s.url)).filter((n): n is number => typeof n === "number"))];
  if (!b.claimStatus && nums.length === 0) return null;
  return (
    <p className="bl-cred">
      {b.claimStatus && <span className="bl-claim" data-c={b.claimStatus}>{CLAIM_META[b.claimStatus].label}</span>}
      {nums.length > 0 && (
        <span className="bl-refs">
          <span className="bl-sr">Sources: </span>
          {nums.map((n) => <sup key={n}><a id={fnRefId(b.id, n)} href={`#${fnId(n)}`} aria-label={`Source ${n}`}>{n}</a></sup>)}
        </span>
      )}
    </p>
  );
}

function body(b: Block): ReactNode {
  switch (b.type) {
    case "tldr":
      return (
        <div className="bl-tldr">
          <p className="bl-tldr-t">{b.title || "In short"}</p>
          <ul>{b.items.map((it, i) => <li key={i}><InlineText text={it} /></li>)}</ul>
        </div>
      );
    case "heading":
      return b.level === 3 ? <h3 id={anchorId(b.id)} className="bl-h3">{b.text}</h3> : <h2 id={anchorId(b.id)} className="bl-h2">{b.text}</h2>;
    case "text":
      return <div className="bl-text"><Prose body={b.body} k={b.id} /></div>;
    case "image":
      return (
        <figure className="bl-img">
          {/* local SVG/PNG from /public/blog with unknown intrinsic size: a plain img is deliberate */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.src} alt={b.alt} loading="lazy" decoding="async" />
          {b.caption && <figcaption className="bl-cap">{b.caption}</figcaption>}
        </figure>
      );
    case "quote":
      return (
        <figure className="bl-quote">
          <blockquote><p><InlineText text={b.text} /></p></blockquote>
          <figcaption>{b.by}</figcaption>
        </figure>
      );
    case "callout":
      return (
        <div className="bl-call" data-tone={b.tone} role="note">
          <span className="bl-call-ic" aria-hidden="true" />
          <div>
            <p className="bl-call-t">{b.title ? <><span className="bl-sr">{TONE_WORD[b.tone]}: </span>{b.title}</> : TONE_WORD[b.tone]}</p>
            <Prose body={b.body} k={b.id} />
          </div>
        </div>
      );
    case "statRow":
      return (
        <dl className="bl-stats" data-n={b.stats.length}>
          {b.stats.map((s, i) => (
            <div key={i} className="bl-stat">
              <dt>{s.label}</dt>
              <dd><span aria-hidden="true" data-count="">{s.value}</span><span className="bl-sr">{s.value}</span></dd>
            </div>
          ))}
        </dl>
      );
    case "stepList":
      return (
        <div className="bl-steps">
          {b.title && <p className="bl-steps-t">{b.title}</p>}
          <ol>{b.steps.map((s, i) => <li key={i}><span className="bl-steps-n" aria-hidden="true">{i + 1}</span><div><b>{s.title}</b><Prose body={s.body} k={`${b.id}-${i}`} /></div></li>)}</ol>
        </div>
      );
    case "faq":
      return (
        <div className="bl-faq">
          {b.items.map((it, i) => (
            <details key={i}>
              <summary>{it.q}</summary>
              <div className="bl-faq-a"><Prose body={it.a} k={`${b.id}-${i}`} /></div>
            </details>
          ))}
        </div>
      );
    case "divider":
      return <hr className="bl-hr" />;
    case "cta":
      return (
        <div className="bl-cta">
          <p className="bl-cta-t">{b.title}</p>
          {b.body && <p className="bl-cta-b">{b.body}</p>}
          <Link className="btn btn-g s-btn-lg" href={b.href}>{b.label}</Link>
        </div>
      );
    case "caseStudy":
      return <CaseStudy blueprintCode={b.blueprintCode} totalCents={b.totalCents} before={b.before} after={b.after} highlight={b.highlight} />;
    case "moneyFlow":
      return <MoneyFlow totalCents={b.totalCents} releasedBps={b.releasedBps} refundedBps={b.refundedBps ?? 0} feeBps={b.feeBps ?? 250} caption={b.caption} interactive={b.interactive ?? true} />;
    case "trancheTimeline":
      return <TrancheTimeline totalDays={b.totalDays} rail={b.rail ?? "A1"} caption={b.caption} />;
    case "apiSnippet":
      return <ApiSnippet method={b.method} path={b.path} request={b.request} response={b.response} note={b.note} />;
    case "compareTable":
      return (
        <div className="bl-scroll" role="region" aria-label={`Comparison: ${b.columns.join(", ")}`} tabIndex={0}>
          <table className="bl-table bl-compare">
            <thead><tr>{b.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr></thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>{b.columns.map((_, j) => (j === 0 ? <th key={j} scope="row"><InlineText text={r[j] ?? ""} /></th> : <td key={j}><InlineText text={r[j] ?? ""} /></td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Footnote list (article end, and inside the studio preview). */
export function Footnotes({ sources, id = "sources-h", title = "Sources" }: { sources: NumberedSource[]; id?: string; title?: string }) {
  if (!sources.length) return null;
  return (
    <section className="bl-notes" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <ol>
        {sources.map((s) => (
          <li key={s.n} id={fnId(s.n)}>
            <a href={s.url} rel="noopener noreferrer" target="_blank">{s.title}<span className="bl-sr"> (opens in a new tab)</span></a>
            <span className="bl-notes-host">{hostOf(s.url)}</span>
            <a className="bl-back" href={`#${fnRefId(s.blockIds[0], s.n)}`} aria-label={`Back to the text for source ${s.n}`}>↩</a>
          </li>
        ))}
      </ol>
    </section>
  );
}
const hostOf = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };

export function BlockRenderer({ blocks, preview = false }: { blocks: Block[]; preview?: boolean }) {
  const sources = collectSources(blocks);
  const refs = new Map(sources.map((s) => [s.url, s.n]));
  return (
    <div className={`bl-body${preview ? " is-preview" : ""}`}>
      {blocks.map((b) => (
        <div key={b.id} className="bl-b" data-type={b.type} data-anim={b.anim ?? "none"} data-bid={b.id}>
          {body(b)}
          <Credit b={b} refs={refs} />
        </div>
      ))}
      {preview && <Footnotes sources={sources} id="preview-sources-h" />}
    </div>
  );
}
export default BlockRenderer;
