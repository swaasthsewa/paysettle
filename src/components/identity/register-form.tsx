"use client";
/**
 * F1.1 · the registration form. Posts to the register server action; the answer comes back as field errors, an
 * error summary at the top (focused and announced, each entry a link to its field), and the typed values (never the
 * password) so nothing else has to be typed again. The password policy is shown as you type, using the same rules the
 * server applies (src/lib/identity/policy.ts). The time zone starts at the browser's own zone.
 * The hidden "website" field is the honeypot: people never see or reach it.
 */
import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { passwordProblems, PASSWORD_MIN } from "@/lib/identity/policy";
import { errorSummary, HONEYPOT, type FieldErrors, type RegField } from "@/lib/identity/registration";

export interface RegAnswer { ok: boolean; message: string; errors?: FieldErrors; values?: Record<string, string> }
type Action = (prev: RegAnswer | null, form: FormData) => Promise<RegAnswer>;

export interface RegisterFormProps {
  action: Action;
  termsVersion: string;
  termsPoints: readonly string[];
  countries: { code: string; name: string }[];
  timezones: string[];
  social: { email: string; name: string } | null;
}

const LABEL: Record<RegField, string> = { name: "Full name", email: "E-mail", password: "Password", role: "I want to", country: "Country", timezone: "Time zone", terms: "Platform terms" };

export function RegisterForm(props: RegisterFormProps) {
  const [state, run, pending] = useActionState(props.action, null);
  const uid = useId();
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state) summary.current?.focus(); }, [state]);
  const list = errorSummary(state?.errors ?? {});
  const id = (f: string) => `${uid}-${f}`;
  return (
    <form action={run} className="stack reg-form">
      <div ref={summary} tabIndex={-1} role={state ? "alert" : undefined} className="reg-summary-wrap">
        {state && (
          <div className="notice" data-b={state.ok ? "ok" : "warn"}>
            <p>{state.message}</p>
            {list.length > 0 && (
              <ul className="reg-summary">{list.map((e) => <li key={e.field}><a href={`#${id(e.field)}`}>{LABEL[e.field]}: {e.message}</a></li>)}</ul>
            )}
          </div>
        )}
      </div>
      {/* remounted for each answer, so the typed values come back from the server answer (the password never does) */}
      <Fields key={state ? JSON.stringify(state.values ?? {}) + (state.message ?? "") : "first"} {...props} uid={uid} values={state?.values ?? {}} errors={state?.errors ?? {}} pending={pending} />
    </form>
  );
}

