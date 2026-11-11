/**
 * Waitlist / NFR abuse limits: the key a per-client rate limit counts against.
 * Assumption (documented): PaySettle runs behind exactly one hosting proxy (the platform's edge / load balancer) that
 * APPENDS the connecting address to X-Forwarded-For. Everything to the left of that last hop was sent by the client and
 * can be forged, so only the rightmost hop is trusted. With no header (local `next start`, tests) every caller shares
 * the key "local". If a second trusted proxy is ever added in front, this must skip that many hops from the right.
 */
export function rateLimitKey(h: Pick<Headers, "get">): string {
  const hops = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const last = hops[hops.length - 1];
  return last && last.length <= 64 ? last : "local";
}
