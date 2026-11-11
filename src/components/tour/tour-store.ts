/**
 * A10 · one tour per browser tab. Every <JudgeTour/> on the page (a launcher in the landing hero, one in the app shell,
 * one on /judges) shares this store; one of them is the "host" and is the only one that draws the dialog and the resume bar,
 * so two mounts never stack two dialogs. The host is the first shell mount if there is one, else the first mounted. State is mirrored to sessionStorage so the tour follows the judge
 * from the public site into the app. Works without a window (server render, unit tests): storage is then skipped.
 */
import { TOUR_STEPS } from "@/data/tour";
import { CLOSED, STORAGE_KEY, parseStored, serialize, tourReducer, type TourAction, type TourState } from "./tour-state";

type Listener = () => void;

export interface TourStore {
  get(): TourState;
  dispatch(a: TourAction): void;
  subscribe(l: Listener): () => void;
  /**
   * Registers a mounted instance under a stable key (React useId); returns the unregister function. A shell mount (launcher={false}, placed once in
   * a layout that stays mounted) passes shell=true and is preferred as host, so the overlay does not move between instances
   * when a page with its own launcher comes and goes.
   */
  register(key: string, shell?: boolean): () => void;
  /** The key of the instance that draws the overlay, or "" when none is mounted. */
  host(): string;
  /** The element focus returns to when the tour ends (the launcher that opened it). */
  opener: HTMLElement | null;
}

function storage(): Storage | null {
  try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; }
}

export function createTourStore(count: number = TOUR_STEPS.length, store: () => Storage | null = storage): TourStore {
  let state: TourState = CLOSED;
  let loaded = false;
  const hosts: { key: string; shell: boolean }[] = [];
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());
  const load = () => {
    if (loaded) return;
    const s = store();
    if (!s) return;
    loaded = true;
    try { state = parseStored(s.getItem(STORAGE_KEY), count); } catch { state = CLOSED; }
  };
  const persist = () => {
    const s = store();
    if (!s) return;
    try { const v = serialize(state); if (v === null) s.removeItem(STORAGE_KEY); else s.setItem(STORAGE_KEY, v); } catch { /* storage full or blocked: the tour still works on this page */ }
  };
  return {
    opener: null,
    get() { load(); return state; },
    dispatch(a) {
      load();
      const next = tourReducer(state, a, count);
      if (next === state || (next.mode === state.mode && next.step === state.step)) return;
      state = next;
      persist();
      emit();
    },
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    register(key, shell = false) {
      hosts.push({ key, shell });
      emit();
      return () => { const i = hosts.findIndex((h) => h.key === key); if (i >= 0) hosts.splice(i, 1); emit(); };
    },
    host() { return (hosts.find((h) => h.shell) ?? hosts[0])?.key ?? ""; },
  };
}

/** The page's shared store. */
export const tourStore = createTourStore();
