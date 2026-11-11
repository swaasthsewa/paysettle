/**
 * F4.05 — "Why this mediator": the router's stored score breakdown for the current offer or assignment, the offer
 * window, and (for staff and mediators) earlier offers and who was excluded and why. Parties see the chosen mediator's
 * score and only counts of the others. Server component; data from src/server/mediators assignmentOf().
 */
import type { Assignment } from "@/server/mediators";
import { EXCLUSION_LABEL, type Exclusion, type ScoreBreakdown } from "@/server/mediators/router";
import { DOMAINS, type DomainKey } from "@/server/mediators/domains";
import { when } from "./format";

const ANSWER: Record<string, { label: string; chip: string }> = {
  ACCEPTED: { label: "Accepted", chip: "ok" }, DECLINED: { label: "Declined", chip: "warn" }, EXPIRED: { label: "Expired", chip: "none" },
};

export function WhyMediator({ a, detail, now }: { a: Assignment; detail: "party" | "full"; now: Date }) {
  const b: ScoreBreakdown | null = a.breakdown;
  const cur = a.current;
  const name = (id: string) => a.names[id] ?? id;
  const counts = new Map<Exclusion, number>();
  for (const x of b?.excluded ?? []) for (const r of x.reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  const queued = a.flags?.opsQueueAt && !cur;
  if (!b && !queued && !a.offers.length) return null;
  return (
    <section className="c md-why" aria-labelledby="md-why-h">
      <div className="c-head">
        <h2 id="md-why-h">Why this mediator</h2>
        {b && <span className="chip" data-b="plain">{b.mode === "network" ? "Scored by the network router" : "Legacy pool, conflict-checked"}</span>}
      </div>
      {queued && <p className="notice" data-b="warn">With the Ops lead since {when(a.flags!.opsQueueAt)}: {a.flags!.opsQueueReason ?? "no mediator accepted in time"}. Ops assigns an eligible mediator by hand.</p>}
      {cur && b && (
        <>
          <p>
            <b>{name(cur.mediatorId)}</b> ranked {b.rank} of {b.eligible} eligible mediator{b.eligible === 1 ? "" : "s"} ({b.considered} considered) with <b className="tnum">{b.total}</b> of 1,000 points.
            {" "}{cur.answer === "ACCEPTED" ? <>Accepted {when(cur.answeredAt)}.</> : <>Offer open until {when(cur.expiresAt)}{now >= cur.expiresAt ? " (passed — moving on at the next check)" : ""}; if declined or not answered, the case goes to the next mediator.</>}
          </p>
          <ul className="md-parts" aria-label="Score parts">
            {b.parts.map((p) => (
              <li key={p.part}>
                <div className="row small"><b>{p.label}</b><span className="muted">weight {p.weight}</span><span className="sp" /><b className="tnum">{p.points}</b><span className="muted tnum">/ {p.weight}</span></div>
                <div className="md-meter" aria-hidden="true"><i style={{ width: `${Math.round(p.value * 100)}%` }} /></div>
                <span className="small muted">{p.note}</span>
              </li>
            ))}
          </ul>
          {b.tieBreak && <p className="small muted">{b.tieBreak}</p>}
          {cur.source === "BACKFILL" && <p className="small muted">This case was assigned before the network router existed. The score shows how the router rates that assignment with today&apos;s data.</p>}
          {cur.source === "OPS" && <p className="small muted">Offered by the Ops lead after earlier offers were declined or ran out of time.</p>}
          <p className="small muted">
            Case domain: {b.domain ? DOMAINS[b.domain as DomainKey]?.label ?? b.domain : "not mapped"} ({b.blueprintCode || "—"}). Excluded before scoring:{" "}
            {counts.size ? [...counts].map(([r, n]) => `${n} ${EXCLUSION_LABEL[r]}`).join("; ") : "nobody"}.
          </p>
        </>
      )}
      {detail === "full" && (
        <>
          {b && b.runnersUp.length > 0 && <p className="small">Next in line: {b.runnersUp.map((r) => `${name(r.id)} (${r.total})`).join(", ")}.</p>}
          {b && b.excluded.length > 0 && (
            <details className="md-details"><summary className="small">Excluded mediators ({b.excluded.length})</summary>
              <ul className="small">{b.excluded.map((x) => <li key={x.id}>{name(x.id)}: {x.reasons.map((r) => EXCLUSION_LABEL[r]).join(", ")}</li>)}</ul>
            </details>
          )}
          {a.offers.length > 0 && (
            <><h3 className="small" style={{ margin: "14px 0 6px" }}>Offers on this case</h3>
            <div className="tbwrap"><table className="tb"><caption className="sr-only">Offers on this case</caption>
              <thead><tr><th>#</th><th>Mediator</th><th>Source</th><th className="n" style={{ paddingRight: 20 }}>Points</th><th>Answer</th></tr></thead>
              <tbody>{a.offers.map((o) => {
                const s = o.answer ? ANSWER[o.answer] : { label: "Open", chip: "warn" };
                return (
                  <tr key={o.id}><td className="tnum">{o.attempt}</td><td>{name(o.mediatorId)}<div className="small muted">{when(o.offeredAt)}</div></td>
                    <td className="small">{o.source === "ROUTER" ? "Router" : o.source === "OPS" ? "Ops lead" : o.source === "SELF" ? "Took open case" : "Backfill"}</td>
                    <td className="n tnum" style={{ paddingRight: 20 }}>{(o.breakdown as { total?: number }).total ?? "—"}</td>
                    <td><span className="chip" data-b={s.chip}>{s.label}</span>{o.reason && <div className="small muted">{o.reason}</div>}</td></tr>
                );
              })}</tbody>
            </table></div></>
          )}
        </>
      )}
    </section>
  );
}
