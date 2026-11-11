"use client";
/**
 * F1.2, F1.3, F1.4, F1.5, F1.6 · one form shell for every identity action: posts to a server action, keeps what was
 * typed when the answer is no, reads the answer to screen readers, and shows recovery codes exactly once.
 */
import { useActionState, useEffect, useRef, type ReactNode } from "react";

export interface ActionAnswer { ok: boolean; message: string; problems?: string[]; codes?: string[] }
type Action = (prev: ActionAnswer | null, form: FormData) => Promise<ActionAnswer>;

export function ActionForm({ action, submit, pendingLabel, className = "stack", variant = "btn", children, resetOnOk }: {
  action: Action; submit: string; pendingLabel?: string; className?: string; variant?: "btn" | "btn btn-g" | "btn btn-d" | "btn btn-sm"; children?: ReactNode; resetOnOk?: boolean;
}) {
  const [state, run, pending] = useActionState(action, null);
  const form = useRef<HTMLFormElement>(null);
  const answer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state) return;
    if (state.ok && resetOnOk) form.current?.reset();
    answer.current?.focus();
  }, [state, resetOnOk]);
  return (
    <form ref={form} action={run} className={className}>
      {children}
      <div className="row">
        <button className={variant} type="submit" disabled={pending}>{pending ? pendingLabel ?? "Saving…" : submit}</button>
      </div>
      <div ref={answer} role="status" tabIndex={-1} style={{ outline: "none" }}>
        {state && (
          <div className="notice" data-b={state.ok ? "ok" : "warn"}>
            <p>{state.message}</p>
            {state.problems && state.problems.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: "1.2em" }}>{state.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </div>
        )}
        {state?.codes && <RecoveryCodes codes={state.codes} />}
      </div>
    </form>
  );
}

/** The recovery codes, shown once: copy them or save them as a text file now. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = `PaySettle recovery codes\nEach code works once. Keep them somewhere safe, away from this device.\n\n${codes.join("\n")}\n`;
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  return (
    <div className="c" style={{ marginTop: 10, boxShadow: "none" }} aria-labelledby="rc-h">
      <div className="c-head"><h3 id="rc-h">Your recovery codes</h3><span className="chip" data-b="warn">Shown once</span></div>
      <p className="small muted">Each code signs you in once if you lose your authenticator. PaySettle keeps only their fingerprints, so they cannot be shown again.</p>
      <ol className="id-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ol>
      <div className="row">
        <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copy all</button>
        <a className="btn btn-sm" href={href} download="paysettle-recovery-codes.txt">Save as a text file</a>
      </div>
    </div>
  );
}
