/**
 * Serves a rebuttal file from the vault (F4.03). Uploaded content is untrusted (P11): images are sent as
 * images, everything else as a download, with nosniff and a sandbox policy; only people with access to the case.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { disputeFiles } from "@/db/schema-disputes";
import { viewer } from "@/lib/session";
import { disputeCase } from "@/server/disputes/queries";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; sha: string }> }) {
  const { id, sha } = await ctx.params;
  const v = await viewer();
  if (!v) return new Response("Sign in first.", { status: 401 });
  if (!/^[a-f0-9]{64}$/.test(sha)) return new Response("Not found", { status: 404 });
  const c = await disputeCase(v, id);
  if (!c) return new Response("Not found", { status: 404 });
  const [f] = await db.select().from(disputeFiles).where(and(eq(disputeFiles.disputeId, id), eq(disputeFiles.sha256, sha))).limit(1);
  if (!f) return new Response("Not found", { status: 404 });
  const image = ["image/png", "image/jpeg", "image/webp"].includes(f.type);
  return new Response(new Uint8Array(f.bytes), {
    headers: {
      "Content-Type": image ? f.type : f.type === "application/pdf" ? "application/pdf" : "application/octet-stream",
      "Content-Disposition": `${image ? "inline" : "attachment"}; filename="${f.name.replace(/[^\w.\- ]+/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=300",
    },
  });
}
