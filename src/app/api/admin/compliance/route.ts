/** Compliance export (F5.05): signed CSV or JSON-LD evidence pack of provider release volume. Finance or admin. */
import { NextResponse } from "next/server";
import { viewer } from "@/lib/session";
import { audit } from "@/lib/audit";
import { db } from "@/db/client";
import { exportPack } from "@/server/control/compliance";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const v = await viewer();
  if (!v || !["finance", "admin"].includes(v.role)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const u = new URL(req.url);
  const format = u.searchParams.get("format") === "jsonld" ? "jsonld" : "csv";
  const from = u.searchParams.get("from"), to = u.searchParams.get("to");
  const p = await exportPack(format, { from: from && !Number.isNaN(Date.parse(from)) ? new Date(from) : undefined, to: to && !Number.isNaN(Date.parse(to)) ? new Date(to) : undefined });
  await audit(db, { id: v.id, role: v.role }, "compliance.exported", format, { rows: p.rows, flagged: p.flagged, signature: p.signature.value.slice(0, 16), alg: p.signature.alg });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(p.body, {
    headers: {
      "Content-Type": p.contentType,
      "Content-Disposition": `attachment; filename="paysettle-compliance-${stamp}.${format === "csv" ? "csv" : "jsonld"}"`,
      "X-PaySettle-Signature": `${p.signature.alg.split(" ")[0]}=${p.signature.value}`,
      "Cache-Control": "no-store",
    },
  });
}
