"use client";
/**
 * Light, dark, or as the device is set. The choice is kept on this device (localStorage) and put on
 * <html data-theme> before the page is drawn (THEME_BOOT, in the root layout), so the page never flashes the other way.
 * The colours for both are already in the styles (app/globals.css and the Look and feel room's tokens).
 *  - ThemeToggle: one press between light and dark, in the top bars.
 *  - ThemeChoice: the three choices, on Your account.
 */
import { useSyncExternalStore } from "react";
import { common } from "@/copy/common";

const KEY = "ps.theme", EVENT = "ps-theme";
export type Theme = "light" | "dark" | "auto";
export const THEME_BOOT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const subscribe = (changed: () => void) => {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(EVENT, changed); mq.addEventListener("change", changed);
  return () => { window.removeEventListener(EVENT, changed); mq.removeEventListener("change", changed); };
};
const chosen = (): Theme => { const t = document.documentElement.dataset.theme; return t === "light" || t === "dark" ? t : "auto"; };
const shown = (): "light" | "dark" => { const t = chosen(); return t === "auto" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t; };

export function setTheme(t: Theme) {
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* private window: the choice lasts for this page */ }
  window.dispatchEvent(new Event(EVENT));
}

const Sun = () => <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />;
const Moon = () => <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />;

/** One press between light and dark. Shows what a press gives: the moon while light, the sun while dark. */
export function ThemeToggle({ className = "tb-btn tb-theme" }: { className?: string }) {
  const now = useSyncExternalStore(subscribe, shown, () => "light" as const);
  const next = now === "dark" ? "light" : "dark";
  return (
    <button type="button" className={className} onClick={() => setTheme(next)} aria-label={(next === "dark" ? "Switch to dark" : "Switch to light")} title={(next === "dark" ? "Switch to dark" : "Switch to light")}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">{now === "dark" ? <Sun /> : <Moon />}</svg>
    </button>
  );
}

/** Light, dark or automatic, as three buttons. */
export function ThemeChoice() {
  const t = useSyncExternalStore(subscribe, chosen, () => "auto" as const);
  const w = common.shell.theme;
  return (
    <div className="theme-choice" role="radiogroup" aria-label={w.label}>
      {(["light", "dark", "auto"] as const).map((k) => (
        <button key={k} type="button" role="radio" aria-checked={t === k} onClick={() => setTheme(k)}>{({ light: w.light, dark: w.dark, auto: w.system })[k]}</button>
      ))}
    </div>
  );
}
