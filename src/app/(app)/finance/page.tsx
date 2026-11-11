/** Finance overview (F3.11 ledger totals, F5.01 breakers, F5.03 clear via four-eyes, F5.05 compliance export; PDF pack + 1099-K review link). */
import { requireViewer } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { financeOverview } from "@/server/control/consoles";
import { canDualControl, expireDue, queue } from "@/server/control/dual";
import { proposeAction, runReconAction } from "@/server/control/actions";
import { lastRecon } from "@/server/control/health";
import { DataTable } from "@/components/console/DataTable";
import { DualControlQueue, Flash, Head, one, Stat, type SP } from "@/components/console/parts";
import { fmtDate, human, stateClass } from "@/components/console/format";
import { isSeededExample, SEEDED_EXAMPLE_LABEL } from "@/server/control/demo-fixtures";

export const metadata = { title: "Finance" };

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["finance", "admin", "judge"]);
  const sp = await searchParams;
  await expireDue();
  const [f, q, recon] = await Promise.all([financeOverview(), queue({ limit: 40 }), lastRecon()]);
  const breakerReqs = q.filter((i) => i.action === "CLEAR_BREAKER");
  const mayClear = canDualControl(v.role, "CLEAR_BREAKER");
  return (
    <>
      <Head title="Finance" sub="Where every cent is: held in PayPal, released to providers, kept as fees, or returned to clients. Totals come from the double-entry ledger." />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <div className="cx-stats">
        <Stat label="Held in PayPal now" value={formatCents(f.heldCents)} tone="held" detail={`${formatCents(f.holdTotalCents)} held in total so far`} />
        <Stat label="Released to providers" value={formatCents(f.releasedCents)} tone="ok" detail="net of fees" />
        <Stat label="Platform fees" value={formatCents(f.feeCents)} />
        <Stat label="Returned to clients" value={formatCents(f.returnedCents)} detail="refunds and voids" />
        <Stat label="Breakers tripped" value={f.breakers.length} tone={f.breakers.length ? "danger" : "ok"} href="#breakers" />
        <Stat label="Last reconciliation" value={recon ? human(recon.verdict) : "None yet"} tone={!recon ? "warn" : recon.verdict === "DRIFT" ? "danger" : recon.verdict === "CLEAN" ? "ok" : "warn"} detail={recon ? fmtDate(recon.createdAt) : undefined} href="/finance/recon" />
      </div>
      <section className="c" id="breakers">
        <div className="c-head"><h2>Tranches stopped by a circuit breaker</h2>
          {v.role !== "judge" && <div className="r"><form action={runReconAction}><input type="hidden" name="back" value="/finance" /><button className="btn btn-sm" type="submit">Run reconciliation now</button></form></div>}
        </div>
        {f.breakers.length === 0 ? <p className="muted">No tranche is stopped. Releases run normally.</p> : (
          <ul className="cx-queue">
            {f.breakers.map((b) => {
              const waiting = breakerReqs.find((r) => r.target === b.id && r.state === "AWAITING");
              return (
                <li key={b.id} className="cx-item">
                  <div className="row"><b>{b.title}</b><span className="small muted">tranche {b.idx} · rail {b.rail}</span><code className="cx-code">{b.id}</code><span className="sp" /><span className="money">{formatCents(b.amountCents)}</span><span className={stateClass("BREAKER")}>Breaker</span></div>
                  {isSeededExample(b.id) && <p className="small"><span className="chip" data-b="warn">{SEEDED_EXAMPLE_LABEL}</span></p>}
                  <p className="small">Releases from this tranche are paused until the drift is explained and two people clear the breaker. The money stays held in PayPal.</p>
                  {b.notes.length > 0 && <ul className="cx-notes">{b.notes.slice(0, 4).map((n, i) => <li key={i}>{n}</li>)}</ul>}
                  {waiting ? <span className="chip" data-b="warn">Clear request waiting for approval ({waiting.id})</span> : mayClear && (
                    <form action={proposeAction} className="cx-inline">
                      <input type="hidden" name="action" value="CLEAR_BREAKER" /><input type="hidden" name="target" value={b.id} /><input type="hidden" name="back" value="/finance" />
                      <label className="sr-only" htmlFor={`cb-${b.id}`}>Why the breaker can be cleared</label>
                      <input id={`cb-${b.id}`} name="reason" className="input" required minLength={10} placeholder="What explains the drift" />
                      <button className="btn btn-sm" type="submit">Propose clearing</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <div className="bento">
        <section className="c span7">
          <div className="c-head"><h2>Breaker requests</h2><a className="r small" href="/admin/dual-control">All four-eyes requests</a></div>
          <DualControlQueue items={breakerReqs} viewer={v} back="/finance" />
        </section>
        <section className="c span5">
          <div className="c-head"><h2>Tranches by state</h2></div>
          <DataTable caption="Tranches by state" quickFilter={false} getRowId="state"
            columnDefs={[{ field: "state", headerName: "State", type: "state" }, { field: "n", headerName: "Tranches", type: "number" }, { field: "cents", headerName: "Amount", type: "money" }]}
            rowData={f.byState.map((s) => ({ state: s.state, n: s.n, cents: s.cents }))} emptyText="No tranches yet." />
        </section>
      </div>
      <section className="c">
        <div className="c-head"><h2>Compliance export</h2></div>
        <p className="small">Provider release volume for the last 12 months, signed so changes are detectable. It is an evidence pack for review, not a legal determination of money-transmitter status. Providers over the review threshold are flagged.</p>
        {v.role === "judge" ? <p className="small muted">Downloads are for finance and admins. <a href="/finance/compliance">See the 1099-K review by provider</a>.</p> : <div className="row"><a className="btn btn-sm" href="/api/admin/compliance?format=csv">Download CSV</a><a className="btn btn-sm" href="/api/admin/compliance?format=jsonld">Download JSON-LD</a><a className="btn btn-sm" href={`/api/pdf/compliance?year=${new Date().getUTCFullYear()}`}>Download PDF</a><a className="btn btn-sm btn-gh" href="/finance/compliance">Form 1099-K review by provider</a></div>}
      </section>
    </>
  );
}
