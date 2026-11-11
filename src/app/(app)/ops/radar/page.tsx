/** F3.10 Hold-expiry radar: every tranche still holding money, its day in the PayPal window, the next watchdog action and days left. */
import Link from "next/link";
import { requireViewer } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { MoneyState } from "@/components/money/MoneyState";
import { radar } from "@/server/money/queries";
import { runWatchdogNow } from "./actions";
import "@/styles/money.css";

export const metadata = { title: "Hold-expiry radar" };
const ACTION: Record<string, string> = { REAUTHORIZE_IF_NEEDED: "Reauthorize (Rail A, once)", WARN: "Warn both parties", OFFER_ROLLOVER: "Offer rollover", SETTLE: "Settle the tranche" };
const URG: Record<string, string> = { ok: "On track", warn: "Warned (day 22+)", risk: "Rollover window (day 25+)", danger: "Settling (day 27+)" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireViewer(["ops", "admin", "finance", "judge"]);
  const sp = await searchParams;
  const rows = await radar(sp.test === "1");
  const soon = rows.filter((r) => r.daysLeft < 7).length;
  const held = rows.reduce((s, r) => s + r.remainingCents, 0);
  return (
    <>
      <div className="phead">
        <div><h1>Hold-expiry radar</h1><p className="sub">PayPal holds last 29 days (Rail A authorization) or 28 days (Rail B). The watchdog warns on day 22, offers rollover on day 25 and settles on day 27 — before PayPal&apos;s own expiry.</p></div>
        <div className="stats">
          <div className="hstat"><div className="v">{rows.length}</div><div className="l">tranches holding money</div></div>
          <div className="hstat"><div className="v money">{formatCents(held)}</div><div className="l">held in PayPal</div></div>
          <div className="hstat"><div className="v">{soon}</div><div className="l">under 7 days left</div></div>
        </div>
      </div>
      {sp.ran !== undefined && <p className="notice" data-b="ok" role="status">Watchdog ran: {sp.ran} action{sp.ran === "1" ? "" : "s"} taken.</p>}
      <form action={runWatchdogNow} className="row">
        <button className="btn btn-sm" type="submit">Run watchdog now</button>
        <span className="small muted">Acts only on actions that are already due; each action runs once per tranche.</span>
        <span className="sp" />
        <Link className="small" href={sp.test === "1" ? "/ops/radar" : "/ops/radar?test=1"}>{sp.test === "1" ? "Hide" : "Show"} playground and automated-test data</Link>
      </form>
      <section className="c" aria-labelledby="r-h">
        <h2 id="r-h">Held tranches, soonest first</h2>
        {rows.length === 0 ? <p className="muted">No tranche is holding money right now.</p> : (
          <div className="tbwrap"><table className="ptable">
            <thead><tr><th scope="col">Contract · tranche</th><th scope="col">State</th><th scope="col" className="n">Still held</th><th scope="col">Day of window</th><th scope="col" className="n">Days left</th><th scope="col">Next watchdog action</th><th scope="col">Urgency</th></tr></thead>
            <tbody>{rows.map((r) => {
              const len = r.rail === "B" ? 28 : 29;
              return (
                <tr key={r.trancheId} className="radar-row" data-u={r.urgency}>
                  <td><Link href={`/finance/ledger?tranche=${r.trancheId}`}>{r.title}</Link> <span className="small muted">· {r.idx} · rail {r.rail}{r.simulated ? " · simulated clock" : ""}</span></td>
                  <td><MoneyState state={r.state} />{r.warned.includes("EXTERNAL_DISPUTE") && <div className="small">PayPal dispute: releases paused</div>}</td>
                  <td className="n money">{formatCents(r.remainingCents, r.currency)}</td>
                  <td><div className="row" style={{ gap: 8 }}><span className="radar-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, (r.day / len) * 100).toFixed(1)}%` }} /></span><span>day {Math.max(0, Math.floor(r.day))} of {len}</span></div></td>
                  <td className="n">{r.daysLeft > 0 ? r.daysLeft.toFixed(1) : "ended"}</td>
                  <td>{r.next ? <>{ACTION[r.next.action] ?? r.next.action} <span className="small muted">· day {r.next.day}</span></> : <span className="muted">all done</span>}</td>
                  <td><span className="chip" data-b={r.urgency === "ok" ? "ok" : r.urgency === "warn" ? "warn" : r.urgency === "risk" ? "risk" : "danger"}>{URG[r.urgency]}</span></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
