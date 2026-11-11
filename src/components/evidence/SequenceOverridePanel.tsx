/**
 * F3.03 out-of-sequence override panel for the milestone page (server component). Shows nothing unless the milestone is
 * waiting on prerequisites or has an override on record. Mount it in the milestone page's main column:
 *   <SequenceOverridePanel d={d} />
 * Money line: the override changes only the order; the payout and the PayPal hold stay as signed.
 */
import "@/styles/playground-extras.css";
import { formatCents } from "@/lib/money";
import type { MilestoneDetail } from "@/server/evidence/view";
import { GrantOverrideForm, RequestOverrideForm, RevokeOverrideForm } from "./SequenceOverrideForms";

const when = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "");
const list = (c: string[]) => (c.length <= 1 ? c.join("") : `${c.slice(0, -1).join(", ")} and ${c[c.length - 1]}`);

export function SequenceOverridePanel({ d }: { d: MilestoneDetail }) {
  const { milestone: m, workspace: ws, override: o, pendingPrerequisites: pending, as } = d;
  if (ws.state !== "LOCKED" || !m.active) return null;
  const waiting = m.state === "LOCKED" && pending.length > 0;
  const granted = o?.status === "GRANTED";
  if (!waiting && !granted) return null;

  const amount = formatCents(m.amountCents, ws.currency);
  const isGate = m.type === "GATE";
  const base = { workspaceId: ws.id, milestoneId: m.id, code: m.code };
  const funded = d.tranche && ["HELD", "PARTIALLY_RELEASED"].includes(d.tranche.state);
  const moneyLine = isGate ? "A gate: no money moves." : `Payout unchanged: ${amount}${funded ? " stays held in PayPal" : ""} until ${ws.clientName ?? "the client"} approves ${m.code}'s evidence.`;
  const skipped = o?.skipped?.length ? o.skipped : pending;

  return (
    <section className="c pgx-so" aria-labelledby="pgx-so-h">
      <div className="c-head">
        <h2 id="pgx-so-h">Out-of-sequence start</h2>
        {granted ? <span className="chip" data-b="ok">Signed by the client</span> : o?.status === "REQUESTED" ? <span className="chip" data-b="warn">Requested</span> : <span className="chip" data-b="plain">Waiting on {list(pending)}</span>}
      </div>

      {granted ? (
        <div className="stack">
          <p>
            {ws.clientName ?? "The client"} signed that {m.code} may start before {list(skipped)} {skipped.length === 1 ? "is" : "are"} settled
            {o.decidedAt ? <> on {when(o.decidedAt)}</> : null}. {moneyLine}
          </p>
          {o.reason && <p className="small pgx-so-reason"><b>Reason:</b> {o.reason}</p>}
          <p className="small muted">Signature <code title={o.signature ?? ""}>{o.signature?.slice(0, 16)}…</code> over contract hash <code title={o.canonicalHash ?? ""}>{o.canonicalHash?.slice(0, 12)}…</code>{o.mfa === "sandbox-skip" ? " · MFA skipped in the sandbox" : o.mfa === "verified" ? " · MFA verified" : ""}</p>
          {m.state === "LOCKED" && <p className="small">{funded ? `${m.code} opens for evidence now.` : `${m.code} opens for evidence once tranche ${m.trancheIdx} is held in PayPal.`}</p>}
          {as === "client" && m.state === "LOCKED" && <RevokeOverrideForm {...base} />}
        </div>
      ) : (
        <div className="stack">
          <p>
            By the signed order, {m.code} opens after {list(pending)} {pending.length === 1 ? "is" : "are"} settled. The client can sign a one-off permission
            to start it earlier. {moneyLine}
          </p>
          {o?.status === "DECLINED" && <p className="notice" data-b="warn" role="note">The last request was declined{o.decidedAt ? ` on ${when(o.decidedAt)}` : ""}.</p>}
          {o?.status === "REVOKED" && <p className="notice" data-b="warn" role="note">A signed override was withdrawn{o.revokedAt ? ` on ${when(o.revokedAt)}` : ""}.</p>}
          {o?.status === "REQUESTED" && <p className="small pgx-so-reason"><b>{ws.providerName ?? "The provider"} asked{o.requestedAt ? ` on ${when(o.requestedAt)}` : ""}:</b> {o.reason}</p>}

          {as === "provider" && (o?.status === "REQUESTED"
            ? <p className="small muted" role="status">Waiting for {ws.clientName ?? "the client"} to sign or decline.</p>
            : <RequestOverrideForm {...base} pending={pending} />)}
          {as === "client" && <GrantOverrideForm {...base} pending={pending} amountLabel={amount} isGate={isGate} requestReason={o?.status === "REQUESTED" ? o.reason : null} />}
          {as === "staff" && <p className="small muted">Only the client can sign this permission; the provider can ask for it.</p>}
        </div>
      )}
    </section>
  );
}
