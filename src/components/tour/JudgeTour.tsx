"use client";
/**
 * A10 · the judge tour. <JudgeTour/> renders a "Take the 3-minute tour" button (unless launcher={false}) and, while a
 * tour runs, either the step dialog or a small resume bar. Mount it anywhere, as often as needed: only one instance draws
 * the overlay (a launcher-less shell mount when there is one, see tour-store.ts), and the tour carries over between pages
 * in sessionStorage.
 *
 * Accessibility: the dialog is a native <dialog> opened with showModal(), so the rest of the page is inert while it is open;
 * Tab and Shift+Tab are kept inside it; Escape ends the tour; focus moves to the step heading on each step and back to the
 * button that opened the tour when it ends. Ending the tour removes everything it drew: nothing is left over the page.
 * Motion: one short fade, switched off by the global reduced-motion rules.
 */
import "@/styles/tour.css";
import Link from "next/link";
import { useEffect, useId, useRef, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { TOUR_LABEL, TOUR_STEPS } from "@/data/tour";
import { CLOSED, stepLabel, tabLeaves, trapTarget, type TourState } from "./tour-state";
import { tourStore } from "./tour-store";

const serverState = (): TourState => CLOSED;
const serverHost = () => "";
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Where focus goes when the dialog is tucked away: to the resume bar, or to the main region of the page being opened. */
let focusNext: "bar" | "page" | null = null;

function focusMain() {
  const main = document.getElementById("page");
  if (main) main.focus({ preventScroll: true });
}

export interface JudgeTourProps {
  /** Show the start button. Use false in a shell that only needs to carry a running tour across pages. */
  launcher?: boolean;
  /** Button text; defaults to "Take the 3-minute tour". */
  label?: string;
  /** Classes of the start button; defaults to the global .btn. */
  className?: string;
}

export function JudgeTour({ launcher = true, label = TOUR_LABEL, className = "btn" }: JudgeTourProps) {
  const state = useSyncExternalStore(tourStore.subscribe, tourStore.get, serverState);
  const host = useSyncExternalStore(tourStore.subscribe, tourStore.host, serverHost);
  const me = useId();
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => tourStore.register(me, !launcher), [me, launcher]);

  const start = () => {
    tourStore.opener = btn.current;
    tourStore.dispatch({ type: "start" });
  };
  const isHost = host === me;

  return (
    <>
      {launcher && (
        <button ref={btn} type="button" className={className} aria-haspopup="dialog" onClick={start}>
          {label}
        </button>
      )}
      {isHost && state.mode === "open" && createPortal(<TourDialog step={state.step} />, document.body)}
      {isHost && state.mode === "minimized" && createPortal(<ResumeBar step={state.step} />, document.body)}
    </>
  );
}

export default JudgeTour;

/* ── the step dialog ── */

function TourDialog({ step }: { step: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const count = TOUR_STEPS.length;
  const s = TOUR_STEPS[step] ?? TOUR_STEPS[0];
  const last = step >= count - 1;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      try { d.showModal(); } catch { d.setAttribute("open", ""); }
    }
    return () => { if (d?.open) d.close(); };
  }, []);

  useEffect(() => { head.current?.focus(); }, [step]);

  const end = () => {
    focusNext = null;
    const opener = tourStore.opener;
    tourStore.dispatch({ type: "close" });
    requestAnimationFrame(() => { if (opener?.isConnected) opener.focus(); else focusMain(); });
  };
  const next = () => {
    if (last) { end(); return; }
    tourStore.dispatch({ type: "next" });
  };
  const prev = () => tourStore.dispatch({ type: "prev" });
  const hide = (to: "bar" | "page") => {
    focusNext = to;
    tourStore.dispatch({ type: "minimize" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Tab") {
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (tabLeaves(i, items.length, e.shiftKey)) {
        e.preventDefault();
        items[trapTarget(i, items.length, e.shiftKey)]?.focus();
      }
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight" && !last) { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft" && step > 0) { e.preventDefault(); prev(); }
  };
  /* A click on the backdrop lands on the <dialog> itself (its content fills it): tuck the tour away. */
  const onClick = (e: MouseEvent<HTMLDialogElement>) => { if (e.target === ref.current) hide("bar"); };

  return (
    <dialog
      ref={ref}
      className="tour-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => { e.preventDefault(); end(); }}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      <div className="tour-in">
        <div className="tour-top">
          <p className="tour-count">Judge tour · {stepLabel(step, count)}</p>
          <button type="button" className="tour-x" aria-label="End the tour" onClick={end}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /></svg>
          </button>
        </div>
        <p className="tour-tag">{s.tag}</p>
        <h2 id={titleId} ref={head} tabIndex={-1} className="tour-title">{s.title}</h2>
        <p id={bodyId} className="tour-body">{s.body}</p>
        <h3 className="tour-look-h">What to look at</h3>
        <ul className="tour-look">{s.look.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="tour-go">
          <Link className="btn btn-g" href={s.go.href} onClick={() => hide("page")}>{s.go.label}</Link>
          {s.also && <Link className="btn" href={s.also.href} onClick={() => hide("page")}>{s.also.label}</Link>}
        </p>
        <nav aria-label="Tour steps" className="tour-steps">
          <ol>
            {TOUR_STEPS.map((t, i) => (
              <li key={t.id}>
                <button type="button" className="tour-dot" aria-label={`Step ${i + 1}: ${t.title}`} aria-current={i === step ? "step" : undefined} onClick={() => tourStore.dispatch({ type: "go", step: i })}>
                  <i aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="tour-nav">
          <button type="button" className="btn" onClick={prev} disabled={step === 0}>Back</button>
          <button type="button" className="btn btn-gh" onClick={() => hide("bar")}>Hide for now</button>
          <button type="button" className="btn btn-d" onClick={next}>{last ? "Finish the tour" : "Next"}</button>
        </div>
        <p className="tour-keys">Keys: ← and → move between steps, Esc ends the tour.</p>
      </div>
    </dialog>
  );
}

/* ── the resume bar, shown while the judge looks at a screen ── */

function ResumeBar({ step }: { step: number }) {
  const resumeBtn = useRef<HTMLButtonElement>(null);
  const count = TOUR_STEPS.length;
  const s = TOUR_STEPS[step] ?? TOUR_STEPS[0];

  useEffect(() => {
    const f = focusNext;
    focusNext = null;
    if (f === "bar") resumeBtn.current?.focus();
    else if (f === "page") focusMain();
  }, []);

  const end = () => {
    const opener = tourStore.opener;
    tourStore.dispatch({ type: "close" });
    requestAnimationFrame(() => { if (opener?.isConnected) opener.focus(); else focusMain(); });
  };

  return (
    <div className="tour-bar" role="region" aria-label="Judge tour">
      <p className="tour-bar-t"><b>Tour</b> <span>{stepLabel(step, count)}: {s.title}</span></p>
      <button ref={resumeBtn} type="button" className="btn btn-sm btn-g" onClick={() => tourStore.dispatch({ type: "resume" })}>Resume tour</button>
      <button type="button" className="tour-x" aria-label="End the tour" onClick={end}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /></svg>
      </button>
    </div>
  );
}
