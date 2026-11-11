/**
 * Growth funnel (F5.09 funnel, pruning heatmap, LTV · F2.12 PII scrubbed; cohorts under 5 suppressed)
 * + X2 F5.09 ops-touch rate: share of signed contracts that needed a person (Ops clearance or a Tier 3 mediator).
 */
import { requireViewer } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { funnel, ltv, opsTouch, pruneHeatmap, shown, SUPPRESSED_LABEL, MIN_COHORT, type Shown } from "@/server/control/analytics";
import { RISK_OPS_THRESHOLD } from "@/lib/policy";
import "@/styles/console-extras.css";
import { Head, Stat } from "@/components/console/parts";

export const metadata = { title: "Funnel" };
const STEPS = [["created", "Created"], ["signed", "Signed"], ["funded", "Funded"], ["completed", "Completed"]] as const;
const pctOf = (n: Shown, d: Shown) => (n === null || d === null || !d ? null : Math.round((n / d) * 100));

/* heat colour: teal ramp mixed into the card colour, so it works in light and dark themes */
const heat = (bps: number | null) => (bps === null ? undefined : { background: `color-mix(in srgb, var(--g1) ${Math.min(85, Math.round(bps / 100 * 0.85 + 6))}%, var(--card))`, color: bps > 4500 ? "#fff" : "var(--ink)" });

export default async function Page() {
  await requireViewer(["marketing", "admin", "ops", "judge"]);
  const [f, heatmap, l, touch] = await Promise.all([funnel(), pruneHeatmap(), ltv(), opsTouch()]);
  const rate = (bps: number | null) => (bps === null ? SUPPRESSED_LABEL : `${(bps / 100).toFixed(1)}%`);
  const t = f.total;
  return (
    <>
      <Head title="Funnel" sub={`Aggregated across all contracts, without names or emails. Any group smaller than ${MIN_COHORT} shows “${SUPPRESSED_LABEL}” instead of a number.`} />
      <div className="cx-stats">
        {STEPS.map(([k, label]) => <Stat key={k} label={`Contracts ${label.toLowerCase()}`} value={shown(t[k])} detail={k === "created" ? undefined : pctOf(t[k], t.created) === null ? undefined : `${pctOf(t[k], t.created)}% of created`} />)}
        <Stat label="Fee revenue per client" value={l.feePerClientCents === null ? SUPPRESSED_LABEL : formatCents(l.feePerClientCents)} detail={l.clients === null ? "too few clients to show" : `${l.clients} clients`} />
        <Stat label="Repeat clients" value={l.repeatRateBps === null ? SUPPRESSED_LABEL : `${(l.repeatRateBps / 100).toFixed(0)}%`} detail="more than one contract" />
        <Stat label="Ops-touch rate" value={rate(touch.rateBps)} tone={touch.rateBps === null ? undefined : touch.rateBps > 2000 ? "warn" : "ok"} detail="signed contracts that needed a person" href="#ops-touch" />
      </div>
      <section className="c" id="ops-touch" aria-labelledby="ot-h">
        <div className="c-head"><h2 id="ot-h">Ops-touch rate</h2><span className="r small muted">{shown(touch.cohort)} signed contracts</span></div>
        <p className="small">How many signed contracts needed someone from PaySettle: Operations clearance (risk score {RISK_OPS_THRESHOLD} or more) or a Tier 3 mediator on any milestone. Lower means the rules and templates do the work. A contract that needed both counts once.</p>
        <ul className="cnx-list" aria-label="Ops-touch parts">
          {([["Needed a person", touch.touched, touch.rateBps], ["Operations clearance", touch.opsClearance, touch.opsRateBps], ["Tier 3 mediator", touch.tier3, touch.tier3RateBps]] as const).map(([label, n, bps]) => (
            <li key={label} className="cnx-meter">
              <span>{label}</span>
              <span className="track" aria-hidden="true"><i style={{ width: `${bps === null ? 0 : Math.min(100, bps / 100)}%` }} data-b={bps !== null && bps > 2000 ? "warn" : undefined} /></span>
              <span className="tnum">{n === null ? SUPPRESSED_LABEL : `${n} · ${rate(bps)}`}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="c">
        <div className="c-head"><h2>All blueprints</h2></div>
        <div className="cx-funnel" role="list">
          {STEPS.map(([k, label]) => {
            const p = pctOf(t[k], t.created);
            return <div key={k} className="cx-bar" role="listitem"><span>{label}</span><span className="track" aria-hidden="true"><i style={{ width: `${p ?? 0}%` }} /></span><span className="n">{shown(t[k])}{p !== null && k !== "created" ? ` · ${p}%` : ""}</span></div>;
          })}
        </div>
      </section>
      <section className="c">
        <div className="c-head"><h2>By blueprint</h2></div>
        <div className="tbwrap">
          <table className="ptable">
            <caption className="sr-only">Funnel by blueprint</caption>
            <thead><tr><th scope="col">Blueprint</th>{STEPS.map(([k, label]) => <th key={k} scope="col" className="cx-r">{label}</th>)}<th scope="col" className="cx-r">Created → completed</th></tr></thead>
            <tbody>
              {f.byBlueprint.map((b) => (
                <tr key={b.code}>
                  <td><b>{b.title}</b><div className="small muted">{b.code}</div></td>
                  {STEPS.map(([k]) => <td key={k} className="cx-r tnum">{b[k] === null ? <span className="muted small">{SUPPRESSED_LABEL}</span> : b[k]}</td>)}
                  <td className="cx-r tnum">{pctOf(b.completed, b.created) === null ? <span className="muted small">—</span> : `${pctOf(b.completed, b.created)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="c">
        <div className="c-head"><h2>Most-pruned baseline milestones</h2><div className="r cx-legend"><span>fewer prunes</span><i style={heat(500)} /><i style={heat(3000)} /><i style={heat(7000)} /><span>more</span></div></div>
        <p className="small muted">Share of contracts on each blueprint whose negotiation removed the milestone. Frequently pruned steps are candidates for rewording or making optional.</p>
        {heatmap.map((b) => (
          <div key={b.code} className="tbwrap">
            <table className="cx-heat">
              <caption className="sr-only">Prune rate per milestone for {b.title}</caption>
              <thead><tr><th scope="col">{b.title} <span className="muted">({shown(b.cohort)} contracts)</span></th>{b.cells.map((c) => <th key={c.code} scope="col" title={c.title}>{c.code}</th>)}</tr></thead>
              <tbody><tr>
                <th scope="row" className="small muted">pruned</th>
                {b.cells.map((c) => c.rateBps === null
                  ? <td key={c.code} data-sup="" title={`${c.title}: ${SUPPRESSED_LABEL}`}>{SUPPRESSED_LABEL}</td>
                  : <td key={c.code} style={heat(c.rateBps)} title={`${c.title}: ${c.pruned} of ${shown(b.cohort)} contracts`}>{(c.rateBps / 100).toFixed(0)}%<div className="small">{c.pruned}</div></td>)}
              </tr></tbody>
            </table>
          </div>
        ))}
      </section>
    </>
  );
}
