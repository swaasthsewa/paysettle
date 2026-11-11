/**
 * The dispute room shared by both parties. F4.01 scoped freeze and timeline · F4.02 Tier 1 sealed offers ·
 * F4.03 Tier 2 vault · F4.04 annotation tool · F4.06 Tier 3 status · F4.08 settlement legs · F4.10 PayPal disputes.
 * F4.05: "why this mediator" (stored router breakdown) and the parties' rating after settlement.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import "@/styles/disputes.css";
import "@/styles/mediators.css";
import { requireViewer } from "@/lib/session";
import { disputeCase } from "@/server/disputes/queries";
import { REASONS } from "@/server/disputes/rules";
import { lockAction, sealNowAction, skipAction } from "@/server/disputes/actions";
import { BidWidget } from "@/components/disputes/bid-widget";
import { RebuttalForm, type AnnImage } from "@/components/disputes/rebuttal-form";
import { Events, External, Flash, Legs, Milestones, StateChip, Timeline, Vault, VerdictSummary, WhereMoney } from "@/components/disputes/parts";
import { money, pctOf, when } from "@/components/disputes/format";
import { WhyMediator } from "@/components/disputes/why-mediator";
import { RateMediator } from "@/components/disputes/rate-mediator";
import { db } from "@/db/client";
import { wsClauses } from "@/db/schema";
import { eq } from "drizzle-orm";

export const metadata = { title: "Dispute room" };

const safeUrl = (u?: string) => (u && (u.startsWith("/") || u.startsWith("https://")) ? u : null);

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const v = await requireViewer();
  const { id } = await params;
  const q = await searchParams;
  const c = await disputeCase(v, id);
  if (!c) notFound();
  const cur = c.workspace.currency;
  const judge = v.role === "judge";
  const party = c.side !== null || judge;
  const back = v.role === "client" ? "/client/disputes" : "/disputes";
  const clauses = (await db.select({ code: wsClauses.code, title: wsClauses.title, active: wsClauses.active }).from(wsClauses).where(eq(wsClauses.workspaceId, c.workspace.id))).filter((k) => k.active);
  const images: AnnImage[] = [
    ...c.evidence.flatMap((p) => p.files.filter((f) => f.kind === "IMAGE" || /^image\//.test(f.kind)).map((f) => ({ sha: f.sha256, name: f.name, url: safeUrl(f.url), kind: f.kind }))),
    ...c.files.filter((f) => f.type.startsWith("image/")).map((f) => ({ sha: f.sha256, name: f.name, url: `/disputes/${c.d.id}/file/${f.sha256}`, kind: "IMAGE" })),
  ];
  const locks = c.meta?.vaultLocks ?? [];
  const myLock = c.side ? locks.includes(c.side) : false;
  const other = c.side === "client" ? c.providerName : c.clientName;
  const myBids = c.bids.filter((b) => b.role === c.side);
  const staffView = c.access === "staff" || c.access === "mediator" || c.access === "cosigner";
  const rateable = c.d.state === "RESOLVED" && c.verdict?.origin === "TIER3" && !!c.verdict.mediatorId && c.side !== null;
  const myReview = c.side ? c.reviews.find((r) => r.raterRole === c.side) ?? null : null;

  return (
    <>
      <div className="phead">
        <div>
          <p className="crumb"><Link href={back}>Disputes</Link> › {c.workspace.title}</p>
          <h1>Dispute on {c.milestone.code}</h1>
          <p className="sub">{c.milestone.title} · {c.clientName} (client) and {c.providerName} (provider) · opened {when(c.d.createdAt)}</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v money">{money(c.d.amountCents, cur)}</div><div className="l">Frozen amount</div></div>
          <div className="hstat"><div className="v" style={{ fontSize: 18 }}><StateChip state={c.d.state} /></div><div className="l">{c.meta?.fastTrack ? "Fast track (hold ends soon)" : "Stage"}</div></div>
        </div>
      </div>
      <Flash ok={q.ok} error={q.error} />
      <section className="c" aria-label="Stages"><Timeline c={c} /></section>

      <div className="bento">
        <section className="c span7" aria-labelledby="dz-money">
          <div className="c-head"><h2 id="dz-money">Where the money is</h2></div>
          <WhereMoney c={c} />
          <Milestones c={c} />
          <p className="small muted">Settled milestones stay paid. Milestones that depend on {c.milestone.code} wait until this dispute ends.</p>
        </section>

        <section className="c span5" aria-labelledby="dz-now">
          <div className="c-head"><h2 id="dz-now">{c.d.state === "TIER1" ? "Sealed offers" : c.d.state === "TIER2" ? "Evidence vault" : c.d.state === "TIER3" ? "With the mediator" : "Outcome"}</h2></div>

          {c.d.state === "TIER1" && party && (
            <>
              {(c.myTurn || judge) && c.round ? <BidWidget disputeId={c.d.id} amountCents={c.d.amountCents} currency={cur} side={c.side ?? "client"} round={c.round} />
                : c.waitingOther ? <p>Your round {c.round} offer is sealed. Waiting for {other}.</p> : null}
              {myBids.length > 0 && <ul className="dz-files">{myBids.map((b) => <li key={b.round}>Round {b.round}: you offered {pctOf(b.providerShareBps)} to the provider <span className="small muted">· commit {b.commit.slice(0, 12)}…</span></li>)}</ul>}
              <p className="small muted">{c.roundsDone} of 3 rounds complete. Offers close {when(c.d.tier1Until)}.</p>
              <form action={skipAction}><input type="hidden" name="disputeId" value={c.d.id} /><button className="btn btn-sm btn-gh" type="submit">Skip to the evidence vault (no penalty)</button></form>
            </>
          )}

          {c.d.state === "TIER2" && party && (
            <>
              <p>Add what the mediator should see until {when(c.vaultEnd)}. Locked sides: {locks.length ? locks.join(", ") : "none"}.</p>
              {myLock ? <p className="notice">You locked your side. The vault seals when {other} locks or at the deadline.</p>
                : <form action={lockAction}><input type="hidden" name="disputeId" value={c.d.id} /><button className="btn btn-sm" type="submit">I have nothing more to add — lock my side</button></form>}
              {judge && <form action={sealNowAction}><input type="hidden" name="disputeId" value={c.d.id} /><button className="btn btn-sm btn-gh" type="submit">Seal now (sandbox judge)</button></form>}
            </>
          )}

          {c.d.state === "TIER3" && !c.verdict && (
            <p>{c.mediatorName ? `${c.mediatorName} is reviewing the sealed dossier.` : "Waiting for a mediator free of conflicts to take the case."} Verdict due {when(c.meta?.tier3Until)}.</p>
          )}
          {c.verdict && <VerdictSummary c={c} />}
          {c.verdict && <Legs c={c} back={`/disputes/${c.d.id}`} />}
          {rateable && <RateMediator disputeId={c.d.id} mediatorName={c.names[c.verdict!.mediatorId!] ?? "the mediator"} mine={myReview} />}
          {c.d.state === "SUPERSEDED" && <p className="notice" data-b="warn">A PayPal dispute on this payment took over. Payouts on the hold are locked while PayPal decides.</p>}
          {!party && !c.verdict && c.d.state !== "TIER3" && <p className="muted small">The parties are working through this stage.</p>}
          {(c.access === "mediator" || c.access === "cosigner" || c.access === "staff") && <Link className="btn btn-sm" href={`/mediator/cases/${c.d.id}`}>Open the workbench</Link>}
        </section>

        {c.d.state === "TIER2" && party && !myLock && (
          <section className="c span12" aria-labelledby="dz-add">
            <div className="c-head"><h2 id="dz-add">Add to the vault</h2></div>
            <RebuttalForm disputeId={c.d.id} images={images} clauses={clauses.map((k) => ({ code: k.code, title: k.title }))} />
          </section>
        )}

        {(c.d.tier >= 3 || c.assignment.offers.length > 0) && <div className="span12"><WhyMediator a={c.assignment} detail={staffView ? "full" : "party"} now={c.now} /></div>}

        <section className="c span7" aria-labelledby="dz-ev">
          <div className="c-head"><h2 id="dz-ev">Evidence and vault</h2></div>
          <div className="dz-reb" data-role={c.d.openedBy === c.workspace.clientId ? "client" : "provider"}>
            <div className="row"><b>Opening statement</b><span className="chip" data-b="plain">{REASONS[c.d.reason as keyof typeof REASONS] ?? c.d.reason}</span></div>
            <p className="dz-pre">{c.d.narrative}</p>
          </div>
          <Vault c={c} fileHref={(sha) => `/disputes/${c.d.id}/file/${sha}`} />
        </section>
        <section className="c span5" aria-labelledby="dz-log">
          <div className="c-head"><h2 id="dz-log">Activity</h2></div>
          <Events c={c} />
        </section>
      </div>
      <External c={c} />
    </>
  );
}
