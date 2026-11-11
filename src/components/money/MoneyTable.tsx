/** F3.11 Releases and returns table (receipts for clients, payouts for providers). Deadline adjustment line per release. */
import { formatCents } from "@/lib/money";
import { AdjustmentLine, TimingBadge } from "@/components/contracts/deadline-parts";
import type { MoneyLine } from "@/server/money/queries";
import { MoneyState } from "./MoneyState";
import "@/styles/money.css";

export function MoneyTable({ lines, currency, who }: { lines: MoneyLine[]; currency: string; who: "client" | "provider" }) {
  if (!lines.length) return <p className="small muted">No releases or returns on this contract yet.</p>;
  return (
    <div className="tbwrap">
      <table className="ptable">
        <caption className="sr-only">Releases and returns</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col">Tranche</th><th scope="col" className="n">Gross</th><th scope="col" className="n">Fee</th><th scope="col" className="n">{who === "client" ? "Provider receives" : "You receive"}</th><th scope="col">Status</th><th scope="col">PayPal reference</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="small">{l.at.toISOString().slice(0, 10)}</td>
              <td>{l.kind === "RETURN" ? <><b>Returned to client</b> <span className="small muted">{l.label}</span></> : <><b>{l.code}</b> {l.label}{l.kind === "VERDICT" && <span className="small muted"> · mediator verdict</span>}{l.adjustment && <><br /><TimingBadge timing={l.adjustment.timing} daysLate={l.adjustment.daysLate} daysEarly={l.adjustment.daysEarly} /> <AdjustmentLine a={l.adjustment} currency={currency} /></>}</>}</td>
              <td>{l.trancheIdx}</td>
              <td className="n money">{formatCents(l.grossCents, currency)}</td>
              <td className="n">{l.kind === "RETURN" ? "—" : formatCents(l.feeCents, currency)}</td>
              <td className="n">{l.kind === "RETURN" ? "—" : formatCents(l.netCents, currency)}</td>
              <td><MoneyState state={l.status} /></td>
              <td className="small muted">{l.paypalRef?.startsWith("recorded:") ? "not captured" : l.paypalRef ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
