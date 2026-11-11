/**
 * F1.1 self-registration: name, e-mail, password (platform password policy), role client or provider, country,
 * time zone, and the F1.8 platform terms on the same page. Sandbox only (P9): "Continue with demo identity provider",
 * which confirms the e-mail through the built-in demo IdP before the form is filled.
 */
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { RegisterForm } from "@/components/identity/register-form";
import { common } from "@/copy/common";
import { viewer } from "@/lib/session";
import { TERMS_POINTS, TERMS_VERSION } from "@/lib/identity/handshake";
import { countryOptions } from "@/lib/identity/countries";
import { timeZones } from "@/lib/identity/profile";
import { socialAvailable, socialIdentity } from "@/lib/identity/register-social";
import { register } from "./actions";
import "@/styles/register.css";

export const metadata = { title: "Create an account" };
export const dynamic = "force-dynamic";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const [me, social] = await Promise.all([viewer(), socialIdentity()]);
  const sandbox = socialAvailable();
  return (
    <main className="page reg-page" id="main">
      <Link href="/" className="row reg-brand"><BrandMark height={36} /><b style={{ fontSize: 22 }}>{common.product}</b></Link>
      <div className="phead"><div><h1>Create your account</h1><p className="sub">For clients who buy work in milestones and providers who deliver it. Money for each milestone is held in PayPal until it is approved.</p></div></div>
      {error && <p className="notice" data-b="warn" role="alert">{error.slice(0, 300)}</p>}
      {me && (
        <p className="notice" role="note">You are signed in as {me.name}. To create a different account, <Link href="/logout">sign out</Link> first, or <Link href="/">go back to the home page</Link>.</p>
      )}

      {sandbox && !social && (
        <section className="c" aria-labelledby="idp-h">
          <div className="reg-idp">
            <div>
              <h2 id="idp-h" className="reg-h">Sign up with an identity provider</h2>
              <p className="small muted">Sandbox: a built-in demo identity provider stands in for a social sign-in. It confirms your e-mail address, so invites sent to it join your account straight away.</p>
            </div>
            <a className="btn" href="/register/social/start">Continue with demo identity provider</a>
          </div>
        </section>
      )}

      <section className="c" aria-labelledby="form-h">
        {social ? (
          <div className="notice" data-b="ok" role="note">
            <b>Confirmed by the demo identity provider:</b> {social.name ? `${social.name}, ` : ""}{social.email}. Finish the details below. <a href="/register/social/start">Use a different demo account</a>
          </div>
        ) : sandbox ? <p className="reg-or" aria-hidden="true">or register with e-mail</p> : null}
        <h2 id="form-h" className="reg-h">{social ? "Your details" : "Register with e-mail"}</h2>
        <RegisterForm action={register} termsVersion={TERMS_VERSION} termsPoints={TERMS_POINTS} countries={countryOptions()} timezones={timeZones()} social={social ? { email: social.email, name: social.name } : null} />
      </section>
      <p className="small muted">Staff accounts (operations, mediators, finance, administrators) are not opened here. Staff sign in with SSO from the sign-in page.</p>
    </main>
  );
}
