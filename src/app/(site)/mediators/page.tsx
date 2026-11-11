/**
 * F4.05 — /mediators (public): what PaySettle mediators do, the domains the network covers (live counts, no names),
 * how assignment is kept fair (the router's published rules and weights), the path into the network, and the
 * application form (server action: zod, honeypot, rate limit).
 */
import { Head, PageHero, Section, SiteMain } from "@/components/site/parts";
import "@/styles/mediators.css";
import { publicNetwork } from "@/server/mediators";
import { DOMAINS, DOMAIN_KEYS, domainOf } from "@/server/mediators/domains";
import { PART_LABEL, WEIGHTS, type Part, COI_DAYS } from "@/server/mediators/router";
import { APPLICATION_TRAP, COSIGN_FEE_CENTS, LANGUAGES, MEDIATOR_FEE_CENTS, PROBATION_COSIGNS, SECOND_REVIEW_BPS } from "@/server/mediators/rules";
import { formatCents } from "@/lib/money";
import { ApplyForm } from "./apply-form";

export const metadata = { title: "Mediators", description: "How PaySettle mediators decide milestone disputes, how cases are assigned fairly, and how to apply." };
export const dynamic = "force-dynamic";

const ZONES = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC"]; } })();
const PART_TEXT: Record<Part, string> = {
  domain: "Listing the exact kind of job scores full marks; covering its wider domain scores 60%.",
  load: "Fewer open cases against their own limit scores higher, so work spreads out.",
  sla: "Share of verdicts signed within 48 hours of taking the case, over the last 90 days.",
  quality: "Ratings from both parties after settlement, and agreement in random second reviews.",
  timezone: "Shared 09:00–17:00 working hours with the two parties.",
};

