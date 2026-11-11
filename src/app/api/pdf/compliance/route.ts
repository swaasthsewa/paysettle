/**
 * F5.05 GET /api/pdf/compliance?year=YYYY[&from&to] — the compliance pack as a signed PDF: non-custodial release volume
 * per provider and the Form 1099-K style review flag for the calendar year. Finance and admins only; audited.
 */
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { audit } from "@/lib/audit";
import { viewer } from "@/lib/session";
import { compliancePdfPack } from "@/server/control/compliance";
import { pdfError, pdfResponse } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const date = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s)) ? new Date(s) : undefined);

export async function GET(req: Request) {
  const v = await viewer();
  if (!v) return NextResponse.json({ error: "Sign in to download the compliance pack." }, { status: 401 });
  if (v.role !== "finance" && v.role !== "admin") return NextResponse.json({ error: "Only finance and admins can download the compliance pack." }, { status: 403 });
  const u = new URL(req.url);
  const yearIn = Number(u.searchParams.get("year") ?? new Date().getUTCFullYear());
  const year = Number.isInteger(yearIn) && yearIn >= 2000 && yearIn <= 2100 ? yearIn : new Date().getUTCFullYear();
  try {
    const p = await compliancePdfPack({ year, from: date(u.searchParams.get("from")), to: date(u.searchParams.get("to")), generatedFor: `${v.name} (${v.role})` });
    await audit(db, { id: v.id, role: v.role }, "compliance.exported", "pdf", { year, rows: p.rows, flagged: p.flagged, over1099k: p.over, signature: p.signature.value.slice(0, 16), alg: p.signature.alg });
    return pdfResponse(p.bytes, `paysettle-compliance-${year}.pdf`, { "X-PaySettle-Signature": `${p.signature.alg.split(" ")[0]}=${p.signature.value}` });
  } catch (e) { return pdfError(e); }
}
