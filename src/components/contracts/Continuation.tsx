/**
 * F2.13 — continuation contracts in the contract room: the period chain ("Period 2 · continues …", with links both
 * ways) and the "Continue into the next period" panel for a LOCKED contract (repeat this period's milestones, carry
 * unfinished ones over). The new period is a draft: it is negotiated, signed, locked and funded like any contract.
 */
import Link from "next/link";
import { formatCents } from "@/lib/money";

type Action = (f: FormData) => Promise<void>;
export interface Chain { periodNo: number; parent: { id: string; title: string; periodNo: number } | null; next: { id: string; title: string; periodNo: number; state: string } | null }

export function PeriodChain({ chain }: { chain: Chain }) {
  if (!chain.parent && !chain.next) return null;
  return (
    <p className="row small" data-testid="period-chain">
      <span className="chip" data-b="plain">Period {chain.periodNo}</span>
      {chain.parent && <span>continues <Link href={`/contracts/${chain.parent.id}`}>{chain.parent.title}</Link> (period {chain.parent.periodNo})</span>}
      {chain.next && <span>{chain.parent ? "· " : ""}continues in <Link href={`/contracts/${chain.next.id}`}>{chain.next.title}</Link> (period {chain.next.periodNo})</span>}
    </p>
  );
}

export function ContinuePanel({ wsId, title, periodNo, carryable, blocked, action }: { wsId: string; title: string; periodNo: number; carryable: { code: string; title: string; type: "GATE" | "PAY"; amountCents: number; day: number }[]; blocked: string | null; action: Action }) {
  const next = periodNo + 1;
  return (
    <section className="c span12" id="next-period" aria-labelledby="np-h">
      <div className="c-head"><h2 id="np-h">Continue into the next period</h2><span className="r small muted">For a monthly retainer, or month {next} of a build</span></div>
      {blocked ? <p className="small muted">{blocked}</p> : (
        <details className="ms" data-testid="continue-panel">
          <summary><b>Start period {next}</b> <span className="muted small">— a new draft contract with the same parties, blueprint, currency and clauses</span></summary>
          <form action={action} className="stack" style={{ paddingTop: 10 }}>
            <input type="hidden" name="wsId" value={wsId} />
            <div className="field"><label htmlFor="np-title">Title of the new period</label><input id="np-title" name="title" maxLength={120} defaultValue={`${title.replace(/ · period \d+$/, "")} · period ${next}`} /></div>
            <label className="row small"><input type="checkbox" name="repeat" value="1" defaultChecked /> Repeat this period&apos;s milestones as the template for period {next}</label>
            {carryable.length > 0 && (
              <fieldset className="stack">
                <legend className="small"><b>Carry unfinished milestones over</b> — they move: this contract removes them by a change order that both of you sign, so nothing is paid twice</legend>
                {carryable.map((m) => (
                  <label className="row small" key={m.code}><input type="checkbox" name="carry" value={m.code} /> <span className="ms-code">{m.code}</span> {m.title} · day {m.day}{m.type === "PAY" ? ` · ${formatCents(m.amountCents)}` : ""}</label>
                ))}
              </fieldset>
            )}
            <div className="field"><label htmlFor="np-note">Note (optional)</label><input id="np-note" name="note" maxLength={500} placeholder="Same scope as last month." /></div>
            <div className="row"><button className="btn btn-g btn-sm">Create period {next} draft</button><span className="small muted">Nothing is charged: the client funds period {next} through PayPal after both of you sign it.</span></div>
          </form>
        </details>
      )}
    </section>
  );
}
