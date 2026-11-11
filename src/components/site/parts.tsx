/** F3 · building blocks of the public pages: the page hero, sections, section heads, point lists and the closing band. Server-safe. */
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHero({ kicker, title, lead, children }: { kicker: string; title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <header className="s-hero">
      <div className="s-wrap">
        <p className="s-kicker">{kicker}</p>
        <h1>{title}</h1>
        {lead && <p className="s-lead">{lead}</p>}
        {children}
      </div>
    </header>
  );
}

export function Section({ id, alt, children }: { id: string; alt?: boolean; children: ReactNode }) {
  return (
    <section className={`s-section${alt ? " alt" : ""}`} aria-labelledby={`${id}-h`}>
      <div className="s-wrap">{children}</div>
    </section>
  );
}

export function Head({ id, title, lead }: { id: string; title: string; lead?: ReactNode }) {
  return (
    <div className="s-head s-reveal">
      <h2 id={`${id}-h`}>{title}</h2>
      {lead && <p className="s-lead">{lead}</p>}
    </div>
  );
}

/** Short points: a bold lead-in, then one plain line. */
export function Points({ items }: { items: readonly { b?: string; t: string }[] }) {
  return (
    <ul className="s-points">
      {items.map((p) => <li key={p.b ?? p.t} className="s-reveal"><span className="s-dot" aria-hidden="true" /><span>{p.b && <b>{p.b} </b>}{p.t}</span></li>)}
    </ul>
  );
}

/** The closing band of a short page: the demo and the waitlist. */
export function Cta() {
  return (
    <section className="s-section" aria-labelledby="cta-h">
      <div className="s-wrap">
        <div className="s-cta s-reveal">
          <svg className="s-cta-art" viewBox="0 0 400 60" aria-hidden="true" focusable="false">
            <path d="M0 18 C80 18 120 42 200 30" stroke="#0d9488" />
            <path d="M0 42 C80 42 120 18 200 30" stroke="#f59e0b" />
            <path d="M200 30 H400" stroke="currentColor" />
          </svg>
          <h2 id="cta-h">See it run, start to finish</h2>
          <p>Pick a person in the live demo and take a contract from blueprint to release in a few minutes. Sandbox money only.</p>
          <div className="s-ctas">
            <Link className="btn btn-g s-btn-lg" href="/login">Try the live demo</Link>
            <Link className="btn s-btn-lg" href="/waitlist">Join the waitlist</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The main region of a short page; the skip link in the site nav points here. */
export function SiteMain({ children }: { children: ReactNode }) {
  return <main id="page" className="s-page" tabIndex={-1}>{children}</main>;
}
