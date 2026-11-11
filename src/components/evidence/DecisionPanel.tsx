"use client";
/**
 * F3.07 / F3.09 client decision area: approve and release (signed over the evidence root hash), request a fix
 * (listed items; the third rejection opens a dispute), or open a dispute. The server re-checks everything.
 */
import Link from "next/link";
import { useActionState, useState } from "react";

export interface ActionResult { ok: boolean; message: string }
type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

export function DecisionPanel(p: {
  workspaceId: string; milestoneId: string; code: string; rootHash: string; amountLabel: string; isGate: boolean;
  state: string; attempts: number; disputeHref: string; approve: Action; requestFix: Action; retryOnly?: boolean;
}) {
  const [aState, approveAct, aPending] = useActionState(p.approve, null);
  const [fState, fixAct, fPending] = useActionState(p.requestFix, null);
  const [checked, setChecked] = useState(false);
  const third = p.attempts >= 3;
  const what = p.isGate ? `Approve gate ${p.code}` : `Approve and release ${p.amountLabel}`;

  if (p.retryOnly) {
    return (
      <form action={approveAct} className="stack">
        <input type="hidden" name="workspaceId" value={p.workspaceId} />
        <input type="hidden" name="milestoneId" value={p.milestoneId} />
        <input type="hidden" name="rootHash" value={p.rootHash} />
        <input type="hidden" name="confirm" value="on" />
        <p className="small">Your signed approval is on file. {p.isGate ? `Recording gate ${p.code} is queued.` : `The release of ${p.amountLabel} is queued.`}</p>
        <button className="btn btn-sm" type="submit" disabled={aPending}>{aPending ? "Retrying…" : "Retry the release now"}</button>
        {aState && <div className="notice" data-b={aState.ok ? "ok" : "warn"} role="status">{aState.message}</div>}
      </form>
    );
  }

  return (
    <div className="stack ev-decide">
      <form action={approveAct} className="stack ev-approve">
        <input type="hidden" name="workspaceId" value={p.workspaceId} />
        <input type="hidden" name="milestoneId" value={p.milestoneId} />
        <input type="hidden" name="rootHash" value={p.rootHash} />
        <label className="row small ev-confirm-box">
          <input type="checkbox" name="confirm" required checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {p.isGate ? `I inspected the evidence; approving ${p.code} lets the next milestones start.` : `I inspected the evidence; releasing ${p.amountLabel} is final in PaySettle`}
        </label>
        <div className="field ev-mfa">
          <label htmlFor="ev-mfa">Authenticator code <span className="muted">(optional in the sandbox)</span></label>
          <input id="ev-mfa" name="mfaCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} />
        </div>
        <div className="row">
          <button className="btn btn-g" type="submit" disabled={!checked || aPending} aria-disabled={!checked || aPending}>{aPending ? "Signing…" : what}</button>
          <span className="muted small">Your approval is signed over evidence root <code>{p.rootHash.slice(0, 12)}…</code></span>
        </div>
        {aState && <div className="notice" data-b={aState.ok ? "ok" : "danger"} role="status">{aState.message}</div>}
      </form>

      {p.state === "SUBMITTED" && (
        <form action={fixAct} className="stack ev-fix">
          <input type="hidden" name="workspaceId" value={p.workspaceId} />
          <input type="hidden" name="milestoneId" value={p.milestoneId} />
          <div className="field">
            <label htmlFor="ev-items">Request a fix — one item per line</label>
            <textarea id="ev-items" name="items" required maxLength={4000} placeholder={"Screen list is missing the checkout flow\nPrototype link asks for a password"} />
          </div>
          {third
            ? <p className="notice" data-b="warn">This is the third submission. Rejecting it opens a formal dispute; the money stays held in PayPal.</p>
            : <p className="muted small">The provider gets 72 hours to fix (rejection {p.attempts} of 2 before a dispute).</p>}
          <div><button className="btn" type="submit" disabled={fPending}>{fPending ? "Sending…" : third ? "Reject and open a dispute" : "Request a fix"}</button></div>
          {fState && <div className="notice" data-b={fState.ok ? "ok" : "danger"} role="status">{fState.message}</div>}
        </form>
      )}

      <div className="row">
        <Link className="btn btn-gh btn-sm" href={p.disputeHref}>Open a dispute instead</Link>
        <span className="muted small">For disagreements a fix cannot solve.</span>
      </div>
    </div>
  );
}
