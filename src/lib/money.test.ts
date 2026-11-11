import { describe, expect, it } from "vitest";
import { feeFor, splitByBps, splitDispute } from "./money";

describe("money", () => {
  it("largest remainder: $1,000 in three equal parts → 333.33/333.33/333.34", () => {
    expect(splitByBps(100_000, [3333, 3333, 3334])).toEqual([33_330, 33_330, 33_340]);
    expect(splitByBps(99_999, [1, 1, 1])).toEqual([33_333, 33_333, 33_333]);
    expect(splitByBps(100_000, [1, 1, 1])).toEqual([33_333, 33_333, 33_334]);
  });
  it("split always sums to the total", () => {
    for (let t = 1; t < 5_000; t += 37) {
      const parts = splitByBps(t, [1700, 2300, 1000, 5000]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(t);
    }
  });
  it("fee uses half-even worked example", () => {
    const gross = splitByBps(850_000, [1000, 2500, 3000, 2000, 1500]);
    expect(gross).toEqual([85_000, 212_500, 255_000, 170_000, 127_500]);
    const fees = gross.map((g) => feeFor(g, 250));
    expect(fees).toEqual([2125, 5312, 6375, 4250, 3188]);
    expect(fees.reduce((a, b) => a + b, 0)).toBe(21_250);
  });
  it("dispute split never exceeds the disputed amount", () => {
    expect(splitDispute(200_000, 7500)).toEqual({ refundCents: 50_000, releaseCents: 150_000 });
    expect(splitDispute(101, 5000)).toEqual({ refundCents: 51, releaseCents: 50 });
    for (let s = 0; s <= 10_000; s += 125) {
      const r = splitDispute(99_999, s);
      expect(r.refundCents + r.releaseCents).toBe(99_999);
    }
  });
  it("rejects floats", () => { expect(() => feeFor(10.5, 250)).toThrow(); });
});
