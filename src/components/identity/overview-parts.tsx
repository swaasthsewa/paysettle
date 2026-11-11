/** F1 overviews · the money cards and the contracts grouped by stage, shared by /client and /provider. Server-safe. */
import Link from "next/link";
import type { ReactNode } from "react";
import { contractHref, STAGE_ORDER, type Money, type OverviewContract } from "@/lib/identity/overview";
import { cents } from "./format";

export function MoneyCards({ money, currency = "USD", labels }: { money: Money; currency?: string; labels: { held: string; released: string; returned: string; waiting: string } }) {
  const cards = [
    { k: "held", v: money.heldCents, l: labels.held, s: "held" },
    { k: "released", v: money.releasedCents, l: labels.released, s: "released" },
    { k: "returned", v: money.returnedCents, l: labels.returned, s: "refunded" },
    { k: "waiting", v: money.waitingCents, l: labels.waiting, s: "draft" },
  ];
  return (
    <div className="id-money" role="list" aria-label="Where the money is">
      {cards.map((c) => (
        <div key={c.k} className="id-mcard" data-k={c.k} role="listitem">
          <span className={`state ${c.s}`} style={{ alignSelf: "flex-start" }}>{c.l}</span>
          <span className="v">{cents(c.v, currency)}</span>
        </div>
      ))}
    </div>
  );
}

export function ContractsByStage({ contracts, role, empty }: { contracts: OverviewContract[]; role: "client" | "provider"; empty: ReactNode }) {
  if (!contracts.length) return <>{empty}</>;
  const groups = STAGE_ORDER.map((k) => ({ k, items: contracts.filter((c) => c.stage.key === k) })).filter((g) => g.items.length);
  return (
    <div className="stack">
      {groups.map((g) => (
        <div key={g.k}>
          <h3 className="id-group-h">{g.items[0].stage.label} · {g.items.length}</h3>
          <ul className="id-list">
            {g.items.map((c) => (
              <li key={c.id}>
                <Link className="id-main" href={contractHref(role, c.id)}>
                  <b>{c.title}</b>
                  <small>{c.counterpart ?? (c.inviteEmail ? `Invited: ${c.inviteEmail}` : "No counterpart yet")} · revision {c.revision} · {cents(c.totalCents, c.currency)} in total</small>
                </Link>
                {c.money.heldCents > 0 && <span className="state held"><span className="tnum">{cents(c.money.heldCents, c.currency)}</span>&nbsp;held</span>}
                {c.money.releasedCents > 0 && <span className="state released"><span className="tnum">{cents(c.money.releasedCents, c.currency)}</span>&nbsp;released</span>}
                {c.money.returnedCents > 0 && <span className="state refunded"><span className="tnum">{cents(c.money.returnedCents, c.currency)}</span>&nbsp;returned</span>}
                {c.money.waitingCents > 0 && <span className="state draft"><span className="tnum">{cents(c.money.waitingCents, c.currency)}</span>&nbsp;not funded</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
