"use client";
/* Plays each block's chosen motion (data-anim on .bl-b) as it scrolls into view. Built on the
 * site's rule (see REUSE.md): nothing is hidden at first paint. Only blocks still below
 * the fold when the page settles are hidden ("pre") and then rise in; blocks already on screen stay put.
 * Off entirely under prefers-reduced-motion, the app's calm/off motion setting, or without IntersectionObserver —
 * then every block simply rests in its final state. countUp counts the figures of a block once (visual copy only;
 * screen readers read the final value from a hidden twin). */
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const NUM = /^(\D*?)(\d[\d,]*(?:\.\d+)?)([^]*)$/;

function countUp(scope: HTMLElement) {
  for (const el of scope.querySelectorAll<HTMLElement>("[data-count]")) {
    const final = el.dataset.final ?? el.textContent ?? "";
    el.dataset.final = final;
    const m = NUM.exec(final);
    if (!m) continue;
    const [, pre, num, post] = m;
    const decimals = num.includes(".") ? num.split(".")[1].length : 0;
    const target = Number(num.replace(/,/g, ""));
    if (!Number.isFinite(target) || target === 0) continue;
    const grouped = num.includes(",");
    const fmt = (v: number) => {
      const s = v.toFixed(decimals);
      return grouped ? Number(s).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s;
    };
    const t0 = performance.now(), ms = 900;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = k >= 1 ? final : `${pre}${fmt(target * eased)}${post}`;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

export function BlogReveal({ replayKey = 0 }: { replayKey?: number }) {
  const path = usePathname();
  useEffect(() => {
    const motion = document.documentElement.dataset.motion;
    if (motion === "calm" || motion === "off" || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const blocks = Array.from(document.querySelectorAll<HTMLElement>(".bl-b[data-anim]:not([data-anim='none'])"));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        el.classList.add("in");
        if (el.dataset.anim === "countUp") countUp(el);
        io.unobserve(el);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    const fold = window.innerHeight;
    for (const el of blocks) {
      el.classList.remove("in");
      if (replayKey > 0 || el.getBoundingClientRect().top > fold) { el.classList.add("pre"); io.observe(el); }
    }
    return () => io.disconnect();
  }, [path, replayKey]);
  return null;
}
export default BlogReveal;
