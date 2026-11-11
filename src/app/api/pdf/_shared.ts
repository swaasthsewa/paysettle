/** F2.10 F5.05 F4.10 helpers for the PDF download routes: the PDF answer with safe headers, and errors as plain JSON. */
import { NextResponse } from "next/server";
import { DomainError } from "@/server/types";

/** File names are built from ids only; anything else is dropped so the header cannot be broken (P11). */
export const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);

export function pdfResponse(bytes: Buffer, filename: string, extra: Record<string, string> = {}) {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName(filename)}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}

const STATUS: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, INVALID: 400 };
export function pdfError(e: unknown) {
  if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: STATUS[e.code] ?? 409 });
  console.error("pdf route failed", e);
  return NextResponse.json({ error: "The PDF could not be made. Try again in a moment." }, { status: 500 });
}
