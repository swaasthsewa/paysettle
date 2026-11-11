/**
 * F2.10 GET /api/pdf/contract/{workspaceId} — the contract as a PDF: parties, milestones, clauses, canonical hash,
 * signatures with time, revision. Parties, Operations, admins and the assigned mediator only (judges: sandbox
 * playground contracts). Every download is written to the audit chain.
 */
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { audit } from "@/lib/audit";
import { viewer } from "@/lib/session";
import { contractPdf } from "@/lib/pdf/contract";
import { contractPdfAccess, contractPdfData } from "@/server/control/documents";
import { pdfError, pdfResponse } from "../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ workspaceId: string }> }) {
  const v = await viewer();
  if (!v) return NextResponse.json({ error: "Sign in to download the contract." }, { status: 401 });
  const { workspaceId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(workspaceId)) return NextResponse.json({ error: "Unknown contract." }, { status: 404 });
  try {
    const actor = { id: v.id, role: v.role, name: v.name };
    const access = await contractPdfAccess(actor, workspaceId);
    const data = await contractPdfData(actor, workspaceId);
    const bytes = await contractPdf(data);
    await audit(db, { id: v.id, role: v.role }, "contract.pdf_downloaded", workspaceId, { access, revNo: data.revision?.revNo ?? null, hash: data.revision?.hash ?? null });
    return pdfResponse(bytes, `paysettle-contract-${workspaceId}-rev${data.revision?.revNo ?? 0}.pdf`, data.revision ? { "X-PaySettle-Canonical-Hash": data.revision.hash } : {});
  } catch (e) { return pdfError(e); }
}
