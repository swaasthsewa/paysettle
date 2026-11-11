/**
 * F3.10 F3.11 Tranche card for any screen: amount, where the money is (released / returned / still held) and the hold-window
 * countdown. `now` is supplied by the server (the workspace's virtual clock), so the countdown matches the watchdog.
 * Data: trancheSummaries(workspaceId) from src/server/money/queries, or pass the figures directly.
 */
import Link from "next/link";
import { formatCents } from "@/lib/money";
import { MoneyState } from "./MoneyState";
import "@/styles/money.css";

export interface TrancheCardData {
  id: string; idx: number; rail: string; state: string; amountCents: number; heldAt: Date | null; windowEndsAt: Date | null; currency?: string;
  balance: { held: number; released: number; returned: number; remaining: number; pool?: { held: number; paid: number; returned: number; remaining: number } }; warned?: string[];
  /** Early-finish bonus pool funded with this tranche. */
  bonusPoolCents?: number;
}
const DAY = 86_400_000;

export function TrancheCard({ t, now, fundHref, compact }: { t: TrancheCardData; now: Date; fundHref?: string; compact?: boolean }) {
  const cur = t.currency ?? "USD";
  const base = t.balance.held || t.amountCents || 1;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / base) * 100)).toFixed(2)}%`;
  const day = t.heldAt ? (now.getTime() - t.heldAt.getTime()) / DAY : null;
  const left = t.windowEndsAt ? (t.windowEndsAt.getTime() - now.getTime()) / DAY : null;
  const settleIn = t.heldAt ? (t.heldAt.getTime() + 27 * DAY - now.getTime()) / DAY : null;
  const live = ["HELD", "PARTIALLY_RELEASED", "SETTLING"].includes(t.state) && t.balance.remaining > 0;
  const tone = day === null || !live ? "ok" : day >= 25 ? "danger" : day >= 22 ? "warn" : "ok";
  const blocked = (t.warned ?? []).includes("EXTERNAL_DISPUTE");
  return (
    <article className="c money-card" aria-label={`Tranche ${t.idx}`}>
      <div className="c-head">
        <h3>Tranche {t.idx}</h3>
        <MoneyState state={t.state} />
        <span className="r small muted">Rail {t.rail}</span>
      </div>
      <div className="row money-figs">
        <div><div className="money money-big">{formatCents(t.amountCents, cur)}</div><div className="small muted">{t.balance.held ? "authorized in PayPal" : "to be held in PayPal"}</div></div>
        {t.balance.held > 0 && <div><div className="money">{formatCents(t.balance.remaining, cur)}</div><div className="small muted">still held</div></div>}
      </div>
      {t.balance.held > 0 && (
        <>
          <div className="money-bar" role="img" aria-label={`${formatCents(t.balance.released, cur)} released, ${formatCents(t.balance.returned, cur)} returned, ${formatCents(t.balance.remaining, cur)} still held`}>
            <i className="seg-released" style={{ width: pct(t.balance.released) }} />
            <i className="seg-returned" style={{ width: pct(t.balance.returned) }} />
            <i className="seg-held" style={{ width: pct(t.balance.remaining) }} />
          </div>
          {!compact && (
            <ul className="money-key small">
              <li><i className="dot seg-released" aria-hidden="true" />Released {formatCents(t.balance.released, cur)}</li>
              <li><i className="dot seg-returned" aria-hidden="true" />Returned {formatCents(t.balance.returned, cur)}</li>
              <li><i className="dot seg-held" aria-hidden="true" />Held {formatCents(t.balance.remaining, cur)}</li>
            </ul>
          )}
        </>
      )}
      {(t.bonusPoolCents ?? 0) > 0 && (
        <p className="small muted">
          Bonus pool {formatCents(t.bonusPoolCents!, cur)}{t.balance.pool && t.balance.pool.held > 0 ? ` · paid as early bonuses ${formatCents(t.balance.pool.paid, cur)} · returned ${formatCents(t.balance.pool.returned, cur)} · still held ${formatCents(t.balance.pool.remaining, cur)}` : " · funded with this tranche; what is not earned goes back to the client"}
        </p>
      )}
      {live && day !== null && left !== null && (
        <p className="money-window small" data-tone={tone}>
          Day {Math.max(0, Math.floor(day))} of {t.rail === "B" ? 28 : 29} · {left > 0 ? `${Math.floor(left)} d ${Math.floor((left % 1) * 24)} h left in the PayPal hold` : "hold window ended"}
          {settleIn !== null && settleIn > 0 ? ` · settles in ${Math.ceil(settleIn)} d` : ""}
        </p>
      )}
      {blocked && <p className="notice" data-b="warn">A PayPal dispute is open on this payment. Releases are paused until PayPal resolves it.</p>}
      {fundHref && t.state === "PLANNED" && <Link className="btn btn-g btn-sm" href={fundHref}>Fund tranche {t.idx} with PayPal</Link>}
      {fundHref && t.state === "AWAITING_APPROVAL" && <Link className="btn btn-sm" href={fundHref}>Finish PayPal approval</Link>}
    </article>
  );
}
