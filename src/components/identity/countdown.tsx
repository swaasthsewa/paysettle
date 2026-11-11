"use client";
/**
 * F3.06 review clock, shown on the overviews · a countdown to a due time on the contract's virtual clock.
 * The server passes the due time, its own "now" on the virtual clock and the real time it read, so the first
 * render matches on both sides; after that it ticks every 30 seconds.
 */
import { useEffect, useState } from "react";
import { dueText } from "./time";

export function Countdown({ dueMs, virtualNowMs, realNowMs, label }: { dueMs: number; virtualNowMs: number; realNowMs: number; label?: string }) {
  const skew = virtualNowMs - realNowMs;
  const [now, setNow] = useState(virtualNowMs);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + skew), 30_000);
    return () => window.clearInterval(id);
  }, [skew]);
  const left = dueMs - now;
  return (
    <span className="id-due" data-late={left < 0 ? "" : undefined} title={label}>
      <span className="sr-only">{label ? `${label}: ` : ""}</span>{dueText(left)}
    </span>
  );
}
