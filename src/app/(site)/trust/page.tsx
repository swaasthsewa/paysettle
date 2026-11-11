/**
 * A8 · /trust — the 24 risks our red team raised against the plan, our answer to each with its status and the screen
 * that shows it; what we do not do; the published risk formula (read from src/lib/policy); who PaySettle is for; and the
 * eight further risks we track. Content: src/data/trust.ts.
 */
import "@/styles/trust.css";
import Link from "next/link";
import { Cta, PageHero, SiteMain } from "@/components/site/parts";
import { JudgeTour } from "@/components/tour/JudgeTour";
import { FOR_WHOM, OPS_THRESHOLD, RISKS, STATUS_HINT, STATUS_LABEL, STATUS_TONE, TRACKED, WE_DO_NOT, riskWeights, statusCounts } from "@/data/trust";
import { RiskList, TrustLinks } from "./risk-list";

export const metadata = {
  title: "Trust",
  description: "The 24 hard questions our own red team asked about PaySettle, our answer to each, how far it is built, and where to check it.",
  alternates: { canonical: "/trust" },
};

export default function Page() {
  const counts = statusCounts();
  const weights = riskWeights();
  return (
    <SiteMain>
      <PageHero
        kicker="Trust"
        title="The hard questions, answered in the open"
        lead="Before building PaySettle we asked our own red team to attack the plan. These are the 24 risks they raised, what we did about each one, how far that answer is built, and where you can check it yourself."
      >
        <ul className="tr-sum" aria-label="Answers by status">
          {counts.map((c) => (
            <li key={c.status}><b>{c.n}</b> <span className="chip" data-b={STATUS_TONE[c.status]}>{c.label}</span></li>
          ))}
        </ul>
        <p className="s-chips tr-hero-links">
          <Link className="btn" href="/trust/ai">AI scorecard</Link>
          <Link className="btn" href="/security">Security controls</Link>
          <Link className="btn" href="/privacy">Privacy</Link>
        </p>
      </PageHero>

      <section id="risks" className="s-section tight tr" aria-labelledby="risks-h">
        <div className="s-wrap">
          <div className="s-head">
            <h2 id="risks-h">24 risks, one answer each</h2>
            <p className="s-lead">Each answer links to the page or screen that shows it. App screens open in the live demo; the link says which demo person to sign in as.</p>
          </div>
          <dl className="tr-legend">
            {(["built", "progress", "decided"] as const).map((s) => (
              <div key={s}><dt><span className="chip" data-b={STATUS_TONE[s]}>{STATUS_LABEL[s]}</span></dt><dd>{STATUS_HINT[s]}</dd></div>
            ))}
          </dl>
          <RiskList risks={RISKS} />
        </div>
      </section>

      <section id="not" className="s-section alt tr" aria-labelledby="not-h">
        <div className="s-wrap">
          <div className="s-head"><h2 id="not-h">What we do not do</h2><p className="s-lead">Four lines we hold to, because each one removes a conflict of interest or a risk we do not need.</p></div>
          <ul className="tr-not">
            {WE_DO_NOT.map((w) => (
              <li key={w.title} className="s-card">
                <h3><span className="tr-no" aria-hidden="true" />{w.title}</h3>
                <p>{w.body}</p>
                {w.risk && <p className="tr-ref"><a href={`#risk-${w.risk}`}>See risk {w.risk}</a></p>}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="formula" className="s-section tr" aria-labelledby="formula-h">
        <div className="s-wrap">
          <div className="s-head">
            <h2 id="formula-h">The risk score, in full</h2>
            <p className="s-lead">Every contract gets a score from 0 to 100 when it is signed. It is a fixed formula with no link to revenue. A score of {OPS_THRESHOLD} or more sends the contract to a person in Operations before any money is held.</p>
          </div>
          <div className="tr-table-wrap">
            <table className="tr-table">
              <caption className="sr-only">Parts of the risk score and their weights</caption>
              <thead><tr><th scope="col">Part</th><th scope="col">Weight</th><th scope="col">What it measures</th></tr></thead>
              <tbody>
                {weights.map((w) => (
                  <tr key={w.key}><th scope="row">{w.label}</th><td className="tnum">{w.points} points</td><td>{w.meaning}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><th scope="row">Total</th><td className="tnum">{weights.reduce((a, w) => a + w.points, 0)} points</td><td>Each part counts from 0 to its full weight; the score is the rounded sum.</td></tr></tfoot>
            </table>
          </div>
          <p className="s-note">The weights shown here are read from the scoring code itself, so this page and the product cannot drift apart.</p>
        </div>
      </section>

      <section id="for-whom" className="s-section alt tr" aria-labelledby="for-whom-h">
        <div className="s-wrap tr-for">
          <div className="s-head"><h2 id="for-whom-h">Who PaySettle is for</h2><p className="s-lead">{FOR_WHOM.who}</p></div>
          <ul className="s-ticks">{FOR_WHOM.examples.map((e) => <li key={e}>{e}</li>)}</ul>
          <p className="tr-notfor">{FOR_WHOM.notFor}</p>
        </div>
      </section>

      <section id="tracked" className="s-section tr" aria-labelledby="tracked-h">
        <div className="s-wrap">
          <div className="s-head"><h2 id="tracked-h">Eight more risks we track</h2><p className="s-lead">The red team did not raise these. We did, while building.</p></div>
          <ul className="tr-tracked">
            {TRACKED.map((t, i) => (
              <li key={t.title} className="s-card">
                <article aria-labelledby={`tracked-${i}-h`}>
                  <div className="tr-risk-top"><h3 id={`tracked-${i}-h`}>{t.title}</h3><span className="chip" data-b={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</span></div>
                  <p className="tr-risk-text">{t.risk}</p>
                  <p className="tr-answer"><b>Our answer.</b> {t.answer}</p>
                  <div className="tr-check"><p className="tr-check-h">Check it</p><TrustLinks links={t.links} /></div>
                </article>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Cta />
      {/* carries a running judge tour (A10) on this page; draws nothing otherwise */}
      <JudgeTour launcher={false} />
    </SiteMain>
  );
}
