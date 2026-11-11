/**
 * F1.1 · making and "delivering" an e-mail confirmation link. Server-only helper (never a server action: it takes a
 * user id, so exposing it would let anyone mint a link for any account).
 *   · sandbox: the link is shown on the person's own welcome page (sealed cookie on their browser, "Sandbox outbox");
 *     no e-mail leaves the system (P9)
 *   · production: no e-mail sender is configured in this build, so nothing is sent and the page says so plainly;
 *     invites addressed to the e-mail stay pending until the address is confirmed
 */
import { sandboxMode } from "@/lib/clock";
import { VERIFY_PATH } from "@/lib/identity/email-verify";
import { putOutbox } from "@/lib/identity/register-session";
import { requestOrigin } from "@/lib/identity/sso-flow";
import { startEmailVerification } from "./register";

export type Delivery = "sandbox" | "unsent" | "already";

export async function issueConfirmationLink(userId: string): Promise<Delivery> {
  const r = await startEmailVerification(userId);
  if ("already" in r) return "already";
  if (!sandboxMode()) return "unsent";
  await putOutbox(userId, `${await requestOrigin()}${VERIFY_PATH}?t=${encodeURIComponent(r.token)}`);
  return "sandbox";
}
