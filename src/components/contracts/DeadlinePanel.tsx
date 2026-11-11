/**
 * F3.07 F3.08 — milestone page "Deadline" panel: due date on the contract clock, on-time badge, the adjustment the
 * release made (or would make if approved now), signed extensions and mediator rulings, and the provider's route to
 * contest a deduction (reason MISSED_DEADLINE through the existing dispute flow).
 */
import Link from "next/link";
import { formatCents } from "@/lib/money";
import type { DeadlineFacts } from "@/server/money/deadline";
import type { ExtensionView } from "@/server/contracts/deadline";
import { AdjustmentLine, TimingBadge } from "./deadline-parts";
import "@/styles/deadline.css";

const fmt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
const DISPUTABLE = ["SUBMITTED", "REMEDIATION", "ESCALATED"];
const FINAL = ["RELEASED", "SETTLED_BY_VERDICT", "REFUNDED"];

export function DeadlinePanel({ f, extensions, as, viewerId, workspaceId, currency, disputeId, actions }: {
  f: DeadlineFacts; extensions: ExtensionView[]; as: "client" | "provider" | "staff" | "other"; viewerId: string; workspaceId: string; currency: string; disputeId: string | null;
  actions: { request: (fd: FormData) => Promise<void>; decide: (fd: FormData) => Promise<void>; excuse: (fd: FormData) => Promise<void> };
}) {
  const m = f.milestone, a = f.adjustment, done = Boolean(f.stored);
  const late = f.terms.late, early = f.terms.early;
  const open = !done && !FINAL.includes(m.state);
  const pending = extensions.find((x) => x.kind === "EXTENSION" && x.state === "REQUESTED");
  const hidden = <><input type="hidden" name="workspaceId" value={workspaceId} /><input type="hidden" name="milestoneId" value={m.id} /></>;
  const deduction = done ? f.stored!.deductionCents : a.deductionCents;
  return (
    <section className="c" id="deadline" aria-labelledby="dl-ms-h">
      <div className="c-head">
        <h2 id="dl-ms-h">Deadline</h2>
        {f.lateness && m.type === "PAY" && <TimingBadge timing={a.timing} daysLate={a.daysLate} daysEarly={a.daysEarly} provisional={!done && f.basis !== "ACCEPTED"} />}
      </div>
      <dl className="kv">
        <div><dt>Due</dt><dd>{f.dueAt ? <>{fmt(f.dueAt)}<small>Day {f.dueOffsetDays} of tranche {m.trancheIdx}, counted from the PayPal hold (contract clock){f.excusedDays ? ` · ${f.excusedDays} day${f.excusedDays === 1 ? "" : "s"} excused` : ""}</small></> : <>Day {m.targetDay}<small>The clock starts when tranche {m.trancheIdx} is held in PayPal.</small></>}</dd></div>
        {f.acceptedAt && f.basis !== "IF_DELIVERED_NOW" && <div><dt>{f.basis === "ACCEPTED" ? "Accepted submission" : "Submission in review"}</dt><dd>{fmt(f.acceptedAt)}{f.lateness && f.lateness.reviewExcludedMs > 0 && <small>{Math.round(f.lateness.reviewExcludedMs / 3_600_000)} h of client review not counted</small>}</dd></div>}
        <div><dt>Terms</dt><dd>
          {late ? <>Late: −{(late.rateBps / 100).toFixed(2)}% a day after {late.graceDays} grace day{late.graceDays === 1 ? "" : "s"}, up to {(late.capBps / 100).toFixed(2)}%.</> : "No late deduction."}{" "}
          {early ? <>Early: +{(early.rateBps / 100).toFixed(2)}% a day from {early.minDaysEarly} days early, up to {(early.capBps / 100).toFixed(2)}%; {formatCents(f.poolLeftCents, currency)} of the pool left.</> : "No early bonus."}
        </dd></div>
      </dl>
      {m.type === "PAY" && (done
        ? <p><AdjustmentLine a={{ ...f.stored!, countedDays: f.stored!.countedDays }} currency={currency} /></p>
        : f.lateness
          ? <p className="dl-adj">{f.basis === "IF_DELIVERED_NOW" ? "If delivered and approved now" : "If this submission is approved"}: {a.deductionCents ? <><b>−{formatCents(a.deductionCents, currency)}</b> late deduction ({a.countedLateDays} counted day{a.countedLateDays === 1 ? "" : "s"}), back to the client.</> : a.bonusCents ? <><b>+{formatCents(a.bonusCents, currency)}</b> early bonus from the pool{a.limitedByPool ? " (limited by what is left in the pool)" : ""}.</> : "no adjustment."}</p>
          : null)}
      {as === "provider" && deduction > 0 && DISPUTABLE.includes(m.state) && !disputeId && (
        <p className="small">Think the deduction is wrong? <Link href={`/client/disputes/new?milestone=${encodeURIComponent(m.id)}&reason=MISSED_DEADLINE`}>Contest it as a dispute</Link> before the client approves; the milestone&apos;s money stays held while it runs.</p>
      )}

      {(extensions.length > 0 || (open && (as === "client" || as === "provider"))) && <h3 className="small">Extensions and rulings</h3>}
      {extensions.length > 0 && (
        <ul className="dl-ext">
          {extensions.map((x) => (
            <li key={x.id}>
              <span><b>{x.kind === "EXTENSION" ? `${x.days}-day extension` : `${x.days} day${x.days === 1 ? "" : "s"} excused by a ruling`}</b> · {x.state.toLowerCase()} · asked by {x.requestedBy.name} on {fmt(x.requestedAt)}</span>
              <span className="muted">“{x.reason}”</span>
              {x.state === "ACCEPTED" && x.kind === "EXTENSION" && <span className="small">Signed by {x.requestedBy.name} and {x.decidedBy?.name} {x.decidedAt ? `on ${fmt(x.decidedAt)}` : ""}{x.dueAfter ? ` · due date now ${fmt(x.dueAfter)}` : ""} <span className="dl-sig">sig {x.requestSig.slice(0, 10)}… / {x.decisionSig?.slice(0, 10)}…</span></span>}
              {x.state === "REQUESTED" && (
                <div className="row">
                  {x.requestedBy.id !== viewerId && (as === "client" || as === "provider") && open && <>
                    <form action={actions.decide}>{hidden}<input type="hidden" name="extensionId" value={x.id} /><input type="hidden" name="decision" value="accept" /><button className="btn btn-g btn-sm">Sign and accept {x.days} day{x.days === 1 ? "" : "s"}</button></form>
                    <form action={actions.decide}>{hidden}<input type="hidden" name="extensionId" value={x.id} /><input type="hidden" name="decision" value="decline" /><button className="btn btn-gh btn-sm">Decline</button></form>
                  </>}
                  {x.requestedBy.id === viewerId && <form action={actions.decide}>{hidden}<input type="hidden" name="extensionId" value={x.id} /><input type="hidden" name="decision" value="withdraw" /><button className="btn btn-gh btn-sm">Withdraw request</button></form>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && (as === "client" || as === "provider") && !pending && (
        <form action={actions.request} className="form-grid">
          {hidden}
          <div className="field"><label htmlFor="dl-days">Extra days</label><input id="dl-days" name="days" type="number" min={1} max={30} defaultValue={2} required /></div>
          <div className="field wide"><label htmlFor="dl-why">Why</label><input id="dl-why" name="reason" required minLength={5} maxLength={500} placeholder="Access to the staging server arrived on day 4" /></div>
          <div className="row wide"><button className="btn btn-sm">Ask for an extension</button><span className="small muted">It counts only once the other party signs it.</span></div>
        </form>
      )}
      {open && as === "staff" && (
        <form action={actions.excuse} className="form-grid">
          {hidden}{disputeId && <input type="hidden" name="disputeId" value={disputeId} />}
          <div className="field"><label htmlFor="dl-x-days">Days excused by the ruling</label><input id="dl-x-days" name="days" type="number" min={1} max={60} required /></div>
          <div className="field wide"><label htmlFor="dl-x-why">Ruling</label><input id="dl-x-why" name="reason" required minLength={5} maxLength={500} placeholder="Client access delay excuses two days" /></div>
          <div className="row wide"><button className="btn btn-sm">Record excused days</button><span className="small muted">Recorded as ruled; it reduces the counted late days.</span></div>
        </form>
      )}
    </section>
  );
}
