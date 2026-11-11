/** F3 · /for-clients — the client's case (Business Plan v4 §3–§4): pay only for verified progress. */
import { Cta, Head, PageHero, Points, Section, SiteMain } from "@/components/site/parts";
import { site } from "@/copy/site";

export const metadata = { title: "For clients" };

export default function Page() {
  const t = site.pages.clients;
  return (
    <SiteMain>
      <PageHero kicker={t.kicker} title={t.title} lead={t.lead} />
      <Section id="why">
        <Head id="why" title="What changes for you" />
        <Points items={t.points} />
      </Section>
      <Section id="limits" alt>
        <Head id="limits" title="What stays the same" lead="PayPal's own buyer protection still applies to every payment. PaySettle adds the contract logic on top; it does not replace PayPal's programmes." />
      </Section>
      <Cta />
    </SiteMain>
  );
}
