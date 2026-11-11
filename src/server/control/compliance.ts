/**
 * F5.05 Non-custodial compliance exporter (signed CSV / JSON-LD; PDF via src/lib/pdf/compliance.ts). Output is an evidence pack for review — it is not a
 * legal determination of money-transmitter status. Flags providers whose released volume crosses a review threshold.
 * Signature: HMAC-SHA256 with COMPLIANCE_SIGNING_KEY (P8: from the environment); without a key, a SHA-256 digest only.
 */
import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sha256 } from "@/lib/ids";
import { DAY } from "@/lib/clock";
import { canonical } from "@/lib/canonical";
import { compliancePdf } from "@/lib/pdf/compliance";
import { NOT_TEST_ORG_SQL, REAL_WS_SQL, type Dbx } from "./common";

export const REVIEW_THRESHOLD_CENTS = 2_000_000; /* $20,000 released to one provider in the period (configurable review line) */
export const REVIEW_THRESHOLD_COUNT = 200;
export const DISCLAIMER = "Evidence pack for compliance review. Not a legal determination of money-transmitter status. Funds were held by PayPal; PaySettle did not take custody on Rail A1.";

export async function complianceRows(from: Date, to: Date) {
  const r = (await db.execute(sql`
    select u.id as provider_id, u.name as provider, count(r.id)::int as releases,
      coalesce(sum(r.gross_cents),0)::bigint as gross, coalesce(sum(r.fee_cents),0)::bigint as fee, coalesce(sum(r.net_cents),0)::bigint as net,
      string_agg(distinct t.rail, ' ') as rails
    from users u
    left join workspaces w on w.provider_id = u.id and ${REAL_WS_SQL("w")}
    left join ws_milestones m on m.workspace_id = w.id
    left join releases r on r.milestone_id = m.id and r.status = 'COMPLETED' and coalesce(r.completed_at, r.created_at) between ${from} and ${to}
    left join tranches t on t.id = r.tranche_id
    where u.role = 'provider' and ${NOT_TEST_ORG_SQL("u")} group by u.id, u.name order by u.name`)).rows as { provider_id: string; provider: string; releases: number; gross: string; fee: string; net: string; rails: string | null }[];
  return r.map((x) => {
    const gross = Number(x.gross);
    const flagged = gross >= REVIEW_THRESHOLD_CENTS || x.releases >= REVIEW_THRESHOLD_COUNT;
    return { providerId: x.provider_id, provider: x.provider, releases: x.releases, grossCents: gross, feeCents: Number(x.fee), netCents: Number(x.net), rails: x.rails ?? "", flagged };
  });
}

function sign(body: string) {
  const key = process.env.COMPLIANCE_SIGNING_KEY;
  return key ? { alg: "HMAC-SHA256", value: createHmac("sha256", key).update(body).digest("hex") } : { alg: "SHA-256 (digest only; set COMPLIANCE_SIGNING_KEY to sign)", value: sha256(body) };
}

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };

export async function exportPack(format: "csv" | "jsonld", period?: { from?: Date; to?: Date }) {
  const to = period?.to ?? new Date(), from = period?.from ?? new Date(to.getTime() - 365 * DAY);
  const rows = await complianceRows(from, to);
  let body: string, contentType: string;
  if (format === "csv") {
    const head = ["provider_id", "provider", "releases", "gross_cents", "fee_cents", "net_cents", "rails", "review_flag"];
    body = [`# ${DISCLAIMER}`, `# period ${from.toISOString()} .. ${to.toISOString()}`, head.join(","),
      ...rows.map((r) => [r.providerId, r.provider, r.releases, r.grossCents, r.feeCents, r.netCents, r.rails, r.flagged ? "REVIEW" : ""].map(csvCell).join(","))].join("\n") + "\n";
    contentType = "text/csv; charset=utf-8";
  } else {
    body = JSON.stringify({
      "@context": { "@vocab": "https://schema.org/", ps: "https://paysettle.example/ns#" },
      "@type": "Dataset", name: "PaySettle provider release volume", description: DISCLAIMER, temporalCoverage: `${from.toISOString()}/${to.toISOString()}`,
      "ps:reviewThresholdCents": REVIEW_THRESHOLD_CENTS,
      hasPart: rows.map((r) => ({ "@type": "MonetaryAmount", "ps:providerId": r.providerId, name: r.provider, currency: "USD", "ps:releases": r.releases, "ps:grossCents": r.grossCents, "ps:feeCents": r.feeCents, "ps:netCents": r.netCents, "ps:rails": r.rails, "ps:reviewFlag": r.flagged })),
    }, null, 2);
    contentType = "application/ld+json; charset=utf-8";
  }
  return { body, contentType, signature: sign(body), rows: rows.length, flagged: rows.filter((r) => r.flagged).length };
}

/* ── F5.05 (X2): 1099-K style threshold flag per provider per calendar year ── */

/**
 * US Form 1099-K reporting line used as a review flag. Under the One Big Beautiful Bill Act (July 2025) the federal
 * line went back to more than $20,000 in gross payments AND more than 200 transactions in a calendar year, applied from
 * 2022. Rules have changed several times and vary by year, and some states use lower lines. PayPal, as the payment
 * settlement entity, is the one that files and issues Form 1099-K; PaySettle does not. This flag only tells finance
 * which providers to look at. Override per year in FORM_1099K_BY_YEAR when the rule changes.
 */
