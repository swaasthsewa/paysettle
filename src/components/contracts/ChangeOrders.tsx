/**
 * F2.13 — change orders in the contract room of a LOCKED contract: the "Propose change order" panel (one form: change or
 * remove milestones that have not started, add up to two new ones), the review panel for the other party (what changes,
 * the money impact in plain words, the policy gate, signatures, sign or decline) and the history. Server-rendered forms
 * reusing the negotiation room's styles; the server re-plans everything, the form only collects what changed.
 */
import Link from "next/link";
import { formatCents } from "@/lib/money";
import { RISK_OPS_THRESHOLD } from "@/lib/policy";
import type { ChangeOrderRoom, ChangeOrderView } from "@/server/contracts/change-orders";
import { MsChip, artifactLabel } from "./chips";

type Action = (f: FormData) => Promise<void>;
const fmt = (d: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
const STATE_LABEL: Record<string, [string, string]> = {
  PROPOSED: ["Waiting for signatures", "warn"], AWAITING_OPS: ["With Operations", "warn"], APPLIED: ["Signed and in force", "ok"],
  DECLINED: ["Declined", "none"], WITHDRAWN: ["Withdrawn", "none"], RETURNED: ["Returned by Operations", "none"], SUPERSEDED: ["Superseded", "none"],
};
const FIELD: Record<string, string> = { title: "title", day: "due day", amount: "amount", proof: "proof", criteria: "criteria", lockRule: "lock rule", disputeRule: "dispute rule" };
const showVal = (field: string, v: string | number) => (field === "amount" ? formatCents(Number(v)) : field === "day" ? `day ${v}` : `“${v}”`);
export const proofLines = (p: { artifacts: { kind: string; min: number; note?: string }[] }) => p.artifacts.map((a) => `${a.min} × ${a.kind}${a.note ? ` — ${a.note}` : ""}`).join("\n");

export function CoChip({ state }: { state: string }) {
  const [label, b] = STATE_LABEL[state] ?? [state, "plain"];
  return <span className="chip" data-b={b}>{label}</span>;
}

/** What the change order does, in plain words. */
export function CoDiffList({ co }: { co: ChangeOrderView }) {
  const d = co.diff;
  return (
    <ul className="diff-list" data-testid="co-diff">
      {d.added.map((x) => <li key={`a${x.code}`}>Adds <b>{x.code}</b> “{x.title}” — day {x.day}{x.type === "PAY" ? `, ${formatCents(x.amountCents)}` : ", information step"}</li>)}
      {d.removed.map((x) => <li key={`r${x.code}`}>Removes <b>{x.code}</b> “{x.title}”{x.amountCents ? ` (${formatCents(x.amountCents)})` : ""}</li>)}
      {d.changed.map((x) => <li key={`c${x.code}`}>Changes <b>{x.code}</b> “{x.title}”: {x.fields.map((f) => `${FIELD[f.field] ?? f.field} ${showVal(f.field, f.from)} → ${showVal(f.field, f.to)}`).join("; ")}</li>)}
      <li>Contract total {formatCents(d.totalFromCents)} → <b>{formatCents(d.totalToCents)}</b></li>
    </ul>
  );
}

export function ChangeOrders({ wsId, revision, room, party, signAction, declineAction, proposeAction }: {
  wsId: string; revision: number; room: ChangeOrderRoom; party: "client" | "provider" | null; signAction: Action; declineAction: Action; proposeAction: Action;
}) {
  const open = room.open;
  const past = room.orders.filter((o) => o.id !== open?.id);
  return (
    <section className="c span12" id="co" aria-labelledby="co-h">
      <div className="c-head"><h2 id="co-h">Change orders</h2><span className="r small muted">Milestones that have not started can change after lock. Both parties sign; until then the current terms apply.</span></div>
      {open ? <Review co={open} stale={room.openStale} party={party} signAction={signAction} declineAction={declineAction} />
        : party ? <Propose wsId={wsId} revision={revision} room={room} action={proposeAction} />
        : <p className="small muted">No change order is open.</p>}
      {past.length > 0 && (
        <>
          <h3 className="cl-h" style={{ marginTop: 14 }}>History</h3>
          <ol className="rev-list">{past.map((o) => (
            <li key={o.id}>
              <span className="rev-no">CO{o.no}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {o.note} <CoChip state={o.state} />
                <br /><span className="muted small">{o.proposedBy.name} · {fmt(o.createdAt)}{o.state === "APPLIED" ? ` · revision ${o.revNo}` : ""}{o.decisionNote ? ` · “${o.decisionNote}”` : ""}</span>
                {o.state === "APPLIED" && <><CoDiffList co={o} /><ul className="small">{o.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></>}
                {o.continuationId && <span className="small"> · <Link href={`/contracts/${o.continuationId}`}>continuation contract</Link></span>}
              </span>
              <code className="hash">{o.hash.slice(0, 8)}</code>
            </li>
          ))}</ol>
        </>
      )}
    </section>
  );
}

function Review({ co, stale, party, signAction, declineAction }: { co: ChangeOrderView; stale: string | null; party: "client" | "provider" | null; signAction: Action; declineAction: Action }) {
  const iSigned = party !== null && co.signatures.some((s) => s.role === party);
  const mine = party !== null && co.proposedBy.role === party;
  const blocked = co.violations.length > 0 || Boolean(stale);
  return (
    <div className="stack" data-testid="co-review">
      <div className="row"><b>Change order {co.no}</b><CoChip state={co.state} /><span className="small muted">proposed by {co.proposedBy.name} ({co.proposedBy.role}) · {fmt(co.createdAt)} · becomes revision {co.revNo}</span></div>
      <p className="notice small">“{co.note}”</p>
      {stale && <div className="notice" data-b="danger" role="alert">{stale} {mine ? "Withdraw it and propose again." : "Decline it; the other party can propose again."}</div>}
      <div className="bento">
        <div className="span6"><h4>What changes</h4><CoDiffList co={co} /></div>
        <div className="span6">
          <h4>Money</h4>
          <ul className="diff-list" data-testid="co-money">{co.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <p className="small muted">Nothing is charged automatically. New tranches are funded by the client through PayPal; returns go back through PayPal.</p>
        </div>
        <div className="span6">
          <h4>Policy gate</h4>
          {co.violations.length ? <ul className="vio-list">{co.violations.map((x, i) => <li key={i}><b>{x.rule}</b> {x.message}</li>)}</ul> : <p className="small muted">All pre-signature rules pass for the amended contract.</p>}
          <p className="small muted">Risk score <span className="risk-score" {...(co.risk >= RISK_OPS_THRESHOLD ? { "data-high": "" } : {})}>{co.risk}</span>{co.risk >= RISK_OPS_THRESHOLD ? ` — at ${RISK_OPS_THRESHOLD} or more, Operations reviews it after both sign, before it takes effect.` : ""}</p>
        </div>
        <div className="span6">
          <h4>Signatures</h4>
          {co.signatures.length ? <ul className="rev-list">{co.signatures.map((s, i) => <li key={i}><span style={{ flex: 1 }}><b>{s.name}</b> ({s.role}) signed{s.mfa ? " with MFA" : ""}<br /><span className="muted small">{fmt(s.at)}</span></span><code className="hash">{s.hashPrefix}</code></li>)}</ul> : <p className="small muted">No signatures yet.</p>}
          {co.state === "AWAITING_OPS" && <p className="notice small" data-b="warn">Both signed. Operations reviews it before it takes effect.</p>}
        </div>
      </div>
      {party && co.state === "PROPOSED" && (
        <div className="row" style={{ alignItems: "flex-end", gap: 16 }}>
          {!iSigned && (
            <form action={signAction} className="stack">
              <input type="hidden" name="coId" value={co.id} /><input type="hidden" name="hash" value={co.hash} />
              <div className="field"><label htmlFor="co-mfa">Authenticator code <span className="muted">(if you have MFA set up)</span></label><input id="co-mfa" name="mfa" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" /></div>
              <button className="btn btn-g" disabled={blocked}>Sign change order {co.no}</button>
              <p className="small muted">You sign hash <code className="hash">{co.hash.slice(0, 16)}</code>{blocked ? " — it cannot be signed as it stands." : "."}</p>
            </form>
          )}
          {iSigned && <p className="notice small">You signed. Waiting for the other party.</p>}
          <form action={declineAction} className="stack">
            <input type="hidden" name="coId" value={co.id} />
            {!mine && <div className="field"><label htmlFor="co-why">Why you decline</label><input id="co-why" name="note" maxLength={1000} placeholder="We still need the final check-in." /></div>}
            <button className="btn btn-sm">{mine ? "Withdraw change order" : "Decline change order"}</button>
          </form>
        </div>
      )}
    </div>
  );
}

function Propose({ wsId, revision, room, action }: { wsId: string; revision: number; room: ChangeOrderRoom; action: Action }) {
  const editable = room.milestones.filter((m) => !m.frozen);
  const frozen = room.milestones.filter((m) => m.frozen);
  return (
    <details className="ms" data-testid="co-propose">
      <summary><b>Propose change order</b> <span className="muted small">— change, add or remove milestones that have not started</span></summary>
      <form action={action} className="stack" style={{ paddingTop: 10 }}>
        <input type="hidden" name="wsId" value={wsId} /><input type="hidden" name="rev" value={revision} />
        <div className="field"><label htmlFor="co-note">Why the contract changes</label><textarea id="co-note" name="note" required minLength={5} maxLength={1000} placeholder="Content and marketing work added in the last week." /></div>
        <p className="cl-h">Milestones that can change</p>
        {editable.length ? editable.map((m) => (
          <details className="ms" key={m.code}>
            <summary><span className="ms-code">{m.code}</span> {m.title} <span className="small muted">· day {m.day}{m.type === "PAY" ? ` · ${formatCents(m.amountCents)}` : " · information step"} · tranche {m.trancheIdx} ({m.trancheState.toLowerCase().replace(/_/g, " ")})</span> <MsChip state={m.state} /></summary>
            <div className="form-grid" style={{ paddingTop: 8 }}>
              <div className="field wide"><label htmlFor={`co-t-${m.code}`}>Title</label><input id={`co-t-${m.code}`} name={`title_${m.code}`} defaultValue={m.title} minLength={3} maxLength={140} /></div>
              <div className="field"><label htmlFor={`co-d-${m.code}`}>Due day</label><input id={`co-d-${m.code}`} name={`day_${m.code}`} type="number" min={1} max={365} defaultValue={m.day} /></div>
              {m.type === "PAY" && <div className="field"><label htmlFor={`co-a-${m.code}`}>Amount (USD)</label><input id={`co-a-${m.code}`} name={`amount_${m.code}`} inputMode="decimal" defaultValue={(m.amountCents / 100).toFixed(2)} /></div>}
              <div className="field wide"><label htmlFor={`co-p-${m.code}`}>Proof (one per line: count × kind — what it shows)</label><textarea id={`co-p-${m.code}`} name={`proof_${m.code}`} defaultValue={proofLines(m.proof)} /></div>
              <div className="field wide"><label htmlFor={`co-c-${m.code}`}>Acceptance criteria (one per line)</label><textarea id={`co-c-${m.code}`} name={`criteria_${m.code}`} defaultValue={m.proof.criteria.join("\n")} /></div>
              <label className="row small wide"><input type="checkbox" name={`remove_${m.code}`} value="1" /> Remove {m.code} from the contract</label>
            </div>
          </details>
        )) : <p className="small muted">Every milestone has started, so none can change. You can still add new ones.</p>}
        {frozen.length > 0 && <p className="small muted">Frozen (submitted or later, or evidence already sent): {frozen.map((m) => `${m.code} ${m.title}`).join(", ")}.</p>}
        <p className="cl-h">Add milestones</p>
        {[1, 2].map((n) => (
          <details className="ms" key={n}>
            <summary><b>New milestone {n}</b> <span className="muted small">— leave the title empty to skip</span></summary>
            <div className="form-grid" style={{ paddingTop: 8 }}>
              <div className="field wide"><label htmlFor={`co-n${n}-title`}>Title</label><input id={`co-n${n}-title`} name={`new${n}_title`} maxLength={140} placeholder="Content and marketing pages" /></div>
              <div className="field"><label htmlFor={`co-n${n}-type`}>Kind</label><select id={`co-n${n}-type`} name={`new${n}_type`} defaultValue="PAY"><option value="PAY">Payment</option><option value="GATE">Information step (no money)</option></select></div>
              <div className="field"><label htmlFor={`co-n${n}-day`}>Due day</label><input id={`co-n${n}-day`} name={`new${n}_day`} type="number" min={1} max={365} defaultValue={20} /></div>
              <div className="field"><label htmlFor={`co-n${n}-amount`}>Amount (USD)</label><input id={`co-n${n}-amount`} name={`new${n}_amount`} inputMode="decimal" placeholder="1,200" /></div>
              <div className="field"><label htmlFor={`co-n${n}-art`}>Proof artifact</label><select id={`co-n${n}-art`} name={`new${n}_artifact`} defaultValue="PDF">{["PDF", "IMAGE", "VIDEO", "LOG", "LINK", "SIGNATURE"].map((k) => <option key={k} value={k}>{artifactLabel(k)}</option>)}</select></div>
              <div className="field"><label htmlFor={`co-n${n}-min`}>How many</label><input id={`co-n${n}-min`} name={`new${n}_min`} type="number" min={1} max={50} defaultValue={1} /></div>
              <div className="field wide"><label htmlFor={`co-n${n}-crit`}>Acceptance criteria (one per line)</label><textarea id={`co-n${n}-crit`} name={`new${n}_criteria`} placeholder={"Pages are live\nLinked from the main menu"} /></div>
              <div className="field"><label htmlFor={`co-n${n}-lock`}>Lock rule</label><input id={`co-n${n}-lock`} name={`new${n}_lock`} maxLength={300} defaultValue="Client approves." /></div>
              <div className="field"><label htmlFor={`co-n${n}-disp`}>Dispute rule</label><input id={`co-n${n}-disp`} name={`new${n}_dispute`} maxLength={300} defaultValue="Missing items fixed within 72 hours." /></div>
            </div>
          </details>
        ))}
        <div className="row"><button className="btn btn-g btn-sm">Propose change order</button><span className="small muted">The other party reviews the changes and the money impact, then both sign.</span></div>
      </form>
    </details>
  );
}
