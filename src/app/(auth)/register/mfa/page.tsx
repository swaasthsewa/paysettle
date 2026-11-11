/**
 * F1.1, F1.2 · registration step 2 for providers: set up an authenticator app before the first session. Outside the
 * sandbox the step cannot be skipped (providers need a second factor to sign in); in the sandbox it can (P9).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { BrandMark } from "@/components/brand";
import { ActionForm } from "@/components/identity/action-form";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { common } from "@/copy/common";
import { sandboxMode } from "@/lib/clock";
import { beginEnrolment } from "@/lib/identity/mfa";
import { parkedRegistration } from "@/lib/identity/register-session";
import { confirmRegMfa, finishRegMfa, restartRegMfa } from "./actions";
import "@/styles/site.css";
import "@/styles/register.css";

export const metadata = { title: "Set up your authenticator" };
export const dynamic = "force-dynamic";

export default async function RegisterMfa({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const step = await parkedRegistration();
  if (!step) redirect("/login?error=" + encodeURIComponent("Your registration step expired. Sign in with your e-mail and password to continue."));
  const [u] = await db.select().from(users).where(eq(users.id, step.u)).limit(1);
  if (!u) redirect("/register");
  const pending = (u.profile as { mfaPending?: { secret: string } }).mfaPending;
  const enrol = pending?.secret ? beginEnrolment(u.email, pending.secret) : null;
  const sandbox = sandboxMode();
  return (
    <main className="page reg-page" id="main">
      <Link href="/" className="row reg-brand"><BrandMark height={36} /><b style={{ fontSize: 22 }}>{common.product}</b></Link>
      <div className="phead"><div><h1>Set up your authenticator, {u.name.split(" ")[0]}</h1><p className="sub">Step 2 of 2. Providers sign in with a password and a six-digit code, because releases are paid to their PayPal account.</p></div></div>
      {error && <p className="notice" data-b="warn" role="alert">{error.slice(0, 300)}</p>}
      <section className="c" aria-labelledby="mfa-h">
        <h2 id="mfa-h" className="reg-h">Authenticator app</h2>
        {u.mfaSecret ? (
          <p className="notice" data-b="ok" role="status">The authenticator app is on for {u.email}.</p>
        ) : enrol ? (
          <>
            <ol className="reg-steps">
              <li>Open an authenticator app (any app with time-based codes) and choose to add an account by typing a key.</li>
              <li>Type this key. Account: <b>{u.email}</b>, issuer: <b>PaySettle</b>, time-based.</li>
              <li>Type the six-digit code the app shows, below.</li>
            </ol>
            <p className="reg-key"><span className="sr-only">Key: </span>{enrol.groups}</p>
            <details><summary className="small">Setup address for apps that accept one</summary><p className="reg-uri">{enrol.uri}</p></details>
            <ActionForm action={confirmRegMfa} submit="Turn on" variant="btn btn-g">
              <div className="field"><label htmlFor="rm-code">Six-digit code from the app</label><input id="rm-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required /></div>
            </ActionForm>
          </>
        ) : (
          <p className="small muted">The previous set-up was discarded. Start again with a new key.</p>
        )}
        {!u.mfaSecret && <form action={restartRegMfa}><button className="btn btn-gh btn-sm" type="submit">Start again with a new key</button></form>}
      </section>
      <section className="c" aria-labelledby="go-h">
        <h2 id="go-h" className="reg-h">Continue</h2>
        <p className="small muted">After the app is on and the recovery codes are saved, continue to your account.</p>
        <form action={finishRegMfa} className="row">
          <button className="btn btn-d" type="submit">Continue to my account</button>
          {sandbox && !u.mfaSecret && <button className="btn btn-gh" type="submit" name="skip" value="1" formNoValidate>Skip for now (sandbox only)</button>}
        </form>
        {sandbox && !u.mfaSecret && <p className="small muted">Sandbox: you can skip and set it up later on Account &amp; security. Outside the sandbox this step is required.</p>}
      </section>
    </main>
  );
}