export const FORM_1099K_DEFAULT: { readonly grossCents: number; readonly transactions: number } = { grossCents: 2_000_000, transactions: 200 };
export const FORM_1099K_BY_YEAR: Record<number, { grossCents: number; transactions: number }> = {};
export const form1099kLine = (year: number) => FORM_1099K_BY_YEAR[year] ?? FORM_1099K_DEFAULT;
/** Share of either line at which a provider is shown as "near" (80%). */
export const NEAR_BPS = 8_000;
export const TAX_NOTE = "Review flag only. The federal Form 1099-K line used here is more than $20,000 and more than 200 payments in a calendar year; rules vary by year and some states use lower lines. PayPal is the reporting entity and issues Form 1099-K; PaySettle does not file it.";

export type TaxFlag = "OVER" | "NEAR" | "UNDER";
export interface TaxYearRow { providerId: string; provider: string; country: string | null; payments: number; grossCents: number; feeCents: number; netCents: number; flag: TaxFlag; grossShareBps: number; countShareBps: number }

/** Pure: the flag for one provider-year. Both parts must be over the line (the federal rule is "and"). */
export function taxFlag(grossCents: number, payments: number, line = FORM_1099K_DEFAULT): { flag: TaxFlag; grossShareBps: number; countShareBps: number } {
  const grossShareBps = Math.floor((grossCents * 10_000) / line.grossCents), countShareBps = Math.floor((payments * 10_000) / line.transactions);
  const flag: TaxFlag = grossCents > line.grossCents && payments > line.transactions ? "OVER" : grossShareBps >= NEAR_BPS || countShareBps >= NEAR_BPS ? "NEAR" : "UNDER";
  return { flag, grossShareBps, countShareBps };
}

/** Completed releases per provider in one calendar year (UTC), test and playground data left out. */
export async function taxYearRows(year: number, dbx: Dbx = db): Promise<TaxYearRow[]> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("year out of range");
  const from = new Date(Date.UTC(year, 0, 1)), to = new Date(Date.UTC(year + 1, 0, 1));
  const r = (await dbx.execute(sql`
    select u.id as provider_id, u.name as provider, u.profile->>'country' as country, count(r.id)::int as payments,
      coalesce(sum(r.gross_cents),0)::bigint as gross, coalesce(sum(r.fee_cents),0)::bigint as fee, coalesce(sum(r.net_cents),0)::bigint as net
    from users u
    join workspaces w on w.provider_id = u.id and ${REAL_WS_SQL("w")}
    join ws_milestones m on m.workspace_id = w.id
    join releases r on r.milestone_id = m.id and r.status = 'COMPLETED' and coalesce(r.completed_at, r.created_at) >= ${from} and coalesce(r.completed_at, r.created_at) < ${to}
    where u.role = 'provider' and ${NOT_TEST_ORG_SQL("u")}
    group by u.id, u.name, u.profile->>'country' order by sum(r.gross_cents) desc, u.name`)).rows as { provider_id: string; provider: string; country: string | null; payments: number; gross: string; fee: string; net: string }[];
  const line = form1099kLine(year);
  return r.map((x) => {
    const grossCents = Number(x.gross);
    return { providerId: x.provider_id, provider: x.provider, country: x.country, payments: x.payments, grossCents, feeCents: Number(x.fee), netCents: Number(x.net), ...taxFlag(grossCents, x.payments, line) };
  });
}

/** Years that have any completed release (newest first), plus the current year. */
export async function taxYears(dbx: Dbx = db, now = new Date()): Promise<number[]> {
  const r = (await dbx.execute(sql`select distinct extract(year from coalesce(completed_at, created_at) at time zone 'UTC')::int as y from releases where status = 'COMPLETED'`)).rows as { y: number }[];
  return [...new Set([now.getUTCFullYear(), ...r.map((x) => x.y)])].sort((a, b) => b - a);
}

/** Signature over the exact figures printed in the compliance PDF (canonical JSON), so a copy can be checked. */
export function signFigures(v: unknown) { return sign(canonical(v)); }

/** F5.05 the compliance pack as a PDF (non-custodial export + 1099-K flag for one calendar year). */
export async function compliancePdfPack(o: { year: number; from?: Date; to?: Date; generatedFor: string }, dbx: Dbx = db) {
  const to = o.to ?? new Date(), from = o.from ?? new Date(to.getTime() - 365 * DAY);
  const [rows, taxRows] = await Promise.all([complianceRows(from, to), taxYearRows(o.year, dbx)]);
  const taxLine = form1099kLine(o.year);
  const figures = { period: { from: from.toISOString(), to: to.toISOString() }, rows, year: o.year, taxLine, taxRows };
  const signature = signFigures(figures);
  const bytes = await compliancePdf({
    period: { from, to }, disclaimer: DISCLAIMER, reviewLine: { grossCents: REVIEW_THRESHOLD_CENTS, count: REVIEW_THRESHOLD_COUNT }, rows,
    year: o.year, taxLine, taxNote: TAX_NOTE, taxRows, signature, generatedAt: new Date(), generatedFor: o.generatedFor,
  });
  return { bytes, signature, rows: rows.length, flagged: rows.filter((r) => r.flagged).length, over: taxRows.filter((r) => r.flag === "OVER").length };
}
