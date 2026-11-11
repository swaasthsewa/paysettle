/**
 * A10 · judge tour logic: the state machine, stored state, the focus trap arithmetic, the shared store (one host per
 * page, sessionStorage mirror) and the step content (6–8 steps, S1–S7 covered, links to real routes, plain copy).
 */
import { describe, expect, it } from "vitest";
import { TOUR_LABEL, TOUR_MINUTES, TOUR_STEPS } from "@/data/tour";
import { CLOSED, STORAGE_KEY, parseStored, serialize, stepLabel, tabLeaves, tourReducer, trapTarget, type TourState } from "./tour-state";
import { createTourStore } from "./tour-store";
import { appRoutes, routeExists } from "./routes-for-tests";

const N = 8;
const open = (step: number): TourState => ({ mode: "open", step });

describe("A10 tour state machine", () => {
  it("A10 start opens at step 1, or where a tucked-away tour stopped", () => {
    expect(tourReducer(CLOSED, { type: "start" }, N)).toEqual(open(0));
    expect(tourReducer({ mode: "minimized", step: 4 }, { type: "start" }, N)).toEqual(open(4));
    expect(tourReducer(open(5), { type: "start" }, N)).toEqual(open(0));
  });
  it("A10 next and prev move within bounds; next on the last step ends the tour", () => {
    expect(tourReducer(open(0), { type: "next" }, N)).toEqual(open(1));
    expect(tourReducer(open(0), { type: "prev" }, N)).toEqual(open(0));
    expect(tourReducer(open(N - 1), { type: "next" }, N)).toEqual(CLOSED);
    expect(tourReducer(CLOSED, { type: "next" }, N)).toBe(CLOSED);
    expect(tourReducer(CLOSED, { type: "prev" }, N)).toBe(CLOSED);
  });
  it("A10 go clamps the step and opens; non-finite steps are ignored", () => {
    expect(tourReducer(CLOSED, { type: "go", step: 3 }, N)).toEqual(open(3));
    expect(tourReducer(open(1), { type: "go", step: 99 }, N)).toEqual(open(N - 1));
    expect(tourReducer(open(1), { type: "go", step: -4 }, N)).toEqual(open(0));
    expect(tourReducer(open(1), { type: "go", step: Number.NaN }, N)).toEqual(open(1));
  });
  it("A10 minimize keeps the step; resume reopens it; close always ends", () => {
    const m = tourReducer(open(2), { type: "minimize" }, N);
    expect(m).toEqual({ mode: "minimized", step: 2 });
    expect(tourReducer(m, { type: "resume" }, N)).toEqual(open(2));
    expect(tourReducer(CLOSED, { type: "minimize" }, N)).toBe(CLOSED);
    expect(tourReducer(CLOSED, { type: "resume" }, N)).toBe(CLOSED);
    expect(tourReducer(m, { type: "close" }, N)).toEqual(CLOSED);
    expect(tourReducer(open(1), { type: "start" }, 0)).toEqual(CLOSED);
  });
});

describe("A10 stored tour state", () => {
  it("A10 round-trips open and minimized; closed removes the key", () => {
    expect(serialize(CLOSED)).toBeNull();
    for (const s of [open(3), { mode: "minimized", step: 6 } as TourState]) expect(parseStored(serialize(s), N)).toEqual(s);
  });
  it("A10 malformed, foreign or out-of-range values read as closed", () => {
    for (const raw of [null, undefined, "", "{", "[]", "null", '{"v":2,"mode":"open","step":1}', '{"v":1,"mode":"wide","step":1}', '{"v":1,"mode":"open","step":1.5}', '{"v":1,"mode":"open","step":-1}', `{"v":1,"mode":"open","step":${N}}`, '{"v":1,"mode":"open","step":"2"}']) {
      expect(parseStored(raw, N)).toEqual(CLOSED);
    }
    expect(parseStored(serialize(open(2)), 0)).toEqual(CLOSED);
  });
});

