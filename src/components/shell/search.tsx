"use client";
/**
 * Search in the top bar: games, exercises, check-ups and the app's pages, as the person types. The list is read from
 * the server once, when the search first opens (/api/search); the matching is done here. On a wide screen it is a
 * field with a drop-down; on a phone a button that opens it over the whole screen. "/" or Ctrl+K opens it from anywhere.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { common } from "@/copy/common";
export interface SearchItem { kind: "page" | "contract"; label: string; hint?: string; href: string; switchTo?: string }
import { NavIcon } from "./icons";

const s = common.shell.search;
const ORDER = ["contract", "page"] as const;
const words = (q: string) => q.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Items whose name has every typed word at the start of one of its words; then those whose description has them. */
export function match(items: readonly SearchItem[], q: string, take = 24): SearchItem[] {
  const want = words(q);
  if (!want.length) return [];
  const starts = (text: string) => { const have = words(text); return want.every((w) => have.some((h) => h.startsWith(w))); };
  const byName = items.filter((i) => starts(i.label));
  const byHint = items.filter((i) => !byName.includes(i) && i.hint && starts(`${i.label} ${i.hint}`));
  return [...byName, ...byHint].slice(0, take);
}

export function AppSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [at, setAt] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (items) return;
    fetch("/api/search", { headers: { "x-paysettle-search": "1" } }).then((r) => (r.ok ? r.json() : { items: [] })).then((b: { items: SearchItem[] }) => setItems(b.items)).catch(() => setItems([]));
  }, [items]);
  const show = useCallback(() => { setOpen(true); load(); requestAnimationFrame(() => field.current?.focus()); }, [load]);
  const hide = useCallback(() => { setOpen(false); setQ(""); setAt(0); }, []);

  const found = useMemo(() => match(items ?? [], q), [items, q]);
  const grouped = useMemo(() => ORDER.map((k) => ({ k, list: found.filter((f) => f.kind === k) })).filter((g) => g.list.length), [found]);
  const flat = grouped.flatMap((g) => g.list);

  const go = useCallback((i: SearchItem | undefined) => {
    if (!i) return;
    hide();
    router.push(i.href);
  }, [hide, router]);

  /* "/" or Ctrl+K opens the search; a click outside closes it */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); show(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [show]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) hide(); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, hide]);

  return (
    <div className="tb-search" ref={box} data-open={open || undefined}>
      <button type="button" className="tb-btn tb-search-btn" onClick={show} aria-label={s.open} title={s.open}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M15 15l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
      <div className="tb-search-box" role="search">
        <svg className="tb-search-glass" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M15 15l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <input
          ref={field} type="search" value={q} placeholder={s.placeholder} aria-label={s.label} autoComplete="off" enterKeyHint="go"
          role="combobox" aria-expanded={open && !!q} aria-controls="tb-search-list" aria-activedescendant={flat[at] ? `tb-s-${at}` : undefined}
          onFocus={() => { setOpen(true); load(); }}
          onChange={(e) => { setQ(e.target.value); setAt(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { hide(); field.current?.blur(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(flat.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); go(flat[at]); }
          }}
        />
        <kbd className="tb-kbd" aria-hidden="true">/</kbd>
        <button type="button" className="tb-search-close" onClick={hide}>{s.close}</button>
      </div>
      {open && (
        <div className="tb-results" id="tb-search-list" role="listbox" aria-label={s.label}>
          {!q.trim() ? <p className="tb-empty">{s.hint}</p>
            : !flat.length ? <p className="tb-empty">{items ? s.none : "…"}</p>
            : grouped.map((g) => (
              <div key={g.k} className="tb-group">
                <p className="tb-group-title">{g.k === "contract" ? "Contracts" : s.groups.pages}</p>
                {g.list.map((i) => {
                  const n = flat.indexOf(i);
                  return (
                    <a key={i.switchTo ?? i.href} id={`tb-s-${n}`} role="option" aria-selected={n === at} href={i.href} className="tb-item"
                      onMouseEnter={() => setAt(n)} onClick={(e) => { e.preventDefault(); go(i); }}>
                      <span className="tb-item-icon">{i.switchTo ? <b aria-hidden="true">{i.label.slice(0, 1).toUpperCase()}</b> : <NavIcon href={i.href} />}</span>
                      <span className="tb-item-text"><b>{i.label}</b>{i.hint && <small>{i.hint}</small>}</span>
                    </a>
                  );
                })}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
