"use client";
/**
 * F3 · the waitlist form. With script it posts JSON to /api/waitlist and shows the answer in place, keeping what was
 * typed when the answer is no; without script the plain form post works and the server redirects back with the answer.
 * The honeypot field is off-screen, out of the tab order and hidden from screen readers: only a robot fills it.
 */
import { useRef, useState } from "react";
import { site } from "@/copy/site";

const t = site.waitlist;
type Field = "email" | "role" | "note";
interface Answer { ok: boolean; message: string; fields?: Field[]; count?: number }

export function WaitlistForm({ roles, maxNote, trap, initial }: { roles: readonly string[]; maxNote: number; trap: string; initial?: Answer | null }) {
  const [answer, setAnswer] = useState<Answer | null>(initial ?? null);
  const [pending, setPending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const bad = (f: Field) => (answer?.fields?.includes(f) ? true : undefined);

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setPending(true);
    const data = Object.fromEntries(new FormData(ev.currentTarget).entries());
    let next: Answer;
    try {
      const res = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(data) });
      next = (await res.json()) as Answer;
    } catch {
      next = { ok: false, message: t.result.failed };
    }
    setAnswer(next);
    setPending(false);
    if (next.ok) form.current?.reset();
    requestAnimationFrame(() => box.current?.focus());
  }

  return (
    <form ref={form} className="s-form" action="/api/waitlist" method="post" noValidate onSubmit={submit}>
      <div className="s-form-row">
        <div className="field">
          <label htmlFor="wl-email">{t.fields.email}</label>
          <input id="wl-email" name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" aria-invalid={bad("email")} aria-describedby={bad("email") ? "wl-email-p" : undefined} />
          {bad("email") && <span id="wl-email-p" className="s-problem">{t.problems.email}</span>}
        </div>
        <div className="field">
          <label htmlFor="wl-role">{t.fields.role}</label>
          <select id="wl-role" name="role" defaultValue="provider" aria-invalid={bad("role")}>
            {roles.map((r) => <option key={r} value={r}>{t.roles[r as keyof typeof t.roles] ?? r}</option>)}
          </select>
          {bad("role") && <span className="s-problem">{t.problems.role}</span>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="wl-note">{t.fields.note} <span className="s-hint">({t.fields.noteHint})</span></label>
        <textarea id="wl-note" name="note" maxLength={maxNote} rows={4} aria-invalid={bad("note")} />
        {bad("note") && <span className="s-problem">{t.problems.note}</span>}
      </div>
      <div className="s-trap" aria-hidden="true">
        <label htmlFor="wl-site">{t.trap}</label>
        <input id="wl-site" name={trap} type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="row">
        <button className="btn btn-g s-btn-lg" type="submit" disabled={pending}>{pending ? t.sending : t.send}</button>
      </div>
      <div ref={box} role="status" tabIndex={-1} className="s-answer">
        {answer && <p className="notice" data-b={answer.ok ? "ok" : "warn"}>{answer.message}</p>}
      </div>
      <p className="s-note">{t.use}</p>
    </form>
  );
}