function Fields({ termsVersion, termsPoints, countries, timezones, social, uid, values: v, errors: err, pending }: RegisterFormProps & { uid: string; values: Record<string, string>; errors: FieldErrors; pending: boolean }) {
  const id = (f: string) => `${uid}-${f}`;
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [name, setName] = useState(v.name || social?.name || "");
  const [email, setEmail] = useState(social?.email ?? v.email ?? "");
  const tzRef = useRef<HTMLSelectElement>(null);
  /* start the time zone at the browser's own zone (a DOM default, not state: the server cannot know it) */
  useEffect(() => {
    const el = tzRef.current;
    if (!el || v.timezone) return;
    const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezones.includes(mine)) el.value = mine;
  }, [v.timezone, timezones]);

  const live = useMemo(() => (pw ? passwordProblems(pw, { email, name }) : []), [pw, email, name]);
  const described = (f: RegField, hint?: boolean) => [hint ? id(`${f}-hint`) : "", err[f]?.length ? id(`${f}-err`) : ""].filter(Boolean).join(" ") || undefined;
  const fieldError = (f: RegField) => err[f]?.length ? <span id={id(`${f}-err`)} className="reg-err">{err[f]!.join(" ")}</span> : null;

  return (
    <>
      {social && <input type="hidden" name="via" value="demo-idp" />}
      <input type="hidden" name="termsVersion" value={termsVersion} />

      <div className="reg-grid">
        <div className="field reg-wide">
          <label htmlFor={id("name")}>Full name</label>
          <input id={id("name")} name="name" type="text" autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)}
            aria-invalid={err.name?.length ? true : undefined} aria-describedby={described("name", true)} />
          <span id={id("name-hint")} className="small muted">As it should appear on contracts and receipts.</span>
          {fieldError("name")}
        </div>

        <div className="field reg-wide">
          <label htmlFor={id("email")}>E-mail</label>
          {social ? (
            <>
              <input id={id("email")} type="email" value={social.email} readOnly aria-readonly="true" aria-describedby={id("email-hint")} />
              <span id={id("email-hint")} className="small muted">Confirmed by the demo identity provider. Contract invites sent to this address join your account.</span>
            </>
          ) : (
            <>
              <input id={id("email")} name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)}
                aria-invalid={err.email?.length ? true : undefined} aria-describedby={described("email", true)} />
              <span id={id("email-hint")} className="small muted">We send a confirmation link here. Invites addressed to it join your account once it is confirmed.</span>
            </>
          )}
          {fieldError("email")}
        </div>

        <div className="field reg-wide">
          <label htmlFor={id("password")}>Password</label>
          <div className="reg-pw">
            <input id={id("password")} name="password" type={show ? "text" : "password"} autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={128} value={pw} onChange={(e) => setPw(e.target.value)}
              aria-invalid={err.password?.length ? true : undefined} aria-describedby={described("password", true)} />
            <button type="button" className="btn btn-sm btn-gh" aria-pressed={show} aria-controls={id("password")} onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
          </div>
          <span id={id("password-hint")} className="small muted">
            At least {PASSWORD_MIN} characters. Leave out your name and the part of your e-mail before the @. Commonly used passwords are refused.
            {social ? " You use it to sign in with e-mail later." : ""}
            {pw && (live.length ? <span className="reg-live" data-b="warn"> Not yet: {live.join(" ")}</span> : <span className="reg-live" data-b="ok"> This password meets the policy.</span>)}
          </span>
          {fieldError("password")}
        </div>

        <fieldset className="reg-wide reg-roles" aria-describedby={err.role?.length ? id("role-err") : undefined}>
          <legend id={id("role")} tabIndex={-1}>I want to</legend>
          <label className="reg-role">
            <input type="radio" name="role" value="client" required defaultChecked={v.role === "client"} />
            <span><b>Buy work (client)</b><small>Fund milestones; the money waits in PayPal until you approve each one.</small></span>
          </label>
          <label className="reg-role">
            <input type="radio" name="role" value="provider" defaultChecked={v.role === "provider"} />
            <span><b>Deliver work (provider)</b><small>Get paid per approved milestone. Providers set up an authenticator app next.</small></span>
          </label>
          {fieldError("role")}
        </fieldset>

        <div className="field">
          <label htmlFor={id("country")}>Country</label>
          <select id={id("country")} name="country" required defaultValue={v.country ?? ""} autoComplete="country"
            aria-invalid={err.country?.length ? true : undefined} aria-describedby={described("country")}>
            <option value="" disabled>Pick your country</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          {fieldError("country")}
        </div>

        <div className="field">
          <label htmlFor={id("timezone")}>Time zone</label>
          <select ref={tzRef} id={id("timezone")} name="timezone" required defaultValue={v.timezone || "UTC"}
            aria-invalid={err.timezone?.length ? true : undefined} aria-describedby={described("timezone", true)}>
            {timezones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
          <span id={id("timezone-hint")} className="small muted">Deadlines and review windows show in this zone.</span>
          {fieldError("timezone")}
        </div>
      </div>

      <section className="reg-terms" aria-labelledby={id("terms-h")}>
        <h2 id={id("terms-h")} className="reg-h">Platform terms, version {termsVersion}</h2>
        <ul>{termsPoints.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="small muted">Full text: <a href="/terms" target="_blank" rel="noopener">platform terms</a>. Your acceptance is recorded with the time, your IP address, your browser and the version, and signed so it cannot be changed later.</p>
        <label className="row reg-check" htmlFor={id("terms")}>
          <input id={id("terms")} type="checkbox" name="terms" required aria-invalid={err.terms?.length ? true : undefined} aria-describedby={err.terms?.length ? id("terms-err") : undefined} />
          <span>I have read and accept the platform terms, version {termsVersion}.</span>
        </label>
        {fieldError("terms")}
      </section>

      {/* honeypot: hidden from people and from assistive technology */}
      <div className="reg-hp" aria-hidden="true">
        <label htmlFor={id(HONEYPOT)}>Website (leave empty)</label>
        <input id={id(HONEYPOT)} name={HONEYPOT} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="row">
        <button className="btn btn-g" type="submit" disabled={pending} aria-disabled={pending}>{pending ? "Creating your account…" : "Create account"}</button>
        <span className="small muted">Already have an account? <a href="/login">Sign in</a></span>
      </div>
    </>
  );
}
