"use client";
/* A thin reading-progress bar at the top of an article. Decorative (aria-hidden): the contents list and the
 * headings carry the structure. Measures the article element only, so footnotes and related posts do not count. */
import { useEffect, useRef } from "react";

export function ReadingProgress({ target = "article" }: { target?: string }) {
  const bar = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const a = document.querySelector<HTMLElement>(target);
        if (!a) return;
        const r = a.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        const done = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : r.top <= 0 ? 1 : 0;
        el.style.transform = `scaleX(${done.toFixed(4)})`;
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); cancelAnimationFrame(raf); };
  }, [target]);
  return <div className="bl-progress" aria-hidden="true"><span ref={bar} /></div>;
}
export default ReadingProgress;
