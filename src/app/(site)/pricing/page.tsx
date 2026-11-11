/** F3 · /pricing — the release fee, mediation fee and the later Pro plan (Business Plan v4 §6), with a worked example. */
import { Cta, PageHero, Section, SiteMain } from "@/components/site/parts";
import { site } from "@/copy/site";
import { feeFor } from "@/lib/money";

export const metadata = { title: "Pricing" };

export default function Page() {
  const t = site.pages.pricing;
  const total = 800_000, fee = feeFor(total, 250);
  return (
    <SiteMain>
      <PageHero kicker={t.kicker} title={t.title} lead={t.lead} />
      <Section id="plans">
        <h2 id="plans-h" className="sr-only">Prices</h2>
        <div className="s-cols3">
          {t.plans.map((p) => (
            <div key={p.name} className="s-card s-price s-reveal">
              <h3>{p.name}</h3>
              <p className="s-price-v">{p.price}</p>
              <p className="s-price-per">{p.per}</p>
              <ul className="s-ticks">{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
      </Section>
      <Section id="example" alt>
        <div className="s-card s-example s-reveal">
          <h2 id="example-h">{t.example.title}</h2>
          <ul>{t.example.lines(total, fee).map((l) => <li key={l} className="tnum">{l}</li>)}</ul>
          <p className="s-note">{t.note}</p>
        </div>
      </Section>
      <Cta />
    </SiteMain>
  );
}
