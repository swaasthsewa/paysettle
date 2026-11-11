/* F2.06 — the caseStudy block: a blueprint's real milestone list (src/data/blueprints) with each payment
 * milestone's amount for the post's total, split by largest remainder (src/lib/money). Before/after copy is the author's.
 * Highlighted codes are marked visually and in text ("highlighted"), never by colour alone. Server-safe. */
import { formatCents, pct } from "@/lib/money";
import { caseStudyView } from "./math";
import { InlineText } from "./Inline";

export function CaseStudy({ blueprintCode, totalCents, before, after, highlight }: { blueprintCode: string; totalCents: number; before: string; after: string; highlight?: string[] }) {
  const v = caseStudyView(blueprintCode, totalCents);
  const hi = new Set(highlight ?? []);
  return (
    <figure className="bl-case">
      <div className="bl-case-ba">
        <div className="bl-case-b"><span className="bl-case-tag">Before</span><p><InlineText text={before} /></p></div>
        <div className="bl-case-a"><span className="bl-case-tag">With milestones</span><p><InlineText text={after} /></p></div>
      </div>
      {!v ? (
        <p className="notice" data-b="warn">This case study points at a blueprint that is no longer in the library.</p>
      ) : (
        <>
          <div className="bl-case-head">
            <b>{v.blueprint.title}</b>
            <span className="chip" data-b="plain">{v.blueprint.vertical}</span>
            <span className="muted small">{v.rows.length} steps · {v.payCount} paid, {v.gateCount} checkpoints · {v.days} days · {formatCents(v.totalCents)}</span>
          </div>
          <div className="bl-scroll" role="region" aria-label={`${v.blueprint.title} milestones`} tabIndex={0}>
            <table className="bl-table bl-case-table">
              <caption className="bl-sr">Milestones of the {v.blueprint.title} blueprint for {formatCents(v.totalCents)}</caption>
              <thead><tr><th scope="col">Day</th><th scope="col">Step</th><th scope="col">Kind</th><th scope="col" className="num">Share</th><th scope="col" className="num">Amount</th></tr></thead>
              <tbody>
                {v.rows.map((r) => (
                  <tr key={r.code} className={hi.has(r.code) ? "is-hi" : undefined}>
                    <td className="tnum">{r.day}</td>
                    <th scope="row"><span className="bl-case-code">{r.code}</span> {r.title}{hi.has(r.code) && <span className="bl-case-hi"> · highlighted</span>}</th>
                    <td>{r.type === "PAY" ? "Payment" : "Checkpoint"}</td>
                    <td className="num tnum">{r.type === "PAY" ? pct(r.bps) : "—"}</td>
                    <td className="num money">{r.type === "PAY" ? formatCents(r.amountCents) : "no payment"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td /><th scope="row">Total</th><td /><td className="num tnum">100%</td><td className="num money">{formatCents(v.rows.reduce((a, r) => a + r.amountCents, 0))}</td></tr></tfoot>
            </table>
          </div>
        </>
      )}
      <figcaption className="bl-cap">Milestones, days and shares are the blueprint&rsquo;s own, as the app loads them. Amounts are split to the cent by largest remainder.</figcaption>
    </figure>
  );
}
export default CaseStudy;
