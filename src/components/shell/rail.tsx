"use client";
/**
 * The button that folds the sidebar into a rail of pictures and opens it again. The choice is kept on this device
 * (localStorage) and set on <html data-rail="on"> before the page is drawn (RAIL_BOOT), so a folded menu never flashes open.
 */
import { useSyncExternalStore } from "react";
import { common } from "@/copy/common";

const KEY = "ps.rail", EVENT = "ps-rail";
/** Runs before the page is drawn: puts the remembered choice on <html>. */
export const RAIL_BOOT = `try{if(localStorage.getItem("${KEY}")==="on")document.documentElement.dataset.rail="on"}catch(e){}`;

const subscribe = (changed: () => void) => { window.addEventListener(EVENT, changed); return () => window.removeEventListener(EVENT, changed); };
const folded = () => document.documentElement.dataset.rail === "on";

export function RailToggle() {
  const on = useSyncExternalStore(subscribe, folded, () => false);
  const flip = () => {
    const next = !folded();
    if (next) document.documentElement.dataset.rail = "on"; else delete document.documentElement.dataset.rail;
    try { localStorage.setItem(KEY, next ? "on" : "off"); } catch { /* private window: the choice lasts for this page */ }
    window.dispatchEvent(new Event(EVENT));
  };
  const s = common.shell;
  return (
    <button type="button" className="tb-btn tb-rail" onClick={flip} aria-pressed={on} aria-label={on ? s.expand : s.collapse} title={on ? s.expand : s.collapse}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <rect x="3.5" y="5" width="17" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M9.5 5v14" stroke="currentColor" strokeWidth="1.7" />
        <path d={on ? "M13.5 10l2 2-2 2" : "M16 10l-2 2 2 2"} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
