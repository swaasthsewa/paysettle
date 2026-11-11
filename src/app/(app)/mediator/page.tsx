/** Mediator overview: counts, SLA, root causes and the clause feedback loop (F4.05 F4.06 F4.12). */
import Link from "next/link";
import "@/styles/disputes.css";
import { requireViewer } from "@/lib/session";
import { mediatorOverview } from "@/server/disputes/queries";
import { ROOT_CAUSES } from "@/server/disputes/rules";
import { left, money, when } from "@/components/disputes/format";
import { StateChip } from "@/components/disputes/parts";

export const metadata = { title: "Mediator" };

export default async function Page() {
  const v = await requireViewer(["mediator", "judge", "ops", "admin"]);
  const o = await mediatorOverview(v);
  const mine = o.queue.filter((x) => x.lane === "mine");
  const offered = o.queue.filter((x) => x.lane === "offered"); // offers waiting for an answer
  const open = o.queue.filter((x) => x.lane === "open");
  const cosign = o.queue.filter((x) => x.lane === "cosign");
  const overdue = o.queue.filter((x) => x.overdue && (x.lane === "mine" || x.lane === "open"));
  const due = [...mine, ...open].filter((x) => x.due && x.state === "TIER3").sort((a, b) => a.due!.getTime() - b.due!.getTime());
  const roots = Object.entries(o.roots).sort((a, b) => b[1] - a[1]);
  const rootMax = Math.max(1, ...roots.map(([, n]) => n));
  return (
    <>
      <div className="phead">
        <div><h1>Mediator</h1><p className="sub">Sealed dossiers, verdicts and co-signatures. Verdicts are due 144 hours after a dispute opens (72 on fast track).</p></div>
        <div className="stats">
          <div className="hstat"><div className="v tnum">{offered.length}</div><div className="l"><Link href="/mediator/cases">Offers to answer</Link></div></div>
          <div className="hstat"><div className="v tnum">{mine.length}</div><div className="l">Your cases</div></div>
          <div className="hstat"><div className="v tnum">{open.length}</div><div className="l">Open to take</div></div>
          <div className="hstat"><div className="v tnum">{cosign.length}</div><div className="l">Need your co-signature</div></div>
          <div className="hstat"><div className="v tnum">{overdue.length}</div><div className="l">Past the SLA</div></div>
        </div>
      </div>
      <div className="bento">
        <section className="c span7" aria-labelledby="dz-sla">
          <div className="c-head"><h2 id="dz-sla">Verdicts due</h2><div className="r"><Link className="btn btn-sm" href="/mediator/cases">Case queue</Link></div></div>
          {due.length ? (
            <table className="tb"><thead><tr><th>Case</th><th>Due</th><th className="n">Amount</th></tr></thead><tbody>
              {due.map((x) => (
                <tr key={x.id} className="rowlink"><td><Link className="stretch" href={`/mediator/cases/${x.id}`}><b>{x.milestone}</b></Link><div className="small muted">{x.workspace} · {x.client} and {x.provider}</div></td>
                  <td className="small">{when(x.due)}<div className={x.overdue ? "" : "muted"}>{x.overdue ? <span className="chip" data-b="danger">Past due</span> : left(x.now, x.due!)}</div></td>
                  <td className="n money">{money(x.amountCents, x.currency)}{x.highValue && <div className="small muted">co-sign needed</div>}</td></tr>
              ))}
            </tbody></table>
          ) : <div className="empty"><b>Nothing waiting for a verdict.</b><span className="small">Cases arrive here when a vault is sealed.</span></div>}
        </section>
        <section className="c span5" aria-labelledby="dz-all">
          <div className="c-head"><h2 id="dz-all">All disputes by stage</h2></div>
          <dl className="kv">
            {["TIER1", "TIER2", "TIER3", "EXECUTING", "RESOLVED", "SUPERSEDED"].map((s) => <div key={s}><dt><StateChip state={s} /></dt><dd className="tnum">{o.byState[s] ?? 0}</dd></div>)}
            <div><dt>Average time to verdict</dt><dd>{o.avgHoursToVerdict === null ? "—" : `${o.avgHoursToVerdict.toFixed(1)} h`}</dd></div>
            <div><dt>Settled at Tier 1</dt><dd>{o.tier1Share === null ? "—" : `${Math.round(o.tier1Share * 100)}% of verdicts`}</dd></div>
            <div><dt>Holds with a PayPal dispute</dt><dd className="tnum">{o.externalCount}</dd></div>
          </dl>
        </section>
        <section className="c span5" aria-labelledby="dz-rc">
          <div className="c-head"><h2 id="dz-rc">Root causes</h2></div>
          {roots.length ? roots.map(([k, n]) => (
            <div key={k} className="stack" style={{ gap: 4 }}>
              <div className="row small"><span>{ROOT_CAUSES[k as keyof typeof ROOT_CAUSES] ?? k}</span><span className="sp" /><b className="tnum">{n}</b></div>
              <div className="dz-bar" aria-hidden="true"><i style={{ width: `${(n / rootMax) * 100}%`, background: "var(--g1)" }} /></div>
            </div>
          )) : <p className="muted small">Tagged on every verdict. Nothing tagged yet.</p>}
        </section>
        <section className="c span7" aria-labelledby="dz-fb">
          <div className="c-head"><h2 id="dz-fb">Clause feedback: dispute rate per blueprint milestone</h2></div>
          <p className="small muted">Baseline milestones that left draft. A rate over 8% flags the template for Growth to rework its criteria or proof spec.</p>
          {o.rates.length ? (
            <table className="tb"><thead><tr><th>Blueprint</th><th>Milestone</th><th className="n">Disputes</th><th className="n">Rate</th><th></th></tr></thead><tbody>
              {o.rates.filter((r) => r.disputes > 0 || r.flagged).slice(0, 12).map((r) => (
                <tr key={`${r.blueprintCode}-${r.milestoneCode}`}><td>{r.blueprintCode}</td><td>{r.milestoneCode}</td><td className="n tnum">{r.disputes} / {r.milestones}</td><td className="n tnum">{(r.rateBps / 100).toFixed(1)}%</td>
                  <td>{r.flagged ? <span className="chip" data-b="danger">Over 8%</span> : <span className="chip" data-b="ok">OK</span>}</td></tr>
              ))}
            </tbody></table>
          ) : <p className="muted small">No contracts have left draft yet.</p>}
          {o.rates.length > 0 && o.rates.every((r) => r.disputes === 0) && <p className="muted small">No disputes on any blueprint milestone yet.</p>}
        </section>
      </div>
    </>
  );
}
