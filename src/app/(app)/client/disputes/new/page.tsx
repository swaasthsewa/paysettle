/** Open a dispute on one milestone (F4.01 scoped freeze, F4.11 fast track shown before opening). */
import Link from "next/link";
import { notFound } from "next/navigation";
import "@/styles/disputes.css";
import { requireViewer } from "@/lib/session";
import { milestoneForDispute } from "@/server/disputes/queries";
import { REASONS } from "@/server/disputes/rules";
import { openDisputeAction } from "@/server/disputes/actions";
import { Flash } from "@/components/disputes/parts";
import { MS_LABEL, money, when } from "@/components/disputes/format";

export const metadata = { title: "Open a dispute" };

export default async function Page({ searchParams }: { searchParams: Promise<{ milestone?: string; error?: string; reason?: string }> }) {
  const v = await requireViewer(["client", "provider", "ops", "judge"]);
  const q = await searchParams;
  const back = v.role === "client" ? "/client/disputes" : "/disputes";
  if (!q.milestone) return (
    <>
      <div className="phead"><div><p className="crumb"><Link href={back}>Disputes</Link></p><h1>Open a dispute</h1></div></div>
      <section className="c"><p>Pick a milestone with submitted proof from <Link href={back}>your disputes page</Link>.</p></section>
    </>
  );
  const x = await milestoneForDispute(v, q.milestone);
  if (!x) notFound();
  const m = x.milestone, cur = x.workspace.currency;
  /* MISSED_DEADLINE (contest a late deduction) is the provider's; ?reason= preselects it from the milestone page */
  const reasons = Object.entries(REASONS).filter(([k]) => (v.role === "provider" ? k !== "QUALITY" : k !== "UNFAIR_REJECTION" && k !== "MISSED_DEADLINE"));
  const preset = reasons.some(([k]) => k === q.reason) ? q.reason : reasons[0]?.[0];
  return (
    <>
      <div className="phead">
        <div><p className="crumb"><Link href={back}>Disputes</Link> › {x.workspace.title}</p><h1>Dispute {m.code}</h1><p className="sub">{m.title} · {x.workspace.client} and {x.workspace.provider}</p></div>
        <div className="stats"><div className="hstat"><div className="v money">{money(m.amountCents, cur)}</div><div className="l">Would be frozen</div></div></div>
      </div>
      <Flash error={q.error} />
      {x.existingDisputeId ? (
        <section className="c"><p>This milestone already has a dispute. <Link href={`/disputes/${x.existingDisputeId}`}>Open the dispute room</Link>.</p></section>
      ) : x.final ? (
        <section className="c"><p className="notice" data-b="warn">{m.title} is settled ({MS_LABEL[m.state] ?? m.state}). Its release is final within PaySettle, so it cannot be disputed here. PayPal&apos;s own buyer and seller programmes are unaffected.</p></section>
      ) : !x.open ? (
        <section className="c"><p className="notice">Only a milestone with submitted proof can be disputed. {m.title} is {(MS_LABEL[m.state] ?? m.state).toLowerCase()}.</p></section>
      ) : (
        <div className="bento">
          <section className="c span7" aria-labelledby="dz-form">
            <div className="c-head"><h2 id="dz-form">What went wrong</h2></div>
            <form action={openDisputeAction} className="stack">
              <input type="hidden" name="milestoneId" value={m.id} />
              <fieldset className="dz-radios">
                <legend>Reason</legend>
                {reasons.map(([k, label]) => <label key={k}><input type="radio" name="reason" value={k} defaultChecked={k === preset} required /> {label}</label>)}
              </fieldset>
              <div className="field">
                <label htmlFor="dz-n">In your words</label>
                <textarea id="dz-n" name="narrative" className="input" required minLength={10} maxLength={4000} placeholder="Which criterion is not met, and what you expected to see." />
              </div>
              <div className="row"><button className="btn btn-g" type="submit">Open the dispute and freeze {money(m.amountCents, cur)}</button><Link className="btn btn-gh" href={back}>Cancel</Link></div>
            </form>
          </section>
          <section className="c span5" aria-labelledby="dz-what">
            <div className="c-head"><h2 id="dz-what">What happens next</h2></div>
            <ol className="dz-events">
              <li><b>Tier 1 · sealed offers</b> Until {when(x.deadlines.tier1Until)}. Each of you names a share for the provider. If the two meet within 5 points, it settles at the midpoint. Free.</li>
              <li><b>Tier 2 · evidence vault</b> Until {when(x.deadlines.vaultUntil)}. Add notes, files and marked regions. Write-once. Free.</li>
              <li><b>Tier 3 · mediator</b> Verdict by {when(x.deadlines.tier3Until)}. A flat mediation fee applies to the party at fault.</li>
              <li><b>Settlement</b> The refund leg first, then the release leg.</li>
            </ol>
            {x.deadlines.fastTrack && <p className="notice" data-b="warn">Fewer than 72 hours remain on this PayPal hold, so each tier is shortened to 24 hours.</p>}
            <p className="small muted">The dispute rule for this milestone: {m.disputeRule}</p>
            {m.criteria.length > 0 && <ul className="dz-files">{m.criteria.map((c) => <li key={c}>{c}</li>)}</ul>}
          </section>
        </div>
      )}
    </>
  );
}
