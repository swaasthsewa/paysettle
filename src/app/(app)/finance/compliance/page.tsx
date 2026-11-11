/**
 * F5.05 (X2) Finance → compliance: Form 1099-K style review flag per provider per calendar year (gross and payment
 * count against the federal line), and the compliance pack downloads (signed CSV, JSON-LD, PDF). Review aid only:
 * PayPal is the reporting entity for Form 1099-K.
 */
import { requireViewer } from "@/lib/session";
import { formatCents, pct } from "@/lib/money";
import { DISCLAIMER, form1099kLine, NEAR_BPS, TAX_NOTE, taxYearRows, taxYears, type TaxFlag } from "@/server/control/compliance";
import { Head, Stat, one, type SP } from "@/components/console/parts";
import "@/styles/console-extras.css";

export const metadata = { title: "Compliance" };
export const dynamic = "force-dynamic";

const FLAG: Record<TaxFlag, { label: string; tone: string }> = {
  OVER: { label: "Over the line", tone: "danger" }, NEAR: { label: `Near (${NEAR_BPS / 100}%+)`, tone: "warn" }, UNDER: { label: "Under", tone: "plain" },
};

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["finance", "admin", "judge"]);
  const sp = await searchParams;
  const years = await taxYears();
  const asked = Number(one(sp.year));
  const year = years.includes(asked) ? asked : years[0];
  const [rows, line] = [await taxYearRows(year), form1099kLine(year)];
  const over = rows.filter((r) => r.flag === "OVER"), near = rows.filter((r) => r.flag === "NEAR");
  const canDownload = v.role === "finance" || v.role === "admin";
  return (
    <>
      <Head title="Compliance" sub="Released volume per provider, checked against the Form 1099-K line for each calendar year. PayPal files and issues Form 1099-K; this page tells finance whom to look at." />
      <div className="notice" role="note">{TAX_NOTE}</div>
      <div className="cx-stats">
        <Stat label={`Providers paid in ${year}`} value={rows.length} />
        <Stat label="Over the line" value={over.length} tone={over.length ? "danger" : "ok"} detail={`more than ${formatCents(line.grossCents)} and ${line.transactions} payments`} />
        <Stat label="Near the line" value={near.length} tone={near.length ? "warn" : "ok"} detail={`${NEAR_BPS / 100}% of either part`} />
        <Stat label="Released in the year" value={formatCents(rows.reduce((a, r) => a + r.grossCents, 0))} tone="ok" detail="gross, completed releases" />
      </div>
      <section className="c" aria-labelledby="yr-h">
        <div className="c-head"><h2 id="yr-h">Calendar year {year}</h2>
          <form method="get" className="r cnx-yearform">
            <div className="field"><label htmlFor="yr">Year</label><select id="yr" name="year" defaultValue={String(year)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
            <button className="btn btn-sm" type="submit">Show</button>
          </form>
        </div>
        <div className="tbwrap">
          <table className="ptable">
            <caption className="sr-only">Form 1099-K review flag per provider for {year}</caption>
            <thead><tr><th scope="col">Provider</th><th scope="col">Country</th><th scope="col" className="cx-r">Payments</th><th scope="col" className="cx-r">Gross</th><th scope="col" className="cx-r">Fees</th><th scope="col" className="cx-r">Net paid</th><th scope="col" className="cx-r">Share of line</th><th scope="col">Flag</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="muted">No completed releases in {year}.</td></tr>}
              {rows.map((r) => (
                <tr key={r.providerId}>
                  <td><b>{r.provider}</b><div className="small muted">{r.providerId}</div></td>
                  <td>{r.country ?? <span className="muted">—</span>}</td>
                  <td className="cx-r tnum">{r.payments}</td>
                  <td className="cx-r tnum money">{formatCents(r.grossCents)}</td>
                  <td className="cx-r tnum">{formatCents(r.feeCents)}</td>
                  <td className="cx-r tnum">{formatCents(r.netCents)}</td>
                  <td className="cx-r tnum small">{pct(Math.min(r.grossShareBps, 99_999))} of gross · {pct(Math.min(r.countShareBps, 99_999))} of count</td>
                  <td><span className="chip" data-b={FLAG[r.flag].tone}>{FLAG[r.flag].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Both parts must be over the line for the federal rule. Test and playground contracts are left out. Countries come from the provider’s profile when they gave one.</p>
      </section>
      <section className="c" aria-labelledby="dl-h">
        <div className="c-head"><h2 id="dl-h">Compliance pack</h2></div>
        <p className="small">{DISCLAIMER}</p>
        {canDownload ? (
          <div className="row">
            <a className="btn btn-sm btn-g" href={`/api/pdf/compliance?year=${year}`}>Download PDF ({year})</a>
            <a className="btn btn-sm" href="/api/admin/compliance?format=csv">Download CSV</a>
            <a className="btn btn-sm" href="/api/admin/compliance?format=jsonld">Download JSON-LD</a>
          </div>
        ) : <p className="small muted">Downloads are for finance and admins.</p>}
        <p className="small muted">Each download is signed (HMAC-SHA256 with the compliance key when one is set, otherwise a SHA-256 digest) and written to the audit trail.</p>
      </section>
    </>
  );
}
