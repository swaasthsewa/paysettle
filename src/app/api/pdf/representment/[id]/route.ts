/**
 * F4.10 GET /api/pdf/representment/{id} — the evidence dossier PDF PaySettle sent (or will send) to PayPal for a
 * dispute. Operations, finance and admins (judges in sandbox). Audited.
 */
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { audit } from "@/lib/audit";
import { viewer } from "@/lib/session";
import { representmentPdf } from "@/server/representment";
import { pdfError, pdfResponse } from "../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const v = await viewer();
  if (!v) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return NextResponse.json({ error: "Unknown dossier." }, { status: 404 });
  try {
    const { bytes, row } = await representmentPdf(v.role, id);
    await audit(db, { id: v.id, role: v.role }, "representment.pdf_downloaded", id, { disputeId: row.disputeId, dossierHash: row.dossierHash });
    return pdfResponse(bytes, `paysettle-dossier-${row.disputeId}.pdf`, { "X-PaySettle-Dossier-Hash": row.dossierHash ?? "" });
  } catch (e) { return pdfError(e); }
}
