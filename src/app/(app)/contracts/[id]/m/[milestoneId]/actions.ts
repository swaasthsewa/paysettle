"use server";
/** F3.07 / F3.09 server actions for the milestone page: approve (signed release trigger) and request a fix. Also covers extensions. */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireViewer } from "@/lib/session";
import { DomainError } from "@/server/types";
import { approveMilestone, requestFix } from "@/server/evidence";
import { decideExtension, recordExcusedDays, requestExtension, withdrawExtension } from "@/server/contracts/deadline";
import type { ActionResult } from "@/components/evidence/DecisionPanel";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Approve = z.object({ workspaceId: Id, milestoneId: Id, rootHash: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal("on"), mfaCode: z.string().regex(/^\d{6}$/).optional() });
const Fix = z.object({ workspaceId: Id, milestoneId: Id, items: z.string().min(1).max(4000) });

const fail = (e: unknown): ActionResult => {
  if (e instanceof DomainError) return { ok: e.code === "RELEASE_QUEUED", message: e.message };
  console.error("milestone action failed", e);
  return { ok: false, message: "That did not go through. Nothing changed; try again." };
};

export async function approveAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  const raw = Object.fromEntries(["workspaceId", "milestoneId", "rootHash", "confirm", "mfaCode"].map((k) => [k, fd.get(k) || undefined]));
  const p = Approve.safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues.some((i) => i.path[0] === "confirm") ? "Tick the box to confirm you inspected the evidence." : p.error.issues.some((i) => i.path[0] === "mfaCode") ? "The authenticator code has 6 digits." : "Reload the page and try again." };
  try {
    await approveMilestone({ id: v.id, role: v.role, name: v.name }, p.data.milestoneId, p.data.rootHash, p.data.mfaCode);
    revalidatePath(`/contracts/${p.data.workspaceId}/m/${p.data.milestoneId}`);
    revalidatePath(`/contracts/${p.data.workspaceId}`);
    return { ok: true, message: "Approved and signed. The release is on its way to the provider's PayPal account." };
  } catch (e) {
    revalidatePath(`/contracts/${p.data.workspaceId}/m/${p.data.milestoneId}`);
    return fail(e);
  }
}

export async function requestFixAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const v = await requireViewer();
  const p = Fix.safeParse({ workspaceId: fd.get("workspaceId"), milestoneId: fd.get("milestoneId"), items: String(fd.get("items") ?? "").trim() });
  if (!p.success) return { ok: false, message: "List at least one thing to fix." };
  const items = p.data.items.split(/\r?\n/).map((s) => s.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean);
  try {
    await requestFix({ id: v.id, role: v.role, name: v.name }, p.data.milestoneId, items);
    revalidatePath(`/contracts/${p.data.workspaceId}/m/${p.data.milestoneId}`);
    return { ok: true, message: `Sent ${items.length} item${items.length === 1 ? "" : "s"} to the provider.` };
  } catch (e) { return fail(e); }
}

/* ── Deadline extensions and excused days (form actions; the page shows the outcome) ── */
const ExtReq = z.object({ workspaceId: Id, milestoneId: Id, days: z.coerce.number().int().min(1).max(30), reason: z.string().trim().min(5).max(500) });
const ExtDec = z.object({ workspaceId: Id, milestoneId: Id, extensionId: Id, decision: z.enum(["accept", "decline", "withdraw"]) });
const Excuse = z.object({ workspaceId: Id, milestoneId: Id, days: z.coerce.number().int().min(1).max(60), reason: z.string().trim().min(5).max(500), disputeId: z.string().regex(/^[A-Za-z0-9_-]{0,64}$/).optional() });
const back = (ws: string, ms: string, q: Record<string, string>) => `/contracts/${ws}/m/${ms}?${new URLSearchParams(q).toString()}#deadline`;
const msg = (e: unknown) => (e instanceof DomainError ? e.message : "That did not go through. Nothing changed; try again.");

export async function requestExtensionAction(fd: FormData) {
  const v = await requireViewer(["client", "provider"]);
  const p = ExtReq.safeParse({ workspaceId: fd.get("workspaceId"), milestoneId: fd.get("milestoneId"), days: fd.get("days"), reason: fd.get("reason") });
  if (!p.success) redirect(back(String(fd.get("workspaceId") ?? ""), String(fd.get("milestoneId") ?? ""), { dlerr: "Ask for 1 to 30 days and say in a few words why." }));
  let out: Record<string, string>;
  try { await requestExtension({ id: v.id, role: v.role, name: v.name }, p.data.milestoneId, { days: p.data.days, reason: p.data.reason }); out = { dl: `Extension of ${p.data.days} day${p.data.days === 1 ? "" : "s"} requested. It counts once the other party signs it.` }; }
  catch (e) { out = { dlerr: msg(e) }; }
  revalidatePath(`/contracts/${p.data.workspaceId}/m/${p.data.milestoneId}`);
  redirect(back(p.data.workspaceId, p.data.milestoneId, out));
}

export async function decideExtensionAction(fd: FormData) {
  const v = await requireViewer(["client", "provider"]);
  const p = ExtDec.safeParse({ workspaceId: fd.get("workspaceId"), milestoneId: fd.get("milestoneId"), extensionId: fd.get("extensionId"), decision: fd.get("decision") });
  if (!p.success) redirect("/client/contracts");
  const a = { id: v.id, role: v.role, name: v.name };
  let out: Record<string, string>;
  try {
    if (p.data.decision === "withdraw") await withdrawExtension(a, p.data.extensionId);
    else await decideExtension(a, p.data.extensionId, p.data.decision);
    out = { dl: p.data.decision === "accept" ? "Extension signed by both parties. The due date moved." : p.data.decision === "decline" ? "Extension declined. The due date stays as signed." : "Request withdrawn." };
  } catch (e) { out = { dlerr: msg(e) }; }
  revalidatePath(`/contracts/${p.data.workspaceId}/m/${p.data.milestoneId}`);
  redirect(back(p.data.workspaceId, p.data.milestoneId, out));
}

export async function recordExcusedAction(fd: FormData) {
  const v = await requireViewer(["mediator", "ops", "admin", "judge"]);
  const p = Excuse.safeParse({ workspaceId: fd.get("workspaceId"), milestoneId: fd.get("milestoneId"), days: fd.get("days"), reason: fd.get("reason"), disputeId: fd.get("disputeId") || undefined });
  if (!p.success) redirect(back(String(fd.get("workspaceId") ?? ""), String(fd.get("milestoneId") ?? ""), { dlerr: "Give 1 to 60 days and quote the ruling in a few words." }));
  let out: Record<string, string>;
  try { await recordExcusedDays({ id: v.id, role: v.role, name: v.name }, p.data.milestoneId, { days: p.data.days, reason: p.data.reason, disputeId: p.data.disputeId }); out = { dl: `${p.data.days} excused day${p.data.days === 1 ? "" : "s"} recorded from the ruling.` }; }
  catch (e) { out = { dlerr: msg(e) }; }
  revalidatePath(`/contracts/${p.data.workspaceId}/m/${p.data.milestoneId}`);
  redirect(back(p.data.workspaceId, p.data.milestoneId, out));
}
