/**
 * Money rules. Integer cents and basis points only — never floating point in money paths.
 */
export const BPS_FULL = 10_000;

/** Largest-remainder split of `totalCents` by basis points. Leftover cents go to the largest fractional parts; ties to the later item. */
export function splitByBps(totalCents: number, bps: number[]): number[] {
  assertInt(totalCents, "totalCents");
  const sum = bps.reduce((a, b) => a + b, 0);
  if (sum === 0) return bps.map(() => 0);
  const exact = bps.map((b) => (totalCents * b) / sum);
  const floors = exact.map(Math.floor);
  let left = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || b.i - a.i);
  for (const o of order) { if (left <= 0) break; floors[o.i] += 1; left -= 1; }
  return floors;
}

/** Round half to even on a value in cents × 10,000 (exact integer arithmetic). */
function roundHalfEven(numerator: number, denominator: number): number {
  const q = Math.floor(numerator / denominator);
  const r = numerator - q * denominator;
  const twice = 2 * r;
  if (twice > denominator) return q + 1;
  if (twice < denominator) return q;
  return q % 2 === 0 ? q : q + 1;
}

/** Platform fee for one release: round_half_even(amount × feeBps / 10,000). */
export function feeFor(amountCents: number, feeBps: number): number {
  assertInt(amountCents, "amountCents"); assertInt(feeBps, "feeBps");
  return roundHalfEven(amountCents * feeBps, BPS_FULL);
}

/** Split a disputed amount: refund rounds half up toward the client, release is the rest — never exceeds the amount. */
export function splitDispute(amountCents: number, providerShareBps: number): { refundCents: number; releaseCents: number } {
  assertInt(amountCents, "amountCents");
  if (providerShareBps < 0 || providerShareBps > BPS_FULL) throw new RangeError("providerShareBps out of range");
  const clientBps = BPS_FULL - providerShareBps;
  const refundCents = Math.floor((amountCents * clientBps + BPS_FULL / 2) / BPS_FULL);
  return { refundCents, releaseCents: amountCents - refundCents };
}

export function formatCents(c: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(c / 100);
}
export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

function assertInt(n: number, name: string) {
  if (!Number.isSafeInteger(n)) throw new TypeError(`${name} must be a safe integer (cents/bps), got ${n}`);
}
