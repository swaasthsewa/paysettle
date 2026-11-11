/** F2.11 — the Operations clearance queue: signed contracts with risk ≥ 75, the parts of the score, clear or return. SLA 2 h. X2 F2.10: contract PDF link. */
import Link from "next/link";
import { formatCents } from "@/lib/money";
import { RISK_OPS_THRESHOLD } from "@/lib/policy";
import { clearanceQueue } from "@/server/contracts";
import { currentActor } from "@/server/contracts/web";
import { changeOrderQueue } from "@/server/contracts/change-orders";
import { changeOrderClearanceAction, clearanceAction } from "./actions";
import "@/styles/contracts.css";

export const metadata = { title: "Contract clearance" };
export const dynamic = "force-dynamic";

const PARTS: [string, number, string][] = [["valueBand", 0.3, "Contract value"], ["protectivePruned", 0.25, "Protective clauses switched off"], ["custom", 0.2, "Custom clauses"], ["tier", 0.15, "Provider tier"], ["frontLoad", 0.1, "Front-loaded payments"]];

export default async function Page({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { a } = await currentActor(["ops"]);
  const queue = await clearanceQueue(a);
  const coQueue = await changeOrderQueue(a);
  return (
    <>
      <div className="phead">
        <div><h1>Contract clearance</h1><p className="sub">Contracts both parties signed with a risk score of {RISK_OPS_THRESHOLD} or more. Clear them to lock, or return them with a note. Target: within 2 hours.</p></div>
        <div className="stats"><div className="hstat"><div className="v">{queue.length}</div><div className="l">Waiting</div></div><div className="hstat"><div className="v">{coQueue.length}</div><div className="l">Change orders</div></div></div>
      </div>
      {sp.err && <div className="notice" data-b="danger" role="alert">{sp.err}</div>}
      {sp.ok && <div className="notice" data-b="ok" role="status">{sp.ok === "cleared" ? "Cleared. The contract is locked and its tranches are planned." : sp.ok === "co_cleared" ? "Cleared. The change order is now the contract's latest revision." : "Returned to the parties with your note."}</div>}
      {!queue.length && !coQueue.length && <div className="empty"><p>Nothing is waiting for clearance.</p></div>}
      {coQueue.map((q) => (
        <section key={q.id} className="c" aria-labelledby={`co-${q.id}`}>
          <div className="c-head">
            <h2 id={`co-${q.id}`}><Link href={`/contracts/${q.workspaceId}#co`}>{q.title}</Link> · change order {q.no}</h2>
            <span className="r"><span className="chip" data-b={q.waitingMinutes >= 120 ? "danger" : q.waitingMinutes >= 90 ? "warn" : "ok"}>Waiting {q.waitingMinutes < 120 ? `${q.waitingMinutes} min` : `${Math.floor(q.waitingMinutes / 60)} h ${q.waitingMinutes % 60} min`}</span><span className="risk-score" data-high="">{q.risk.score}</span></span>
          </div>
          <p className="small muted">{q.client} (client) ↔ {q.provider} (provider) · total <span className="money">{formatCents(q.totalFromCents)}</span> → <span className="money">{formatCents(q.totalToCents)}</span> · becomes revision {q.revNo}</p>
          <ul className="small">{q.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <form action={changeOrderClearanceAction} className="stack">
            <input type="hidden" name="coId" value={q.id} />
            <div className="field"><label htmlFor={`con-${q.id}`}>Note to both parties (required to return)</label><textarea id={`con-${q.id}`} name="note" maxLength={1000} /></div>
            <div className="row"><button className="btn btn-g btn-sm" name="decision" value="clear">Clear change order</button><button className="btn btn-sm" name="decision" value="return">Return to the parties</button></div>
          </form>
        </section>
      ))}
      {queue.map((q) => {
        const mins = q.waitingMinutes;
        const sla = mins >= 120 ? "danger" : mins >= 90 ? "warn" : "ok";
        return (
          <section key={q.id} className="c" aria-labelledby={`q-${q.id}`}>
            <div className="c-head">
              <h2 id={`q-${q.id}`}><Link href={`/contracts/${q.id}`}>{q.title}</Link></h2>
              <span className="r"><span className="chip" data-b={sla}>Waiting {mins < 120 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`}</span><span className="risk-score" data-high="">{q.risk.score}</span></span>
            </div>
            <p className="small muted">{q.client} (client) ↔ {q.provider} (provider) · <span className="money">{formatCents(q.totalCents)}</span> · revision {q.revision}{q.violations.length ? ` · ${q.violations.length} policy issue(s)` : ""}</p>
            <div className="bento">
              <div className="span6 risk-parts">
                {PARTS.map(([k, w, label]) => {
                  const part = q.risk.parts[k] ?? 0;
                  return <div className="risk-part" key={k}><span>{label}</span><b>{Math.round(100 * w * part)} / {Math.round(100 * w)}</b><div className="prog" aria-hidden="true"><i style={{ width: `${Math.round(part * 100)}%` }} /></div></div>;
                })}
              </div>
              <form action={clearanceAction} className="span6 stack">
                <input type="hidden" name="wsId" value={q.id} />
                <div className="field"><label htmlFor={`n-${q.id}`}>Note to both parties (required to return)</label><textarea id={`n-${q.id}`} name="note" maxLength={1000} placeholder="Checked the custom clauses with both parties." /></div>
                <div className="row"><button className="btn btn-g btn-sm" name="decision" value="clear">Clear and lock</button><button className="btn btn-sm" name="decision" value="return">Return to the parties</button><a className="btn btn-sm btn-gh" href={`/api/pdf/contract/${q.id}`} aria-label={`Download the signed contract PDF for ${q.title}`}>Contract PDF</a></div>
              </form>
            </div>
          </section>
        );
      })}
    </>
  );
}
