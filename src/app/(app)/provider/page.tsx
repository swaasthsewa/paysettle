/**
 * F1 provider overview (get paid on delivery without chasing; F1.4 onboarding state, F1.6 PayPal
 * link, trust tier). To-do: milestones open or in remediation, evidence waiting on the client (review clock), disputes;
 * payouts released and pending; contract invites and signatures. Read straight from the database.
 */
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import "@/styles/site.css";
import { db } from "@/db/client";
import { paypalLinks, users } from "@/db/schema";
import { Countdown } from "@/components/identity/countdown";
import { cents, tzOf, when } from "@/components/identity/format";
import { ContractsByStage, MoneyCards } from "@/components/identity/overview-parts";
import { feeFor } from "@/lib/money";
import { requireViewer } from "@/lib/session";
import { contractHref, disputeHref, loadOverview, milestoneHref, OPEN_DISPUTE } from "@/lib/identity/overview";
import { isValidated, missingCredentials, onboardingChip, type ProviderProfile } from "@/lib/identity/provider";

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const TIER = {
  platinum: "Platinum: long clean record; contracts clear fastest",
  standard: "Standard: clean releases so far",
  new: "New: the first contracts build your record",
  probation: "Probation: recent disputes; Ops reviews your contracts",
} as Record<string, string>;

