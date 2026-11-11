/** Reconciliation (F5.01, P6): run now, run history, and each tranche's three planes side by side
 *  (AG Grid column groups A · B · C with highlighted difference columns). */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { tranches, workspaces } from "@/db/schema";
import { requireViewer } from "@/lib/session";
import { canWrite } from "@/lib/rbac";
import { formatCents } from "@/lib/money";
import { reconHistory, reconRunLines, IN_FLIGHT_MS } from "@/server/control/recon";
import { runReconAction } from "@/server/control/actions";
import { DataTable } from "@/components/console/DataTable";
import { Flash, Head, one, Stat, type SP } from "@/components/console/parts";
import { fmtDate, human, iso, stateClass } from "@/components/console/format";
import { isSeededExample, SEEDED_EXAMPLE_LABEL } from "@/server/control/demo-fixtures";

export const metadata = { title: "Reconciliation" };
type Line = Awaited<ReturnType<typeof reconRunLines>>[number];

function Planes({ l }: { l: Line }) {
  const a = l.planeA, b = l.planeB, c = l.planeC;
  return (
    <div className="cx-planes">
      <div className="cx-plane"><h4>A · Signed contract</h4><dl>
        <dt>Payment milestones</dt><dd>{formatCents(a.contractCents)}</dd>
        <dt>Tranche amount</dt><dd>{formatCents(a.trancheCents)}</dd>
        <dt>Still unpaid</dt><dd>{formatCents(a.openCents)}</dd></dl></div>
      <div className="cx-plane"><h4>B · Ledger</h4><dl>
        <dt>Held</dt><dd>{formatCents(b.holdCents)}</dd>
        <dt>Released (net)</dt><dd>{formatCents(b.releaseCents)}</dd>
        <dt>Fees</dt><dd>{formatCents(b.feeCents)}</dd>
        <dt>Returned</dt><dd>{formatCents(b.returnedCents)}</dd>
        <dt>Remaining</dt><dd>{formatCents(b.remainingCents)}</dd></dl></div>
      <div className="cx-plane" data-off={!c.available || undefined}><h4>C · {c.source}</h4>{c.available ? <dl>
        <dt>Authorized</dt><dd>{formatCents(c.authorizedCents)}</dd>
        <dt>Captured (gross)</dt><dd>{formatCents(c.capturedCents)}</dd>
        <dt>Refunded or voided</dt><dd>{formatCents(c.returnedCents)}</dd>
        <dt>Transactions</dt><dd>{c.txns}</dd></dl> : <p className="small muted">No PayPal data for this tranche in this run.</p>}</div>
    </div>
  );
}

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["finance", "admin", "judge"]);
  const sp = await searchParams;
  const runs = await reconHistory(30);
  const runId = one(sp.run) || runs[0]?.id;
  const run = runs.find((r) => r.id === runId) ?? runs[0];
  const allLines = run ? await reconRunLines(run.id) : [];
  const names = allLines.length ? await db.select({ id: tranches.id, idx: tranches.idx, title: workspaces.title, workspaceId: tranches.workspaceId }).from(tranches).innerJoin(workspaces, eq(workspaces.id, tranches.workspaceId)).where(inArray(tranches.id, allLines.map((l) => l.trancheId))) : [];
  const nameOf = (id: string) => { const n = names.find((x) => x.id === id); return n ? `${n.title} · tranche ${n.idx}` : id; };
  const wsOf = (id: string) => names.find((x) => x.id === id)?.workspaceId ?? "";
  // per-contract summary and filter: a reviewer can find their own contract's tranches without reading every row
  const byContract = [...new Map(names.map((n) => [n.workspaceId, n.title])).entries()].map(([id, title]) => {
    const ls = allLines.filter((l) => wsOf(l.trancheId) === id);
    return { id, title, total: ls.length, matched: ls.filter((l) => l.status === "MATCHED").length, waiting: ls.filter((l) => l.status === "IN_FLIGHT" || l.status === "UNAVAILABLE").length, inFlight: ls.filter((l) => l.status === "IN_FLIGHT").length, drift: ls.filter((l) => l.status === "DRIFT").length, seeded: isSeededExample(id) };
  }).sort((a, b) => a.title.localeCompare(b.title));
  const contract = byContract.find((c) => c.id === one(sp.contract));
  const lines = contract ? allLines.filter((l) => wsOf(l.trancheId) === contract.id) : allLines;
  const attention = lines.filter((l) => l.status !== "MATCHED");
  const seededOnly = attention.length > 0 && attention.every((l) => isSeededExample(l.trancheId));
  return (
    <>
      <Head title="Reconciliation" sub={`Three planes per tranche: the signed contract, our ledger and PayPal. Differences younger than ${IN_FLIGHT_MS / 60_000} minutes are in flight; older ones are drift and stop that tranche's releases.`} />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <div className="cx-stats">
        <Stat label="This run" value={run ? human(run.verdict) : "No runs yet"} tone={!run ? "warn" : run.verdict === "CLEAN" ? "ok" : run.verdict === "DRIFT" ? "danger" : "warn"} detail={run ? fmtDate(run.createdAt) : undefined} />
        <Stat label="Matched" value={run?.matched ?? 0} tone="ok" />
        <Stat label="Waiting (in flight or no PayPal data)" value={run?.inFlight ?? 0} tone={run?.inFlight ? "held" : undefined} />
        <Stat label="Drift exceptions" value={run?.exceptions.length ?? 0} tone={run?.exceptions.length ? "danger" : "ok"} detail={run && run.exceptions.length > 0 && run.exceptions.every((e) => isSeededExample(e.trancheId)) ? "all from the seeded example" : undefined} />
      </div>
      {seededOnly && !contract && <p className="c small" role="note"><b>{SEEDED_EXAMPLE_LABEL}.</b> The drift below comes from a demo contract seeded on purpose with a duplicate release posting. Every other contract&apos;s tranches are listed under By contract.</p>}
      <section className="c">
        <div className="c-head"><h2>{run ? `Run ${run.id}` : "No run yet"}</h2>
          {canWrite(v.role, "recon.run") && <div className="r"><form action={runReconAction}><input type="hidden" name="back" value="/finance/recon" /><button className="btn btn-g btn-sm" type="submit">Run now</button></form></div>}
        </div>
        {run && <p className="small muted">Window {fmtDate(run.windowStart)} to {fmtDate(run.windowEnd)} · {lines.length} {lines.length === 1 ? "tranche" : "tranches"} checked{contract ? <> for {contract.title} · <a href={`/finance/recon?run=${run.id}`}>Show all contracts</a></> : ""}.</p>}
        {attention.length === 0 && run && <p className="muted">Every tranche matched on all three planes.</p>}
        <div className="stack">
          {attention.map((l) => (
            <article key={l.id} className="cx-exc" data-b={l.status}>
              <div className="row"><b>{nameOf(l.trancheId)}</b><code className="cx-code">{l.trancheId}</code><span className="sp" />{l.trippedBreaker && <span className="chip" data-b="danger">Breaker tripped by this run</span>}<span className={stateClass(l.status)}>{human(l.status)}</span></div>
              {isSeededExample(l.trancheId) && <p className="small"><span className="chip" data-b="warn">{SEEDED_EXAMPLE_LABEL}</span></p>}
              <Planes l={l} />
              {l.notes.length > 0 && <ul className="cx-notes">{l.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
            </article>
          ))}
        </div>
      </section>
      {byContract.length > 0 && run && (
        <section className="c">
          <div className="c-head"><h2>By contract</h2></div>
          <p className="small muted">Each contract&apos;s tranches in this run. Open a contract to see only its tranches.</p>
          <DataTable caption="Reconciliation by contract" getRowId="id" quickFilter={byContract.length > 8}
            columnDefs={[
              { field: "contract", headerName: "Contract", type: "link", width: 280 },
              { field: "result", headerName: "Result", type: "state", filter: true },
              { field: "matched", headerName: "Matched", type: "number" }, { field: "waiting", headerName: "Waiting", type: "number" }, { field: "drift", headerName: "Drift", type: "number" },
              { field: "note", headerName: "Note", width: 360 },
            ]}
            rowData={byContract.map((c) => ({
              id: c.id, contract: { href: `/finance/recon?run=${run.id}&contract=${c.id}`, label: c.title },
              result: c.drift ? "DRIFT" : c.inFlight ? "IN_FLIGHT" : c.waiting ? "UNAVAILABLE" : "MATCHED", matched: c.matched, waiting: c.waiting, drift: c.drift,
              note: c.seeded ? SEEDED_EXAMPLE_LABEL : c.matched === c.total ? `All ${c.total} matched` : null,
            }))} />
        </section>
      )}
      {lines.length > 0 && (
        <section className="c">
          <div className="c-head"><h2>{contract ? `${contract.title}: tranches in this run` : "All tranches in this run"}</h2></div>
          <p className="small muted">The three planes side by side. <b>A↔B</b> is what the ledger still holds minus what the contract still owes; <b>A</b> is the tranche amount minus its signed payment milestones. Any difference that is not zero is highlighted; explained differences are listed under Notes in the exceptions above.</p>
          <DataTable caption="Reconciliation lines" persistKey="recon-lines" getRowId="id" exportName={`recon-${run?.id ?? "run"}`} rowToneField="tone"
            initialSort={{ field: "dAB", dir: "asc" }}
            columnDefs={[
              { field: "tranche", headerName: "Tranche", pinned: "left" },
              { field: "status", headerName: "Result", type: "state", filter: true },
              { field: "a", headerName: "Payment milestones", type: "money", group: "A · Signed contract" },
              { field: "aTranche", headerName: "Tranche amount", type: "money", group: "A · Signed contract", hide: true },
              { field: "aOpen", headerName: "Still unpaid", type: "money", group: "A · Signed contract" },
              { field: "hold", headerName: "Held", type: "money", group: "B · Ledger" },
              { field: "release", headerName: "Released (net)", type: "money", group: "B · Ledger" },
              { field: "fee", headerName: "Fees", type: "money", group: "B · Ledger", hide: true },
              { field: "returned", headerName: "Returned", type: "money", group: "B · Ledger", hide: true },
              { field: "remaining", headerName: "Remaining", type: "money", group: "B · Ledger" },
              { field: "cAuth", headerName: "Authorized", type: "money", group: "C · PayPal", hide: true },
              { field: "c", headerName: "Captured (gross)", type: "money", group: "C · PayPal" },
              { field: "cReturned", headerName: "Refunded or voided", type: "money", group: "C · PayPal", hide: true },
              { field: "dAB", headerName: "A↔B", type: "diff", group: "Difference", tooltip: "Ledger remaining minus unpaid milestones" },
              { field: "dA", headerName: "A", type: "diff", group: "Difference", tooltip: "Tranche amount minus its payment milestones", hide: true },
              { field: "cIssues", headerName: "C", type: "chip", group: "Difference", tooltip: "Differences between the ledger and PayPal found by this run" },
              { field: "notes", headerName: "Notes", type: "number", width: 96 },
              { field: "example", headerName: "Example", width: 200, hide: !lines.some((l) => isSeededExample(l.trancheId)) },
            ]}
            rowData={lines.map((l) => {
              const cIssues = l.notes.filter((n) => n.startsWith("C:")).length;
              return {
                id: l.id, tranche: nameOf(l.trancheId), status: l.status, tone: l.status === "DRIFT" ? "danger" : l.status === "IN_FLIGHT" ? "warn" : null,
                a: l.planeA.contractCents, aTranche: l.planeA.trancheCents, aOpen: l.planeA.openCents,
                hold: l.planeB.holdCents, release: l.planeB.releaseCents, fee: l.planeB.feeCents, returned: l.planeB.returnedCents, remaining: l.planeB.remainingCents,
                cAuth: l.planeC.available ? l.planeC.authorizedCents : null, c: l.planeC.available ? l.planeC.capturedCents : null, cReturned: l.planeC.available ? l.planeC.returnedCents : null,
                dAB: l.planeB.remainingCents - l.planeA.openCents, dA: l.planeA.trancheCents - l.planeA.contractCents,
                cIssues: !l.planeC.available ? { label: "No data", tone: "none" as const } : cIssues ? { label: `${cIssues} found`, tone: "danger" as const } : { label: "None", tone: "ok" as const },
                notes: l.notes.length, example: isSeededExample(l.trancheId) ? "Seeded example" : null,
              };
            })} />
        </section>
      )}
      <section className="c">
        <div className="c-head"><h2>History</h2></div>
        <DataTable caption="Reconciliation runs" getRowId="id" initialSort={{ field: "at", dir: "desc" }} pagination paginationPageSize={10}
          columnDefs={[
            { field: "at", headerName: "When", type: "date" }, { field: "verdict", headerName: "Verdict", type: "state", filter: true },
            { field: "matched", headerName: "Matched", type: "number" }, { field: "inFlight", headerName: "Waiting", type: "number" }, { field: "exceptions", headerName: "Exceptions", type: "number" },
            { field: "open", headerName: "Run", type: "link" },
          ]}
          rowData={runs.map((r) => ({ id: r.id, at: iso(r.createdAt), verdict: r.verdict, matched: r.matched, inFlight: r.inFlight, exceptions: r.exceptions.length, open: { href: `/finance/recon?run=${r.id}`, label: r.id === run?.id ? "Showing" : "Open" } }))}
          emptyText="No reconciliation has run yet." />
      </section>
    </>
  );
}
