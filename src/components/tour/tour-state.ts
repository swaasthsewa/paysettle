/**
 * A10 · the judge tour's state machine, pure so it can be unit-tested without a browser.
 *  closed     nothing on screen but the launcher buttons; the page is untouched
 *  open       the modal step dialog (focus kept inside it)
 *  minimized  a small, non-modal "Resume tour" bar while the judge looks at a screen
 * The state survives page changes in sessionStorage (one tab, one tour); bad stored values read as closed.
 */

export type TourMode = "closed" | "open" | "minimized";
export interface TourState { mode: TourMode; step: number }
export type TourAction =
  | { type: "start" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "go"; step: number }
  | { type: "minimize" }
  | { type: "resume" }
  | { type: "close" };

export const CLOSED: TourState = Object.freeze({ mode: "closed", step: 0 }) as TourState;
export const STORAGE_KEY = "paysettle.tour.v1";

const clamp = (n: number, count: number) => Math.max(0, Math.min(count - 1, Math.trunc(n)));

/**
 * Next state. `count` is the number of steps. "start" opens at the first step, or where a tucked-away tour stopped;
 * "next" on the last step ends the tour; "go" jumps to a step and opens it.
 */
export function tourReducer(s: TourState, a: TourAction, count: number): TourState {
  if (count <= 0) return CLOSED;
  switch (a.type) {
    case "start": return { mode: "open", step: s.mode === "minimized" ? clamp(s.step, count) : 0 };
    case "resume": return s.mode === "closed" ? s : { mode: "open", step: clamp(s.step, count) };
    case "next": {
      if (s.mode === "closed") return s;
      return s.step >= count - 1 ? CLOSED : { mode: "open", step: clamp(s.step + 1, count) };
    }
    case "prev": return s.mode === "closed" ? s : { mode: "open", step: clamp(s.step - 1, count) };
    case "go": return Number.isFinite(a.step) ? { mode: "open", step: clamp(a.step, count) } : s;
    case "minimize": return s.mode === "closed" ? s : { mode: "minimized", step: clamp(s.step, count) };
    case "close": return CLOSED;
  }
}

/** The stored form; `null` means "remove the key" (closed). */
export function serialize(s: TourState): string | null {
  return s.mode === "closed" ? null : JSON.stringify({ v: 1, mode: s.mode, step: s.step });
}

/** Reads a stored value back. A missing, malformed or out-of-range value gives the closed state. */
export function parseStored(raw: string | null | undefined, count: number): TourState {
  if (!raw || count <= 0) return CLOSED;
  try {
    const o = JSON.parse(raw) as { v?: unknown; mode?: unknown; step?: unknown };
    if (o?.v !== 1 || (o.mode !== "open" && o.mode !== "minimized") || typeof o.step !== "number" || !Number.isInteger(o.step)) return CLOSED;
    if (o.step < 0 || o.step >= count) return CLOSED;
    return { mode: o.mode, step: o.step };
  } catch {
    return CLOSED;
  }
}

/**
 * Focus trap: where Tab (or Shift+Tab) goes from the element at `index` among `count` focusable elements of the dialog.
 * `index` is -1 when focus is on the dialog itself or its heading. Returns -1 when nothing is focusable.
 */
export function trapTarget(index: number, count: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return shift ? count - 1 : 0;
  if (shift) return index === 0 ? count - 1 : index - 1;
  return index === count - 1 ? 0 : index + 1;
}

/** Whether Tab from `index` would leave the dialog, so the browser's own move must be replaced. */
export function tabLeaves(index: number, count: number, shift: boolean): boolean {
  if (count <= 0) return true;
  if (index < 0 || index >= count) return true;
  return shift ? index === 0 : index === count - 1;
}

/** Words for the step counter and the resume bar. */
export const stepLabel = (step: number, count: number) => `Step ${step + 1} of ${count}`;
