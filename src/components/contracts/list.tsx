/** F2.02 F2.03 — the contract list for a client or a provider (title, counterpart, state, total, updated). */
import Link from "next/link";
import { formatCents } from "@/lib/money";
import { WsChip } from "./chips";
import "@/styles/contracts.css";

export interface ListRow { id: string; title: string; state: string; totalCents: number; counterpart: string; updatedAt: Date }

const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);

export function ContractList({ rows, counterpartLabel, empty }: { rows: ListRow[]; counterpartLabel: string; empty: React.ReactNode }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <div className="tbwrap">
      <table className="tb">
        <thead><tr><th scope="col">Contract</th><th scope="col">{counterpartLabel}</th><th scope="col">State</th><th scope="col" className="n">Total</th><th scope="col">Updated</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="rowlink">
              <td><Link className="stretch" href={`/contracts/${r.id}`}><b>{r.title}</b></Link></td>
              <td>{r.counterpart}</td>
              <td><WsChip state={r.state} /></td>
              <td className="n money">{formatCents(r.totalCents)}</td>
              <td className="muted small">{fmtDate(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
