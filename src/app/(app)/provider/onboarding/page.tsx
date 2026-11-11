/**
 * F1.4 provider setup (business, category, masked tax id, licence fingerprints, Ops review state) and
 * F1.6 PayPal merchant link. Real data: users.onboarding_state, users.profile.provider, paypal_links.
 * F1.4 OCR assist: each licence shows what was read from it (number, expiry, issuer) as the suggestion Ops will see.
 */
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import "@/styles/site.css";
import { db } from "@/db/client";
import { paypalLinks, users } from "@/db/schema";
import { ActionForm } from "@/components/identity/action-form";
import { tzOf, when } from "@/components/identity/format";
import { LicenceForm } from "@/components/identity/licence-form";
import { LicenceSuggestion } from "@/components/identity/licence-suggestions";
import { sandboxMode } from "@/lib/clock";
import { SHARED_DEMO_READ_ONLY, requireViewer, sharedDemo } from "@/lib/session";
import { isValidated, missingCredentials, onboardingChip, PROVIDER_CATEGORIES, type ProviderProfile } from "@/lib/identity/provider";
import { addLicence, removeLicence, saveBusiness, saveMerchant } from "./actions";

export const metadata = { title: "Onboarding & PayPal" };
export const dynamic = "force-dynamic";

const REVIEW = { QUEUED: { label: "Queued for review", b: "plain" }, ACCEPTED: { label: "Accepted by Ops", b: "ok" }, REJECTED: { label: "Rejected: upload a clearer copy", b: "danger" } } as const;

