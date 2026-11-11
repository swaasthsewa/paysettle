/* F2.07 F3.10 — the trancheTimeline block: how a job of N days splits into PayPal hold windows on a rail.
 * Windows come from tranchePlan() → src/lib/policy trancheOf (the same function that tranches real contracts);
 * the watchdog days come from watchdogPlan(). Server-safe; a plain table carries the same facts for screen readers. */
import { RAIL_NAME, tranchePlan } from "./math";

export function TrancheTimeline({ totalDays, rail, caption }: { totalDays: number; rail: "A1" | "A2" | "B"; caption?: string }) {
  const p = tranchePlan(totalDays, rail);
  const span = Math.max(p.totalDays, p.capDays);
  const pctOf = (d: number) => `${((d / span) * 100).toFixed(3)}%`;
  const n = p.tranches.length;
  return (
    <figure className="bl-tt">
      <div className="bl-tt-head">
        <b>{p.totalDays}-day job on {RAIL_NAME[rail]}</b>
        <span className="chip" data-b="plain">{n} {n === 1 ? "hold window" : "hold windows"} · up to {p.capDays} days each</span>
      </div>
      <div className="bl-tt-track" aria-hidden="true">
        {p.tranches.map((t) => (
          <div key={t.idx} className="bl-tt-win" style={{ left: pctOf(t.fromDay - 1), width: pctOf(t.days) }} data-i={t.idx % 3}>
            <span>T{t.idx}</span>
          </div>
        ))}
        {p.tranches.length === 1 && p.totalDays < p.capDays && (
          <div className="bl-tt-spare" style={{ left: pctOf(p.totalDays), width: pctOf(p.capDays - p.totalDays) }}><span>spare</span></div>
        )}
      </div>
      <div className="bl-tt-scale" aria-hidden="true"><span>day 1</span><span>day {span}</span></div>
      <table className="bl-table bl-tt-table">
        <caption className="bl-sr">Hold windows for a {p.totalDays}-day job on rail {rail}</caption>
        <thead><tr><th scope="col">Tranche</th><th scope="col">Work days</th><th scope="col">Length</th></tr></thead>
        <tbody>
          {p.tranches.map((t) => (
            <tr key={t.idx}><th scope="row">T{t.idx}</th><td className="tnum">{t.fromDay}–{t.toDay}</td><td className="tnum">{t.days} {t.days === 1 ? "day" : "days"}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="bl-tt-watch">
        <b>Inside every hold, the watchdog acts on day</b>
        <ol>
          {p.watchdog.map((w) => <li key={w.action}><span className="bl-tt-day tnum">{w.day}</span>{w.label}</li>)}
        </ol>
      </div>
      {caption && <figcaption className="bl-cap">{caption}</figcaption>}
    </figure>
  );
}
export default TrancheTimeline;
