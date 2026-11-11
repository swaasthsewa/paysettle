/** Server-rendered console building blocks (F5.03 queue, notices, stat tiles). */
import type { ReactNode } from "react";
import type { Role } from "@/db/schema";
import { approveAction, vetoAction } from "@/server/control/actions";
import { canDualControl, DC_ACTIONS, type DcAction } from "@/server/control/dual";
import { fmtAge, fmtDate, human, stateClass } from "./format";
import "@/styles/console.css";

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return <div className="notice" data-b={err ? "danger" : "ok"} role={err ? "alert" : "status"}>{err || ok}</div>;
}

export function Stat({ label, value, detail, tone, href }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "ok" | "warn" | "danger" | "held"; href?: string }) {
  const body = <><span className="l">{label}</span><span className="v">{value}</span>{detail && <span className="d">{detail}</span>}</>;
  return href ? <a className="cx-stat" data-b={tone} href={href}>{body}</a> : <div className="cx-stat" data-b={tone}>{body}</div>;
}

export function Head({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) {
  return <div className="phead"><div><h1>{title}</h1><p className="sub">{sub}</p></div>{children && <div className="stats">{children}</div>}</div>;
}

export interface QueueItem {
  id: string; action: string; target: string; payload: unknown; reason: string; state: string; expiresAt: Date; createdAt: Date;
  initiatorId: string; initiator: { name: string; role: string } | null; approver: { name: string } | null; decider: { name: string } | null;
  outcome: { decision: string; ok: boolean; result: Record<string, unknown> } | null;
}

const payloadText = (action: string, p: unknown) => {
  const o = (p ?? {}) as Record<string, unknown>;
  if (action === "PUBLISH_BLUEPRINT") return o.active === false ? `withdraw at ${String(o.version)}` : `publish ${String(o.version)}`;
  if (action === "FLIP_FLAG") return `turn ${o.on ? "on" : "off"}`;
  if (action === "SET_TRUST_TIER") return `set tier to ${String(o.tier)}`;
  if (action === "EXTEND_VAULT") return `extend by ${String(o.hours)} h`;
  return "";
};

/** The four-eyes queue: approve is refused for the initiator (and by the database constraint four_eyes). */
export function DualControlQueue({ items, viewer, back, now = new Date(), showDecided = true }: { items: QueueItem[]; viewer: { id: string; role: Role }; back: string; now?: Date; showDecided?: boolean }) {
  const waiting = items.filter((i) => i.state === "AWAITING");
  const decided = items.filter((i) => i.state !== "AWAITING");
  return (
    <div className="stack">
      {waiting.length === 0 && <p className="muted">No requests are waiting for a second person.</p>}
      <ul className="cx-queue">
        {waiting.map((i) => {
          const mine = i.initiatorId === viewer.id;
          const allowed = canDualControl(viewer.role, i.action as DcAction);
          const left = i.expiresAt.getTime() - now.getTime();
          return (
            <li key={i.id} className="cx-item" data-b="AWAITING">
              <div className="row"><b>{DC_ACTIONS[i.action as DcAction]?.label ?? i.action}</b><code className="cx-code">{i.target}</code>{payloadText(i.action, i.payload) && <span className="chip" data-b="plain">{payloadText(i.action, i.payload)}</span>}<span className="sp" /><span className={stateClass(left > 0 ? "AWAITING" : "EXPIRED")}>{left > 0 ? `${fmtAge(left)} left` : "Expired"}</span></div>
              <p className="small">“{i.reason}”</p>
              <p className="meta">Proposed by {i.initiator?.name ?? i.initiatorId} ({i.initiator?.role}) · {fmtDate(i.createdAt)} · {i.id}</p>
              <div className="row">
                <form action={approveAction}>
                  <input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value={back} />
                  <button className="btn btn-g btn-sm" type="submit" disabled={mine || !allowed || left <= 0} aria-describedby={`why-${i.id}`}>Approve and execute</button>
                </form>
                <form action={vetoAction} className="cx-inline">
                  <input type="hidden" name="id" value={i.id} /><input type="hidden" name="back" value={back} />
                  <label className="sr-only" htmlFor={`note-${i.id}`}>Reason to {mine ? "withdraw" : "veto"}</label>
                  <input id={`note-${i.id}`} name="note" className="input" placeholder={mine ? "Why withdraw (optional)" : "Why veto (optional)"} disabled={!mine && !allowed} />
                  <button className="btn btn-sm" type="submit" disabled={!mine && !allowed}>{mine ? "Withdraw" : "Veto"}</button>
                </form>
                <span id={`why-${i.id}`} className="small muted">{mine ? "You proposed this, so a different person must approve it." : !allowed ? `Your role (${viewer.role}) cannot approve this action.` : left <= 0 ? "This request expired." : "Approving runs the action now."}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {showDecided && decided.length > 0 && (
        <details className="fam">
          <summary><b>Decided</b><span className="muted">{decided.length} recent</span></summary>
          <ul className="cx-queue" style={{ padding: "0 16px 16px" }}>
            {decided.map((i) => (
              <li key={i.id} className="cx-item">
                <div className="row"><b>{DC_ACTIONS[i.action as DcAction]?.label ?? i.action}</b><code className="cx-code">{i.target}</code><span className="sp" /><span className={stateClass(i.outcome?.decision === "FAILED" ? "FAILED" : i.state)}>{human(i.outcome?.decision ?? i.state)}</span></div>
                <p className="meta">Proposed by {i.initiator?.name ?? i.initiatorId} · {i.state === "EXECUTED" ? `approved by ${i.approver?.name ?? "?"}` : i.state === "VETOED" ? `stopped by ${i.decider?.name ?? "?"}` : "not approved within 30 minutes"} · {fmtDate(i.createdAt)}</p>
                {i.outcome?.result && typeof i.outcome.result.note === "string" && <p className="small">{i.outcome.result.note}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
