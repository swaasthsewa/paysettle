"use client";
/**
 * F3 · the site navigation: the mark, the page links, the theme switch and sign-in or "Open the app".
 * One list of links serves both layouts. On a wide screen it sits in the bar; on a phone it is a menu the button opens.
 * Closed, the menu is display: none, so it is out of the tab order. Escape closes it and returns focus to the button.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand";
import { ThemeChoice, ThemeToggle } from "@/components/shell/theme";
import { common } from "@/copy/common";
import { site as t } from "@/copy/site";

const MENU_ID = "site-menu";

const ICON: Record<string, string> = {
  "/how-it-works": "M5 6h6v5H5zM13 13h6v5h-6zM8 11v4h5M16 13V9h-5",
  "/for-providers": "M4 9h16v10H4zM9 9V6h6v3M4 13h16",
  "/for-clients": "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM4.5 20a7.5 7.5 0 0 1 15 0",
  "/security": "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM9 12l2 2 4-4",
  "/pricing": "M4 12V5h7l9 9-7 7zM8 8h.01",
  "/blog": "M5 4h11l3 3v13H5zM8 9h8M8 13h8M8 17h5",
};
const Icon = ({ href }: { href: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d={ICON[href] ?? "M12 11a1 1 0 1 0 0 2"} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function SiteNav({ home }: { home: string | null }) {
  const path = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const burger = useRef<HTMLButtonElement>(null);

  /* the hairline under the bar appears once the page has moved; written to the element, no re-render on scroll */
  useEffect(() => {
    const on = () => { if (bar.current) bar.current.dataset.scrolled = String(window.scrollY > 8); };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (bar.current && !bar.current.contains(e.target as Node)) setOpen(false); };
    const root = document.documentElement, was = root.style.overflow;
    root.style.overflow = "hidden";
    document.addEventListener("pointerdown", away);
    return () => { document.removeEventListener("pointerdown", away); root.style.overflow = was; };
  }, [open]);

  const close = () => setOpen(false);
  const current = (href: string) => (path === href || path.startsWith(href + "/") ? ("page" as const) : undefined);

  return (
    <header ref={bar} className="s-nav" data-open={open} onKeyDown={(e) => { if (e.key === "Escape" && open) { setOpen(false); burger.current?.focus(); } }}>
      <a className="skip" href="#page">{common.nav.skip}</a>
      <Link className="s-logo" href="/" aria-label={t.logoLabel} onClick={close}><BrandMark />{t.name}</Link>
      <button ref={burger} type="button" className="s-burger" aria-expanded={open} aria-controls={MENU_ID} aria-label={open ? t.nav.closeMenu : t.nav.openMenu} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M4 4l10 10M14 4L4 14" /> : <path d="M2.5 5h13M2.5 9h13M2.5 13h13" />}
        </svg>
      </button>
      <nav id={MENU_ID} className="s-links" aria-label={t.nav.label} data-open={open}>
        {t.nav.links.map((l) => (
          <Link key={l.href} href={l.href} aria-current={current(l.href)} onClick={close}>
            <span className="s-link-icon"><Icon href={l.href} /></span>
            <span className="s-link-words"><span className="s-link-label">{l.label}</span><span className="s-link-text">{l.text}</span></span>
          </Link>
        ))}
        <div className="s-menu-theme"><span>{common.shell.theme.label}</span><ThemeChoice /></div>
        <div className="s-menu-actions">
          {home
            ? <Link className="btn btn-d" href={home} onClick={close}>{t.nav.openApp}</Link>
            : <><Link className="btn" href="/login" onClick={close}>{t.nav.signIn}</Link><Link className="btn btn-d" href="/login" onClick={close}>{t.nav.demo}</Link></>}
        </div>
      </nav>
      <div className="s-navr">
        <ThemeToggle className="s-theme" />
        {home
          ? <Link className="btn btn-d btn-sm" href={home}>{t.nav.openApp}</Link>
          : <><Link className="btn btn-gh btn-sm s-wide-only" href="/login">{t.nav.signIn}</Link><Link className="btn btn-d btn-sm" href="/login">{t.nav.demo}</Link></>}
      </div>
    </header>
  );
}
