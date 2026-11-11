/** Provider health (F5.10): 90-day releases, disputes, dispute ratio, trust tier with rehabilitation; tier changes via four-eyes. */
import { requireViewer } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { providerHealth, REHAB_STREAK } from "@/server/control/providers";
import { canDualControl, expireDue, queue } from "@/server/control/dual";
import { proposeAction } from "@/server/control/actions";
import { DataTable, type Tone } from "@/components/console/DataTable";
import { DualControlQueue, Flash, Head, one, Stat, type SP } from "@/components/console/parts";

export const metadata = { title: "Provider health" };
const TONE: Record<string, Tone> = { platinum: "grad", standard: "ok", new: "plain", probation: "danger" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["ops", "admin", "judge"]);
  const sp = await searchParams;
  await expireDue();
  const [ps, q] = await Promise.all([providerHealth(), queue({ limit: 40 })]);
  const tierReqs = q.filter((i) => i.action === "SET_TRUST_TIER");
  const changes = ps.filter((p) => p.suggested !== p.tier);
  const may = canDualControl(v.role, "SET_TRUST_TIER");
  return (
    <>
      <Head title="Provider health" sub={`Last 90 days. Under 1% disputes with at least 10 releases is Platinum; up to 1.5% is Standard; above 1.5% is Probation and new contracts pause. ${REHAB_STREAK} clean milestones in a row lift Probation.`} />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <div className="cx-stats">
        <Stat label="Providers" value={ps.length} />
        <Stat label="On probation" value={ps.filter((p) => p.tier === "probation").length} tone={ps.some((p) => p.tier === "probation") ? "danger" : "ok"} />
        <Stat label="Tier changes suggested" value={changes.length} tone={changes.length ? "warn" : "ok"} />
        <Stat label="Paid to providers (90 days)" value={formatCents(ps.reduce((a, p) => a + p.paidCents, 0))} tone="ok" />
      </div>
      <section className="c">
        <DataTable caption="Provider health" getRowId="id" initialSort={{ field: "ratio", dir: "desc" }}
          columnDefs={[
            { field: "name", headerName: "Provider" }, { field: "tier", headerName: "Tier", type: "chip", filter: true },
            { field: "releases", headerName: "Releases", type: "number" }, { field: "disputes", headerName: "Disputes", type: "number" },
            { field: "ratio", headerName: "Dispute ratio", type: "bps" }, { field: "streak", headerName: "Clean streak", type: "number" },
            { field: "paid", headerName: "Paid (net)", type: "money" }, { field: "suggested", headerName: "Rule says", type: "chip" }, { field: "reason", headerName: "Why" },
          ]}
          rowData={ps.map((p) => ({ id: p.id, name: p.name, tier: { label: cap(p.tier), tone: TONE[p.tier] }, releases: p.releases, disputes: p.disputes, ratio: p.ratioBps, streak: p.cleanStreak, paid: p.paidCents, suggested: { label: cap(p.suggested), tone: p.suggested === p.tier ? "plain" : "warn" }, reason: p.reason }))}
          emptyText="No providers yet." />
      </section>
      <section className="c">
        <div className="c-head"><h2>Suggested tier changes</h2></div>
        {changes.length === 0 ? <p className="muted">Every provider’s tier matches the rule.</p> : (
          <ul className="cx-queue">
            {changes.map((p) => {
              const waiting = tierReqs.find((r) => r.target === p.id && r.state === "AWAITING");
              return (
                <li key={p.id} className="cx-item">
                  <div className="row"><b>{p.name}</b><span className="chip" data-b={TONE[p.tier]}>{cap(p.tier)}</span><span aria-hidden="true">→</span><span className="chip" data-b={TONE[p.suggested]}>{cap(p.suggested)}</span></div>
                  <p className="small">{p.reason}</p>
                  {waiting ? <span className="chip" data-b="warn">Change waiting for approval ({waiting.id})</span> : may && (
                    <form action={proposeAction} className="cx-inline">
                      <input type="hidden" name="action" value="SET_TRUST_TIER" /><input type="hidden" name="target" value={p.id} /><input type="hidden" name="tier" value={p.suggested} /><input type="hidden" name="back" value="/ops/providers" />
                      <label className="sr-only" htmlFor={`t-${p.id}`}>Reason</label>
                      <input id={`t-${p.id}`} name="reason" className="input" required minLength={10} defaultValue={`Rule §6.12: ${p.reason}`.slice(0, 200)} />
                      <button className="btn btn-sm" type="submit">Propose {cap(p.suggested)}</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="c">
        <div className="c-head"><h2>Tier requests</h2></div>
        <DualControlQueue items={tierReqs} viewer={v} back="/ops/providers" />
      </section>
    </>
  );
}
