/** Ops overview (F2.11 clearance SLA 2 h / escalation 90 min, hold windows, escalations, dispute SLAs, F4.10 PayPal disputes). */
import { requireViewer } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { opsOverview } from "@/server/control/consoles";
import { canDualControl, expireDue, queue, type DcAction } from "@/server/control/dual";
import { DataTable } from "@/components/console/DataTable";
import { DualControlQueue, Flash, Head, one, Stat, type SP } from "@/components/console/parts";
import { fmtAge, fmtHours, iso } from "@/components/console/format";
import { representmentCounts } from "@/server/representment";

export const metadata = { title: "Operations" };

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["ops", "admin", "judge"]);
  const sp = await searchParams;
  await expireDue();
  const [o, q, rep] = await Promise.all([opsOverview(), queue({ limit: 40 }), representmentCounts()]);
  const forMe = q.filter((i) => canDualControl(v.role, i.action as DcAction) && (i.state === "AWAITING"));
  const breached = o.clearance.filter((c) => c.status !== "ON_TIME").length;
  return (
    <>
      <Head title="Operations" sub="What needs a person today: risky contracts to clear, holds close to PayPal’s window, reviews that timed out and disputes near their deadline." />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <div className="cx-stats">
        <Stat label="Waiting for clearance" value={o.clearance.length} tone={breached ? "danger" : o.clearance.length ? "warn" : "ok"} detail={breached ? `${breached} past 90 minutes` : "SLA 2 h"} href="/ops/clearance" />
        <Stat label="Holds near window end" value={o.radar.length} tone={o.radar.some((r) => (r.hoursLeft ?? 99) <= 72) ? "danger" : o.radar.length ? "warn" : "ok"} detail="within 7 days" href="/ops/radar" />
        <Stat label="Escalated reviews" value={o.escalated.length} tone={o.escalated.length ? "warn" : "ok"} detail="client did not review in 72 h" />
        <Stat label="Disputes near deadline" value={o.nearingSla.length} tone={o.nearingSla.length ? "danger" : "ok"} detail="within 24 h" />
        <Stat label="PayPal disputes" value={rep.total} tone={rep.failed ? "danger" : rep.notEligible + rep.pending ? "warn" : rep.total ? "ok" : undefined} detail={rep.failed ? `${rep.failed} dossier(s) not sent` : rep.notEligible + rep.pending ? `${rep.notEligible + rep.pending} waiting on PayPal` : "dossiers sent to PayPal"} href="/ops/representments" />
        <Stat label="Four-eyes for you" value={forMe.filter((i) => i.initiatorId !== v.id).length} tone={forMe.length ? "held" : undefined} href="/admin/dual-control" />
      </div>
      <div className="bento">
        <section className="c span6">
          <div className="c-head"><h2>Contract clearance</h2><a className="r small" href="/ops/clearance">Open queue</a></div>
          <DataTable caption="Contracts waiting for clearance" quickFilter={false} getRowId="id"
            columnDefs={[{ field: "title", headerName: "Contract" }, { field: "risk", headerName: "Risk", type: "number" }, { field: "total", headerName: "Value", type: "money" }, { field: "age", headerName: "Waiting" }, { field: "status", headerName: "SLA", type: "state" }]}
            rowData={o.clearance.map((c) => ({ id: c.id, title: c.title, risk: c.riskScore, total: c.totalCents, age: fmtAge(c.ageMs), status: c.status }))} emptyText="No contract is waiting for clearance." />
        </section>
        <section className="c span6">
          <div className="c-head"><h2>Holds near PayPal’s window</h2><a className="r small" href="/ops/radar">Open radar</a></div>
          <DataTable caption="Holds near window end" quickFilter={false} getRowId="id" initialSort={{ field: "hours", dir: "asc" }}
            columnDefs={[{ field: "title", headerName: "Contract" }, { field: "amount", headerName: "Held", type: "money" }, { field: "state", headerName: "State", type: "state" }, { field: "hours", headerName: "Hours left", type: "number" }, { field: "left", headerName: "Window" }]}
            rowData={o.radar.map((r) => ({ id: r.id, title: `${r.title} · T${r.idx}`, amount: r.amountCents, state: r.state, hours: r.hoursLeft, left: fmtHours(r.hoursLeft ?? 0) }))} emptyText="No hold ends within 7 days." />
        </section>
        <section className="c span6">
          <div className="c-head"><h2>Escalated milestone reviews</h2></div>
          <DataTable caption="Escalated milestones" quickFilter={false} getRowId="id"
            columnDefs={[{ field: "title", headerName: "Contract" }, { field: "code", headerName: "Milestone", type: "code" }, { field: "name", headerName: "Title" }, { field: "amount", headerName: "Amount", type: "money" }, { field: "due", headerName: "Review was due", type: "date" }]}
            rowData={o.escalated.map((m) => ({ id: m.id, title: m.title, code: m.code, name: m.milestone, amount: m.amountCents, due: iso(m.reviewDueAt) }))} emptyText="No review has timed out." />
        </section>
        <section className="c span6">
          <div className="c-head"><h2>Disputes by deadline</h2></div>
          <DataTable caption="Open disputes by deadline" quickFilter={false} getRowId="id" initialSort={{ field: "hours", dir: "asc" }}
            columnDefs={[{ field: "title", headerName: "Contract" }, { field: "code", headerName: "Milestone", type: "code" }, { field: "state", headerName: "Stage", type: "state" }, { field: "amount", headerName: "Disputed", type: "money" }, { field: "hours", headerName: "Hours left", type: "number" }, { field: "left", headerName: "Deadline" }]}
            rowData={o.disputeSla.map((d) => ({ id: d.id, title: d.title, code: d.code, state: d.state, amount: d.amountCents, hours: d.hoursLeft, left: fmtHours(d.hoursLeft) }))} emptyText="No open disputes." />
        </section>
      </div>
      <section className="c">
        <div className="c-head"><h2>Four-eyes requests you can act on</h2><a className="r small" href="/admin/dual-control">Full queue</a></div>
        <DualControlQueue items={forMe} viewer={v} back="/ops" showDecided={false} />
      </section>
      <p className="small muted">Amounts: {formatCents(o.radar.reduce((a, r) => a + r.amountCents, 0))} held in tranches near window end. Timers use each contract’s clock (the playground can move it).</p>
    </>
  );
}
