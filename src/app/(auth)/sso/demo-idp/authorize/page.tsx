/**
 * F1.7 Demo identity provider — authorize / consent screen (sandbox only, P9). Stands in for a company IdP (Okta, Entra ID,
 * Google Workspace…) so the full OIDC authorization-code + PKCE flow can be shown without one. Production refuses it.
 */
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { common } from "@/copy/common";
import { sandboxMode } from "@/lib/clock";
import { STAFF_ROLES } from "@/lib/identity/sso";
import { checkAuthorizeRequest, demoGroupsFor, demoIssuer, UNKNOWN_PERSON } from "@/lib/identity/sso-demo";
import { requestOrigin as demoOrigin } from "@/lib/identity/sso-flow";
import { demoConsent, demoDeny } from "./actions";

export const metadata = { title: "Demo identity provider" };
export const dynamic = "force-dynamic";
type SP = Promise<Record<string, string | string[] | undefined>>;
const FIELDS = ["response_type", "client_id", "redirect_uri", "scope", "state", "nonce", "code_challenge", "code_challenge_method"] as const;

export default async function DemoAuthorize({ searchParams }: { searchParams: SP }) {
  if (!sandboxMode()) {
    return <main className="page" style={{ maxWidth: 640, paddingTop: 48 }}><h1>Not available</h1><p className="notice" role="alert">The demo identity provider exists only in the sandbox. Production sign-in uses your company identity provider.</p></main>;
  }
  const sp = await searchParams;
  const v = Object.fromEntries(FIELDS.map((k) => [k, String((Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "")])) as Record<(typeof FIELDS)[number], string>;
  const issuer = demoIssuer(await demoOrigin());
  const problem = checkAuthorizeRequest({ clientId: v.client_id, redirectUri: v.redirect_uri, state: v.state, nonce: v.nonce, codeChallenge: v.code_challenge, codeChallengeMethod: v.code_challenge_method, responseType: v.response_type }, issuer);
  const staff = problem ? [] : await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users).where(inArray(users.role, [...STAFF_ROLES])).orderBy(users.role, users.name);
  const hidden = FIELDS.map((k) => <input key={k} type="hidden" name={k} value={v[k]} />);
  return (
    <main className="page" style={{ maxWidth: 720, paddingTop: 48 }}>
      <div className="notice" data-b="warn" role="note"><b>Demo identity provider (sandbox).</b> This page plays the part of your company&apos;s identity provider so the whole sign-in can be shown. In production PaySettle sends staff to the IdP set in OIDC_ISSUER instead.</div>
      <div className="phead"><div><h1>Sign in to {common.product}</h1><p className="sub">Application <code>{v.client_id || "—"}</code> asks for: {v.scope || "openid"}. Choose who you are in this demo company directory.</p></div></div>
      {problem ? <p className="notice" data-b="danger" role="alert">This sign-in request was refused: {problem}</p> : (
        <>
          <section className="c stack" aria-labelledby="idp-staff-h">
            <h2 id="idp-staff-h" style={{ fontSize: 18 }}>Company directory</h2>
            <form action={demoConsent} className="stack">
              {hidden}
              <fieldset className="stack" style={{ border: 0, padding: 0 }}>
                <legend className="small muted">Each person carries the IdP group that PaySettle maps to a staff role (OIDC_ROLE_MAP).</legend>
                {staff.map((s, i) => (
                  <label key={s.id} className="row" style={{ gap: 8 }}>
                    <input type="radio" name="who" value={`user:${s.id}`} defaultChecked={i === 0} required />
                    <span><b>{s.name}</b> <span className="muted small">{s.email} · groups: {demoGroupsFor(s.role).join(", ")} → {common.roles[s.role]}</span></span>
                  </label>
                ))}
              </fieldset>
              <h3 className="small">Try a refusal</h3>
              <label className="row" style={{ gap: 8 }}><input type="radio" name="who" value="unknown" /> <span><b>{UNKNOWN_PERSON.name}</b> <span className="muted small">{UNKNOWN_PERSON.email} · groups: ps-ops — not a PaySettle account (ERR_107)</span></span></label>
              {staff[0] && <label className="row" style={{ gap: 8 }}><input type="radio" name="who" value={`mismatch:${staff[0].id}`} /> <span><b>{staff[0].name}</b> <span className="muted small">with the wrong IdP group — role does not match the account (ERR_107)</span></span></label>}
              <div className="row">
                <button className="btn btn-g" type="submit">Continue</button>
                <button className="btn btn-gh" type="submit" formAction={demoDeny} formNoValidate>Cancel</button>
              </div>
            </form>
          </section>
          <section className="c">
            <dl className="kv small">
              <div><dt>Issuer</dt><dd><code>{issuer}</code></dd></div>
              <div><dt>Redirect</dt><dd><code>{v.redirect_uri}</code></dd></div>
              <div><dt>PKCE</dt><dd>{v.code_challenge_method} · challenge <code>{v.code_challenge.slice(0, 16)}…</code></dd></div>
              <div><dt>Tokens</dt><dd>RS256 id_token, 5-minute life, keys at <a href={`${issuer}/jwks`}>JWKS</a> · <a href={`${issuer}/.well-known/openid-configuration`}>discovery</a></dd></div>
            </dl>
          </section>
        </>
      )}
    </main>
  );
}
