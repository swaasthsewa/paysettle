/**
 * F1 client overview (pay only for verified progress; F1.3 profile gate; F3.06 review clocks).
 * Contracts by stage with money held / released / returned, and what needs the client: approvals due (countdown on
 * each contract's virtual clock), unfunded tranches, signatures, open disputes. Read straight from the database.
 */
import Link from "next/link";
import { eq } from "drizzle-orm";
import "@/styles/site.css";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { Countdown } from "@/components/identity/countdown";
import { cents, tzOf, when } from "@/components/identity/format";
import { ContractsByStage, MoneyCards } from "@/components/identity/overview-parts";
import { requireViewer } from "@/lib/session";
import { contractHref, disputeHref, fundHref, loadOverview, milestoneHref, OPEN_DISPUTE } from "@/lib/identity/overview";
import { profileGaps, type StoredProfile } from "@/lib/identity/profile";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function ClientOverview() {
  const v = await requireViewer(["client"]);
  const [u] = await db.select({ profile: users.profile }).from(users).where(eq(users.id, v.id)).limit(1);
  const profile = (u?.profile ?? {}) as StoredProfile;
  const tz = tzOf(profile);
  const currency = profile.currency ?? "USD";
  const o = await loadOverview({ id: v.id, email: v.email, role: "client" });
  const byId = new Map(o.contracts.map((c) => [c.id, c]));
  const title = (wsId: string) => byId.get(wsId)?.title ?? "Contract";

  const approvals = o.milestones.filter((m) => m.state === "SUBMITTED" || m.state === "ESCALATED").sort((a, b) => (a.reviewDueAt?.getTime() ?? Infinity) - (b.reviewDueAt?.getTime() ?? Infinity));
  const unfunded = o.tranches.filter((t) => (t.state === "PLANNED" || t.state === "AWAITING_APPROVAL") && byId.get(t.workspaceId)?.state === "LOCKED").sort((a, b) => a.startDay - b.startDay);
  const toSign = o.contracts.filter((c) => (c.state === "READY_TO_SIGN" || c.state === "PARTIALLY_SIGNED") && !c.signedByMe);
  const open = o.disputes.filter((d) => OPEN_DISPUTE.has(d.state));
  const actions = approvals.length + unfunded.length + toSign.length + open.length;
  const gaps = profileGaps(profile);
  const first = v.name.split(" ")[0];

  return (
    <>
      <div className="phead">
        <div>
          <h1>Overview</h1>
          <p className="sub">Hello {first}. {o.contracts.length ? `Where your money is across ${o.contracts.length} contract${o.contracts.length === 1 ? "" : "s"}, and what is waiting for you.` : "Start a contract and your money will show here, milestone by milestone."}</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v tnum">{cents(o.total.heldCents, currency)}</div><div className="l">Held in PayPal</div></div>
          <div className="hstat"><div className="v">{actions}</div><div className="l">Need you</div></div>
        </div>
      </div>

      {gaps.length > 0 && (
        <p className="notice" data-b="warn" role="note">Your profile is missing {gaps.join(", ")}. Funding a tranche needs a complete profile (ERR_103). <Link href="/account">Complete it on Account &amp; security</Link>.</p>
      )}

      <MoneyCards money={o.total} currency={currency} labels={{ held: "Held in PayPal", released: "Released to providers", returned: "Returned to you", waiting: "Signed, not funded yet" }} />

      <div className="id-grid">
        <section className="c id-6" aria-labelledby="todo-h">
          <div className="c-head"><h2 id="todo-h">Needs you</h2><span className="r"><span className="chip" data-b={actions ? "warn" : "ok"}>{actions ? `${actions} open` : "All clear"}</span></span></div>
          {actions === 0 ? (
            <div className="empty">
              <p>Nothing needs you right now. When a provider submits evidence, it appears here with its review clock.</p>
              <div className="row"><Link className="btn btn-d btn-sm" href="/client/new">Start a new contract</Link><Link className="btn btn-sm" href="/blueprints">Browse blueprints</Link></div>
            </div>
          ) : (
            <div className="stack">
              {approvals.length > 0 && (
                <div>
                  <h3 className="id-group-h">Approvals due · {approvals.length}</h3>
                  <ul className="id-list">
                    {approvals.map((m) => {
                      const c = byId.get(m.workspaceId);
                      return (
                        <li key={m.id}>
                          <Link className="id-main" href={milestoneHref(m.workspaceId, m.id)}>
                            <b>{m.code} · {m.title}</b>
                            <small>{title(m.workspaceId)} · {m.state === "ESCALATED" ? "review window passed, escalated" : `evidence submitted, attempt ${Math.max(1, m.attempts)}`}</small>
                          </Link>
                          <span className="id-amt">{cents(m.amountCents, c?.currency)}</span>
                          {m.reviewDueAt && c && <Countdown dueMs={m.reviewDueAt.getTime()} virtualNowMs={c.nowMs} realNowMs={o.realNowMs} label={`Review due ${when(m.reviewDueAt, tz)}`} />}
                          <Link className="btn btn-g btn-sm" href={milestoneHref(m.workspaceId, m.id)}>Review proof</Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {unfunded.length > 0 && (
                <div>
                  <h3 className="id-group-h">Tranches to fund · {unfunded.length}</h3>
                  <ul className="id-list">
                    {unfunded.map((t) => (
                      <li key={t.id}>
                        <div className="id-main"><b>Tranche {t.idx} · {title(t.workspaceId)}</b><small>Days {t.startDay}–{t.endDay} · {t.state === "AWAITING_APPROVAL" ? "PayPal order created, waiting for your approval in PayPal" : "work in this tranche starts once PayPal holds it"}</small></div>
                        <span className="id-amt">{cents(t.amountCents, byId.get(t.workspaceId)?.currency)}</span>
                        <Link className="btn btn-d btn-sm" href={fundHref(t.workspaceId, t.id)}>{t.state === "AWAITING_APPROVAL" ? "Finish in PayPal" : "Fund in PayPal"}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {toSign.length > 0 && (
                <div>
                  <h3 className="id-group-h">Waiting for your signature · {toSign.length}</h3>
                  <ul className="id-list">
                    {toSign.map((c) => (
                      <li key={c.id}>
                        <div className="id-main"><b>{c.title}</b><small>Revision {c.revision}{c.signedByThem ? ` · ${c.counterpart ?? "the provider"} has signed` : " · neither side has signed yet"}</small></div>
                        <span className="id-amt">{cents(c.totalCents, c.currency)}</span>
                        <Link className="btn btn-sm" href={contractHref("client", c.id)}>Read and sign</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {open.length > 0 && (
                <div>
                  <h3 className="id-group-h">Open disputes · {open.length}</h3>
                  <ul className="id-list">
                    {open.map((d) => {
                      const c = byId.get(d.workspaceId);
                      const due = d.state === "TIER1" ? d.tier1Until : d.vaultUntil;
                      return (
                        <li key={d.id}>
                          <Link className="id-main" href={disputeHref(d.id)}><b>{d.code} · {d.title}</b><small>{title(d.workspaceId)} · Tier {d.tier} · only this milestone is frozen</small></Link>
                          <span className="state disputed"><span className="tnum">{cents(d.amountCents, c?.currency)}</span>&nbsp;frozen</span>
                          {c && (d.state === "TIER1" || d.state === "TIER2") && <Countdown dueMs={due.getTime()} virtualNowMs={c.nowMs} realNowMs={o.realNowMs} label={d.state === "TIER1" ? "Blind bids close" : "Evidence vault closes"} />}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="c id-6" aria-labelledby="contracts-h">
          <div className="c-head"><h2 id="contracts-h">Contracts</h2><span className="r"><Link className="btn btn-sm" href="/client/contracts">All contracts</Link></span></div>
          <ContractsByStage contracts={o.contracts} role="client" empty={
            <div className="empty">
              <p>No contracts yet. Start from a blueprint: the milestones, proof specs and protection come with it.</p>
              <div className="row"><Link className="btn btn-g btn-sm" href="/client/new">Start a contract</Link><Link className="btn btn-sm" href="/blueprints">Browse blueprints</Link></div>
            </div>
          } />
        </section>
      </div>
    </>
  );
}
