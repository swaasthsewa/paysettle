/**
 * F1.1 · Demo identity provider — sign-up consent screen (sandbox only, P9). Plays the part of a social identity
 * provider so "Continue with demo identity provider" runs the full OpenID Connect code flow with PKCE: this screen
 * issues the one-time code, the token and JWKS endpoints are the demo IdP's own (/sso/demo-idp/*). Production refuses.
 */
import { randomBytes } from "node:crypto";
import { sandboxMode } from "@/lib/clock";
import { checkAuthorizeRequest, demoIssuer } from "@/lib/identity/sso-demo";
import { requestOrigin } from "@/lib/identity/sso-flow";
import { REG_CALLBACK_PATH } from "@/lib/identity/register-social";
import { DEMO_INVITE_EMAIL, DEMO_INVITE_NAME } from "@/server/identity/demo";
import { openInvites } from "@/server/identity/invites";
import { signUpConsent, signUpDeny } from "./actions";
import "@/styles/register.css";

export const metadata = { title: "Demo identity provider" };
export const dynamic = "force-dynamic";
type SP = Promise<Record<string, string | string[] | undefined>>;
const FIELDS = ["response_type", "client_id", "redirect_uri", "scope", "state", "nonce", "code_challenge", "code_challenge_method"] as const;
const FIRST = ["Riya", "Tomas", "Amara", "Kenji", "Lucia", "Omar", "Ines", "Dev"], LAST = ["Kapoor", "Novak", "Mensah", "Sato", "Ferreira", "Haddad", "Lind", "Rao"];

export default async function DemoSignUp({ searchParams }: { searchParams: SP }) {
  if (!sandboxMode()) {
    return <main className="page reg-page"><h1>Not available</h1><p className="notice" role="alert">The demo identity provider exists only in the sandbox. Register with your e-mail address instead.</p></main>;
  }
  const sp = await searchParams;
  const v = Object.fromEntries(FIELDS.map((k) => [k, String((Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "")])) as Record<(typeof FIELDS)[number], string>;
  const issuer = demoIssuer(await requestOrigin());
  let problem = checkAuthorizeRequest({ clientId: v.client_id, redirectUri: v.redirect_uri, state: v.state, nonce: v.nonce, codeChallenge: v.code_challenge, codeChallengeMethod: v.code_challenge_method, responseType: v.response_type }, issuer);
  if (!problem) { try { if (new URL(v.redirect_uri).pathname !== REG_CALLBACK_PATH) problem = "This screen only serves sign-up requests."; } catch { problem = "redirect_uri is not a URL."; } }
  const pick = randomBytes(3);
  const first = FIRST[pick[0] % FIRST.length], last = LAST[pick[1] % LAST.length];
  const suggested = { name: `${first} ${last}`, email: `${first}.${last}.${pick.toString("hex")}@social.example`.toLowerCase() };
  const hidden = FIELDS.map((k) => <input key={k} type="hidden" name={k} value={v[k]} />);
  const invite = problem ? [] : await openInvites(DEMO_INVITE_EMAIL);
  return (
    <main className="page reg-page" id="main">
      <div className="notice" data-b="warn" role="note"><b>Demo identity provider (sandbox).</b> This page plays the part of a social sign-in provider. It asserts whatever e-mail you type as confirmed, which is why it exists only in the sandbox.</div>
      <div className="phead"><div><h1>Sign up to PaySettle with Demo ID</h1><p className="sub">PaySettle asks for: {v.scope || "openid"}. It receives your name and a confirmed e-mail address; nothing else.</p></div></div>
      {problem ? <p className="notice" data-b="danger" role="alert">This sign-up request was refused: {problem}</p> : (
        <section className="c" aria-labelledby="idp-acct-h">
          <h2 id="idp-acct-h" className="reg-h">Your demo account</h2>
          <form action={signUpConsent} className="stack">
            {hidden}
            <div className="field"><label htmlFor="idp-name">Name</label><input id="idp-name" name="name" type="text" required minLength={2} maxLength={80} defaultValue={suggested.name} autoComplete="name" /></div>
            <div className="field"><label htmlFor="idp-email">E-mail</label><input id="idp-email" name="email" type="email" required maxLength={254} defaultValue={suggested.email} autoComplete="email" aria-describedby="idp-email-hint" />
              <span id="idp-email-hint" className="small muted">To try invite linking, use the address a client invited.</span></div>
            <div className="row">
              <button className="btn btn-g" type="submit">Continue to PaySettle</button>
              <button className="btn btn-gh" type="submit" formAction={signUpDeny} formNoValidate>Cancel</button>
            </div>
          </form>
          {invite.length > 0 && (
            <form action={signUpConsent} className="reg-outbox" aria-labelledby="idp-inv-h">
              {hidden}
              <input type="hidden" name="name" value={DEMO_INVITE_NAME} />
              <input type="hidden" name="email" value={DEMO_INVITE_EMAIL} />
              <b id="idp-inv-h" className="small">Try invite linking</b>
              <p className="small">A demo client invited <b>{DEMO_INVITE_EMAIL}</b> to “{invite[0].title}”. Sign up as that address and the contract joins your new provider account.</p>
              <div className="row"><button className="btn btn-sm" type="submit">Continue as {DEMO_INVITE_NAME} ({DEMO_INVITE_EMAIL})</button></div>
            </form>
          )}
          <dl className="kv small">
            <div><dt>Issuer</dt><dd><code>{issuer}</code></dd></div>
            <div><dt>Redirect</dt><dd><code>{v.redirect_uri}</code></dd></div>
            <div><dt>PKCE</dt><dd>{v.code_challenge_method} · challenge <code>{v.code_challenge.slice(0, 16)}{"…"}</code></dd></div>
          </dl>
        </section>
      )}
    </main>
  );
}
