"use client";
/* P6 — the moneyFlow block: client → PayPal hold → provider (after the fee) / back to the client / still held.
 * Every figure comes from moneyFlowParts() (src/lib/money underneath). When interactive, a slider moves the released
 * share and everything recomputes live; the summary sentence is announced politely to screen readers.
 * The server renders the same markup with the author's numbers, so it reads fully without scripts. */
import { useId, useState } from "react";
import { formatCents, pct } from "@/lib/money";
import { moneyFlowParts } from "./math";

export interface MoneyFlowProps { totalCents: number; releasedBps: number; refundedBps: number; feeBps: number; caption?: string; interactive: boolean }

export function MoneyFlow({ totalCents, releasedBps, refundedBps, feeBps, caption, interactive }: MoneyFlowProps) {
  /* When the author's split leaves nothing held (a settlement), the slider moves money between provider and client.
     Otherwise the returned share stays as written and the slider moves money between provider and "still held". */
  const settles = releasedBps + refundedBps >= 10_000;
  const [rel, setRel] = useState(releasedBps);
  const ref = settles ? 10_000 - rel : Math.min(refundedBps, 10_000 - rel);
  const max = settles ? 10_000 : 10_000 - refundedBps;
  const f = moneyFlowParts(totalCents, rel, ref, feeBps);
  const id = useId();
  const step = releasedBps % 100 === 0 && refundedBps % 100 === 0 ? 100 : 1;
  const summary = `${formatCents(f.releasedCents)} released: the provider receives ${formatCents(f.providerNetCents)} after a ${pct(feeBps)} fee of ${formatCents(f.feeCents)}. ${formatCents(f.refundedCents)} goes back to the client${f.stillHeldCents ? `, and ${formatCents(f.stillHeldCents)} stays held in PayPal` : ""}.`;

  return (
    <figure className="bl-flow" aria-labelledby={`${id}-cap`}>
      <ol className="bl-flow-row" aria-label="Where the money goes">
        <li className="bl-node is-client"><span className="bl-node-k">Client funds</span><b className="money">{formatCents(f.totalCents)}</b></li>
        <li className="bl-node is-hold"><span className="bl-node-k">Held in PayPal</span><b className="money">{formatCents(f.totalCents)}</b><span className="bl-node-s">released only on a signed approval or verdict</span></li>
        <li className="bl-outs-wrap">
          <span className="bl-sr">Then it splits:</span>
          <ul className="bl-outs">
            <li className="bl-node is-provider"><span className="bl-node-k">To the provider</span><b className="money">{formatCents(f.providerNetCents)}</b><span className="bl-node-s">{formatCents(f.releasedCents)} released − {formatCents(f.feeCents)} fee ({pct(feeBps)})</span></li>
            <li className="bl-node is-refund"><span className="bl-node-k">Back to the client</span><b className="money">{formatCents(f.refundedCents)}</b><span className="bl-node-s">no fee on a refund</span></li>
            {(f.stillHeldCents > 0 || !settles) && <li className="bl-node is-held"><span className="bl-node-k">Still held</span><b className="money">{formatCents(f.stillHeldCents)}</b><span className="bl-node-s">waiting for later milestones</span></li>}
          </ul>
        </li>
      </ol>
      <div className="bl-bar" aria-hidden="true">
        <i className="is-provider" style={{ flexGrow: f.providerNetCents }} />
        <i className="is-fee" style={{ flexGrow: f.feeCents }} />
        <i className="is-refund" style={{ flexGrow: f.refundedCents }} />
        <i className="is-held" style={{ flexGrow: f.stillHeldCents }} />
      </div>
      {interactive && (
        <div className="bl-slider">
          <label htmlFor={`${id}-r`}>Share released to the provider <b className="tnum">{pct(rel)}</b></label>
          <input id={`${id}-r`} type="range" min={0} max={max} step={step} value={rel}
            aria-valuetext={`${pct(rel)} released, ${formatCents(f.releasedCents)}`}
            onChange={(e) => setRel(Number(e.currentTarget.value))} />
          {rel !== releasedBps && <button type="button" className="btn btn-sm btn-gh" onClick={() => setRel(releasedBps)}>Reset to {pct(releasedBps)}</button>}
        </div>
      )}
      <p className="bl-flow-sum" aria-live={interactive ? "polite" : undefined}>{summary}</p>
      <figcaption id={`${id}-cap`} className="bl-cap">{caption ?? `A ${formatCents(totalCents)} example. Amounts are integer cents; the fee is charged only on what is released.`}</figcaption>
    </figure>
  );
}
export default MoneyFlow;
