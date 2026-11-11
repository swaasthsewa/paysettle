"use client";
/**
 * F3 · the only client code on the landing page. The sections arrive from the server in their final state; this turns
 * them into scroll scenes with CSS transitions and one IntersectionObserver (no animation library).
 *
 *   moving  motion allowed: scenes still below the screen when the page opens wait (data-wait); each plays its
 *           entrance as it arrives, and parts marked data-depth drift at their own speed as the page scrolls (parallax).
 *   still   reduced motion, the staff motion setting at calm or off, or no script: nothing runs and every scene
 *           stays in its final, readable state.
 *
 * gsap ScrollTrigger pinning is not used; this is the motion layer, and it degrades the same way.
 */
import { useEffect, useRef, type ReactNode } from "react";

export function Motion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const level = document.documentElement.dataset.motion;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (level === "calm" || level === "off" || calm.matches || !("IntersectionObserver" in window)) return;

    root.classList.add("lp-moving");
    const fold = window.innerHeight;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        delete (e.target as HTMLElement).dataset.wait;
        io.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.05 });
    for (const el of root.querySelectorAll<HTMLElement>("[data-scene]:not([data-scene='hero'])")) {
      if (el.getBoundingClientRect().top > fold * 0.92) { el.dataset.wait = ""; io.observe(el); }
    }

    /* parallax: a part marked data-depth drifts against the scroll by its depth (a fraction of its distance from the
       middle of the screen), so the illustrations sit on a different plane from the text */
    const deep = Array.from(root.querySelectorAll<HTMLElement>("[data-depth]"));
    let frame = 0;
    const paint = () => {
      frame = 0;
      const mid = window.innerHeight / 2;
      for (const el of deep) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > window.innerHeight + 200) continue;
        const was = Number(el.dataset.ty) || 0; // measure where the part sits without its own drift
        const ty = (r.top - was + r.height / 2 - mid) * (Number(el.dataset.depth) || 0);
        el.dataset.ty = ty.toFixed(1);
        el.style.translate = `0 ${ty.toFixed(1)}px`;
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(paint); };
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });

    /* someone switches reduced motion on while reading: show everything at once */
    const stop = () => { if (!calm.matches) return; root.classList.remove("lp-moving"); root.querySelectorAll<HTMLElement>("[data-wait]").forEach((el) => delete el.dataset.wait); };
    calm.addEventListener("change", stop);

    return () => {
      io.disconnect();
      for (const el of deep) el.style.translate = "";
      window.removeEventListener("scroll", onScroll);
      calm.removeEventListener("change", stop);
      if (frame) cancelAnimationFrame(frame);
      root.classList.remove("lp-moving");
    };
  }, []);

  return <main ref={ref} id="page" className="lp" tabIndex={-1}>{children}</main>;
}
