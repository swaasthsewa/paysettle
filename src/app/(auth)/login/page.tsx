// F1.9 sandbox bypass: the persona picker renders only in sandbox mode (P9) · F1.7 "Staff: sign in with SSO" · F1.1 link to /register.
import Link from "next/link";
import { asc } from "drizzle-orm";
import { BrandMark } from "@/components/brand";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { common } from "@/copy/common";
import { sandboxMode } from "@/lib/clock";
import { ssoAvailable, ssoIsDemo } from "@/lib/identity/sso-flow";
import { demoSignIn, passwordSignIn } from "./actions";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const personas = sandboxMode() ? await db.select().from(users).where(undefined).orderBy(asc(users.persona)) : [];
  const demo = personas.filter((p) => p.persona);
  return (
    <main className="page" style={{ maxWidth: 1040, paddingTop: 48 }}>
      <Link href="/" className="row" style={{ textDecoration: "none", gap: 10 }}><BrandMark height={36} /><b style={{ fontSize: 22 }}>{common.product}</b></Link>
      <div className="phead"><div><h1>Sign in</h1><p className="sub">{common.tagline}</p></div></div>
      {error && <p className="notice" role="alert">{error}</p>}
      {sandboxMode() && demo.length > 0 && (
        <section className="c" aria-labelledby="demo-h">
          <div><h2 id="demo-h" style={{ fontSize: 20 }}>Explore the live demo</h2><p className="muted small">Pick a person. No password needed in the sandbox. Each role sees its own workspace.</p></div>
          <div className="persona-grid">
            {demo.map((p) => (
              <form key={p.id} action={demoSignIn}>
                <input type="hidden" name="userId" value={p.id} />
                <button className="persona" type="submit">
                  <i className="who-initial" aria-hidden="true">{p.name.slice(0, 1)}</i>
                  <span><b>{p.name}</b><small>{common.roles[p.role]} · {String((p.profile as { blurb?: string }).blurb ?? "")}</small></span>
                </button>
              </form>
            ))}
          </div>
        </section>
      )}
      {ssoAvailable() && (
        <section className="c" style={{ maxWidth: 460 }} aria-labelledby="sso-h">
          <h2 id="sso-h" style={{ fontSize: 20 }}>Staff: sign in with SSO</h2>
          <p className="muted small">Operations, mediators, finance and administrators sign in through the company identity provider{ssoIsDemo() ? " (in the sandbox, a built-in demo identity provider)" : ""}. Your role comes from your IdP groups.</p>
          <a className="btn" href="/sso/start">Continue with SSO</a>
        </section>
      )}
      <section className="c" style={{ maxWidth: 460 }}>
        <h2 style={{ fontSize: 20 }}>Sign in with email</h2>
        <form action={passwordSignIn} className="stack">
          <label className="field">Email<input className="input" name="email" type="email" autoComplete="email" required /></label>
          <label className="field">Password<input className="input" name="password" type="password" autoComplete="current-password" required /></label>
          <label className="field">Authenticator code or recovery code (if set up)<input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" /></label>
          <button className="btn btn-g" type="submit">Sign in</button>
        </form>
        <p className="small muted">New to {common.product}? <Link href="/register">Create an account</Link></p>
      </section>
    </main>
  );
}