describe("A10 focus trap", () => {
  it("A10 Tab wraps from the last element to the first, Shift+Tab from the first to the last", () => {
    expect(trapTarget(4, 5, false)).toBe(0);
    expect(trapTarget(0, 5, true)).toBe(4);
    expect(trapTarget(1, 5, false)).toBe(2);
    expect(trapTarget(1, 5, true)).toBe(0);
  });
  it("A10 focus on the dialog or heading (index -1) enters at the first or last element", () => {
    expect(trapTarget(-1, 5, false)).toBe(0);
    expect(trapTarget(-1, 5, true)).toBe(4);
    expect(trapTarget(-1, 0, false)).toBe(-1);
  });
  it("A10 only moves that would leave the dialog are taken over", () => {
    expect(tabLeaves(4, 5, false)).toBe(true);
    expect(tabLeaves(0, 5, true)).toBe(true);
    expect(tabLeaves(2, 5, false)).toBe(false);
    expect(tabLeaves(2, 5, true)).toBe(false);
    expect(tabLeaves(-1, 5, false)).toBe(true);
    expect(tabLeaves(0, 0, false)).toBe(true);
  });
  it("A10 step label", () => { expect(stepLabel(2, 8)).toBe("Step 3 of 8"); });
});

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

describe("A10 shared tour store", () => {
  it("A10 the first mounted instance hosts the overlay; the next takes over when it unmounts", () => {
    const s = createTourStore(N, () => null);
    expect(s.host()).toBe("");
    const offA = s.register("a"), offB = s.register("b");
    expect(s.host()).toBe("a");
    offA();
    expect(s.host()).toBe("b");
    offB();
    expect(s.host()).toBe("");
  });
  it("A10 a shell mount (launcher off, in a layout) hosts even when a page launcher mounted first", () => {
    const s = createTourStore(N, () => null);
    const offPage = s.register("page", false), offShell = s.register("shell", true);
    expect(s.host()).toBe("shell");
    offPage();
    expect(s.host()).toBe("shell");
    offShell();
    expect(s.host()).toBe("");
  });
  it("A10 dispatch notifies subscribers once per real change and works without storage", () => {
    const s = createTourStore(N, () => null);
    let calls = 0;
    const off = s.subscribe(() => { calls++; });
    s.dispatch({ type: "start" });
    s.dispatch({ type: "prev" }); // no change at step 0
    s.dispatch({ type: "next" });
    expect(s.get()).toEqual(open(1));
    expect(calls).toBe(2);
    off();
    s.dispatch({ type: "close" });
    expect(calls).toBe(2);
    expect(s.get()).toEqual(CLOSED);
  });
  it("A10 the tour follows the judge across pages through sessionStorage, and ending it clears the key", () => {
    const mem = new MemoryStorage();
    const page1 = createTourStore(N, () => mem);
    page1.dispatch({ type: "go", step: 3 });
    page1.dispatch({ type: "minimize" });
    expect(JSON.parse(mem.getItem(STORAGE_KEY)!)).toMatchObject({ mode: "minimized", step: 3 });
    const page2 = createTourStore(N, () => mem); // a full page load in the same tab
    expect(page2.get()).toEqual({ mode: "minimized", step: 3 });
    page2.dispatch({ type: "close" });
    expect(mem.getItem(STORAGE_KEY)).toBeNull();
  });
  it("A10 a broken stored value starts closed", () => {
    const mem = new MemoryStorage();
    mem.setItem(STORAGE_KEY, "not json");
    expect(createTourStore(N, () => mem).get()).toEqual(CLOSED);
  });
});

/* ── step content ── */

describe("A10 tour steps", () => {
  it("A10 has 6 to 8 steps with unique ids and a 3-minute label", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(6);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(8);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    expect(TOUR_LABEL).toBe(`Take the ${TOUR_MINUTES}-minute tour`);
  });
  it("A10 walks every playground scenario S1–S7, in order", () => {
    const seen = TOUR_STEPS.flatMap((s) => s.scenarios);
    expect(seen).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
    for (const s of TOUR_STEPS.filter((x) => x.scenarios.length)) expect(s.go.href).toBe("/playground");
  });
  it("A10 every step links to a route that exists in the app", () => {
    const all = appRoutes();
    for (const s of TOUR_STEPS) for (const l of [s.go, ...(s.also ? [s.also] : [])]) {
      expect(l.href.startsWith("/"), `${s.id}: ${l.href}`).toBe(true);
      expect(routeExists(l.href, all), `${s.id}: ${l.href} has no page`).toBe(true);
    }
  });
  it("A10 P10 every step is plain, complete and free of guarantee language", () => {
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(5);
      expect(s.body.length).toBeGreaterThan(60);
      expect(s.look.length).toBeGreaterThanOrEqual(2);
      const text = [s.tag, s.title, s.body, ...s.look, s.go.label, s.also?.label ?? ""].join(" ");
      expect(text).not.toMatch(/guarantee|risk[- ]free|100\s*%|irreversible|bank[- ]grade/i);
    }
  });
});
