/**
 * A8 · one design scenario on /trust: what could go wrong, what we built, the options we set aside and why, how far it is
 * built, and where to see it. Server-rendered; nothing on this page needs a script.
 */
import Link from "next/link";
import { STATUS_LABEL, STATUS_TONE, type Scenario, type TrustLink } from "@/data/trust";

export function TrustLinks({ links }: { links: readonly TrustLink[] }) {
  return (
    <ul className="tr-links">
      {links.map((l) => (
        <li key={l.href + l.label}>
          <Link href={l.href}>{l.label}</Link>
          {l.as && <span className="tr-as"> · sign in as {l.as}</span>}
        </li>
      ))}
    </ul>
  );
}

export function ScenarioCard({ s, n }: { s: Scenario; n: number }) {
  return (
    <li id={s.id} className="tb-card">
      <article aria-labelledby={`${s.id}-h`}>
        <header className="tb-top">
          <span className="tb-kick">Scenario {String(n).padStart(2, "0")}</span>
          <span className="chip" data-b={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</span>
        </header>
        <h3 id={`${s.id}-h`}>{s.question}</h3>
        <div className="tb-cols">
          <div className="tb-built">
            <p className="tb-label"><span className="tb-ico tb-ico-ok" aria-hidden="true" />How PaySettle resolves it</p>
            <p>{s.built}</p>
            {s.next && <p className="tr-next"><b>Still to do.</b> {s.next}</p>}
          </div>
          <div className="tb-aside">
            <p className="tb-label"><span className="tb-ico tb-ico-no" aria-hidden="true" />Considered and set aside</p>
            <ul>
              {s.setAside.map((a) => (
                <li key={a.option}><b>{a.option}.</b> {a.why}</li>
              ))}
            </ul>
          </div>
        </div>
        <footer className="tr-check"><p className="tr-check-h">See it</p><TrustLinks links={s.links} /></footer>
      </article>
    </li>
  );
}