export default async function Page() {
  let rows: Awaited<ReturnType<typeof publicNetwork>> = [];
  try { rows = await publicNetwork(); } catch { rows = []; }
  const taking = rows.filter((r) => r.status === "ACTIVE" || r.status === "SENIOR");
  const byDomain = DOMAIN_KEYS.map((d) => ({ d, n: taking.filter((r) => r.domains.includes(d) || r.domains.some((x) => domainOf(x) === d)).length }));
  const langs = new Set(taking.flatMap((r) => r.languages));
  const zones = new Set(taking.map((r) => r.timezone));
  return (
    <SiteMain>
      <PageHero kicker="Mediators" title="Disputes decided by people who know the work"
        lead="When a milestone is disputed and the two sides cannot meet in sealed offers, a mediator from the right trade reads the sealed evidence and decides the split to the cent. The money stays in the PayPal hold until a signed verdict releases it.">
        <p className="s-count"><b className="tnum">{taking.length}</b> mediators taking cases now, across {zones.size} time zone{zones.size === 1 ? "" : "s"} and {langs.size} language{langs.size === 1 ? "" : "s"}.</p>
      </PageHero>

      <Section id="what">
        <Head id="what" title="What a mediator does" />
        <ol className="md-steps">
          <li className="s-reveal"><h3>Reads a sealed dossier</h3><p>The milestone&apos;s acceptance criteria, the proof the provider submitted with its file hashes, and both sides&apos; statements and marked-up photos. Nothing can be added or removed once the vault is sealed.</p></li>
          <li className="s-reveal"><h3>Decides the split</h3><p>A share to the provider and the rest back to the client, with written findings and a root cause. An AI proposal may be shown as advice; it never decides and never moves money.</p></li>
          <li className="s-reveal"><h3>Signs, sometimes with a second mediator</h3><p>Above $5,000, and on a new mediator&apos;s first {PROBATION_COSIGNS} verdicts, a Senior mediator from another firm co-signs before any money moves.</p></li>
        </ol>
      </Section>

      <Section id="domains" alt>
        <Head id="domains" title="Domains we cover" lead="Each domain maps to the contract blueprints in PaySettle, so a roofing dispute goes to someone who knows roofs." />
        <ul className="md-domains">
          {byDomain.map(({ d, n }) => <li key={d} className="s-reveal"><b className="tnum">{n}</b><span>{DOMAINS[d].label}</span><span className="s-note">{n === 0 ? "Recruiting" : `mediator${n === 1 ? "" : "s"} taking cases`}</span></li>)}
        </ul>
      </Section>

      <Section id="fair">
        <Head id="fair" title="How assignment stays fair" lead="The router is published and deterministic: the same case and the same network give the same choice, and the reasons are stored with every offer." />
        <div className="s-card s-reveal">
          <h3>First, who may take the case</h3>
          <ul className="s-ticks">
            <li>Active or Senior in the network, with at least one verified credential that has not expired.</li>
            <li>Covers the job&apos;s domain and shares a language with both parties.</li>
            <li>No case with either party in the last {COI_DAYS} days, no declared conflict, and not in the same firm as either party.</li>
            <li>Not paused, not on leave, and below their own limit of open cases.</li>
          </ul>
        </div>
        <h3 className="s-reveal" style={{ margin: "26px 0 12px" }}>Then, who fits best (points out of 1,000)</h3>
        <ul className="md-weights">
          {(Object.keys(WEIGHTS) as Part[]).map((p) => (
            <li key={p} className="s-reveal"><span><b style={{ textAlign: "left" }}>{PART_LABEL[p]}</b><br /><span className="s-note">{PART_TEXT[p]}</span></span>
              <div className="md-meter" aria-hidden="true"><i style={{ width: `${WEIGHTS[p] / 4}%` }} /></div><b className="tnum">{WEIGHTS[p]}</b></li>
          ))}
        </ul>
        <p className="s-note">Ties go to whoever was assigned least recently. The top mediator has 2 hours to accept (30 minutes when the hold is close to its end); a decline or no answer passes the case to the next. After three misses the Ops lead assigns it by hand.</p>
      </Section>

      <Section id="path" alt>
        <Head id="path" title="Joining the network" />
        <ol className="s-loop">
          <li className="s-reveal"><span className="s-n" aria-hidden="true">1</span><div><h3>Apply</h3><p>Tell us your domains, languages, credentials and any conflicts. Ops replies within five working days.</p></div></li>
          <li className="s-reveal"><span className="s-n" aria-hidden="true">2</span><div><h3>Credentials checked</h3><p>Upload certificates in your profile. Ops checks each one and its expiry date; only a hash of the file is kept with your record.</p></div></li>
          <li className="s-reveal"><span className="s-n" aria-hidden="true">3</span><div><h3>Calibration</h3><p>Decide three sealed sample cases from real blueprints. Within 10 points of the reference split and the right root cause on all three passes.</p></div></li>
          <li className="s-reveal"><span className="s-n" aria-hidden="true">4</span><div><h3>Probation, then Active</h3><p>The Ops lead gives you your first cases, and a Senior mediator co-signs your first {PROBATION_COSIGNS} verdicts. After that the router offers you cases. {SECOND_REVIEW_BPS / 100}% of all closed verdicts get a random second review.</p></div></li>
        </ol>
        <p className="s-note">Fees are flat per verdict ({formatCents(MEDIATOR_FEE_CENTS.PROBATION)} on probation, {formatCents(MEDIATOR_FEE_CENTS.ACTIVE)} active, {formatCents(MEDIATOR_FEE_CENTS.SENIOR)} senior; {formatCents(COSIGN_FEE_CENTS)} per co-signature), paid by PaySettle from its own fee income — never from the money held for the parties.</p>
      </Section>

      <section className="s-section" aria-labelledby="apply-h" id="apply">
        <div className="s-wrap s-narrow">
          <div className="s-head"><h2 id="apply-h">Apply to mediate</h2><p className="s-lead">Sandbox build: applications are stored for the Ops review queue in this demo.</p></div>
          <ApplyForm trap={APPLICATION_TRAP} zones={ZONES}
            domains={DOMAIN_KEYS.map((d) => ({ value: d, label: DOMAINS[d].label }))}
            languages={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))} />
        </div>
      </section>
    </SiteMain>
  );
}
