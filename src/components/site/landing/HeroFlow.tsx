"use client";
/**
 * F3 · mounts the hero's settlement field (settle-field.ts) once the page has loaded and the browser is idle, so the
 * canvas never competes with the heading for the first paint. The heading and copy are server-rendered.
 */
import { useEffect, useRef } from "react";
import { startSettleField, type SettleField } from "./settle-field";

export function HeroFlow() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false, idle = 0, field: SettleField | null = null;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    const run = () => { if (!cancelled && ref.current) field = startSettleField(ref.current); };
    const begin = () => { idle = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 900 }) : window.setTimeout(run, 150); };
    if (document.readyState === "complete") begin(); else window.addEventListener("load", begin, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", begin);
      if (w.cancelIdleCallback) w.cancelIdleCallback(idle); else window.clearTimeout(idle);
      field?.destroy();
    };
  }, []);
  return <canvas ref={ref} className="lp2-canvas" aria-hidden="true" />;
}
