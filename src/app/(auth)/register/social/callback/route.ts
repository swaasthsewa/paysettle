/** F1.1 · GET /register/social/callback — code + state → token exchange and id_token checks (sandbox only), then back to the form. */
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { audit } from "@/lib/audit";
import { appOrigin } from "@/lib/identity/sso-flow";
import { finishSocial } from "@/lib/identity/register-social";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const r = await finishSocial(req.url);
  if (r.ok) return NextResponse.redirect(new URL("/register", appOrigin(req.url)), 303);
  await audit(db, { id: null, role: "public" }, "identity.register_idp_failed", "register", { code: r.code });
  const m = r.code === "IDP_ERROR" ? "The demo identity provider sign-in was cancelled. Register with e-mail, or start it again." : `The demo identity provider sign-in did not complete: ${r.message.replace(/[.\s]+$/, "")}. Start it again, or register with e-mail.`;
  return NextResponse.redirect(new URL("/register?error=" + encodeURIComponent(m), appOrigin(req.url)), 303);
}
