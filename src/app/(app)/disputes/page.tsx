/** Disputes for either party (providers reach their disputes here). F4.01 F4.02 F4.03. */
import Link from "next/link";
import "@/styles/disputes.css";
import { requireViewer } from "@/lib/session";
import { disputable, listDisputes } from "@/server/disputes/queries";
import { DisputeTable } from "@/components/disputes/list";
import { money } from "@/components/disputes/format";

export const metadata = { title: "Disputes" };

export default async function Page() {
  const v = await requireViewer(["client", "provider", "ops", "admin", "judge"]);
  const [rows, can] = await Promise.all([listDisputes(v), disputable(v)]);
  return (
    <>
      <div className="phead"><div><h1>Disputes</h1><p className="sub">Each dispute freezes one milestone. Everything else on the contract carries on.</p></div></div>
      <section className="c">
        {rows.length ? <DisputeTable rows={rows} /> : <div className="empty"><b>No disputes.</b></div>}
      </section>
      {can.length > 0 && (
        <section className="c" aria-labelledby="dz-can">
          <div className="c-head"><h2 id="dz-can">Milestones you can dispute</h2></div>
          <ul className="mini-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {can.map((m) => (
              <li key={m.id} className="plan-row"><b>{m.code} · {m.title}</b><span className="small muted">{m.workspace.title}</span><span className="money">{money(m.amountCents, m.currency)}</span>
                <Link className="btn btn-sm" href={`/client/disputes/new?milestone=${m.id}`}>Open a dispute</Link></li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
