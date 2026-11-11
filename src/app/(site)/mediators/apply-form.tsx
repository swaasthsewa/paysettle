"use client";
/**
 * The public mediator application form. Posts to a server action (zod, honeypot, 5 posts per address per
 * 10 minutes). Problems are announced in a live region and each field points at its own message. The honeypot field
 * is off-screen, out of the tab order and hidden from screen readers.
 */
import { useActionState, useEffect, useRef } from "react";
import { applyAction, type ApplyState } from "@/server/mediators/actions";

type Opt = { value: string; label: string };
export function ApplyForm({ domains, languages, zones, trap }: { domains: Opt[]; languages: Opt[]; zones: string[]; trap: string }) {
  const [state, action, pending] = useActionState<ApplyState | null, FormData>(applyAction, null);
  const box = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state) { box.current?.focus(); if (state.ok) form.current?.reset(); } }, [state]);
  const err = (k: keyof NonNullable<ApplyState["errors"]>) => state?.errors?.[k];
  const aria = (k: keyof NonNullable<ApplyState["errors"]>, id: string) => (err(k) ? { "aria-invalid": true as const, "aria-describedby": `${id}-p` } : {});
  const prob = (k: keyof NonNullable<ApplyState["errors"]>, id: string) => (err(k) ? <span id={`${id}-p`} className="s-problem">{err(k)}</span> : null);

  return (
    <form ref={form} className="s-form" action={action} noValidate>
      <div ref={box} role="status" tabIndex={-1} className="s-answer">
        {state && <p className="notice" data-b={state.ok ? "ok" : "warn"}>{state.message}</p>}
      </div>
      <div className="s-form-row">
        <div className="field"><label htmlFor="ma-name">Full name</label><input id="ma-name" name="name" required maxLength={120} autoComplete="name" {...aria("name", "ma-name")} />{prob("name", "ma-name")}</div>
        <div className="field"><label htmlFor="ma-email">E-mail</label><input id="ma-email" name="email" type="email" required maxLength={254} autoComplete="email" {...aria("email", "ma-email")} />{prob("email", "ma-email")}</div>
      </div>
      <fieldset className="md-checks" {...(err("domains") ? { "aria-describedby": "ma-dom-p" } : {})}>
        <legend>Domains you know well (pick one or more)</legend>
        {domains.map((d) => <label key={d.value}><input type="checkbox" name="domains" value={d.value} /> {d.label}</label>)}
        {prob("domains", "ma-dom")}
      </fieldset>
      <fieldset className="md-checks" {...(err("languages") ? { "aria-describedby": "ma-lang-p" } : {})}>
        <legend>Languages you can mediate in</legend>
        {languages.map((l) => <label key={l.value}><input type="checkbox" name="languages" value={l.value} defaultChecked={l.value === "en"} /> {l.label}</label>)}
        {prob("languages", "ma-lang")}
      </fieldset>
      <div className="s-form-row">
        <div className="field"><label htmlFor="ma-tz">Time zone</label>
          <select id="ma-tz" name="timezone" defaultValue="UTC" {...aria("timezone", "ma-tz")}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select>{prob("timezone", "ma-tz")}</div>
        <div className="field"><label htmlFor="ma-hours">Hours a week you can give</label><input id="ma-hours" name="weeklyHours" type="number" min={2} max={60} defaultValue={8} required {...aria("weeklyHours", "ma-hours")} />{prob("weeklyHours", "ma-hours")}</div>
      </div>
      <div className="field"><label htmlFor="ma-firm">Firm <span className="s-hint">(leave empty if you work independently)</span></label><input id="ma-firm" name="firm" maxLength={120} autoComplete="organization" {...aria("firm", "ma-firm")} />{prob("firm", "ma-firm")}</div>
      <div className="field"><label htmlFor="ma-cred">Credentials <span className="s-hint">(licences, accreditations, bar or trade memberships, with issuer)</span></label><textarea id="ma-cred" name="credentials" required maxLength={2000} rows={4} {...aria("credentials", "ma-cred")} />{prob("credentials", "ma-cred")}</div>
      <div className="field"><label htmlFor="ma-coi">Conflicts to declare <span className="s-hint">(companies or people you work for or with; one per line)</span></label><textarea id="ma-coi" name="conflicts" maxLength={2000} rows={3} {...aria("conflicts", "ma-coi")} />{prob("conflicts", "ma-coi")}</div>
      <div className="s-trap" aria-hidden="true">
        <label htmlFor="ma-site">Leave this field empty</label>
        <input id="ma-site" name={trap} type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="row"><button className="btn btn-g s-btn-lg" type="submit" disabled={pending}>{pending ? "Sending…" : "Send application"}</button></div>
      <p className="s-note">We use these details only to review your application and, if approved, to route cases to you. Uploads of certificates happen after approval, in your profile.</p>
    </form>
  );
}
