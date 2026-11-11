/** Client's disputes (F4.01 F4.02 F4.03 F4.06 F4.08): every dispute on my contracts and the milestones I could dispute now. */
import Link from "next/link";
import "@/styles/disputes.css";
import { requireViewer } from "@/lib/session";
import { disputable, listDisputes } from "@/server/disputes/queries";
import { DisputeTable } from "@/components/disputes/list";
import { money } from "@/components/disputes/format";

export const metadata = { title: "Disputes" };

export default async function Page() {
  const v = await requireViewer(["client", "judge", "ops"]);
  const [rows, can] = await Promise.all([listDisputes(v), disputable(v)]);
  const open = rows.filter((r) => !["RESOLVED", "SUPERSEDED"].includes(r.state));
  const frozen = open.reduce((a, r) => a + r.amountCents, 0);
  return (
    <>
      <div className="phead">
        <div><h1>Disputes</h1><p className="sub">A dispute freezes only the milestone in question. Settled milestones stay paid, and the rest of the contract carries on.</p></div>
        <div className="stats">
          <div className="hstat"><div className="v tnum">{open.length}</div><div className="l">Open</div></div>
          <div className="hstat"><div className="v money">{money(frozen)}</div><div className="l">Frozen in PayPal holds</div></div>
        </div>
      </div>
      <section className="c" aria-labelledby="dz-mine">
        <div className="c-head"><h2 id="dz-mine">Your disputes</h2></div>
        {rows.length ? <DisputeTable rows={rows} /> : <div className="empty"><b>No disputes.</b><span className="small">When proof does not meet the agreed criteria, open one from the milestone below. Nothing else on the contract stops.</span></div>}
      </section>
      <section className="c" aria-labelledby="dz-can">
        <div className="c-head"><h2 id="dz-can">Milestones you can dispute</h2></div>
        <p className="small muted">Only milestones with submitted proof can be disputed. Paid milestones are final within PaySettle.</p>
        {can.length ? (
          <ul className="mini-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {can.map((m) => (
              <li key={m.id} className="plan-row">
                <b>{m.code} · {m.title}</b><span className="small muted">{m.workspace.title}</span>
                <span className="money">{money(m.amountCents, m.currency)}</span>
                <Link className="btn btn-sm" href={`/client/disputes/new?milestone=${m.id}`}>Open a dispute</Link>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">None right now.</p>}
      </section>
    </>
  );
}
