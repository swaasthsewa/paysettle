/**
 * F4.01 F4.05 — mediator schedule: every dispute in the organisation on a Bryntum Scheduler, one row per mediator (and
 * one for cases nobody has taken yet), each bar running from opening to the verdict deadline with its phases inside.
 * Below it, the same deadlines in the AG Grid console table, soonest first.
 */
import Link from "next/link";
import { requireViewer } from "@/lib/session";
import { MediatorSchedule } from "@/components/timeline/MediatorSchedule";
import { DataTable } from "@/components/console/DataTable";
import { mediatorSchedule } from "./data";
import "@/styles/timeline.css";

export const metadata = { title: "Mediator schedule" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const v = await requireViewer(["mediator", "judge", "ops", "admin"]);
  const s = await mediatorSchedule(v);
  const open = s.events.filter((e) => e.next);
  const overdue = open.filter((e) => e.overdue);
  const unassigned = open.filter((e) => e.resourceId === "unassigned");
  const mine = open.filter((e) => e.resourceId === v.id);
  return (
    <>
      <div className="phead">
        <div>
          <p className="crumb"><Link href="/mediator">Mediator</Link> › Schedule</p>
          <h1>Schedule</h1>
          <p className="sub">Each case runs from the day it opened to its verdict deadline: sealed offers, then the evidence vault, then the verdict (due 144 hours after opening, 72 on fast track).</p>
        </div>
        <div className="stats">
          {v.role === "mediator" && <div className="hstat"><div className="v tnum">{mine.length}</div><div className="l">Your open cases</div></div>}
          <div className="hstat"><div className="v tnum">{open.length}</div><div className="l">Open cases</div></div>
          <div className="hstat"><div className="v tnum">{unassigned.length}</div><div className="l">Not assigned yet</div></div>
          <div className="hstat"><div className={`v tnum${overdue.length ? " tl-bad" : ""}`}>{overdue.length}</div><div className="l">Past a deadline</div></div>
        </div>
      </div>

      <section className="c" aria-labelledby="sc-h">
        <div className="c-head">
          <h2 id="sc-h">Cases by mediator</h2>
          <div className="r"><Link className="btn btn-sm btn-gh" href="/mediator/cases">Case queue</Link></div>
        </div>
        <ul className="tl-legend" aria-label="Colour key">
          <li><i className="ph offers" aria-hidden="true" />Sealed offers</li>
          <li><i className="ph vault" aria-hidden="true" />Evidence vault</li>
          <li><i className="ph verdict" aria-hidden="true" />Verdict</li>
          <li><i style={{ background: "var(--danger)" }} aria-hidden="true" />Past a deadline</li>
          <li><i style={{ background: "var(--released)" }} aria-hidden="true" />Resolved</li>
          <li><i className="now" aria-hidden="true" />Now</li>
        </ul>
        {s.events.length === 0 ? <p className="muted">No disputes in this organisation yet.</p> : <MediatorSchedule data={s} />}
      </section>

      <section className="c" aria-labelledby="sc-t">
        <div className="c-head"><h2 id="sc-t">Deadlines</h2></div>
        <DataTable caption="Dispute deadlines" persistKey="mediator-deadlines" getRowId="id" exportName="mediator-deadlines" rowToneField="tone"
          initialSort={{ field: "nextAt", dir: "asc" }}
          columnDefs={[
            { field: "milestone", headerName: "Case" },
            { field: "workspace", headerName: "Contract" },
            { field: "mediator", headerName: "Mediator", filter: true },
            { field: "state", headerName: "Stage", type: "state", filter: true },
            { field: "next", headerName: "Next deadline" },
            { field: "nextAt", headerName: "Due", type: "date" },
            { field: "offers", headerName: "Offers close", type: "date", group: "All deadlines", hide: true },
            { field: "vault", headerName: "Vault seals", type: "date", group: "All deadlines", hide: true },
            { field: "verdict", headerName: "Verdict due", type: "date", group: "All deadlines" },
            { field: "amount", headerName: "Disputed", type: "money" },
            { field: "open", headerName: "Open", type: "link", width: 90, sortable: false },
          ]}
          rowData={s.events.map((e) => ({
            id: e.id, milestone: e.milestone, workspace: e.workspace, mediator: e.mediator, state: e.state,
            next: e.next ? (e.overdue ? `${e.next.label} (past due)` : e.next.label) : "None", nextAt: e.next?.at ?? null,
            offers: e.phases[0].to, vault: e.phases[1].to, verdict: e.phases[2].to, amount: e.amountCents,
            tone: e.overdue ? "danger" : null, open: { href: e.href, label: "Open" },
          }))}
          emptyText="No disputes in this organisation yet." />
      </section>
    </>
  );
}
