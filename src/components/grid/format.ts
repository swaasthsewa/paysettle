/**
 * F5.01 F5.04 F3.11 — pure helpers behind the AG Grid console tables (no React, no AG Grid import, so they run in tests
 * and on the server). Money is always integer cents (P6); these helpers only format and add it up, never divide it.
 */
import { formatCents } from "@/lib/money";

export type Tone = "ok" | "warn" | "risk" | "danger" | "plain" | "none" | "grad";
export type HashStatus = "verified" | "linked" | "broken" | "unchecked";
export type CellValue =
  | string | number | boolean | null | undefined
  | { label: string; tone?: Tone }
  | { href: string; label: string }
  | { hash: string; prev?: string | null; status?: HashStatus };
export type Row = Record<string, CellValue>;

/** Internal row fields the grid adds (never sent by pages). */
export const KIND = "__kind";
export const GROUP = "__group";
export const COUNT = "__count";

export const isObj = (v: CellValue): v is Exclude<CellValue, string | number | boolean | null | undefined> => typeof v === "object" && v !== null;
export const isHash = (v: CellValue): v is { hash: string; prev?: string | null; status?: HashStatus } => isObj(v) && "hash" in v;

/** Text a person would read for a cell (filtering, CSV, sorting of objects). */
export function textOf(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (isHash(v)) return v.hash;
  if (isObj(v)) return v.label;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

const NUMERIC = new Set(["number", "money", "bps", "diff"]);
export const isNumericType = (t?: string) => !!t && NUMERIC.has(t);
export const isMoneyType = (t?: string) => t === "money" || t === "diff";

/** Comparable key: numbers stay numbers, dates become epoch ms, everything else lower-case text. */
export function sortKey(v: CellValue, type?: string): string | number {
  if (v === null || v === undefined || v === "") return isNumericType(type) || type === "date" ? -Infinity : "";
  if (isObj(v)) return textOf(v).toLowerCase();
  if (type === "date") return new Date(String(v)).getTime() || 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return Number(v);
  return isNumericType(type) && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v.toLowerCase();
}
const blank = (v: CellValue) => v === null || v === undefined || v === "";
/** Comparator for the grid. Blanks go last whichever way the column is sorted (pass the grid's isDescending). */
export function compareCells(a: CellValue, b: CellValue, type?: string, descending = false): number {
  if (blank(a) || blank(b)) return blank(a) && blank(b) ? 0 : (blank(a) ? 1 : -1) * (descending ? -1 : 1);
  const x = sortKey(a, type), y = sortKey(b, type);
  if (typeof x === "number" && typeof y === "number") return x === y ? 0 : x < y ? -1 : 1;
  return String(x).localeCompare(String(y), "en", { numeric: true });
}

/** "$2,125.00" (or "−$40.00"); blank for missing values. */
export function money(cents: CellValue, currency = "USD"): string {
  if (cents === null || cents === undefined || cents === "") return "";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return n < 0 ? `−${formatCents(-n, currency)}` : formatCents(n, currency);
}
/** Signed money for difference columns: "+$5.00", "−$5.00", "$0.00". */
export function signedMoney(cents: number, currency = "USD"): string {
  return cents > 0 ? `+${formatCents(cents, currency)}` : money(cents, currency);
}
/** Plain decimal for spreadsheets ("2125.00"), from integer cents without floating-point division. */
export function centsToDecimal(cents: CellValue): string {
  if (cents === null || cents === undefined || cents === "") return "";
  const n = Math.trunc(Number(cents));
  if (!Number.isFinite(n)) return "";
  const neg = n < 0, a = Math.abs(n);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
export const bpsText = (v: CellValue) => (v === null || v === undefined || v === "" ? "" : `${(Number(v) / 100).toFixed(2)}%`);
/** First n characters of a hash with an ellipsis; the full value stays in the title and the copy button. */
export const shortHash = (h: string, n = 10) => (h.length > n ? `${h.slice(0, n)}…` : h);

/** Case-insensitive quick filter: every word must appear somewhere in the row's readable text. */
export function matchesQuick(row: Row, fields: string[], needle: string): boolean {
  const words = needle.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.map((f) => textOf(row[f])).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}
export function matchesPicks(row: Row, picks: Record<string, string>): boolean {
  return Object.entries(picks).every(([f, v]) => !v || textOf(row[f]) === v);
}

/** Totals for money columns over member rows (subtotal rows are skipped so nothing is counted twice). */
export function sumColumns(rows: Row[], fields: string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(fields.map((f) => [f, 0]));
  for (const r of rows) {
    if (r[KIND] === "subtotal") continue;
    for (const f of fields) { const v = r[f]; if (typeof v === "number" && Number.isFinite(v)) out[f] += v; }
  }
  return out;
}

export interface GroupSpec {
  /** Field whose value forms the group (e.g. trancheId). */
  field: string;
  /** Field shown as the group's name (defaults to field). */
  labelField?: string;
  /** Where the subtotal label goes (usually the first visible column). */
  labelInto: string;
  /** Money fields to add up per group. */
  sumFields: string[];
  /** Per-group extra values, e.g. an invariant ✓/✗ cell for the subtotal row. */
  extra?: (key: string, members: Row[]) => Row;
}

/**
 * Client-side "group by" for AG Grid Community (which has no row grouping): keeps member rows in their incoming order,
 * gathers them under their group (groups in order of first appearance) and appends one subtotal row per group.
 */
export function groupWithSubtotals(rows: Row[], spec: GroupSpec): Row[] {
  const order: string[] = [];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (r[KIND] === "subtotal") continue;
    const k = textOf(r[spec.field]) || "—";
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k)!.push({ ...r, [GROUP]: k });
  }
  const out: Row[] = [];
  for (const k of order) {
    const members = groups.get(k)!;
    const sums = sumColumns(members, spec.sumFields);
    const label = textOf(members[0][spec.labelField ?? spec.field]) || k;
    out.push(...members, {
      ...sums, ...(spec.extra?.(k, members) ?? {}),
      [spec.labelInto]: `Subtotal · ${label}`, [KIND]: "subtotal", [GROUP]: k, [COUNT]: members.length, __id: `__sub:${k}`,
    });
  }
  return out;
}

