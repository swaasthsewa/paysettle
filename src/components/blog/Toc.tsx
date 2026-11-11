"use client";
/* "On this page": the article's headings as links. The section being read is marked aria-current="location"
 * (and visually), updated by an IntersectionObserver; without scripts it is a plain list of links. */
import { useEffect, useState } from "react";

export interface TocItem { id: string; text: string; level: 2 | 3 }

export function Toc({ items, title = "On this page" }: { items: TocItem[]; title?: string }) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (!items.length || !("IntersectionObserver" in window)) return;
    const els = items.map((i) => document.getElementById(i.id)).filter((x): x is HTMLElement => Boolean(x));
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const firstVisible = items.find((i) => seen.get(i.id));
      if (firstVisible) { setActive(firstVisible.id); return; }
      const above = els.filter((el) => el.getBoundingClientRect().top < 0).pop();
      if (above) setActive(above.id);
    }, { rootMargin: "-72px 0px -55% 0px", threshold: 0 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);
  if (items.length < 2) return null;
  return (
    <nav className="bl-toc" aria-labelledby="bl-toc-h">
      <p id="bl-toc-h" className="bl-toc-t">{title}</p>
      <ol>
        {items.map((i) => (
          <li key={i.id} data-l={i.level}>
            <a href={`#${i.id}`} aria-current={active === i.id ? "location" : undefined}>{i.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
export default Toc;
