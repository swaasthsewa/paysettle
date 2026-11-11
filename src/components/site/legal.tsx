/** F3 · a plain-language legal page: the draft line, contents, sections and links to the page beside it. */
import Link from "next/link";
import { site as t } from "@/copy/site";

export interface LegalSection { readonly id: string; readonly title: string; readonly body: readonly string[] }

const PAGES = [
  { href: "/privacy", label: t.legal.privacy.title },
  { href: "/terms", label: t.legal.terms.title },
  { href: "/security", label: t.pages.security.kicker },
];

export function LegalPage({ path, title, lead, sections }: { path: string; title: string; lead: string; sections: readonly LegalSection[] }) {
  return (
    <>
      <header className="s-hero">
        <div className="s-wrap">
          <p className="s-draft" role="note">{t.legal.draft}</p>
          <p className="s-kicker">Legal</p>
          <h1>{title}</h1>
          <p className="s-lead">{lead}</p>
          <p className="s-note">{t.legal.updated}</p>
        </div>
      </header>
      <div className="s-section tight">
        <div className="s-wrap s-legal">
          <nav className="s-toc" aria-labelledby="toc-h">
            <h2 id="toc-h">{t.legal.contents}</h2>
            <ol>{sections.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}</ol>
          </nav>
          <div className="s-prose">
            {sections.map((s) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
                <h2 id={`${s.id}-h`}>{s.title}</h2>
                {s.body.map((line) => <p key={line}>{line}</p>)}
              </section>
            ))}
            <section aria-labelledby="related-h">
              <h2 id="related-h">{t.legal.related}</h2>
              <p className="s-chips">{PAGES.filter((p) => p.href !== path).map((p) => <Link key={p.href} className="btn" href={p.href}>{p.label}</Link>)}</p>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
