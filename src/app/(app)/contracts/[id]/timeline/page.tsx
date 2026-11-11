/**
 * F2.04 F3.03 F3.11 — contract timeline: milestones on a Bryntum Gantt (bars from the previous milestone's day to the
 * target day), dependencies as arrows, tranche hold windows as shaded bands, and a now line on the workspace's virtual
 * clock. Read-only: data comes from getWorkspace; the AG Grid table below repeats the schedule for keyboard and
 * screen-reader use and CSV export.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents } from "@/lib/money";
import { getWorkspace } from "@/server/contracts";
import { currentActor, domainMessage } from "@/server/contracts/web";
import { offsetFor, workspaceNow } from "@/server/clock";
import { ContractTimeline } from "@/components/timeline/ContractTimeline";
import { buildContractPlan, TONE_COLOR, TONE_LABEL, type MsTone } from "@/components/timeline/plan";
import { DataTable } from "@/components/console/DataTable";
import "@/styles/timeline.css";

export const metadata = { title: "Contract timeline" };
export const dynamic = "force-dynamic";

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
const ANCHOR: Record<"funded" | "signed" | "projected", string> = {
  funded: "Day 0 is when tranche 1 was held in PayPal",
  signed: "Day 0 is the signing; dates move to the PayPal hold once tranche 1 is funded",
  projected: "Not signed yet: day 0 is today, so dates are a projection",
};

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { a } = await currentActor();
  let v: Awaited<ReturnType<typeof getWorkspace>>;
  try { v = await getWorkspace(a, id); } catch (e) { domainMessage(e); notFound(); }
  const [now, offset] = await Promise.all([workspaceNow(id), offsetFor(id)]);
  const plan = buildContractPlan(v, now, offset);
  const pay = plan.tasks.flatMap((t) => t.children ?? []).filter((t) => t.kind === "pay");
  const sum = (tone: MsTone) => pay.filter((t) => t.tone === tone).reduce((s, t) => s + t.amountCents, 0);
  const tones: MsTone[] = ["held", "released", "disputed", "refunded", "draft", "gate"];

  return (
    <>
      <div className="phead">
        <div>
          <p className="crumb"><Link href={`/contracts/${id}`}>{v.title}</Link> › Timeline</p>
          <h1>Timeline</h1>
          <p className="sub">{ANCHOR[plan.anchorKind]} ({day(plan.anchor)}). Now is {day(plan.now)}{plan.virtual ? " on this contract's virtual clock" : ""}.</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v money">{formatCents(sum("held"), v.currency)}</div><div className="l">Held in PayPal</div></div>
          <div className="hstat"><div className="v money">{formatCents(sum("released"), v.currency)}</div><div className="l">Released</div></div>
          <div className="hstat"><div className="v money">{formatCents(sum("disputed"), v.currency)}</div><div className="l">Disputed or being fixed</div></div>
        </div>
      </div>

      <section className="c" aria-labelledby="tl-h">
        <div className="c-head">
          <h2 id="tl-h">Milestones over time</h2>
          <div className="r"><Link className="btn btn-sm btn-gh" href={`/contracts/${id}`}>Back to the contract</Link></div>
        </div>
        <ul className="tl-legend" aria-label="Colour key">
          {tones.filter((t) => plan.counts[t] > 0).map((t) => (
            <li key={t}><i style={{ background: TONE_COLOR[t] }} aria-hidden="true" className={t === "gate" ? "gate" : undefined} />{TONE_LABEL[t]} <span className="muted">({plan.counts[t]})</span></li>
          ))}
          <li><i className="band" aria-hidden="true" />Tranche window</li>
          <li><i className="now" aria-hidden="true" />{plan.virtual ? "Now (virtual clock)" : "Now"}</li>
        </ul>
        {plan.rows.length === 0 ? <p className="muted">This contract has no active milestones yet.</p> : <ContractTimeline plan={plan} />}
      </section>

      <section className="c" aria-labelledby="tl-t">
        <div className="c-head"><h2 id="tl-t">Schedule as a table</h2></div>
        <DataTable caption="Milestone schedule" persistKey="contract-timeline" getRowId="id" exportName={`timeline-${id}`} quickFilter={plan.rows.length > 8}
          groupBy={{ field: "tranche", label: "tranche" }}
          columnDefs={[
            { field: "title", headerName: "Milestone" },
            { field: "code", headerName: "Code", type: "code", width: 96 },
            { field: "tranche", headerName: "Tranche", filter: true, width: 120 },
            { field: "type", headerName: "Kind", width: 110 },
            { field: "from", headerName: "From day", type: "number", width: 110 },
            { field: "to", headerName: "Target day", type: "number", width: 118 },
            { field: "due", headerName: "Target date", type: "date" },
            { field: "amount", headerName: "Amount", type: "money" },
            { field: "state", headerName: "State", type: "state", filter: true },
            { field: "where", headerName: "Where the money is" },
            { field: "open", headerName: "Open", type: "link", width: 90, sortable: false },
          ]}
          rowData={plan.rows} currency={v.currency} />
      </section>
    </>
  );
}
