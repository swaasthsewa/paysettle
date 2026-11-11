/** F3 · /for-providers — the provider's case (Business Plan v4 §4, §7) and what onboarding needs (F1.4, F1.6). */
import { Cta, Head, PageHero, Points, Section, SiteMain } from "@/components/site/parts";
import { site } from "@/copy/site";

export const metadata = { title: "For providers" };

export default function Page() {
  const t = site.pages.providers;
  return (
    <SiteMain>
      <PageHero kicker={t.kicker} title={t.title} lead={t.lead} />
      <Section id="why">
        <Head id="why" title="Why providers use it" />
        <Points items={t.points} />
      </Section>
      <Section id="setup" alt>
        <Head id="setup" title={t.setup.title} lead="Onboarding takes a few minutes. Ops reviews the documents before your first payout." />
        <ol className="s-checklist">{t.setup.items.map((i) => <li key={i} className="s-reveal">{i}</li>)}</ol>
      </Section>
      <Cta />
    </SiteMain>
  );
}
