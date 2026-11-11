/**
 * A10 · /judges — a landing page for hackathon judges: start the guided tour, or read its eight steps here (the list
 * works without scripts), sign in as the judge, and open the playground. Step content: src/data/tour.ts.
 */
import "@/styles/trust.css";
import Link from "next/link";
import { Cta, PageHero, SiteMain } from "@/components/site/parts";
import { JudgeTour } from "@/components/tour/JudgeTour";
import { TOUR_LABEL, TOUR_MINUTES, TOUR_STEPS } from "@/data/tour";

export const metadata = {
  title: "For judges",
  description: `A ${TOUR_MINUTES}-minute guided tour of PaySettle: the seven playground scenarios and the screens that prove them.`,
  alternates: { canonical: "/judges" },
};

const GOOD_TO_KNOW = [
  { b: "Sandbox money only.", t: "Nothing real moves. The playground runs on a fast mock rail by default; the PayPal Sandbox mode is there when you want to see real sandbox calls." },
  { b: "Each scenario starts fresh.", t: "Starting a scenario builds its own contract, so you can run them in any order and run one again." },
  { b: "The tour waits for you.", t: "“Open the playground” tucks the tour into a small bar at the bottom of the screen. Resume it from there, on any page, in this browser tab." },
  { b: "Keyboard and screen readers.", t: "The tour is a dialog: Tab stays inside it, ← and → move between steps, Esc ends it and returns you to where you were." },
];

export default function Page() {
  return (
    <SiteMain>
      <PageHero
        kicker="For judges"
        title="Judges, start here"
        lead={`${TOUR_STEPS.length} short stops in about ${TOUR_MINUTES} minutes: sign in with one click, run the seven playground scenarios, then see how we answer the hard questions.`}
      >
        <div className="tr-judge-start">
          <JudgeTour className="btn btn-g s-btn-lg" label={TOUR_LABEL} />
          <Link className="btn s-btn-lg" href="/login">Sign in as the judge</Link>
          <Link className="btn s-btn-lg" href="/trust">Read the trust page</Link>
        </div>
      </PageHero>

      <section id="steps" className="s-section tight tr" aria-labelledby="steps-h">
        <div className="s-wrap">
          <div className="s-head"><h2 id="steps-h">The tour, step by step</h2><p className="s-lead">The same steps the guided tour shows, for reading at your own pace.</p></div>
          <ol className="tr-steps">
            {TOUR_STEPS.map((s, i) => (
              <li key={s.id} id={`step-${s.id}`}>
                <span className="s-n" aria-hidden="true">{i + 1}</span>
                <div>
                  <p className="tr-tag">{s.tag}</p>
                  <h3><span className="sr-only">Step {i + 1}: </span>{s.title}</h3>
                  <p>{s.body}</p>
                  <ul>{s.look.map((l) => <li key={l}>{l}</li>)}</ul>
                  <p className="tr-go">
                    <Link className="btn btn-sm" href={s.go.href}>{s.go.label}</Link>
                    {s.also && <Link className="btn btn-sm btn-gh" href={s.also.href}>{s.also.label}</Link>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="know" className="s-section alt tr" aria-labelledby="know-h">
        <div className="s-wrap">
          <div className="s-head"><h2 id="know-h">Good to know</h2></div>
          <ul className="s-points">
            {GOOD_TO_KNOW.map((p) => <li key={p.b}><span className="s-dot" aria-hidden="true" /><span><b>{p.b}</b> {p.t}</span></li>)}
          </ul>
        </div>
      </section>

      <Cta />
    </SiteMain>
  );
}
