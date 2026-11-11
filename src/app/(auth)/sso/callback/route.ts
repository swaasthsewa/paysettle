/** F1.7 Operations SSO callback: code + state → token exchange, id_token validation, RBAC mapping, F1.8 handshake. */
import { NextResponse } from "next/server";
import { appOrigin, finishSso } from "@/lib/identity/sso-flow";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return NextResponse.redirect(new URL(await finishSso(req.url), appOrigin(req.url)), 303);
}
