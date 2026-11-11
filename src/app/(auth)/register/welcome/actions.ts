"use server";
/** F1.1 · welcome page: make a new e-mail confirmation link for the signed-in person (rate limited, 3 per 10 minutes). */
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session";
import { issueConfirmationLink } from "@/server/identity/confirm-link";
import { gateOne, regLimits } from "@/server/identity/limits";
import type { ActionAnswer } from "@/components/identity/action-form";

export async function resendConfirmation(): Promise<ActionAnswer> {
  const v = await requireViewer(["client", "provider"]);
  const gate = gateOne(regLimits.resend, v.id, Date.now());
  if (!gate.ok) return { ok: false, message: gate.message };
  const d = await issueConfirmationLink(v.id);
  revalidatePath("/register/welcome");
  if (d === "already") return { ok: true, message: "Your e-mail address is already confirmed." };
  if (d === "sandbox") return { ok: true, message: "A new link was made and the earlier one stopped working. Sandbox: it is shown in the outbox on this page." };
  return { ok: false, message: "A new link was made, but this deployment has no e-mail sender configured, so it was not sent." };
}
