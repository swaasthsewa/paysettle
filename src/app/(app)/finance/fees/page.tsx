/** Fee schedule (F3.11): platform fee per vertical in basis points, default 250; every change is audited. */
import { requireViewer } from "@/lib/session";
import { canWrite } from "@/lib/rbac";
import { feeFor, formatCents } from "@/lib/money";
import { feeTable, DEFAULT_FEE_BPS, MAX_FEE_BPS } from "@/server/control/fees";
import { setFeeAction } from "@/server/control/actions";
import { DataTable } from "@/components/console/DataTable";
import { Flash, Head, one, type SP } from "@/components/console/parts";
import { iso } from "@/components/console/format";

export const metadata = { title: "Fee schedule" };

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["finance", "admin", "judge"]);
  const sp = await searchParams;
  const rows = await feeTable();
  const may = canWrite(v.role, "fee.configure");
  return (
    <>
      <Head title="Fee schedule" sub={`Platform fee per release, by vertical. Default ${(DEFAULT_FEE_BPS / 100).toFixed(2)}%, deducted from the provider's side, never charged up front; refunded money carries no fee. New contracts take the fee in force when they are created.`} />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <section className="c">
        <DataTable caption="Fee per vertical" getRowId="vertical" quickFilter={false} totals={false}
          columnDefs={[
            { field: "vertical", headerName: "Vertical" }, { field: "feeBps", headerName: "Fee", type: "bps" }, { field: "example", headerName: "Fee on a $2,125.00 release", type: "money" },
            { field: "blueprints", headerName: "Blueprints", type: "number" }, { field: "contracts", headerName: "Contracts", type: "number" },
            { field: "note", headerName: "Last change note" }, { field: "updatedAt", headerName: "Changed", type: "date" },
          ]}
          rowData={rows.map((r) => ({ vertical: r.vertical, feeBps: r.feeBps, example: feeFor(212_500, r.feeBps), blueprints: r.blueprints, contracts: r.contracts, note: r.note, updatedAt: iso(r.updatedAt) }))} />
      </section>
      {may ? (
        <section className="c">
          <div className="c-head"><h2>Change a fee</h2></div>
          <form action={setFeeAction} className="cx-form">
            <div className="field"><label htmlFor="fee-v">Vertical</label><select id="fee-v" name="vertical" required>{rows.map((r) => <option key={r.vertical} value={r.vertical}>{r.vertical} (now {(r.feeBps / 100).toFixed(2)}%)</option>)}</select></div>
            <div className="field"><label htmlFor="fee-p">New fee, percent</label><input id="fee-p" name="feePct" inputMode="decimal" required pattern="\d{1,2}(\.\d{1,2})?" placeholder="2.50" aria-describedby="fee-h" /></div>
            <div className="field wide"><label htmlFor="fee-n">Why (kept in the audit chain)</label><input id="fee-n" name="note" required minLength={5} maxLength={300} /></div>
            <div className="row wide"><button className="btn btn-g" type="submit">Save fee</button><span id="fee-h" className="small muted">Between 0% and {(MAX_FEE_BPS / 100).toFixed(0)}%. Example: 2.50% of {formatCents(212_500)} is {formatCents(feeFor(212_500, 250))} (rounded half to even).</span></div>
          </form>
        </section>
      ) : <p className="small muted">Only Finance can change fees.</p>}
    </>
  );
}
