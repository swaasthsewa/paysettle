/**
 * F3 · the one worked example the landing page's motion graphics share: a $6,000 tranche of the published Web / SaaS
 * MVP blueprint, split by the blueprint's own basis points, so every amount on screen is the blueprint's. Each paid
 * milestone gets an outcome for the story: released, frozen in a dispute, or returned (voided back) because it was not
 * needed. Pure data, safe in client components.
 */
import { WEB_MVP } from "@/data/blueprints/digital";
import { splitByBps } from "@/lib/money";

export type ShareEnd = "released" | "frozen" | "returned";

export const EXAMPLE_TOTAL = 600_000;
const PAY = WEB_MVP.milestones.filter((m) => m.type === "PAY");
const CENTS = splitByBps(EXAMPLE_TOTAL, PAY.map((m) => m.bps));
const END: Record<string, ShareEnd> = { M04: "frozen", M07: "returned" };

export const EXAMPLE_SHARES: readonly { code: string; title: string; day: number; pct: number; cents: number; end: ShareEnd }[] =
  PAY.map((m, i) => ({ code: m.code, title: m.title, day: m.day, pct: m.bps / 100, cents: CENTS[i], end: END[m.code] ?? "released" }));

export const EXAMPLE_TITLE = WEB_MVP.title;
export const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const sumOf = (end: ShareEnd) => EXAMPLE_SHARES.filter((s) => s.end === end).reduce((a, s) => a + s.cents, 0);
