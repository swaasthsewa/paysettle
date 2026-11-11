/** F3 · /terms — plain-language terms (draft): sandbox build, release-final, AI is advice, fees. */
import { LegalPage } from "@/components/site/legal";
import { SiteMain } from "@/components/site/parts";
import { site } from "@/copy/site";

export const metadata = { title: "Terms" };

export default function Page() {
  const t = site.legal.terms;
  return <SiteMain><LegalPage path="/terms" title={t.title} lead={t.lead} sections={t.sections} /></SiteMain>;
}
