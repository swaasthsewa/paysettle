/**
 * F1.2 MFA enforcer · F1.3 profile (currency, time zone, billing) · F1.5 PayPal buyer link · sessions · password.
 * /account for every role. Real data: users, sessions, recovery_codes, paypal_links.
 * P9: a shared demo person (persona picker, sandbox) sees the settings with a read-only note instead of the forms.
 */
import Link from "next/link";
import { cookies } from "next/headers";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import "@/styles/site.css";
import { db } from "@/db/client";
import { paypalLinks, recoveryCodes, sessions, users } from "@/db/schema";
import { ActionForm } from "@/components/identity/action-form";
import { tzOf, when } from "@/components/identity/format";
import { ThemeChoice } from "@/components/shell/theme";
import { common } from "@/copy/common";
import { sandboxMode } from "@/lib/clock";
import { sha256 } from "@/lib/ids";
import { COOKIE, SHARED_DEMO_READ_ONLY, requireViewer, sharedDemo } from "@/lib/session";
import { beginEnrolment, mfaRequired } from "@/lib/identity/mfa";
import { PASSWORD_MIN } from "@/lib/identity/policy";
import { CURRENCIES, profileGaps, timeZones, type StoredProfile } from "@/lib/identity/profile";
import { cancelMfa, changePassword, confirmMfa, disableMfa, endOneSession, endOtherSessions, regenerateCodes, saveBuyerLink, saveProfile, startMfa } from "./actions";

