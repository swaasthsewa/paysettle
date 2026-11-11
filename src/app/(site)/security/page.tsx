/** F3 · /security — the controls, as enforced in this build (constitution P1–P12). */
import { Cta, Head, PageHero, Section, SiteMain } from "@/components/site/parts";
import { site } from "@/copy/site";

export const metadata = { title: "Security" };

export default function Page() {
  const t = site.pages.security;
  return (
    <SiteMain>
      <PageHero kicker={t.kicker} title={t.title} lead={t.lead} />
      <Section id="controls">
        <div className="s-cols3">
          {t.groups.map((g) => (
            <div key={g.title} className="s-card s-reveal">
              <h2>{g.title}</h2>
              <ul className="s-ticks">{g.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
      </Section>
      <Section id="report" alt>
        <Head id="report" title="Reporting a problem" lead={t.report} />
      </Section>
      <Cta />
    </SiteMain>
  );
}
