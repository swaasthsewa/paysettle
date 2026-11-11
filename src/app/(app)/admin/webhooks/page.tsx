/** Webhooks & dead-letter queue (F5.02, P7): every PayPal event with its state; DLQ replay goes through four-eyes (F5.03). */
import { requireViewer } from "@/lib/session";
import { deadLetters, webhookList } from "@/server/control/consoles";
import { proposeAction } from "@/server/control/actions";
import { canDualControl } from "@/server/control/dual";
import { DataTable } from "@/components/console/DataTable";
import { Flash, Head, one, Stat, type SP } from "@/components/console/parts";
import { fmtDate, iso } from "@/components/console/format";

export const metadata = { title: "Webhooks & DLQ" };

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["admin", "ops", "judge"]);
  const sp = await searchParams;
  const events = await webhookList(300);
  const dlq = deadLetters(events);
  const count = (s: string) => events.filter((e) => e.state === s).length;
  const mayPropose = canDualControl(v.role, "REPLAY_WEBHOOK");
  return (
    <>
      <Head title="Webhooks & dead-letter queue" sub="PayPal events are verified, de-duplicated on transmission id, then applied. Failures wait here; a replay needs two people." />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <div className="cx-stats">
        <Stat label="Processed" value={count("PROCESSED")} tone="ok" />
        <Stat label="Duplicates ignored" value={count("DUPLICATE")} />
        <Stat label="Quarantined (bad signature)" value={count("QUARANTINED")} tone={count("QUARANTINED") ? "warn" : "ok"} />
        <Stat label="Dead-lettered" value={count("DEAD")} tone={count("DEAD") ? "danger" : "ok"} />
      </div>
      <section className="c">
        <div className="c-head"><h2>Dead-letter queue</h2><span className="chip" data-b={dlq.length ? "warn" : "ok"}>{dlq.length} waiting</span></div>
        {dlq.length === 0 ? <p className="muted">Nothing is waiting. Every verified event was applied.</p> : (
          <ul className="cx-queue">
            {dlq.map((e) => (
              <li key={e.transmissionId} className="cx-item">
                <div className="row"><b>{e.type}</b><code className="cx-code">{e.transmissionId}</code><span className="sp" /><span className="small muted">received {fmtDate(e.receivedAt)}</span></div>
                {e.error && <p className="small">Failed with: {e.error}</p>}
                <p className="meta">Resource {e.resourceId ?? "—"} · replay re-applies the stored, already-verified payload; version checks stop it from overwriting newer state.</p>
                {mayPropose && (
                  <form action={proposeAction} className="cx-inline">
                    <input type="hidden" name="action" value="REPLAY_WEBHOOK" /><input type="hidden" name="target" value={e.transmissionId} /><input type="hidden" name="back" value="/admin/webhooks" />
                    <label className="sr-only" htmlFor={`r-${e.transmissionId}`}>Reason for replay</label>
                    <input id={`r-${e.transmissionId}`} name="reason" className="input" required minLength={10} placeholder="Why replay (for the approver)" />
                    <button className="btn btn-sm" type="submit">Propose replay</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {mayPropose && <p className="small muted">Proposals appear in the <a href="/admin/dual-control">four-eyes queue</a> and expire after 30 minutes.</p>}
      </section>
      <section className="c">
        <div className="c-head"><h2>All events</h2><span className="small muted">latest 300</span></div>
        <DataTable caption="Webhook events" getRowId="id" initialSort={{ field: "receivedAt", dir: "desc" }} pagination paginationPageSize={25}
          columnDefs={[
            { field: "receivedAt", headerName: "Received", type: "date" },
            { field: "type", headerName: "Event", filter: true },
            { field: "state", headerName: "State", type: "state", filter: true },
            { field: "verified", headerName: "Signature", type: "chip" },
            { field: "resourceId", headerName: "Resource", type: "code" },
            { field: "id", headerName: "Transmission", type: "code" },
            { field: "error", headerName: "Error" },
          ]}
          rowData={events.map((e) => ({ id: e.transmissionId, receivedAt: iso(e.receivedAt), type: e.type, state: e.state, verified: e.verified ? { label: "Verified", tone: "ok" } : { label: "Failed", tone: "danger" }, resourceId: e.resourceId, error: e.error }))}
          emptyText="No PayPal events received yet." />
      </section>
    </>
  );
}
