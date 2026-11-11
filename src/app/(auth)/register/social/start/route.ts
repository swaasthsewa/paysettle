/** F1.1 · GET /register/social/start — sandbox only (P9): sealed state/nonce/PKCE cookie, then the demo IdP sign-up consent screen. */
import { NextResponse } from "next/server";
import { rateLimitKey } from "@/lib/net";
import { appOrigin } from "@/lib/identity/sso-flow";
import { startSocial } from "@/lib/identity/register-social";
import { gateOne, regLimits } from "@/server/identity/limits";

export const dynamic = "force-dynamic";
const back = (req: Request, m: string) => NextResponse.redirect(new URL("/register?error=" + encodeURIComponent(m), appOrigin(req.url)), 303);

export async function GET(req: Request) {
  const gate = gateOne(regLimits.social, rateLimitKey(req.headers), Date.now());
  if (!gate.ok) return back(req, gate.message);
  try {
    return NextResponse.redirect(new URL(await startSocial(req.url), appOrigin(req.url)), 303);
  } catch (e) {
    console.error("register social start failed", e);
    return back(req, "The demo identity provider could not start. Try again, or register with e-mail.");
  }
}
