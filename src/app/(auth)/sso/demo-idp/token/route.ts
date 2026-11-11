/** F1.7 Demo identity provider (sandbox only, P9): token endpoint. Same handler the SSO client uses in-process. */
import { appOrigin } from "@/lib/identity/sso-flow";
import { demoIdpHandle, demoIssuer } from "@/lib/identity/sso-demo";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const issuer = demoIssuer(appOrigin(req.url));
  const path = new URL(issuer).pathname + "/token";
  return (await demoIdpHandle(new Request(new URL(path, issuer), { method: req.method, headers: { authorization: req.headers.get("authorization") ?? "", "content-type": req.headers.get("content-type") ?? "" }, body: req.method === "POST" ? await req.text() : undefined }), issuer)) ?? Response.json({ error: "not_found" }, { status: 404 });
}
