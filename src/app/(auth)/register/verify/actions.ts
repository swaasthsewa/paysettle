"use server";
/**
 * F1.1 · confirm an e-mail address from the link (a button press, so mail scanners that open links do not use it up).
 * On success: invites addressed to the e-mail are linked (src/server/identity/invites.ts) and a signed-in owner lands
 * in the most recent linked contract's room; anyone else is sent to sign in.
 */
import { redirect } from "next/navigation";
import { viewer } from "@/lib/session";
import { clearOutbox } from "@/lib/identity/register-session";
import { confirmEmail } from "@/server/identity/register";
import { nextAfterRegistration } from "@/server/identity/invites";

export async function confirmEmailAction(f: FormData): Promise<void> {
  const token = String(f.get("t") ?? "").slice(0, 2_000);
  const r = await confirmEmail(token);
  if (!r.ok) redirect("/register/verify?problem=" + encodeURIComponent(r.message) + (r.already ? "&already=1" : ""));
  await clearOutbox();
  const v = await viewer();
  if (!v || v.id !== r.userId) redirect("/login?error=" + encodeURIComponent("E-mail address confirmed. Sign in to continue."));
  const next = await nextAfterRegistration(r.userId);
  redirect(next === "/register/welcome" ? "/register/welcome?confirmed=1" : next);
}
