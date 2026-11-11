"use client";
/**
 * F3 · a quiet reveal on scroll for every .s-reveal element of the short pages.
 * Nothing is hidden until the reader first scrolls; then the elements still below the screen are hidden and rise in
 * as they arrive. So the page is whole without scripts, in print, and under reduced motion (then this does nothing).
 */
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function Reveal() {
  const path = usePathname();
  useEffect(() => {
    const motion = document.documentElement.dataset.motion;
    if (motion === "calm" || motion === "off" || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let io: IntersectionObserver | null = null;
    const arm = () => {
      window.removeEventListener("scroll", arm);
      io = new IntersectionObserver((entries) => {
        let n = 0;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.style.transitionDelay = `${Math.min(n++, 5) * 70}ms`;
          el.classList.add("in");
          io?.unobserve(el);
        }
      }, { rootMargin: "0px 0px -6% 0px", threshold: 0 });
      const fold = window.innerHeight;
      for (const el of document.querySelectorAll<HTMLElement>(".s-reveal:not(.pre)")) {
        if (el.getBoundingClientRect().top > fold) { el.classList.add("pre"); io.observe(el); }
      }
    };
    window.addEventListener("scroll", arm, { passive: true });
    return () => { window.removeEventListener("scroll", arm); io?.disconnect(); };
  }, [path]);
  return null;
}
