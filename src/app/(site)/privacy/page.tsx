/** F3 · /privacy — plain-language privacy page (draft), opening with the line that we do not sell data (red team 5). */
import { LegalPage, type LegalSection } from "@/components/site/legal";
import { SiteMain } from "@/components/site/parts";
import { site } from "@/copy/site";
import { MIN_COHORT } from "@/server/control/analytics";

export const metadata = { title: "Privacy" };

/** The "we do not sell data" line, first in the contents so it can be linked (/privacy#no-sale). */
const NO_SALE: LegalSection = {
  id: "no-sale",
  title: "We do not sell data",
  body: [
    "We do not sell data: not personal data, and not anonymised or aggregated trends either.",
    `The analytics inside PaySettle are aggregates used to run the product. Personal data is removed, and any group smaller than ${MIN_COHORT} is shown only as “fewer than ${MIN_COHORT}”.`,
  ],
};

export default function Page() {
  const t = site.legal.privacy;
  return <SiteMain><LegalPage path="/privacy" title={t.title} lead={t.lead} sections={[NO_SALE, ...t.sections]} /></SiteMain>;
}
