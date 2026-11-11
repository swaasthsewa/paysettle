/** F3.02 Buyer returns from PayPal approval: confirm the hold (authorize on Rail A, capture on Rail B), then back to the contract. */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { tranches } from "@/db/schema";
import { viewer } from "@/lib/session";
import { confirmTranche } from "@/server/money";
export const dynamic = "force-dynamic";

const base = (req: NextRequest) => process.env.APP_URL ?? req.nextUrl.origin;

export async function GET(req: NextRequest) {
  const trancheId = req.nextUrl.searchParams.get("tranche") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? undefined;
  const [t] = trancheId ? await db.select({ ws: tranches.workspaceId }).from(tranches).where(eq(tranches.id, trancheId)).limit(1) : [];
  if (!t) return NextResponse.redirect(new URL("/client/contracts?fund_error=" + encodeURIComponent("That PayPal return link does not match a tranche."), base(req)));
  const v = await viewer();
  try {
    await confirmTranche(v ? { id: v.id, role: v.role, name: v.name } : null, trancheId, token);
    return NextResponse.redirect(new URL(`/contracts/${t.ws}?funded=1`, base(req)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "PayPal could not confirm the hold.";
    return NextResponse.redirect(new URL(`/contracts/${t.ws}/fund/${trancheId}?error=${encodeURIComponent(msg)}`, base(req)));
  }
}