export default async function OnboardingPage() {
  const v = await requireViewer(["provider"]);
  const [u] = await db.select().from(users).where(eq(users.id, v.id)).limit(1);
  const p = ((u?.profile as { provider?: Partial<ProviderProfile> } | undefined)?.provider ?? {}) as Partial<ProviderProfile>;
  const tz = tzOf(u?.profile);
  const [merchant] = await db.select().from(paypalLinks).where(and(eq(paypalLinks.userId, v.id), eq(paypalLinks.kind, "merchant"))).limit(1);
  const state = u?.onboardingState ?? "PENDING";
  const chip = onboardingChip(state);
  const missing = missingCredentials(p, Boolean(merchant?.receivable));
  const sandbox = sandboxMode();
  const validated = isValidated(state);
  const todayIso = new Date().toISOString().slice(0, 10);
  const ro = sharedDemo(v); // P9: shared demo provider, settings read-only
  const roNote = <p className="small muted" role="note">{SHARED_DEMO_READ_ONLY}</p>;

  return (
    <>
      <div className="phead">
        <div>
          <h1>Onboarding &amp; PayPal</h1>
          <p className="sub">What Ops needs to validate you, and the PayPal business account your releases are paid into.</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v"><span className="chip" data-b={chip.b} style={{ fontSize: 14 }}>{chip.label}</span></div><div className="l">Review status</div></div>
          <div className="hstat"><div className="v" style={{ textTransform: "capitalize" }}>{u?.tier ?? "new"}</div><div className="l">Trust tier</div></div>
        </div>
      </div>

      {missing.length > 0 ? (
        <section className="notice" data-b="warn" aria-labelledby="miss-h">
          <b id="miss-h">Still needed before your first payout (ERR_104)</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: "1.2em" }}>{missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </section>
      ) : !validated ? (
        <p className="notice" role="note">Everything is in{p.submittedAt ? ` since ${when(new Date(p.submittedAt), tz)}` : ""}. Ops reviews new providers in the provider-health queue; you can negotiate and sign contracts meanwhile.</p>
      ) : (
        <p className="notice" data-b="ok" role="note">Validated. Payouts go to {merchant?.email || "your PayPal business account"}.</p>
      )}

      <div className="id-grid">
        <section className="c id-6" aria-labelledby="biz-h">
          <div className="c-head"><h2 id="biz-h">Business</h2></div>
          {ro ? (
            <>
              <dl className="kv">
                <div><dt>Business name</dt><dd>{p.businessName || "Not given"}</dd></div>
                <div><dt>Country of registration</dt><dd>{p.country || "Not given"}</dd></div>
                <div><dt>Tax id</dt><dd>{p.taxIdMasked || "Not given"}<small>Stored only masked to its last four characters.</small></dd></div>
              </dl>
              {roNote}
            </>
          ) : <ActionForm action={saveBusiness} submit="Save business details" variant="btn btn-d">
            <div className="id-form">
              <div className="field id-wide"><label htmlFor="o-name">Business name</label><input id="o-name" name="businessName" type="text" defaultValue={p.businessName ?? ""} maxLength={120} required autoComplete="organization" /></div>
              <div className="field id-wide"><label htmlFor="o-cat">Category</label>
                <select id="o-cat" name="category" defaultValue={p.category ?? ""}><option value="" disabled>Pick one</option>{PROVIDER_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></div>
              <div className="field"><label htmlFor="o-country">Country of registration</label><input id="o-country" name="country" type="text" maxLength={2} defaultValue={p.country ?? ""} placeholder="IN" required style={{ textTransform: "uppercase" }} /></div>
              <div className="field"><label htmlFor="o-tax">Tax id {p.taxIdMasked && <span className="muted">(on file: {p.taxIdMasked})</span>}</label><input id="o-tax" name="taxId" type="text" maxLength={40} autoComplete="off" placeholder={p.taxIdMasked ? "Leave empty to keep" : "e.g. 12-3456789"} /></div>
            </div>
            <p className="small muted">The tax id is stored only masked to its last four characters, plus a one-way fingerprint so the same id cannot open two provider accounts.</p>
          </ActionForm>}
        </section>

        <section className="c id-6" aria-labelledby="pp-h">
          <div className="c-head"><h2 id="pp-h">PayPal business account</h2>
            <span className="r">{merchant?.receivable ? <span className="chip" data-b="ok">Can receive</span> : merchant ? <span className="chip" data-b="warn">Not confirmed</span> : <span className="chip" data-b="none">Not linked</span>}</span></div>
          {sandbox
            ? <p className="small muted">Sandbox: enter the e-mail of your <b>PayPal Sandbox business account</b>. It is saved as able to receive, so releases in the demo are captured to it.</p>
            : <p className="small muted">Production uses PayPal partner onboarding: you are sent to PayPal to connect the account, and payouts switch on only after PayPal confirms it can receive.</p>}
          {merchant && (
            <dl className="kv">
              <div><dt>Account e-mail</dt><dd>{merchant.email}<small>{merchant.emailConfirmed ? "E-mail confirmed" : "E-mail not confirmed yet"}</small></dd></div>
              <div><dt>Payouts</dt><dd>{merchant.receivable ? "On" : "Off (ERR_106)"}<small>{merchant.receivable ? "Approved milestones are captured to this account." : "Unverified merchant: payout features stay off until PayPal confirms the account."}</small></dd></div>
            </dl>
          )}
          {ro ? roNote : <ActionForm action={saveMerchant} submit={merchant ? "Update PayPal account" : "Link PayPal account"}>
            <div className="field"><label htmlFor="m-email">{sandbox ? "Sandbox business account e-mail" : "PayPal business e-mail"}</label><input id="m-email" name="email" type="email" maxLength={254} defaultValue={merchant?.email ?? ""} required autoComplete="email" placeholder="you@business.example.com" /></div>
          </ActionForm>}
        </section>

        <section className="c id-12" aria-labelledby="lic-h">
          <div className="c-head"><h2 id="lic-h">Licences and registration</h2><span className="r"><span className="chip" data-b="plain">{(p.licences ?? []).length} on file</span></span></div>
          <div className="id-grid">
            <div className="id-6">
              {(p.licences ?? []).length === 0
                ? <div className="empty"><p>No documents yet. Add a business registration, a trade licence or an insurance certificate.</p></div>
                : (
                  <ul className="id-files">
                    {(p.licences ?? []).map((l) => {
                      const r = REVIEW[l.review] ?? REVIEW.QUEUED;
                      return (
                        <li key={l.id}>
                          <b>{l.name}</b><span className="muted">{(l.size / 1024).toFixed(0)} KB · added {when(new Date(l.at), tz)}</span>
                          <span className="chip" data-b={r.b}>{r.label}</span>
                          <code title="SHA-256 fingerprint">{l.sha256.slice(0, 16)}{"…"}</code>
                          {!ro && <form action={removeLicence} style={{ marginLeft: "auto" }}><input type="hidden" name="id" value={l.id} /><button className="btn btn-sm btn-gh" type="submit" aria-label={`Remove ${l.name}`}>Remove</button></form>}
                          <div style={{ flexBasis: "100%" }}><LicenceSuggestion licence={l} todayIso={todayIso} audience="provider" /></div>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </div>
            <div className="id-6">{ro ? roNote : <LicenceForm action={addLicence} />}</div>
          </div>
        </section>
      </div>
      <p className="small muted">Your account security (authenticator app, sessions, password) is on <Link href="/account">Account &amp; security</Link>.</p>
    </>
  );
}
