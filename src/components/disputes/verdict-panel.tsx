"use client";
/**
 * Mediator verdict panel (F4.06, F4.07, F4.09, F4.12). The split is computed with the same rule the
 * server uses (refund rounds half up toward the client; release is the rest), to the cent. The AI figure is advice only.
 * Says why a co-signature is needed (high value or probation) and shows the mediator's own fee, paid by PaySettle.
 */
import { useState } from "react";
import { splitDispute } from "@/lib/money";
import { verdictAction } from "@/server/disputes/actions";
import { money } from "./format";

export function VerdictPanel(p: {
  disputeId: string; amountCents: number; currency: string; aiShareBps: number | null; feeCents: number; needsCosign: boolean;
  rootCauses: { code: string; label: string }[]; inProgress: string[]; disabled?: string | null;
  cosignWhy?: string | null; mediatorFee?: { cents: number; tier: string } | null;
}) {
  const [bps, setBps] = useState(p.aiShareBps ?? 5000);
  const [fault, setFault] = useState<"CLIENT" | "PROVIDER" | "SHARED">("SHARED");
  const [disp, setDisp] = useState<"RESUME" | "TERMINATE">("RESUME");
  const s = splitDispute(p.amountCents, bps);
  const feeClient = fault === "CLIENT" ? p.feeCents : fault === "PROVIDER" ? 0 : Math.floor(p.feeCents / 2);
  const feeProvider = p.feeCents - feeClient;
  return (
    <form action={verdictAction} className="stack">
      <input type="hidden" name="disputeId" value={p.disputeId} />
      <input type="hidden" name="shareBps" value={bps} />
      <div className="field">
        <label htmlFor="dz-vs">Share to the provider</label>
        <input id="dz-vs" type="range" min={0} max={10000} step={50} value={bps} onChange={(e) => setBps(Number(e.target.value))} className="dz-range" aria-valuetext={`${(bps / 100).toFixed(2)}% to the provider`} />
        <div className="row">
          <input aria-label="Share to the provider in percent" className="input dz-num" type="number" min={0} max={100} step={0.01} value={(bps / 100).toFixed(2)}
            onChange={(e) => { const v = Math.round(Number(e.target.value) * 100); if (Number.isFinite(v)) setBps(Math.min(10000, Math.max(0, v))); }} />
          <span className="small muted">%</span>
          {p.aiShareBps !== null && <button type="button" className="btn btn-sm btn-gh" onClick={() => setBps(p.aiShareBps!)}>Use the advice ({(p.aiShareBps / 100).toFixed(2)}%)</button>}
        </div>
      </div>
      <dl className="kv" aria-live="polite">
        <div><dt>Leg 1 · refund to the client</dt><dd className="money">{money(s.refundCents, p.currency)}</dd></div>
        <div><dt>Leg 2 · release to the provider</dt><dd className="money">{money(s.releaseCents, p.currency)}<small>PaySettle&apos;s release fee comes out of this leg, as for any release.</small></dd></div>
        <div><dt>Total (frozen amount)</dt><dd className="money">{money(s.refundCents + s.releaseCents, p.currency)}</dd></div>
        <div><dt>Mediation fee (Tier 3)</dt><dd className="money">{money(p.feeCents, p.currency)}<small>Client {money(feeClient, p.currency)} · provider {money(feeProvider, p.currency)}. Recorded for Finance; not taken from the held amount.</small></dd></div>
        {p.mediatorFee && <div><dt>Your fee for this verdict</dt><dd className="money">{money(p.mediatorFee.cents, p.currency)}<small>Flat {p.mediatorFee.tier.toLowerCase()} rate, paid to you by PaySettle from its own fee income — never from the held amount.</small></dd></div>}
      </dl>
      <fieldset className="dz-radios">
        <legend>Fault (decides who pays the fee)</legend>
        {(["CLIENT", "PROVIDER", "SHARED"] as const).map((f) => (
          <label key={f}><input type="radio" name="fault" value={f} checked={fault === f} onChange={() => setFault(f)} /> {f === "SHARED" ? "Shared or force majeure" : f === "CLIENT" ? "Client" : "Provider"}</label>
        ))}
      </fieldset>
      <fieldset className="dz-radios">
        <legend>What happens next</legend>
        <label><input type="radio" name="disposition" value="RESUME" checked={disp === "RESUME"} onChange={() => setDisp("RESUME")} /> Resume the contract</label>
        <label><input type="radio" name="disposition" value="TERMINATE" checked={disp === "TERMINATE"} onChange={() => setDisp("TERMINATE")} /> End it and return unstarted milestones of this tranche to the client</label>
      </fieldset>
      {p.inProgress.length > 0 && <p className="notice" data-b="warn">Other steps of this tranche are in progress ({p.inProgress.join(", ")}). Decide them in your findings: they are judged in the same ticket.</p>}
      <div className="field">
        <label htmlFor="dz-rc">Root cause (feeds the clause feedback loop)</label>
        <select id="dz-rc" name="rootCause" className="input" required defaultValue="">
          <option value="" disabled>Pick one</option>
          {p.rootCauses.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="dz-fd">Findings</label>
        <textarea id="dz-fd" name="findings" className="input" required minLength={20} maxLength={8000} placeholder="Which criteria the evidence meets, which it misses, citing files, marks and clauses." />
      </div>
      {p.needsCosign && <p className="notice">{p.cosignWhy ? `A second mediator must co-sign before any money moves: ${p.cosignWhy}.` : "Above $5,000: a second mediator must co-sign before any money moves."}</p>}
      {p.disabled ? <p className="notice" data-b="warn">{p.disabled}</p> : <div className="row"><button className="btn btn-g" type="submit">Sign verdict</button></div>}
    </form>
  );
}