export const metadata = { title: "Account & security" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const v = await requireViewer();
  const [u] = await db.select().from(users).where(eq(users.id, v.id)).limit(1);
  const profile = (u?.profile ?? {}) as StoredProfile & { mfaPending?: { secret: string; attempts: number } };
  const tz = tzOf(profile);
  const token = (await cookies()).get(COOKIE)?.value;
  const mine = token ? sha256(token) : null;
  const list = await db.select().from(sessions).where(and(eq(sessions.userId, v.id), gt(sessions.endsAt, new Date()))).orderBy(desc(sessions.lastSeenAt));
  const [rc] = await db.select({ n: sql<number>`count(*)::int` }).from(recoveryCodes).where(and(eq(recoveryCodes.userId, v.id), isNull(recoveryCodes.usedAt)));
  const [buyer] = await db.select().from(paypalLinks).where(and(eq(paypalLinks.userId, v.id), eq(paypalLinks.kind, "buyer"))).limit(1);
  const mfaOn = Boolean(u?.mfaSecret);
  const pending = profile.mfaPending;
  const enrol = pending ? beginEnrolment(v.email, pending.secret) : null;
  const gaps = profileGaps(profile);
  const needs = mfaRequired(v.role);
  const isClient = v.role === "client" || v.role === "judge";
  const zones = timeZones();
  const ro = sharedDemo(v);
  const roNote = <p className="small muted" role="note">{SHARED_DEMO_READ_ONLY}</p>;

  return (
    <>
      <div className="phead">
        <div>
          <h1>Account &amp; security</h1>
          <p className="sub">{v.name} · {v.email} · {common.roles[v.role]}{v.demo ? " · signed in through the sandbox persona picker" : ""}</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v">{mfaOn ? "On" : "Off"}</div><div className="l">Authenticator app</div></div>
          <div className="hstat"><div className="v">{list.length}</div><div className="l">Active sessions</div></div>
        </div>
      </div>

      <nav className="row small" aria-label="More account pages">
        <Link className="btn btn-sm" href="/account/ai">AI &amp; agents: usage and MCP agent tokens</Link>
        {v.role === "provider" && <Link className="btn btn-sm" href="/provider/onboarding">Onboarding &amp; PayPal</Link>}
      </nav>

      {ro && (
        <p className="notice" role="note">
          <b>{SHARED_DEMO_READ_ONLY}</b> Every judge signs in as the same demo people, so the profile, PayPal e-mail, authenticator, password and other sessions of this person stay as they are.
        </p>
      )}

      {needs && !mfaOn && (
        <p className="notice" data-b="warn" role="note">
          <b>Your role needs an authenticator app.</b> {sandboxMode() ? "In the sandbox the persona picker counts as a second factor, so you can explore now; set the app up below before production." : "Set it up below; sign-in with a password asks for it."}
        </p>
      )}

      <div className="id-grid">
        {/* ── F1.3 profile ── */}
        <section className="c id-6" aria-labelledby="profile-h">
          <div className="c-head"><h2 id="profile-h">Profile</h2><span className="r">{gaps.length ? <span className="chip" data-b="warn">Missing: {gaps.join(", ")}</span> : <span className="chip" data-b="ok">Complete</span>}</span></div>
          <p className="small muted">Contracts show amounts in your currency and deadlines in your time zone. Clients need a complete profile before funding a tranche (ERR_103).</p>
          {ro ? roNote : <ActionForm action={saveProfile} submit="Save profile" variant="btn btn-d">
            <div className="id-form">
              <div className="field id-wide"><label htmlFor="p-name">Name on contracts</label><input id="p-name" name="name" type="text" defaultValue={u?.name ?? ""} required maxLength={80} autoComplete="name" /></div>
              <div className="field"><label htmlFor="p-cur">Currency</label>
                <select id="p-cur" name="currency" defaultValue={profile.currency ?? "USD"}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              <div className="field"><label htmlFor="p-tz">Time zone</label>
                <select id="p-tz" name="timezone" defaultValue={profile.timezone ?? "UTC"}>{zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select></div>
              <div className="field"><label htmlFor="p-bn">Billing name or company <span className="muted">(optional)</span></label><input id="p-bn" name="billingName" type="text" defaultValue={profile.billingName ?? ""} maxLength={120} autoComplete="organization" /></div>
              <div className="field"><label htmlFor="p-bc">Billing country</label><input id="p-bc" name="billingCountry" type="text" defaultValue={profile.billingCountry ?? ""} maxLength={2} placeholder="US" autoComplete="country" style={{ textTransform: "uppercase" }} /></div>
            </div>
          </ActionForm>}
          <div className="row small"><span className="muted">Appearance</span><ThemeChoice /></div>
        </section>

        {/* ── F1.5 PayPal buyer link ── */}
        {isClient ? (
          <section className="c id-6" aria-labelledby="buyer-h">
            <div className="c-head"><h2 id="buyer-h">PayPal for paying</h2><span className="r">{buyer?.email ? <span className="chip" data-b="ok">Linked</span> : <span className="chip" data-b="plain">Optional</span>}</span></div>
            <p className="small muted">You approve every hold inside PayPal itself, so this link is optional. Saving your PayPal e-mail here pre-fills checkout and lets Support find a payment faster.{sandboxMode() ? " In the sandbox, use a PayPal Sandbox personal account." : ""}</p>
            {buyer?.email && <dl className="kv"><div><dt>Linked e-mail</dt><dd>{buyer.email}<small>{buyer.emailConfirmed ? "Confirmed by PayPal" : "Confirmed at your first approval"}</small></dd></div></dl>}
            {ro ? roNote : <ActionForm action={saveBuyerLink} submit={buyer?.email ? "Update" : "Link PayPal e-mail"}>
              <div className="field"><label htmlFor="b-email">PayPal e-mail</label><input id="b-email" name="email" type="email" defaultValue={buyer?.email ?? ""} maxLength={254} autoComplete="email" placeholder="you@example.com" /><span className="small muted">Leave empty and save to remove the link.</span></div>
            </ActionForm>}
          </section>
        ) : v.role === "provider" ? (
          <section className="c id-6" aria-labelledby="merch-h">
            <div className="c-head"><h2 id="merch-h">PayPal for getting paid</h2></div>
            <p className="small muted">Your business details, licences and PayPal business account live on the onboarding page.</p>
            <div className="row"><Link className="btn btn-d" href="/provider/onboarding">Open onboarding &amp; PayPal</Link></div>
          </section>
        ) : null}

        {/* ── F1.2 authenticator app ── */}
        <section className="c id-6" aria-labelledby="mfa-h">
          <div className="c-head"><h2 id="mfa-h">Authenticator app</h2><span className="r">{mfaOn ? <span className="chip" data-b="ok">On</span> : pending ? <span className="chip" data-b="warn">Waiting for the first code</span> : <span className="chip" data-b={needs ? "warn" : "plain"}>{needs ? "Required for your role" : "Off"}</span>}</span></div>
          {mfaOn ? (
            <>
              <p className="small muted">Password sign-in asks for a six-digit code. A code works once; the next one appears every 30 seconds.</p>
              <dl className="kv"><div><dt>Recovery codes left</dt><dd>{rc?.n ?? 0} of 10<small>{(rc?.n ?? 0) <= 3 ? "Running low: make a new set." : "Each works once if you lose the app."}</small></dd></div></dl>
              <ActionForm action={regenerateCodes} submit="Make new recovery codes" resetOnOk>
                <div className="field"><label htmlFor="rc-code">Current code from your app</label><input id="rc-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required /></div>
              </ActionForm>
              <details>
                <summary className="small">Switch the authenticator off</summary>
                <div style={{ marginTop: 10 }}>
                  {needs && !sandboxMode()
                    ? <p className="small muted">Your role needs an authenticator app, so it stays on.</p>
                    : <ActionForm action={disableMfa} submit="Switch off" resetOnOk>
                        <div className="field"><label htmlFor="off-code">A code from your app, or a recovery code</label><input id="off-code" name="code" autoComplete="one-time-code" maxLength={12} required /></div>
                      </ActionForm>}
                </div>
              </details>
            </>
          ) : enrol ? (
            <>
              <ol className="id-steps">
                <li>Open your authenticator app (any app that supports time-based codes) and choose to add an account by typing a key.</li>
                <li>Type this key. Account: <b>{v.email}</b>, issuer: <b>PaySettle</b>, time-based.</li>
              </ol>
              <p className="id-key"><span className="sr-only">Key: </span>{enrol.groups}</p>
              <details><summary className="small">Setup address for apps that accept one</summary><p className="id-uri">{enrol.uri}</p></details>
              <ActionForm action={confirmMfa} submit="Turn on" variant="btn btn-g">
                <div className="field"><label htmlFor="mfa-code">Six-digit code from the app</label><input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required /></div>
              </ActionForm>
              <form action={cancelMfa}><button className="btn btn-gh btn-sm" type="submit">Cancel set-up</button></form>
            </>
          ) : (
            <>
              <p className="small muted">A second factor protects signatures and releases. After you turn it on you get ten one-time recovery codes, shown once.</p>
              {ro ? roNote : <ActionForm action={startMfa} submit="Set up an authenticator app" variant="btn btn-d" />}
            </>
          )}
        </section>

        {/* ── password ── */}
        <section className="c id-6" aria-labelledby="pw-h">
          <div className="c-head"><h2 id="pw-h">Password</h2></div>
          <p className="small muted">At least {PASSWORD_MIN} characters, without your e-mail name or your own name. A few unrelated words work well. Changing it signs out every other session.</p>
          {ro ? roNote : <ActionForm action={changePassword} submit="Change password" resetOnOk>
            <div className="id-form">
              {u?.passwordHash && <div className="field id-wide"><label htmlFor="pw-cur">Current password</label><input id="pw-cur" name="current" type="password" autoComplete="current-password" required /></div>}
              <div className="field"><label htmlFor="pw-new">New password</label><input id="pw-new" name="next" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={128} required /></div>
              <div className="field"><label htmlFor="pw-again">New password again</label><input id="pw-again" name="again" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={128} required /></div>
            </div>
          </ActionForm>}
        </section>

        {/* ── sessions ── */}
        <section className="c id-12" aria-labelledby="ses-h">
          <div className="c-head"><h2 id="ses-h">Active sessions</h2>
            {list.length > 1 && !ro && <span className="r"><form action={endOtherSessions}><button className="btn btn-sm" type="submit">End all other sessions</button></form></span>}
          </div>
          <p className="small muted">A session ends after 60 minutes without activity, and always after 12 hours. Times in {tz.replace(/_/g, " ")}.</p>
          <ul className="id-list">
            {list.map((s) => {
              const ref = s.tokenHash.slice(0, 16), here = s.tokenHash === mine;
              return (
                <li key={s.tokenHash}>
                  <div className="id-main">
                    <b>{here ? "This device" : `Session ${ref.slice(0, 6)}`}</b>
                    <small>Started {when(s.createdAt, tz)} · last active {when(s.lastSeenAt, tz)} · ends by {when(s.endsAt, tz)}</small>
                  </div>
                  {s.demo && <span className="chip" data-b="plain">Sandbox persona</span>}
                  <span className="chip" data-b={s.mfa ? "ok" : "none"}>{s.mfa ? "Second factor" : "Password only"}</span>
                  {here ? <Link className="btn btn-sm" href="/logout">Sign out</Link> : ro ? null : (
                    <form action={endOneSession}><input type="hidden" name="ref" value={ref} /><button className="btn btn-sm" type="submit" aria-label={`End session ${ref.slice(0, 6)}`}>End session</button></form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
