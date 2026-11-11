/** F3 · /waitlist — the pilot waitlist with its live count. The form posts to /api/waitlist (zod, honeypot, IP limit). */
import { waitlistCount } from "@/components/site/landing/facts";
import { PageHero, SiteMain } from "@/components/site/parts";
import { WaitlistForm } from "@/components/site/waitlist-form";
import { site } from "@/copy/site";
import { HONEYPOT, WAITLIST_MAX, WAITLIST_ROLES } from "@/lib/identity/waitlist";

export const metadata = { title: "Join the waitlist" };
export const dynamic = "force-dynamic";

const CODES = ["joined", "already", "invalid", "limit", "failed"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ r?: string; f?: string }> }) {
  const t = site.waitlist;
  const { r, f } = await searchParams;
  const n = await waitlistCount();
  /* the answer to a plain form post (no script), carried back in the address */
  const code = CODES.find((c) => c === r);
  const initial = code ? {
    ok: code === "joined" || code === "already",
    message: code === "limit" ? t.result.limit(600) : t.result[code],
    fields: (f ?? "").split(",").filter((x): x is "email" | "role" | "note" => x === "email" || x === "role" || x === "note"),
  } : null;
  return (
    <SiteMain>
      <PageHero kicker={t.kicker} title={t.title} lead={t.lead}>
        <p className="s-count">{n > 0 ? <><b className="tnum">{n.toLocaleString("en-US")}</b> {t.count(n).replace(/^[\d,]+ /, "")}</> : t.count(0)}</p>
      </PageHero>
      <section className="s-section tight" aria-label="Waitlist form">
        <div className="s-wrap s-narrow">
          <WaitlistForm roles={WAITLIST_ROLES} maxNote={WAITLIST_MAX.note} trap={HONEYPOT} initial={initial} />
        </div>
      </section>
    </SiteMain>
  );
}