export default async function ProviderOverview() {
  const v = await requireViewer(["provider"]);
  const [u] = await db.select().from(users).where(eq(users.id, v.id)).limit(1);
  const [merchant] = await db.select().from(paypalLinks).where(and(eq(paypalLinks.userId, v.id), eq(paypalLinks.kind, "merchant"))).limit(1);
  const tz = tzOf(u?.profile);
  const p = ((u?.profile as { provider?: Partial<ProviderProfile> } | undefined)?.provider ?? {}) as Partial<ProviderProfile>;
  const state = u?.onboardingState ?? "PENDING";
  const chip = onboardingChip(state);
  const missing = isValidated(state) ? [] : missingCredentials(p, Boolean(merchant?.receivable));
  const o = await loadOverview({ id: v.id, email: v.email, role: "provider" });
  const byId = new Map(o.contracts.map((c) => [c.id, c]));
  const title = (wsId: string) => byId.get(wsId)?.title ?? "Contract";
  const live = new Set(o.contracts.filter((c) => c.state === "LOCKED").map((c) => c.id));

  const work = o.milestones.filter((m) => live.has(m.workspaceId) && (m.state === "OPEN" || m.state === "REMEDIATION"))
    .sort((a, b) => (a.state === "REMEDIATION" ? -1 : 0) - (b.state === "REMEDIATION" ? -1 : 0) || a.targetDay - b.targetDay);
  const waiting = o.milestones.filter((m) => m.state === "SUBMITTED" || m.state === "ESCALATED");
  const open = o.disputes.filter((d) => OPEN_DISPUTE.has(d.state));
  const toSign = o.contracts.filter((c) => (c.state === "READY_TO_SIGN" || c.state === "PARTIALLY_SIGNED") && !c.signedByMe);
  const negotiating = o.contracts.filter((c) => c.state === "DRAFT");

  const released = o.releases.filter((r) => r.status === "COMPLETED").sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  const releasedNet = released.reduce((a, r) => a + r.netCents, 0);
  const inFlight = o.releases.filter((r) => r.status === "PENDING" || r.status === "IN_FLIGHT");
  const withRelease = new Set(o.releases.map((r) => r.milestoneId));
  const approved = o.milestones.filter((m) => m.state === "APPROVED" && !withRelease.has(m.id));
  const pendingNet = inFlight.reduce((a, r) => a + r.netCents, 0) + approved.reduce((a, m) => a + m.amountCents - feeFor(m.amountCents, byId.get(m.workspaceId)?.feeBps ?? 250), 0);
  const msName = new Map(o.milestones.map((m) => [m.id, `${m.code} · ${m.title}`]));
  const todo = work.length + waiting.length + open.length + toSign.length + o.invites.length;

  return (
    <>
      <div className="phead">
        <div>
          <h1>Overview</h1>
          <p className="sub">Hello {v.name.split(" ")[0]}. What to deliver next, what is waiting on your clients, and what has been paid.</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v tnum">{cents(releasedNet)}</div><div className="l">Paid to you</div></div>
          <div className="hstat"><div className="v tnum">{cents(pendingNet)}</div><div className="l">Payout pending</div></div>
          <div className="hstat"><div className="v">{todo}</div><div className="l">To do</div></div>
        </div>
      </div>

      {(missing.length > 0 || !merchant?.receivable) && (
        <p className="notice" data-b="warn" role="note">
          {!merchant?.receivable ? "Payouts are off until a PayPal business account that can receive is linked (ERR_106). " : ""}
          {missing.length > 0 ? `Ops still needs: ${missing.join("; ")}. ` : ""}
          <Link href="/provider/onboarding">Finish onboarding &amp; PayPal</Link>
        </p>
      )}

      <MoneyCards money={o.total} labels={{ held: "Held in PayPal for your milestones", released: "Released (before fees)", returned: "Returned to clients", waiting: "Signed, client yet to fund" }} />

      <div className="id-grid">
        <section className="c id-8" aria-labelledby="todo-h">
          <div className="c-head"><h2 id="todo-h">To do</h2><span className="r"><span className="chip" data-b={todo ? "warn" : "ok"}>{todo ? `${todo} open` : "All clear"}</span></span></div>
          {todo === 0 ? (
            <div className="empty">
              <p>Nothing to do right now. Send a client a milestone plan from a blueprint; they fund it in PayPal before you start.</p>
              <div className="row"><Link className="btn btn-d btn-sm" href="/blueprints">Pick a blueprint</Link><Link className="btn btn-sm" href="/provider/onboarding">Check onboarding</Link></div>
            </div>
          ) : (
            <div className="stack">
              {o.invites.length > 0 && (
                <div>
                  <h3 className="id-group-h">Contract invites · {o.invites.length}</h3>
                  <ul className="id-list">
                    {o.invites.map((c) => (
                      <li key={c.id}>
                        <div className="id-main"><b>{c.title}</b><small>From {c.counterpart ?? "a client"} · sent to {c.inviteEmail} · revision {c.revision}</small></div>
                        <span className="id-amt">{cents(c.totalCents, c.currency)}</span>
                        <Link className="btn btn-g btn-sm" href={contractHref("provider", c.id)}>Open the plan</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {work.length > 0 && (
                <div>
                  <h3 className="id-group-h">Deliver next · {work.length}</h3>
                  <ul className="id-list">
                    {work.map((m) => (
                      <li key={m.id}>
                        <Link className="id-main" href={milestoneHref(m.workspaceId, m.id)}>
                          <b>{m.code} · {m.title}</b>
                          <small>{title(m.workspaceId)} · day {m.targetDay}{m.state === "REMEDIATION" ? ` · fix requested after attempt ${m.attempts}` : m.funded ? " · funded, ready for evidence" : " · tranche not funded yet"}</small>
                        </Link>
                        {m.state === "REMEDIATION" && <span className="chip" data-b="warn">Fix requested</span>}
                        <span className="id-amt">{m.type === "GATE" ? "Gate" : cents(m.amountCents, byId.get(m.workspaceId)?.currency)}</span>
                        <Link className="btn btn-d btn-sm" href={milestoneHref(m.workspaceId, m.id)}>{m.state === "REMEDIATION" ? "Fix and resubmit" : "Submit evidence"}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {waiting.length > 0 && (
                <div>
                  <h3 className="id-group-h">Waiting on the client · {waiting.length}</h3>
                  <ul className="id-list">
                    {waiting.map((m) => {
                      const c = byId.get(m.workspaceId);
                      return (
                        <li key={m.id}>
                          <Link className="id-main" href={milestoneHref(m.workspaceId, m.id)}><b>{m.code} · {m.title}</b><small>{title(m.workspaceId)} · {m.state === "ESCALATED" ? "the review window passed; escalated to Ops" : "evidence in review"}</small></Link>
                          <span className="id-amt">{cents(m.amountCents, c?.currency)}</span>
                          {m.reviewDueAt && c && <Countdown dueMs={m.reviewDueAt.getTime()} virtualNowMs={c.nowMs} realNowMs={o.realNowMs} label={`Client review due ${when(m.reviewDueAt, tz)}`} />}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {toSign.length > 0 && (
                <div>
                  <h3 className="id-group-h">Waiting for your signature · {toSign.length}</h3>
                  <ul className="id-list">
                    {toSign.map((c) => (
                      <li key={c.id}>
                        <div className="id-main"><b>{c.title}</b><small>{c.counterpart ?? "Client"} · revision {c.revision}{c.signedByThem ? " · the client has signed" : ""}</small></div>
                        <Link className="btn btn-sm" href={contractHref("provider", c.id)}>Read and sign</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {open.length > 0 && (
                <div>
                  <h3 className="id-group-h">Open disputes · {open.length}</h3>
                  <ul className="id-list">
                    {open.map((d) => (
                      <li key={d.id}>
                        <div className="id-main"><b>{d.code} · {d.title}</b><small>{title(d.workspaceId)} · Tier {d.tier} · your other milestones keep going</small></div>
                        <span className="state disputed"><span className="tnum">{cents(d.amountCents)}</span>&nbsp;frozen</span>
                        <Link className="btn btn-sm" href={disputeHref(d.id)}>Open the case</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="c id-4" aria-labelledby="trust-h">
          <div className="c-head"><h2 id="trust-h">Your standing</h2></div>
          <dl className="kv">
            <div><dt>Trust tier</dt><dd><span className="id-tier"><i aria-hidden="true" />{u?.tier ?? "new"}</span><small>{TIER[u?.tier ?? "new"]}</small></dd></div>
            <div><dt>Onboarding</dt><dd><span className="chip" data-b={chip.b}>{chip.label}</span></dd></div>
            <div><dt>PayPal payouts</dt><dd>{merchant?.receivable ? "On" : "Off"}<small>{merchant?.email ?? "No business account linked"}</small></dd></div>
          </dl>
          <div className="row"><Link className="btn btn-sm" href="/provider/onboarding">Onboarding &amp; PayPal</Link></div>
        </section>

        <section className="c id-6" aria-labelledby="pay-h">
          <div className="c-head"><h2 id="pay-h">Payouts</h2><span className="r"><Link className="btn btn-sm" href="/provider/payouts">All payouts</Link></span></div>
          {released.length === 0 && inFlight.length === 0 && approved.length === 0 ? (
            <div className="empty"><p>No payouts yet. Each approved milestone is captured from the client{"’"}s PayPal hold to your account, less the release fee.</p></div>
          ) : (
            <ul className="id-list">
              {[...approved.map((m) => ({ k: m.id, name: `${m.code} · ${m.title}`, ws: m.workspaceId, net: m.amountCents - feeFor(m.amountCents, byId.get(m.workspaceId)?.feeBps ?? 250), fee: feeFor(m.amountCents, byId.get(m.workspaceId)?.feeBps ?? 250), s: "Approved, releasing", at: null as Date | null })),
                ...inFlight.map((r) => ({ k: r.milestoneId + r.status, name: msName.get(r.milestoneId) ?? "Milestone", ws: r.workspaceId, net: r.netCents, fee: r.feeCents, s: "In flight at PayPal", at: r.createdAt })),
                ...released.slice(0, 6).map((r) => ({ k: r.milestoneId, name: msName.get(r.milestoneId) ?? "Milestone", ws: r.workspaceId, net: r.netCents, fee: r.feeCents, s: "Released", at: r.completedAt }))]
                .map((r) => (
                  <li key={r.k}>
                    <div className="id-main"><b>{r.name}</b><small>{title(r.ws)}{r.at ? ` · ${when(r.at, tz)}` : ""} · fee {cents(r.fee)}</small></div>
                    <span className={`state ${r.s === "Released" ? "released" : "held"}`}>{r.s}</span>
                    <span className="id-amt">{cents(r.net)}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="c id-6" aria-labelledby="contracts-h">
          <div className="c-head"><h2 id="contracts-h">Contracts</h2><span className="r"><Link className="btn btn-sm" href="/provider/contracts">All contracts</Link></span></div>
          <ContractsByStage contracts={[...o.contracts.filter((c) => !negotiating.includes(c)), ...negotiating]} role="provider" empty={
            <div className="empty">
              <p>No contracts yet. When a client invites you, the plan arrives under To do.</p>
              <div className="row"><Link className="btn btn-sm" href="/blueprints">See the blueprints clients start from</Link></div>
            </div>
          } />
        </section>
      </div>
    </>
  );
}
