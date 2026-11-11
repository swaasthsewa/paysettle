/** Audit chain explorer (F5.04, F1.10 filters): paged, filtered, with on-demand verification of the whole hash chain.
 *  AG Grid table with a hash-chain column (previous → own hash, copy button, verified / linked / broken badge). */
import { requireViewer } from "@/lib/session";
import { auditPage } from "@/server/control/consoles";
import { verifyChainAction } from "@/server/control/actions";
import { lastCheck } from "@/server/control/health";
import { DataTable } from "@/components/console/DataTable";
import { Flash, Head, one, type SP } from "@/components/console/parts";
import { fmtDate, iso } from "@/components/console/format";

export const metadata = { title: "Audit chain" };

export default async function Page({ searchParams }: { searchParams: SP }) {
  await requireViewer(["admin", "ops", "finance", "judge"]);
  const sp = await searchParams;
  const f = { action: one(sp.action), actor: one(sp.actor), target: one(sp.target), from: one(sp.from), to: one(sp.to), page: Number(one(sp.page) || 1) };
  const [p, last] = await Promise.all([auditPage(f), lastCheck("AUDIT_VERIFY")]);
  const verify = one(sp.verify), brokenAt = Number(one(sp.at) || 0);
  /* chain status per row: broken from this check or the last one; verified when the last full check passed after the entry was written */
  const broken = verify === "broken" ? brokenAt : last && !last.ok ? Number(last.detail.brokenAt ?? 0) : 0;
  const checkedUpTo = last?.ok && verify !== "broken" ? last.at : null;
  const qs = (page: number) => "?" + new URLSearchParams(Object.entries({ ...f, page: String(page) }).filter(([, v]) => v !== "" && v !== undefined) as [string, string][]).toString();
  return (
    <>
      <Head title="Audit chain" sub="Every change is appended to a hash chain: each entry's hash covers the one before it, so editing any past entry breaks every hash after it." />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <section className="c">
        <div className="c-head">
          <h2>Integrity</h2>
          <div className="r">
            {verify === "ok" && <span className="state released">Intact</span>}
            {verify === "broken" && <span className="state disputed">Broken at #{brokenAt}</span>}
            <form action={verifyChainAction}><input type="hidden" name="back" value="/admin/audit" /><button className="btn btn-g btn-sm" type="submit">Verify chain</button></form>
          </div>
        </div>
        <p className="small muted">{last ? `Last check ${fmtDate(last.at)}: ${last.ok ? `intact (${String(last.detail.rows)} entries)` : `broken at #${String(last.detail.brokenAt)}`}.` : "No check recorded yet."} The hourly verifier records a check and pages admins when the chain breaks.</p>
      </section>
      <section className="c">
        <form className="cx-form" method="get" aria-label="Filter audit entries">
          <div className="field"><label htmlFor="f-action">Area</label>
            <select id="f-action" name="action" defaultValue={f.action}><option value="">All areas</option>{p.areas.map((a) => <option key={a} value={a}>{a}</option>)}</select></div>
          <div className="field"><label htmlFor="f-actor">Person</label>
            <select id="f-actor" name="actor" defaultValue={f.actor}><option value="">Anyone (incl. system)</option>{p.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div className="field"><label htmlFor="f-target">Target contains</label><input id="f-target" name="target" type="search" defaultValue={f.target} /></div>
          <div className="field"><label htmlFor="f-from">From</label><input id="f-from" name="from" type="date" defaultValue={f.from} /></div>
          <div className="field"><label htmlFor="f-to">To</label><input id="f-to" name="to" type="date" defaultValue={f.to} /></div>
          <div className="row"><button className="btn btn-d btn-sm" type="submit">Apply</button><a className="btn btn-gh btn-sm" href="/admin/audit">Clear</a></div>
        </form>
        <p className="small muted">The Hash column shows each entry&apos;s previous hash → its own hash. <b>Verified</b>: covered by the last full chain check. <b>Linked</b>: its previous hash matches the entry below it on this page. Copy a full hash with the copy button.</p>
        <DataTable caption="Audit entries" persistKey="audit-entries" getRowId="seq" exportName="audit-chain" quickFilter
          initialSort={{ field: "seq", dir: "desc" }}
          columnDefs={[
            { field: "seq", headerName: "#", type: "number", width: 84 },
            { field: "at", headerName: "When", type: "date" },
            { field: "actor", headerName: "Who" },
            { field: "role", headerName: "Role", filter: true, width: 120 },
            { field: "action", headerName: "Action", type: "code", filter: true },
            { field: "target", headerName: "Target", type: "code" },
            { field: "detail", headerName: "Detail" },
            { field: "hash", headerName: "Hash chain", type: "hash", tooltip: "previous hash → this entry's hash, with its check status" },
          ]}
          rowData={p.rows.map((r, i) => {
            const older = p.rows[i + 1];
            const status = broken && r.seq >= broken ? "broken" as const
              : checkedUpTo && r.at <= checkedUpTo ? "verified" as const
              : older ? (older.hash === r.prevHash ? "linked" as const : "broken" as const) : "unchecked" as const;
            return {
              seq: r.seq, at: iso(r.at), actor: r.actorName ?? r.actorId ?? "system", role: r.actorRole ?? "system", action: r.action, target: r.target,
              detail: JSON.stringify(r.detail).slice(0, 140), hash: { hash: r.hash, prev: r.prevHash, status },
            };
          })}
          emptyText="No audit entries match." />
        <nav className="row cx-pager" aria-label="Audit pages">
          <span className="small muted">{p.total.toLocaleString("en-US")} entries · page {p.page} of {p.pages}</span>
          {p.page > 1 ? <a className="btn btn-sm" href={qs(p.page - 1)}>Newer</a> : <span className="btn btn-sm" aria-disabled="true">Newer</span>}
          {p.page < p.pages ? <a className="btn btn-sm" href={qs(p.page + 1)}>Older</a> : <span className="btn btn-sm" aria-disabled="true">Older</span>}
        </nav>
      </section>
    </>
  );
}
