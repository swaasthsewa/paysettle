/**
 * F3.04 / P11 evidence file download. Streams a stored object only to parties of the workspace that holds it and to
 * staff roles. Images go inline with their exact type; everything else is sent as an attachment. HTML is never served
 * inline: the type comes from the server-side sniff stored with the package, and a locked-down CSP plus nosniff apply.
 */
import { NextResponse } from "next/server";
import { viewer } from "@/lib/session";
import { fileAccess } from "@/server/evidence";
import { isAllowedType } from "@/server/evidence/spec";
import { isSha, objectStore } from "@/server/evidence/storage";

export const dynamic = "force-dynamic";
const INLINE = new Set(["image/jpeg", "image/png"]);

export async function GET(_req: Request, ctx: { params: Promise<{ sha: string }> }) {
  const v = await viewer();
  if (!v) return new NextResponse("Sign in to view evidence.", { status: 401 });
  const { sha } = await ctx.params;
  if (!isSha(sha)) return new NextResponse("Not found", { status: 404 });
  const meta = await fileAccess(v, sha);
  if (!meta) return new NextResponse("Not found", { status: 404 });
  const bytes = await objectStore().getObject(sha);
  if (!bytes) return new NextResponse("The file is no longer in storage.", { status: 410 });
  const type = isAllowedType(meta.type) ? meta.type : "application/octet-stream";
  const inline = INLINE.has(type);
  const ascii = meta.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type === "text/plain" ? "text/plain; charset=utf-8" : type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'none'; sandbox",
      "Cache-Control": "private, max-age=300",
      "Cross-Origin-Resource-Policy": "same-origin",
      ETag: `"${sha}"`,
    },
  });
}
