/**
 * F2.04 F3.03 F3.11 — contract timeline: milestones on a Bryntum Gantt (bars from the previous milestone's day to the
 * target day), dependencies as arrows, tranche hold windows as shaded bands, and a now line on the workspace's virtual
 * clock. Read-only: data comes from getWorkspace; the AG Grid table below repeats the schedule for keyboard and
 * screen-reader use and CSV export.
 * F2.13 When the contract has a change order waiting for signatures (or one is opened with ?co=<id>), the viewer can
 * switch between "Signed plan" and "Proposed change order #N": the proposed milestones become the bars and the signed
 * plan is drawn as baselines. The table follows the selected view. Nothing changes until both parties sign the change
 * order in the contract room.
 * F2.14 For a contract in a continuation chain, "Contract chain" shows every period the viewer may see on one calendar:
 * one summary row per period (linking to that contract) with its milestones, and arrows from each period to the next.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents } from "@/lib/money";
import { getWorkspace } from "@/server/contracts";
import { currentActor, domainMessage } from "@/server/contracts/web";
import { offsetFor, workspaceNow } from "@/server/clock";
import { ContractTimeline } from "@/components/timeline/ContractTimeline";
import { buildChainPlan, buildContractPlan, buildProposedPlan, CHANGE_LABEL, TONE_COLOR, TONE_LABEL, type CoChange, type ContractPlan, type MsTone } from "@/components/timeline/plan";
import { changeOrderForTimeline } from "@/server/contracts/change-orders";
import { contractChain } from "@/server/contracts/continuation";
import { DataTable } from "@/components/console/DataTable";
import { trancheSummaries } from "@/server/money/queries";
import "@/styles/timeline.css";

export const metadata = { title: "Contract timeline" };
export const dynamic = "force-dynamic";

const day = (iso: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
const ANCHOR: Record<"funded" | "signed" | "projected", string> = {
  funded: "Day 0 is when tranche 1 was held in PayPal",
  signed: "Day 0 is the signing; dates move to the PayPal hold once tranche 1 is funded",
  projected: "Not signed yet: day 0 is today, so dates are a projection",
};

const CO_STATE: Record<string, string> = { APPLIED: "signed by both parties and in force", DECLINED: "declined", WITHDRAWN: "withdrawn", SUPERSEDED: "superseded", RETURNED: "returned by Operations" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; co?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { a } = await currentActor();
  let v: Awaited<ReturnType<typeof getWorkspace>>;
  try { v = await getWorkspace(a, id); } catch (e) { domainMessage(e); notFound(); }
  const coParam = typeof sp.co === "string" && /^co_[a-z0-9]{1,40}$/.test(sp.co) ? sp.co : null;
  const [now, offset, co, chainIds] = await Promise.all([workspaceNow(id), offsetFor(id), changeOrderForTimeline(a, id, coParam), contractChain(a, id)]);
  const signedPlan = buildContractPlan(v, now, offset);
  /* the proposed view exists only for a change order still waiting for signatures; a closed one is explained, not drawn */
  const coOpen = co && co.open ? co : null;
  const hasChain = chainIds.length > 1;
  const view: "signed" | "proposed" | "chain" = sp.view === "chain" && hasChain ? "chain"
    : coOpen && (sp.view === "proposed" || (coParam && sp.view !== "signed")) ? "proposed" : "signed";
  const proposed = coOpen && view === "proposed" ? buildProposedPlan(v, coOpen, now, offset) : null;
  /* F2.14 each period is read with the same access check as the contract page; one that fails is left out */
  const periods = view === "chain" ? (await Promise.all(chainIds.map(async (c) => {
    try { const w = c.id === id ? v : await getWorkspace(a, c.id); return { input: w, periodNo: c.periodNo, state: w.state, totalCents: w.totalCents }; } catch { return null; }
  }))).filter((x) => x !== null) : [];
  const chain = view === "chain" ? buildChainPlan(periods, now) : null;
  const plan: ContractPlan = chain ?? proposed ?? signedPlan;
  const base = `/contracts/${id}/timeline`;
  const coQs = coParam ? `co=${coParam}&` : "";
  const changeKinds: CoChange[] = ["redated", "added", "removed", "changed"];
  /* the header always describes this contract as signed (money held, released, disputed), whatever view is selected */
  const pay = signedPlan.tasks.flatMap((t) => t.children ?? []).filter((t) => t.kind === "pay");
  const sum = (tone: MsTone) => pay.filter((t) => t.tone === tone).reduce((s, t) => s + t.amountCents, 0);
  /* held, released and returned come from the ledger: a milestone settled by verdict releases only the agreed share */
  const money = (await trancheSummaries(id)).filter((t) => t.heldAt).reduce((a, t) => ({ held: a.held + t.balance.remaining, released: a.released + t.balance.released, returned: a.returned + t.balance.returned }), { held: 0, released: 0, returned: 0 });
  const tones: MsTone[] = ["held", "released", "disputed", "refunded", "draft", "gate"];
  const changeSummary = proposed ? changeKinds.filter((k) => proposed.changes[k] > 0).map((k) => `${CHANGE_LABEL[k]}: ${proposed.changes[k]}`).join(" · ") : "";

  return (
    <>
      <div className="phead">
        <div>
          <p className="crumb"><Link href={`/contracts/${id}`}>{v.title}</Link> › Timeline</p>
          <h1>Timeline</h1>
          <p className="sub">{ANCHOR[signedPlan.anchorKind]} ({day(signedPlan.anchor)}). Now is {day(signedPlan.now)}{signedPlan.virtual ? " on this contract's virtual clock" : ""}.</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v money">{formatCents(money.held, v.currency)}</div><div className="l">Held in PayPal</div></div>
          <div className="hstat"><div className="v money">{formatCents(money.released, v.currency)}</div><div className="l">Released</div></div>
          {money.returned > 0 && <div className="hstat"><div className="v money">{formatCents(money.returned, v.currency)}</div><div className="l">Returned or kept for client</div></div>}
          <div className="hstat"><div className="v money">{formatCents(sum("disputed"), v.currency)}</div><div className="l">Disputed or being fixed</div></div>
        </div>
      </div>

      <section className="c" aria-labelledby="tl-h">
        <div className="c-head">
          <h2 id="tl-h">Milestones over time</h2>
          <div className="r"><Link className="btn btn-sm btn-gh" href={`/contracts/${id}`}>Back to the contract</Link></div>
        </div>
        {(coOpen || hasChain) && (
          <nav aria-label="Timeline views">
            <ul className="tl-views">
              <li><Link className="btn btn-sm btn-gh" href={`${base}?${coQs}view=signed`} aria-current={view === "signed" ? "page" : undefined}>Signed plan</Link></li>
              {coOpen && <li><Link className="btn btn-sm btn-gh" href={`${base}?${coQs}view=proposed`} aria-current={view === "proposed" ? "page" : undefined}>Proposed change order #{coOpen.no}</Link></li>}
              {hasChain && <li><Link className="btn btn-sm btn-gh" href={`${base}?view=chain`} aria-current={view === "chain" ? "page" : undefined}>Contract chain ({chainIds.length} periods)</Link></li>}
            </ul>
          </nav>
        )}
        {chain && (
          <p className="small muted" role="note" data-testid="chain-note">
            {periods.length} periods of this contract on one calendar, each dated from its own day 0; a period that is not signed yet is projected to start where the one before it ends. Select a period&apos;s bar to open that contract.
          </p>
        )}
        {co && !co.open && <p className="muted" role="note">Change order #{co.no} is {CO_STATE[co.state] ?? co.state.toLowerCase()}. This timeline shows the signed plan.</p>}
        {proposed && coOpen && (
          <div className="tl-note" role="note" data-testid="co-timeline-note">
            <p><b>Nothing changes until both parties sign the change order.</b> The upper bars show change order #{coOpen.no} as proposed; the thin bars under them show the signed plan.</p>
            <p className="small">{changeSummary ? `${changeSummary}.` : "No dates change."}{" "}
              {coOpen.signedBy.length ? `Signed so far by the ${coOpen.signedBy.join(" and the ")}.` : "No one has signed it yet."} {coOpen.lines.join(" ")}</p>
            <p><Link href={`/contracts/${id}#co`}>Review change order #{coOpen.no} in the contract room</Link></p>
          </div>
        )}
        <ul className="tl-legend" aria-label="Colour key">
          {tones.filter((t) => plan.counts[t] > 0).map((t) => (
            <li key={t}><i style={{ background: TONE_COLOR[t] }} aria-hidden="true" className={t === "gate" ? "gate" : undefined} />{TONE_LABEL[t]} <span className="muted">({plan.counts[t]})</span></li>
          ))}
          <li><i className="band" aria-hidden="true" />Tranche window</li>
          <li><i className="now" aria-hidden="true" />{plan.virtual ? "Now (virtual clock)" : "Now"}</li>
        </ul>
        {plan.rows.length === 0 ? <p className="muted">This contract has no active milestones yet.</p> : <ContractTimeline plan={plan} mode={chain ? "chain" : proposed ? "proposed" : "plan"} />}
      </section>

      <section className="c" aria-labelledby="tl-t">
        <div className="c-head"><h2 id="tl-t">{chain ? "Contract chain as a table" : proposed ? `Change order #${coOpen!.no} as a table` : "Schedule as a table"}</h2></div>
        {chain && (
          <ul className="tl-chain-list" data-testid="chain-periods" aria-label="Periods in this chain">
            {chain.tasks.map((t) => (
              <li key={t.id}><Link href={t.href!}>{t.name}</Link> <span className="muted small">· {t.stateLabel} · {t.amountLabel} · {t.children?.length ?? 0} milestones</span></li>
            ))}
          </ul>
        )}
        <DataTable key={view} caption={chain ? "Milestones of every period in this chain" : proposed ? `Milestone schedule proposed by change order ${coOpen!.no}, with the signed dates` : "Milestone schedule"} persistKey={chain ? "contract-timeline-chain" : proposed ? "contract-timeline-co" : "contract-timeline"} getRowId="id" exportName={chain ? `timeline-${id}-chain` : proposed ? `timeline-${id}-co${coOpen!.no}` : `timeline-${id}`} quickFilter={plan.rows.length > 8}
          groupBy={{ field: "tranche", label: chain ? "period" : "tranche" }}
          columnDefs={[
            { field: "title", headerName: "Milestone" },
            ...(proposed ? [{ field: "change", headerName: "Change", filter: true, width: 150 }] : []),
            { field: "code", headerName: "Code", type: "code", width: 96 },
            { field: "tranche", headerName: chain ? "Period" : "Tranche", filter: true, width: 120 },
            { field: "type", headerName: "Kind", width: 110 },
            { field: "from", headerName: "From day", type: "number", width: 110 },
            { field: "to", headerName: "Target day", type: "number", width: 118 },
            { field: "due", headerName: proposed ? "Proposed date" : "Target date", type: "date" },
            ...(proposed ? [{ field: "signedDue", headerName: "Signed date", type: "date" as const }] : []),
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
