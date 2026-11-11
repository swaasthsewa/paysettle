/**
 * F5.05 compliance pack as a PDF: the non-custodial release-volume export (same rows as the signed CSV / JSON-LD)
 * plus the 1099-K style review flag per provider for one calendar year. It is an evidence pack for review, not a legal
 * determination. Pure rendering; figures come from src/server/control/compliance.ts.
 */
import { formatCents, pct } from "@/lib/money";
import { fmtIso, renderPdf } from "./doc";

export interface CompliancePdfInput {
  period: { from: Date; to: Date };
  disclaimer: string;
  reviewLine: { grossCents: number; count: number };
  rows: { providerId: string; provider: string; releases: number; grossCents: number; feeCents: number; netCents: number; rails: string; flagged: boolean }[];
  year: number;
  taxLine: { grossCents: number; transactions: number };
  taxNote: string;
  taxRows: { providerId: string; provider: string; country: string | null; payments: number; grossCents: number; feeCents: number; netCents: number; flag: "OVER" | "NEAR" | "UNDER"; grossShareBps: number; countShareBps: number }[];
  signature: { alg: string; value: string };
  generatedAt: Date; generatedFor: string;
}

const FLAG = { OVER: "Over the line", NEAR: "Near (80%+)", UNDER: "Under" } as const;

export async function compliancePdf(d: CompliancePdfInput): Promise<Buffer> {
  const sum = (k: "grossCents" | "feeCents" | "netCents") => d.rows.reduce((a, r) => a + r[k], 0);
  return renderPdf(
    { title: `PaySettle compliance pack ${d.year}`, subject: "Non-custodial release volume and Form 1099-K review flags", keywords: "PaySettle, compliance, non-custodial, 1099-K" },
    `PaySettle compliance pack · ${d.period.from.toISOString().slice(0, 10)} to ${d.period.to.toISOString().slice(0, 10)} · ${d.signature.alg.split(" ")[0]} ${d.signature.value.slice(0, 16)}`,
    (w) => {
      w.title("Compliance pack", `Release volume ${fmtIso(d.period.from)} to ${fmtIso(d.period.to)} · tax year ${d.year}`);
      w.notice(d.disclaimer);

      w.h2("Where the money was");
      w.kv([
        ["Providers", String(d.rows.length)],
        ["Released (gross)", formatCents(sum("grossCents"))],
        ["Platform fees", formatCents(sum("feeCents"))],
        ["Paid to providers (net)", formatCents(sum("netCents"))],
        ["Review line", `${formatCents(d.reviewLine.grossCents)} released or ${d.reviewLine.count} releases to one provider in the period`],
      ], 170);

      w.h2("Release volume by provider");
      w.table(
        [{ header: "Provider", width: 0.28 }, { header: "Releases", width: 0.1, align: "right" }, { header: "Gross", width: 0.15, align: "right" }, { header: "Fee", width: 0.12, align: "right" }, { header: "Net", width: 0.15, align: "right" }, { header: "Rails", width: 0.08 }, { header: "Review", width: 0.12 }],
        d.rows.map((r) => [`${r.provider}\n${r.providerId}`, String(r.releases), formatCents(r.grossCents), formatCents(r.feeCents), formatCents(r.netCents), r.rails || "—", r.flagged ? "Review" : "—"]),
      );

      w.h2(`Form 1099-K review flag, calendar year ${d.year}`);
      w.p(d.taxNote, { muted: true, size: 8.5 });
      w.kv([["Line used", `more than ${formatCents(d.taxLine.grossCents)} gross and more than ${d.taxLine.transactions} payments`]], 170);
      w.table(
        [{ header: "Provider", width: 0.27 }, { header: "Country", width: 0.09 }, { header: "Payments", width: 0.1, align: "right" }, { header: "Gross", width: 0.15, align: "right" }, { header: "Share of line", width: 0.2, align: "right" }, { header: "Flag", width: 0.19 }],
        d.taxRows.map((r) => [`${r.provider}\n${r.providerId}`, r.country ?? "—", String(r.payments), formatCents(r.grossCents), `${pct(Math.min(r.grossShareBps, 99_999))} gross · ${pct(Math.min(r.countShareBps, 99_999))} count`, FLAG[r.flag]]),
      );

      w.h2("Integrity");
      w.kv([["Signature", `${d.signature.alg}`], ["Value", d.signature.value]], 110);
      w.p("The signature covers the canonical JSON of every figure printed above. Finance can recompute it from the same period with the CSV or JSON-LD export.", { muted: true, size: 8.5 });
      w.p(`Generated ${fmtIso(d.generatedAt)} for ${d.generatedFor}.`, { muted: true, size: 8 });
    },
  );
}
