// F3 waitlist, F1.1 · IDENTITY — a small fixed-window rate limiter kept in memory, keyed by IP address.
// Good enough for one server process (the hackathon deployment); a shared store is needed behind several instances.
// Pure apart from its own map: the caller passes the time.

export interface Limiter { hit(key: string, nowMs: number): { ok: boolean; remaining: number; retryAfterS: number }; reset(): void }

export function fixedWindow(limit: number, windowMs: number, maxKeys = 10_000): Limiter {
  const seen = new Map<string, { start: number; n: number }>();
  return {
    hit(key, nowMs) {
      let w = seen.get(key);
      if (!w || nowMs - w.start >= windowMs) {
        if (!w && seen.size >= maxKeys) { const first = seen.keys().next().value; if (first !== undefined) seen.delete(first); }
        w = { start: nowMs, n: 0 }; seen.set(key, w);
      }
      w.n += 1;
      const ok = w.n <= limit;
      return { ok, remaining: Math.max(0, limit - w.n), retryAfterS: ok ? 0 : Math.ceil((w.start + windowMs - nowMs) / 1000) };
    },
    reset() { seen.clear(); },
  };
}