/**
 * Re-impose the grouping after the grid sorts (used from AG Grid's postSortRows): groups keep their first-appearance
 * order, members keep the grid's sort order inside their group, and the subtotal stays last. Mutates and returns `items`.
 */
export function regroupSorted<T>(items: T[], groupOf: (t: T) => string | undefined, isSubtotal: (t: T) => boolean): T[] {
  const order: string[] = [];
  const members = new Map<string, T[]>();
  const subs = new Map<string, T>();
  const loose: T[] = [];
  for (const it of items) {
    const g = groupOf(it);
    if (g === undefined) { loose.push(it); continue; }
    if (!members.has(g)) { members.set(g, []); order.push(g); }
    if (isSubtotal(it)) subs.set(g, it); else members.get(g)!.push(it);
  }
  const out: T[] = [];
  for (const g of order) { out.push(...members.get(g)!); const s = subs.get(g); if (s) out.push(s); }
  out.push(...loose);
  items.splice(0, items.length, ...out);
  return items;
}

/* ── state chips (the global .state classes) ── */
const STATE: Record<string, { cls: "held" | "released" | "disputed" | "refunded" | "draft"; label?: string }> = {
  HOLD: { cls: "held", label: "Hold" }, RELEASE: { cls: "released", label: "Release" }, FEE: { cls: "draft", label: "Fee" },
  REFUND: { cls: "refunded", label: "Refund" }, VOID: { cls: "refunded", label: "Void" },
  HELD: { cls: "held", label: "Held in PayPal" }, PARTIALLY_RELEASED: { cls: "held", label: "Held · partly released" }, AWAITING_APPROVAL: { cls: "held" },
  AWAITING: { cls: "held" }, IN_FLIGHT: { cls: "held" }, RECEIVED: { cls: "held" }, SETTLING: { cls: "held" }, ROLLED_OVER: { cls: "held" },
  PENDING_OPS: { cls: "held" }, LOCKED: { cls: "draft" }, OPEN: { cls: "held" }, SUBMITTED: { cls: "held", label: "In review" }, APPROVED: { cls: "held" },
  RELEASED: { cls: "released" }, CLOSED: { cls: "released" }, EXECUTED: { cls: "released" }, PROCESSED: { cls: "released" }, MATCHED: { cls: "released" },
  CLEAN: { cls: "released" }, COMPLETED: { cls: "released" }, SIGNED: { cls: "released" }, ON_TIME: { cls: "released" }, RESOLVED: { cls: "released" },
  SETTLED_BY_VERDICT: { cls: "released", label: "Settled by verdict" },
  BREAKER: { cls: "disputed", label: "Paused by reconciliation" }, DRIFT: { cls: "disputed" }, DEAD: { cls: "disputed" }, DISPUTED: { cls: "disputed" },
  ESCALATED: { cls: "disputed" }, QUARANTINED: { cls: "disputed" }, FAILED: { cls: "disputed" }, BREACHED: { cls: "disputed" }, REMEDIATION: { cls: "disputed", label: "Fix requested" },
  TIER1: { cls: "disputed", label: "Sealed offers" }, TIER2: { cls: "disputed", label: "Evidence vault" }, TIER3: { cls: "disputed", label: "With a mediator" },
  REFUNDED: { cls: "refunded", label: "Returned to client" }, VOIDED: { cls: "refunded" }, EXPIRED: { cls: "refunded" }, VETOED: { cls: "refunded" },
  DUPLICATE: { cls: "refunded" }, UNAVAILABLE: { cls: "refunded", label: "No PayPal data" }, ABANDONED: { cls: "refunded" },
};
export const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
export function stateChip(state: string): { cls: string; label: string } {
  const s = STATE[state];
  return { cls: `state ${s?.cls ?? "draft"}`, label: s?.label ?? humanize(state) };
}
