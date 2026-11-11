"use server";
/** F1.7 Demo identity provider consent (sandbox only, P9): issue a one-time code for the chosen identity, or deny. */
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { assertDemoIdp, checkAuthorizeRequest, demoGroupsFor, demoIssuer, issueDemoCode, UNKNOWN_PERSON, type AuthorizeRequest } from "@/lib/identity/sso-demo";
import { requestOrigin as demoOrigin } from "@/lib/identity/sso-flow";
import { isStaff } from "@/lib/identity/sso";


function readRequest(f: FormData): AuthorizeRequest {
  const g = (k: string) => String(f.get(k) ?? "");
  return { clientId: g("client_id"), redirectUri: g("redirect_uri"), state: g("state"), nonce: g("nonce"), codeChallenge: g("code_challenge"), codeChallengeMethod: g("code_challenge_method"), responseType: g("response_type") };
}

export async function demoConsent(f: FormData) {
  assertDemoIdp();
  const r = readRequest(f), issuer = demoIssuer(await demoOrigin());
  if (checkAuthorizeRequest(r, issuer)) redirect("/login?error=" + encodeURIComponent("The demo identity provider refused a malformed sign-in request."));
  const who = String(f.get("who") ?? "");
  let person = UNKNOWN_PERSON;
  if (who !== "unknown") {
    const [kind, id] = who.split(":");
    const [u] = id ? await db.select({ email: users.email, name: users.name, role: users.role }).from(users).where(eq(users.id, id)).limit(1) : [];
    if (!u || !isStaff(u.role)) redirect("/login?error=" + encodeURIComponent("Pick a person on the demo identity provider."));
    const groups = kind === "mismatch" ? demoGroupsFor(u.role === "finance" ? "ops" : "finance") : demoGroupsFor(u.role);
    person = { email: u.email, name: u.name, groups };
  }
  redirect(await issueDemoCode(r, issuer, person));
}

export async function demoDeny(f: FormData) {
  assertDemoIdp();
  const r = readRequest(f), issuer = demoIssuer(await demoOrigin());
  if (checkAuthorizeRequest(r, issuer)) redirect("/login");
  const back = new URL(r.redirectUri);
  back.searchParams.set("error", "access_denied"); back.searchParams.set("state", r.state);
  redirect(back.toString());
}
