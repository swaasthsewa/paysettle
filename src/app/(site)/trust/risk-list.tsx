"use client";
/**
 * A8 · the 24 red-team risks with a status filter. Without scripts every risk is listed (the server renders the full
 * list); with scripts the filter buttons narrow it and a polite live region says how many are shown.
 */
import Link from "next/link";
import { useState } from "react";
import { STATUS_LABEL, STATUS_TONE, statusCounts, type Risk, type RiskStatus, type TrustLink } from "@/data/trust";

type Filter = "all" | RiskStatus;

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

export function RiskItem({ r }: { r: Risk }) {
  return (
    <li id={`risk-${r.n}`} className="tr-risk">
      <article aria-labelledby={`risk-${r.n}-h`}>
        <div className="tr-risk-top">
          <span className="tr-n" aria-hidden="true">{r.n}</span>
          <p className="tr-meta">{r.area} · rated {r.rating}/10 · {r.block} · {r.horizon}-month plan</p>
          <span className="chip" data-b={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</span>
        </div>
        <h3 id={`risk-${r.n}-h`}><span className="sr-only">Risk {r.n}: </span>{r.risk}</h3>
        <p className="tr-answer"><b>Our answer.</b> {r.answer}</p>
        {r.next && <p className="tr-next"><b>Still to do.</b> {r.next}</p>}
        <div className="tr-check"><p className="tr-check-h">Check it</p><TrustLinks links={r.links} /></div>
      </article>
    </li>
  );
}

export function RiskList({ risks }: { risks: readonly Risk[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = filter === "all" ? risks : risks.filter((r) => r.status === filter);
  const counts = statusCounts(risks);
  const options: { id: Filter; label: string; n: number }[] = [{ id: "all", label: "All", n: risks.length }, ...counts.map((c) => ({ id: c.status as Filter, label: c.label, n: c.n }))];
  return (
    <>
      <div className="tr-filter" role="group" aria-labelledby="tr-filter-l">
        <span id="tr-filter-l" className="tr-filter-l">Show</span>
        {options.map((o) => (
          <button key={o.id} type="button" className="tr-pill" aria-pressed={filter === o.id} onClick={() => setFilter(o.id)}>
            {o.label} <span className="tr-pill-n">{o.n}</span>
          </button>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{`Showing ${shown.length} of ${risks.length} risks.`}</p>
      <ol className="tr-risks">{shown.map((r) => <RiskItem key={r.n} r={r} />)}</ol>
    </>
  );
}
