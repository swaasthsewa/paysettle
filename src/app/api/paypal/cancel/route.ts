/** F3.01 Buyer cancelled on PayPal: nothing is held; the tranche stays waiting for approval and can be funded again. */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tranches } from "@/db/schema";
import { audit } from "@/lib/audit";
import { viewer } from "@/lib/session";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  const trancheId = req.nextUrl.searchParams.get("tranche") ?? "";
  const [t] = trancheId ? await db.select({ ws: tranches.workspaceId }).from(tranches).where(eq(tranches.id, trancheId)).limit(1) : [];
  if (!t) return NextResponse.redirect(new URL("/client/contracts", base));
  const v = await viewer();
  await audit(db, { id: v?.id ?? null, role: v?.role ?? "system" }, "money.fund_cancelled", trancheId, {});
  const msg = "You left PayPal before approving. Nothing is held and nothing was charged. You can fund this tranche again at any time.";
  return NextResponse.redirect(new URL(`/contracts/${t.ws}/fund/${trancheId}?cancelled=1&message=${encodeURIComponent(msg)}`, base));
}
