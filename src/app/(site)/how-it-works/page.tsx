/** F3 · /how-it-works — the core loop from brief to receipt, and where the money is at each moment. */
import { Cta, Head, PageHero, Section, SiteMain } from "@/components/site/parts";
import { site } from "@/copy/site";

export const metadata = { title: "How it works" };

export default function Page() {
  const t = site.pages.how;
  return (
    <SiteMain>
      <PageHero kicker={t.kicker} title={t.title} lead={t.lead} />
      <Section id="loop">
        <Head id="loop" title="The loop" />
        <ol className="s-loop">
          {t.loop.map((s, i) => (
            <li key={s.head} className="s-reveal">
              <span className="s-n" aria-hidden="true">{i + 1}</span>
              <div><h3>{s.head}</h3><p>{s.body}</p></div>
            </li>
          ))}
        </ol>
      </Section>
      <Section id="states" alt>
        <Head id="states" title={t.states.title} />
        <ul className="s-states">
          <li className="s-reveal"><span className="state held">Held</span><p>{t.states.held}</p></li>
          <li className="s-reveal"><span className="state released">Released</span><p>{t.states.released}</p></li>
          <li className="s-reveal"><span className="state disputed">Disputed</span><p>{t.states.disputed}</p></li>
          <li className="s-reveal"><span className="state refunded">Returned</span><p>{t.states.refunded}</p></li>
        </ul>
      </Section>
      <Cta />
    </SiteMain>
  );
}
