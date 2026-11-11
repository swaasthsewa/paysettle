/**
 * A8 · /trust — trust by design. The scenarios PaySettle was designed around, by theme: what could go wrong, how the
 * product resolves it, the options we considered and set aside, how far it is built and where to see it. Then the lines
 * we hold, what is deliberately out of scope, the published risk formula (read from src/lib/policy) and who PaySettle is
 * for. Content: src/data/trust.ts.
 */
import "@/styles/trust.css";
import Link from "next/link";
import { Cta, PageHero, SiteMain } from "@/components/site/parts";
import { JudgeTour } from "@/components/tour/JudgeTour";
import { FOR_WHOM, OPS_THRESHOLD, OUT_OF_SCOPE, SCENARIOS, STATUS_HINT, STATUS_LABEL, STATUS_TONE, THEMES, WE_DO_NOT, riskWeights, statusCounts } from "@/data/trust";
import { ScenarioCard } from "./scenario";

export const metadata = {
  title: "Trust by design",
  description: "The scenarios PaySettle was designed around: what could go wrong with held money, evidence, disputes, AI and data, how the product resolves each, and the options we set aside.",
  alternates: { canonical: "/trust" },
};

export default function Page() {
  const counts = statusCounts();
  const weights = riskWeights();
  const offset = THEMES.map((_, i) => THEMES.slice(0, i).reduce((a, t) => a + t.scenarios.length, 0));
  return (
    <SiteMain>
      <PageHero
        kicker="Trust by design"
        title="What could go wrong, and how PaySettle handles it"
        lead={`Money held between milestones, evidence, disputes and AI each fail in their own ways. These are the ${SCENARIOS.length} scenarios we designed PaySettle around: how the product resolves each one, the options we considered and set aside, and where you can see it in the live demo.`}
      >
        <ul className="tr-sum" aria-label="Scenarios by status">
          {counts.filter((c) => c.n > 0).map((c) => (
            <li key={c.status}><b>{c.n}</b> <span className="chip" data-b={STATUS_TONE[c.status]}>{c.label}</span></li>
          ))}
        </ul>
        <nav className="tb-themes" aria-label="Themes on this page">
          {THEMES.map((t, i) => (
            <a key={t.id} href={`#${t.id}`}><span className="tb-themes-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>{t.title}<span className="tb-themes-c">{t.scenarios.length}</span></a>
          ))}
        </nav>
        <p className="s-chips tr-hero-links">
          <Link className="btn" href="/trust/ai">AI scorecard</Link>
          <Link className="btn" href="/security">Security controls</Link>
          <Link className="btn" href="/privacy">Privacy</Link>
        </p>
      </PageHero>

      <section className="s-section tight tr" aria-label="How to read each scenario">
        <div className="s-wrap">
          <dl className="tr-legend">
            {(["built", "progress", "decided"] as const).map((s) => (
              <div key={s}><dt><span className="chip" data-b={STATUS_TONE[s]}>{STATUS_LABEL[s]}</span></dt><dd>{STATUS_HINT[s]}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      {THEMES.map((t, i) => (
        <section key={t.id} id={t.id} className={`s-section tr tb-theme${i % 2 ? " alt" : ""}`} aria-labelledby={`${t.id}-h`}>
          <div className="s-wrap tb-grid">
            <div className="tb-head">
              <p className="tb-num" aria-hidden="true">{String(i + 1).padStart(2, "0")}</p>
              <h2 id={`${t.id}-h`}>{t.title}</h2>
              <p className="s-lead">{t.lead}</p>
            </div>
            <ol className="tb-list">
              {t.scenarios.map((s, k) => <ScenarioCard key={s.id} s={s} n={offset[i] + k + 1} />)}
            </ol>
          </div>
        </section>
      ))}

      <section id="not" className="s-section alt tr" aria-labelledby="not-h">
        <div className="s-wrap">
          <div className="s-head"><h2 id="not-h">Lines we hold</h2><p className="s-lead">Four decisions that each remove a conflict of interest or a risk nobody needs.</p></div>
          <ul className="tr-not">
            {WE_DO_NOT.map((w) => (
              <li key={w.title} className="s-card">
                <h3><span className="tr-no" aria-hidden="true" />{w.title}</h3>
                <p>{w.body}</p>
                {w.scenario && <p className="tr-ref"><a href={`#${w.scenario}`}>{w.scenario === "formula" ? "See the risk formula" : "See the scenario"}</a></p>}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="scope" className="s-section tr" aria-labelledby="scope-h">
        <div className="s-wrap">
          <div className="s-head"><h2 id="scope-h">Deliberately out of scope</h2><p className="s-lead">Ideas from the first plan that we chose not to build. Each would need evidence, a legal review and a clear benefit to the people using PaySettle before it came back.</p></div>
          <ul className="tb-scope">
            {OUT_OF_SCOPE.map((o) => (
              <li key={o.title}><b>{o.title}</b><span>{o.why}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section id="formula" className="s-section alt tr" aria-labelledby="formula-h">
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

      <section id="for-whom" className="s-section tr" aria-labelledby="for-whom-h">
        <div className="s-wrap tr-for">
          <div className="s-head"><h2 id="for-whom-h">Who PaySettle is for</h2><p className="s-lead">{FOR_WHOM.who}</p></div>
          <ul className="s-ticks">{FOR_WHOM.examples.map((e) => <li key={e}>{e}</li>)}</ul>
          <p className="tr-notfor">{FOR_WHOM.notFor}</p>
        </div>
      </section>

      <Cta />
      {/* carries a running judge tour (A10) on this page; draws nothing otherwise */}
      <JudgeTour launcher={false} />
    </SiteMain>
  );
}
