/**
 * F3.01 F3.02 Fund a tranche: what is being held, for which milestones, the fee per release, the hold window, and the
 * rail in plain words. The client presses "Fund with PayPal"; everyone else on the contract sees the same facts read-only.
 */
import { sameNetworkSignal } from "@/lib/identity/risk-signals";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/session";
import { formatCents, pct } from "@/lib/money";
import { MoneyState } from "@/components/money/MoneyState";
import { TrancheCard } from "@/components/money/TrancheCard";
import { fundView } from "@/server/money/queries";
import { fundAction } from "./actions";
import "@/styles/money.css";

export const metadata = { title: "Fund tranche" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string; trancheId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const v = await requireViewer();
  const { id, trancheId } = await params;
  const sp = await searchParams;
  const d = await fundView(id, trancheId);
  if (!d) notFound();
  const { tranche: t, workspace: w } = d;
  const party = v.id === w.clientId || v.id === w.providerId;
  if (!party && !["ops", "admin", "finance", "judge", "mediator"].includes(v.role)) notFound();
  const isClient = v.id === w.clientId;
  const net = isClient && w.providerId ? await sameNetworkSignal(w.clientId, w.providerId).catch(() => null) : null;
  const amt = formatCents(d.fundCents, w.currency); // milestones plus the early-finish bonus pool, one hold
  const railText = t.rail === "B"
    ? `PayPal takes ${amt} now and keeps it on hold for up to 28 days. Each milestone is paid to ${d.provider} only after you approve it; anything not approved is refunded to you before the hold ends.`
    : `PayPal authorizes ${amt} on your account now — it is reserved, not paid. Each milestone is captured only after you approve it; anything not approved is released back to you.`;
  const canFund = isClient && w.state === "LOCKED" && (t.state === "PLANNED" || t.state === "AWAITING_APPROVAL");
  return (
    <>
      <div className="phead">
        <div>
          <p className="crumb"><Link href={`/contracts/${w.id}`}>{w.title}</Link></p>
          <h1>Fund tranche {t.idx}</h1>
          <p className="sub">{w.title} · {d.client} pays, {d.provider} delivers · days {t.startDay}–{t.endDay}</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v money">{amt}</div><div className="l">held through PayPal</div></div>
          <div className="hstat"><div className="v">{d.windowDays} d</div><div className="l">PayPal hold window</div></div>
        </div>
      </div>

      {sp.error && <p className="notice" data-b="danger" role="alert">{sp.error}</p>}
      {sp.cancelled && <p className="notice" data-b="warn" role="status">{sp.message ?? "You left PayPal before approving. Nothing is held."}</p>}

      <div className="bento">
        <section className="c span8" aria-labelledby="ms-h">
          <div className="c-head"><h2 id="ms-h">What this tranche pays for</h2><span className="r"><MoneyState state={t.state} /></span></div>
          <div className="tbwrap">
            <table className="ptable">
              <thead><tr><th scope="col">Milestone</th><th scope="col">Due</th><th scope="col" className="n">Amount</th><th scope="col" className="n">Fee ({pct(w.feeBps)})</th><th scope="col" className="n">Provider receives</th><th scope="col">State</th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id}>
                    <td><b>{l.code}</b> {l.title}{l.type === "GATE" && <span className="small muted"> · checkpoint, no payment</span>}</td>
                    <td>day {l.day}</td>
                    <td className="n money">{formatCents(l.amountCents, w.currency)}</td>
                    <td className="n">{l.type === "PAY" ? formatCents(l.feeCents, w.currency) : "—"}</td>
                    <td className="n">{l.type === "PAY" ? formatCents(l.netCents, w.currency) : "—"}</td>
                    <td><MoneyState state={l.state} /></td>
                  </tr>
                ))}
                {d.bonusPoolCents > 0 && <tr><td><b>Bonus pool</b> <span className="small muted">pays early-finish bonuses; what is not earned goes back to you when the tranche closes</span></td><td>—</td><td className="n money">{formatCents(d.bonusPoolCents, w.currency)}</td><td className="n">on bonuses paid</td><td className="n">up to {formatCents(d.bonusPoolCents, w.currency)}</td><td /></tr>}
                <tr className="money-total"><td>Total</td><td /><td className="n money">{amt}</td><td className="n">{formatCents(d.totalFee, w.currency)}</td><td className="n">{formatCents(t.amountCents - d.totalFee, w.currency)}{d.bonusPoolCents > 0 ? " + bonuses" : ""}</td><td /></tr>
              </tbody>
            </table>
          </div>
          <p className="small muted">The fee is charged on each release, never up front, and is deducted from the provider&apos;s side. Money returned to you carries no fee.</p>
        </section>

        <aside className="span4 stack">
          <section className="c" aria-labelledby="how-h">
            <h2 id="how-h">How the money moves</h2>
            <p>{railText}</p>
            <ol className="money-steps">
              <li>You approve in PayPal. The hold starts at that moment.</li>
              <li>{d.provider} submits evidence for each milestone; you have 48 hours to review.</li>
              <li>Your signed approval releases that milestone&apos;s amount — and only that amount.</li>
              <li>By day 27 of the hold, approved work is paid and unstarted milestones go back to you. Either of you can roll unfinished work into a new tranche earlier.</li>
            </ol>
          </section>
          {t.heldAt ? (
            <TrancheCard t={{ ...t, currency: w.currency, balance: d.balance }} now={d.now} />
          ) : canFund ? (
            <form action={fundAction} className="c">
              {net && net.level !== "none" && <p className="notice small" data-b="warn" role="note"><b>Same network seen for both parties.</b> {net.summary} This is a warning only.</p>}
              <input type="hidden" name="workspaceId" value={w.id} />
              <input type="hidden" name="trancheId" value={t.id} />
              <p className="small muted">You will be sent to PayPal to approve {amt}. Nothing is charged until you approve each milestone.</p>
              <button className="btn btn-g" type="submit">{t.state === "AWAITING_APPROVAL" ? "Continue to PayPal" : "Fund with PayPal"}</button>
            </form>
          ) : (
            <p className="notice">{w.state !== "LOCKED" ? "This tranche can be funded once both parties have signed and the contract is locked." : isClient ? `This tranche is ${t.state.toLowerCase().replace(/_/g, " ")}.` : `Only ${d.client} (the client) can fund this tranche.`}</p>
          )}
        </aside>
      </div>
    </>
  );
}
