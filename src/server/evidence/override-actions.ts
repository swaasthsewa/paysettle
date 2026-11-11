"use server";
/** F3.03 server actions for the out-of-sequence override panel on the milestone page (zod-validated; the service re-checks roles). */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/session";
import { DomainError } from "@/server/types";
import { declineSequenceOverride, grantSequenceOverride, requestSequenceOverride, revokeSequenceOverride } from "./override";

export interface OverrideActionResult { ok: boolean; message: string }

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Base = z.object({ workspaceId: Id, milestoneId: Id });
const Request = Base.extend({ reason: z.string().trim().min(10, "Say in a sentence why (at least 10 characters).").max(500) });
const Grant = Base.extend({ reason: z.string().trim().max(500).default(""), confirm: z.literal("on", { error: "Tick the box to confirm that payout amounts stay as signed." }), mfaCode: z.string().regex(/^\d{6}$/, "The authenticator code has 6 digits.").optional() });
const Decline = Base.extend({ note: z.string().trim().max(300).default("") });

const read = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, fd.get(k) || undefined]));
const bad = (e: z.ZodError): OverrideActionResult => ({ ok: false, message: e.issues[0]?.message ?? "Reload the page and try again." });
const fail = (e: unknown): OverrideActionResult => {
  if (e instanceof DomainError) return { ok: false, message: e.message };
  console.error("sequence override action failed", e);
  return { ok: false, message: "That did not go through. Nothing changed; try again." };
};
const refresh = (ws: string, ms: string) => { revalidatePath(`/contracts/${ws}/m/${ms}`); revalidatePath(`/contracts/${ws}`); };

export async function requestOverrideAction(_prev: OverrideActionResult | null, fd: FormData): Promise<OverrideActionResult> {
  const v = await requireViewer();
  const p = Request.safeParse(read(fd, ["workspaceId", "milestoneId", "reason"]));
  if (!p.success) return bad(p.error);
  try {
    await requestSequenceOverride({ id: v.id, role: v.role, name: v.name }, p.data.milestoneId, p.data.reason);
    refresh(p.data.workspaceId, p.data.milestoneId);
    return { ok: true, message: "Request sent. The client signs or declines it on this page." };
  } catch (e) { return fail(e); }
}

export async function grantOverrideAction(_prev: OverrideActionResult | null, fd: FormData): Promise<OverrideActionResult> {
  const v = await requireViewer();
  const p = Grant.safeParse(read(fd, ["workspaceId", "milestoneId", "reason", "confirm", "mfaCode"]));
  if (!p.success) return bad(p.error);
  try {
    const r = await grantSequenceOverride({ id: v.id, role: v.role, name: v.name }, p.data.milestoneId, { reason: p.data.reason, confirm: true, mfaCode: p.data.mfaCode });
    refresh(p.data.workspaceId, p.data.milestoneId);
    return { ok: true, message: r.opened ? "Signed. The milestone is open for evidence now; payout amounts are unchanged." : "Signed. The milestone opens for evidence once its tranche is held in PayPal; payout amounts are unchanged." };
  } catch (e) { return fail(e); }
}

export async function declineOverrideAction(_prev: OverrideActionResult | null, fd: FormData): Promise<OverrideActionResult> {
  const v = await requireViewer();
  const p = Decline.safeParse(read(fd, ["workspaceId", "milestoneId", "note"]));
  if (!p.success) return bad(p.error);
  try {
    await declineSequenceOverride({ id: v.id, role: v.role, name: v.name }, p.data.milestoneId, p.data.note);
    refresh(p.data.workspaceId, p.data.milestoneId);
    return { ok: true, message: "Declined. The milestone keeps its signed order." };
  } catch (e) { return fail(e); }
}

export async function revokeOverrideAction(_prev: OverrideActionResult | null, fd: FormData): Promise<OverrideActionResult> {
  const v = await requireViewer();
  const p = Base.safeParse(read(fd, ["workspaceId", "milestoneId"]));
  if (!p.success) return bad(p.error);
  try {
    await revokeSequenceOverride({ id: v.id, role: v.role, name: v.name }, p.data.milestoneId);
    refresh(p.data.workspaceId, p.data.milestoneId);
    return { ok: true, message: "Withdrawn. The milestone keeps its signed order." };
  } catch (e) { return fail(e); }
}
