"use client";
/** Tier 1 sealed-offer widget (F4.02). The amounts shown are computed with the same split rule as the verdict (F4.07). */
import { useState } from "react";
import { splitDispute } from "@/lib/money";
import { bidAction } from "@/server/disputes/actions";
import { money } from "./format";

export function BidWidget({ disputeId, amountCents, currency, side, round }: { disputeId: string; amountCents: number; currency: string; side: "client" | "provider"; round: number }) {
  const [pct, setPct] = useState(side === "client" ? 40 : 80);
  const s = splitDispute(amountCents, pct * 100);
  return (
    <form action={bidAction} className="stack dz-bid">
      <input type="hidden" name="disputeId" value={disputeId} />
      <div className="field">
        <label htmlFor="dz-share">Round {round} of 3 · your offer: share of {money(amountCents, currency)} that goes to the provider</label>
        <input id="dz-share" name="sharePct" type="range" min={0} max={100} step={1} value={pct} onChange={(e) => setPct(Number(e.target.value))}
          aria-valuetext={`${pct}% to the provider`} className="dz-range" />
        <div className="row dz-split" aria-live="polite">
          <span><b className="money">{pct}%</b> to the provider · <span className="money">{money(s.releaseCents, currency)}</span></span>
          <span className="sp" />
          <span><b className="money">{100 - pct}%</b> back to the client · <span className="money">{money(s.refundCents, currency)}</span></span>
        </div>
      </div>
      <p className="small muted">Your offer stays hidden unless both offers meet within 5 points. If they do, the dispute settles at the midpoint and nobody pays a mediation fee.</p>
      <div className="row"><button className="btn btn-g" type="submit">Seal my offer</button></div>
    </form>
  );
}
