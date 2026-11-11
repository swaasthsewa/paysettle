/** Dispute list table for parties (F4.01 F4.02 F4.03). Server component. */
import Link from "next/link";
import type { listDisputes } from "@/server/disputes/queries";
import { left, money, when } from "./format";
import { StateChip } from "./parts";

type Row = Awaited<ReturnType<typeof listDisputes>>[number];

export function DisputeTable({ rows }: { rows: Row[] }) {
  return (
    <div className="tbwrap">
      <table className="tb">
        <thead><tr><th>Milestone</th><th>Contract</th><th>Stage</th><th>Next</th><th className="n">Frozen amount</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="rowlink">
              <td><Link className="stretch" href={`/disputes/${r.id}`}><b>{r.milestone.code}</b> {r.milestone.title}</Link><div className="small muted">Opened {when(r.createdAt)}</div></td>
              <td>{r.workspace.title}<div className="small muted">{r.client} · {r.provider}</div></td>
              <td><StateChip state={r.state} /></td>
              <td className="small">{r.next ? <>{r.next.label}<div className="muted">{left(r.now, r.next.at)}</div></> : r.verdict ? <>{(r.verdict.providerShareBps / 100).toFixed(0)}% to the provider</> : "—"}</td>
              <td className="n money">{money(r.amountCents, r.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
