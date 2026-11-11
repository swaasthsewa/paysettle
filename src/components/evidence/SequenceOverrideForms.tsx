"use client";
/**
 * F3.03 out-of-sequence override forms (client component): the provider's request, the client's signature or decline,
 * and the client's withdrawal. The server re-checks roles, state and the signature inputs (src/server/evidence/override.ts).
 */
import { useActionState, useId, useState } from "react";
import {
  declineOverrideAction, grantOverrideAction, requestOverrideAction, revokeOverrideAction, type OverrideActionResult,
} from "@/server/evidence/override-actions";

interface Base { workspaceId: string; milestoneId: string; code: string }

function Result({ r }: { r: OverrideActionResult | null }) {
  return <div aria-live="polite">{r && <p className="notice" data-b={r.ok ? "ok" : "danger"} role={r.ok ? "status" : "alert"}>{r.message}</p>}</div>;
}
function Hidden({ p }: { p: Base }) {
  return <><input type="hidden" name="workspaceId" value={p.workspaceId} /><input type="hidden" name="milestoneId" value={p.milestoneId} /></>;
}

export function RequestOverrideForm(p: Base & { pending: string[] }) {
  const [r, act, busy] = useActionState(requestOverrideAction, null);
  const id = useId();
  if (r?.ok) return <Result r={r} />;
  return (
    <form action={act} className="stack pgx-so-form">
      <Hidden p={p} />
      <div className="field">
        <label htmlFor={`${id}-reason`}>Why start {p.code} before {p.pending.join(", ")}?</label>
        <textarea id={`${id}-reason`} name="reason" required minLength={10} maxLength={500} aria-describedby={`${id}-hint`} placeholder="The fuel pump arrived early and the bench test can run while the frame shop measures the chassis." />
        <span id={`${id}-hint`} className="muted small">The client sees this reason and signs or declines.</span>
      </div>
      <div><button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Sending…" : "Ask the client"}</button></div>
      <Result r={r} />
    </form>
  );
}

export function GrantOverrideForm(p: Base & { pending: string[]; amountLabel: string; isGate: boolean; requestReason: string | null }) {
  const [r, act, busy] = useActionState(grantOverrideAction, null);
  const [d, dAct, dBusy] = useActionState(declineOverrideAction, null);
  const [checked, setChecked] = useState(false);
  const id = useId();
  if (r?.ok || d?.ok) return <Result r={r?.ok ? r : d} />;
  return (
    <div className="stack">
      <form action={act} className="stack pgx-so-form">
        <Hidden p={p} />
        <div className="field">
          <label htmlFor={`${id}-reason`}>Reason on the record</label>
          <textarea id={`${id}-reason`} name="reason" maxLength={500} required={!p.requestReason} minLength={p.requestReason ? undefined : 10} defaultValue={p.requestReason ?? ""} />
        </div>
        <label className="row small pgx-check">
          <input type="checkbox" name="confirm" required checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I let {p.code} start before {p.pending.join(", ")}. {p.isGate ? "No money moves for this gate." : `Its payout stays ${p.amountLabel} and is released only after I approve its evidence.`}</span>
        </label>
        <div className="field pgx-mfa">
          <label htmlFor={`${id}-mfa`}>Authenticator code <span className="muted">(optional in the sandbox)</span></label>
          <input id={`${id}-mfa`} name="mfaCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} />
        </div>
        <div><button className="btn btn-sm btn-g" type="submit" disabled={!checked || busy} aria-disabled={!checked || busy}>{busy ? "Signing…" : `Sign: allow ${p.code} now`}</button></div>
        <Result r={r} />
      </form>
      {p.requestReason !== null && (
        <form action={dAct} className="stack pgx-so-form">
          <Hidden p={p} />
          <div className="field">
            <label htmlFor={`${id}-note`}>Note to the provider <span className="muted">(optional)</span></label>
            <input id={`${id}-note`} name="note" className="input" maxLength={300} />
          </div>
          <div><button className="btn btn-sm btn-gh" type="submit" disabled={dBusy}>{dBusy ? "Declining…" : "Decline the request"}</button></div>
          <Result r={d} />
        </form>
      )}
    </div>
  );
}

export function RevokeOverrideForm(p: Base) {
  const [r, act, busy] = useActionState(revokeOverrideAction, null);
  if (r?.ok) return <Result r={r} />;
  return (
    <form action={act} className="row">
      <Hidden p={p} />
      <button className="btn btn-sm btn-gh" type="submit" disabled={busy}>{busy ? "Withdrawing…" : "Withdraw the override"}</button>
      <span className="muted small">Possible until {p.code} opens for evidence.</span>
      <Result r={r} />
    </form>
  );
}
