"use server";
/** A5 · Server actions for Account → AI & agents: mint and revoke MCP agent tokens, dismiss an agent's release request. */
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session";
import { DomainError } from "@/server/types";
import { mintAgentToken, revokeAgentToken } from "@/server/ai/agent";
import { resolveAgentApproval } from "@/server/ai";

export interface MintState { token?: string; label?: string; limit?: string; error?: string }

export async function mintToken(_prev: MintState, f: FormData): Promise<MintState> {
  const v = await requireViewer();
  const dollars = Number(String(f.get("limit") ?? "15000").replace(/[$,\s]/g, ""));
  const hours = Number(f.get("hours") ?? 24);
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 100_000) return { error: "Enter a spend limit between $0 and $100,000." };
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) return { error: "Enter a lifetime between 1 and 720 hours." };
  try {
    const t = await mintAgentToken({ id: v.id, role: v.role }, { label: String(f.get("label") ?? ""), spendLimitCents: Math.round(dollars * 100), ttlHours: hours });
    revalidatePath("/account/ai");
    return { token: t.token, label: t.label, limit: `$${(t.spendLimitCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` };
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : "The token could not be created." };
  }
}

export async function revokeToken(f: FormData) {
  const v = await requireViewer();
  await revokeAgentToken({ id: v.id, role: v.role }, String(f.get("id") ?? "")).catch(() => undefined);
  revalidatePath("/account/ai");
}

export async function dismissRequest(f: FormData) {
  const v = await requireViewer();
  await resolveAgentApproval({ id: v.id, role: v.role }, String(f.get("id") ?? ""), "DISMISSED").catch(() => undefined);
  revalidatePath("/account/ai");
}
