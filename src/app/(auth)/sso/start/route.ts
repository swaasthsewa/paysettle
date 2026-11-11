/** F1.7 Operations SSO: GET /sso/start → sealed state/nonce/PKCE cookie, then the IdP's authorize endpoint. */
import { NextResponse } from "next/server";
import { appOrigin, startSso } from "@/lib/identity/sso-flow";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    return NextResponse.redirect(new URL(await startSso(req.url), appOrigin(req.url)), 303);
  } catch (e) {
    console.error("sso start failed", e);
    return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("SSO could not start: the identity provider could not be reached. Try again or sign in with email."), appOrigin(req.url)), 303);
  }
}
