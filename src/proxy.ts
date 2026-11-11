import { NextResponse, type NextRequest } from "next/server";
import { NONCE_HEADER, newNonce, scriptRule, scriptRuleHeader, scriptRuleMode } from "@/lib/csp-scripts";

/**
 * NFR security · runs before every page: makes this request's script nonce and sends the script rule
 * (src/lib/csp-scripts.ts). The nonce goes on the request too, where Next.js and `scriptNonce()` read it.
 * The other page rules (frames, forms, connect-src, …) are static and sent from next.config.ts.
 */
export function proxy(req: NextRequest) {
  const mode = scriptRuleMode();
  if (mode === "off") return NextResponse.next();
  const nonce = newNonce();
  const rule = scriptRule(nonce);
  const headers = new Headers(req.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set("content-security-policy", rule);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(scriptRuleHeader(mode), rule);
  return res;
}

export const config = {
  matcher: [
    {
      /* pages only: API answers, built files and pictures carry no scripts */
      source: "/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpe?g|svg|webp|ico|css|js|map|woff2?|txt|xml|json|pdf)$).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }],
    },
  ],
};
