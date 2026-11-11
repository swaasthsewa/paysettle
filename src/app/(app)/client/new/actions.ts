"use server";
/**
 * F2.02 A1 — start a contract: clone a blueprint into a negotiation workspace, optionally from an AI draft of the
 * client's brief. The AI only proposes (P3): its draft passes the same validation and policy gate as any edit.
 */
import { redirect } from "next/navigation";
import { draftContract } from "@/server/ai";
import { createWorkspace, parseDollarsToCents } from "@/server/contracts";
import { getBlueprint } from "@/server/contracts/blueprints";
import { currentActor, domainMessage } from "@/server/contracts/web";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createContractAction(f: FormData) {
  const { a } = await currentActor(["client"]);
  const blueprintCode = s(f, "blueprint"), title = s(f, "title"), brief = s(f, "brief").slice(0, 4000);
  const back = (m: string) => redirect(`/client/new?blueprint=${encodeURIComponent(blueprintCode)}&err=${encodeURIComponent(m)}`);
  const totalCents = parseDollarsToCents(s(f, "total"));
  if (totalCents === null) back("Enter the total in dollars, for example 6,000.");
  const bp = await getBlueprint(blueprintCode);
  if (!bp) back("Pick a blueprint to start from.");
  const pick = s(f, "provider");
  const providerId = pick && pick !== "invite" ? pick : undefined;
  const inviteEmail = pick === "invite" || !pick ? s(f, "inviteEmail") || undefined : undefined;

  let draft: unknown;
  let note = "";
  if (brief.length >= 10) {
    try {
      const r = await draftContract(brief, totalCents!, bp!.recommendedDays);
      if (r.available && r.data) { draft = r.data; note = `AI draft used (${r.data.milestones.length} milestones). Review every step: the drafter only proposes.`; }
      else note = `AI drafting is unavailable${r.reason ? ` (${r.reason})` : ""}; the contract starts from the ${bp!.title} blueprint.`;
    } catch { note = `AI drafting is unavailable; the contract starts from the ${bp!.title} blueprint.`; }
  }

  let id = "", msg = "";
  try { id = await createWorkspace(a, { blueprintCode, title: title || bp!.title, totalCents: totalCents!, providerId, inviteEmail, draft }); }
  catch (e) { msg = domainMessage(e); }
  if (msg) back(msg);
  redirect(`/contracts/${id}${note ? `?note=${encodeURIComponent(note)}` : ""}`);
}
