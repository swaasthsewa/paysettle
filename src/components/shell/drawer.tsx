"use client";
/**
 * Phone and narrow tablet: the button that opens the sidebar as a drawer over the page. On a wide screen it is hidden
 * (the sidebar is always there). The open state lives on <html data-drawer="open">, because the sidebar is a sibling of
 * the top bar, not its child; the drawer closes on a new page, Escape, or a tap outside it.
 */
import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { common } from "@/copy/common";

const EVENT = "ps-drawer";
const subscribe = (changed: () => void) => { window.addEventListener(EVENT, changed); return () => window.removeEventListener(EVENT, changed); };
const isOpen = () => document.documentElement.dataset.drawer === "open";
const set = (open: boolean) => {
  if (open) document.documentElement.dataset.drawer = "open"; else delete document.documentElement.dataset.drawer;
  window.dispatchEvent(new Event(EVENT));
};

export function DrawerToggle() {
  const open = useSyncExternalStore(subscribe, isOpen, () => false);
  const path = usePathname();
  useEffect(() => { set(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { set(false); document.querySelector<HTMLElement>(".tb-drawer")?.focus(); } };
    const onTap = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && !t.closest(".side") && !t.closest(".tb-drawer")) set(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onTap);
    document.querySelector<HTMLElement>(".side a")?.focus({ preventScroll: true });
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onTap); };
  }, [open]);
  const s = common.shell;
  return (
    <button type="button" className="tb-btn tb-drawer" aria-expanded={open} aria-controls="app-side" aria-label={open ? s.closeMenu : s.openMenu} onClick={() => set(!open)}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        {open
          ? <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          : <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
      </svg>
    </button>
  );
}
