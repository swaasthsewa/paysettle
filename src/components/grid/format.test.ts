/** F5.01 F5.04 F3.11 — pure helpers behind the AG Grid console tables. */
import { describe, expect, it } from "vitest";
import { centsToDecimal, compareCells, groupWithSubtotals, matchesQuick, money, regroupSorted, shortHash, signedMoney, stateChip, sumColumns, textOf, type Row } from "./format";

describe("F5.01 grid money formatting", () => {
  it("F5.01 formats integer cents as currency, negative with a real minus sign", () => {
    expect(money(212500)).toBe("$2,125.00");
    expect(money(-4000)).toBe("−$40.00");
    expect(money(null)).toBe("");
    expect(signedMoney(500)).toBe("+$5.00");
    expect(signedMoney(-500)).toBe("−$5.00");
    expect(signedMoney(0)).toBe("$0.00");
  });
  it("F5.01 CSV decimals come from integer arithmetic (no float drift)", () => {
    expect(centsToDecimal(212500)).toBe("2125.00");
    expect(centsToDecimal(7)).toBe("0.07");
    expect(centsToDecimal(-1999)).toBe("-19.99");
    expect(centsToDecimal(undefined)).toBe("");
  });
});

describe("F5.04 grid cells", () => {
  it("F5.04 reads text out of every cell shape and shortens hashes", () => {
    expect(textOf({ label: "Open", href: "/x" })).toBe("Open");
    expect(textOf({ hash: "abc" })).toBe("abc");
    expect(textOf(true)).toBe("Yes");
    expect(shortHash("0123456789abcdef", 8)).toBe("01234567…");
    expect(shortHash("abc")).toBe("abc");
  });
  it("F5.04 sorts numbers numerically, dates by time, blanks last in both directions", () => {
    expect(compareCells(9, 10, "money")).toBe(-1);
    expect(compareCells("2026-11-02T00:00:00Z", "2026-11-01T00:00:00Z", "date")).toBe(1);
    expect(compareCells(null, 1, "number")).toBe(1);
    expect(compareCells(null, 1, "number", true)).toBe(-1); // the grid reverses descending results, so blanks stay last
    expect(compareCells(null, "", "text")).toBe(0);
    expect(compareCells("M10", "M9")).toBe(1);
  });
  it("F5.04 quick filter needs every word somewhere in the row", () => {
    const r: Row = { a: "Booking web app", b: { label: "Released", tone: "ok" } };
    expect(matchesQuick(r, ["a", "b"], "booking released")).toBe(true);
    expect(matchesQuick(r, ["a", "b"], "booking refund")).toBe(false);
    expect(matchesQuick(r, ["a", "b"], "  ")).toBe(true);
  });
  it("F5.04 maps ledger types and states to the shared state chips", () => {
    expect(stateChip("HOLD")).toEqual({ cls: "state held", label: "Hold" });
    expect(stateChip("SOMETHING_NEW")).toEqual({ cls: "state draft", label: "Something new" });
  });
});

describe("F3.11 group by tranche with subtotals", () => {
  const rows: Row[] = [
    { id: 1, tr: "t1", name: "Tranche 1", amt: 100, eff: 100 },
    { id: 2, tr: "t2", name: "Tranche 2", amt: 50, eff: 50 },
    { id: 3, tr: "t1", name: "Tranche 1", amt: 30, eff: -30 },
  ];
  it("F3.11 gathers members under their tranche and appends one subtotal per tranche", () => {
    const g = groupWithSubtotals(rows, { field: "tr", labelField: "name", labelInto: "id", sumFields: ["amt", "eff"], extra: (k) => ({ ok: k === "t1" }) });
    expect(g.map((r) => r.__id ?? r.id)).toEqual([1, 3, "__sub:t1", 2, "__sub:t2"]);
    const s1 = g[2];
    expect(s1).toMatchObject({ amt: 130, eff: 70, id: "Subtotal · Tranche 1", __kind: "subtotal", __count: 2, ok: true });
    expect(g[4]).toMatchObject({ amt: 50, eff: 50, ok: false });
  });
  it("F3.11 totals skip subtotal rows so nothing is counted twice", () => {
    const g = groupWithSubtotals(rows, { field: "tr", labelInto: "id", sumFields: ["amt"] });
    expect(sumColumns(g, ["amt"])).toEqual({ amt: 180 });
  });
  it("F3.11 keeps groups together after the grid sorts, subtotal last", () => {
    const g = groupWithSubtotals(rows, { field: "tr", labelInto: "id", sumFields: ["amt"] });
    const sorted = [...g].sort((a, b) => Number(b.amt) - Number(a.amt)); // sub t1 (130), 1 (100), 2 (50), sub t2 (50), 3 (30)
    regroupSorted(sorted, (r) => r.__group as string, (r) => r.__kind === "subtotal");
    expect(sorted.map((r) => r.__id ?? r.id)).toEqual([1, 3, "__sub:t1", 2, "__sub:t2"]);
  });
});
