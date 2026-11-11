"use server";
/**
 * Server actions behind the dispute screens. F4.01 open · F4.02 bid / skip · F4.03 rebuttal,
 * lock, extension · F4.04 annotations · F4.06 verdict, co-sign · F4.08 retry. Input checked again in src/server/disputes.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/session";
import { sha256 } from "@/lib/ids";
import { DomainError, NotBuilt, type Actor } from "../types";
import { addRebuttal, cosignVerdict, grantExtension, issueVerdict, lockVault, openDispute, placeBid, retryExecution, sealVault, skipToVault, storeRebuttalFile } from "./index";

async function actor(): Promise<Actor> {
  const v = await requireViewer();
  return { id: v.id, role: v.role, name: v.name };
}
const say = (e: unknown) => e instanceof DomainError ? e.message : e instanceof NotBuilt ? "That part of PaySettle is not built yet in this environment." : "Something went wrong. Nothing was changed.";
const go = (path: string, q: Record<string, string>) => `${path}?${new URLSearchParams(q).toString()}`;
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function openDisputeAction(f: FormData) {
  const a = await actor();
  const milestoneId = str(f, "milestoneId");
  let to: string;
  try { const id = await openDispute(a, milestoneId, str(f, "reason"), str(f, "narrative")); to = `/disputes/${id}`; }
  catch (e) { to = go("/client/disputes/new", { milestone: milestoneId, error: say(e) }); }
  revalidatePath("/client/disputes");
  redirect(to);
}

export async function bidAction(f: FormData) {
  const a = await actor();
  const id = str(f, "disputeId");
  const bps = Math.round(Number(str(f, "sharePct")) * 100);
  let q: Record<string, string>;
  try {
    const r = await placeBid(a, id, bps);
    q = r.settled ? { ok: `Both offers met. Settled at ${(r.shareBps! / 100).toFixed(2)}% to the provider.` } : { ok: "Your sealed offer is in. It stays hidden unless both offers meet within 5 points." };
  } catch (e) { q = { error: say(e) }; }
  revalidatePath(`/disputes/${id}`);
  redirect(go(`/disputes/${id}`, q));
}

export async function skipAction(f: FormData) {
  const a = await actor(); const id = str(f, "disputeId");
  let q: Record<string, string> = { ok: "Moved to the evidence vault (Tier 2). Skipping costs nothing." };
  try { await skipToVault(a, id); } catch (e) { q = { error: say(e) }; }
  redirect(go(`/disputes/${id}`, q));
}

export async function rebuttalAction(f: FormData) {
  const a = await actor(); const id = str(f, "disputeId");
  let q: Record<string, string> = { ok: "Added to the vault. Entries cannot be edited or removed." };
  try {
    const narrative = str(f, "narrative");
    let annotations: unknown[] = [];
    const raw = str(f, "annotations");
    if (raw) { try { annotations = JSON.parse(raw); } catch { throw new DomainError("BAD_INPUT", "The marks could not be read. Draw them again."); } }
    const file = f.get("file");
    let hash = sha256(`${a.id}:${narrative}:${raw}`), kind = annotations.length ? "ANNOTATION" : "NOTE";
    if (file instanceof File && file.size > 0) {
      hash = await storeRebuttalFile(a, id, { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
      kind = "FILE";
    }
    await addRebuttal(a, id, { kind, narrative, sha256: hash, annotations });
  } catch (e) { q = { error: say(e) }; }
  revalidatePath(`/disputes/${id}`);
  redirect(go(`/disputes/${id}`, q));
}

export async function lockAction(f: FormData) {
  const a = await actor(); const id = str(f, "disputeId");
  let q: Record<string, string>;
  try { const r = await lockVault(a, id); q = { ok: r.sealed ? "Both sides locked. The vault is sealed and a mediator is assigned." : "Your side is locked. The vault seals when the other side locks or at the deadline." }; }
  catch (e) { q = { error: say(e) }; }
  redirect(go(`/disputes/${id}`, q));
}

export async function sealNowAction(f: FormData) {
  const a = await actor(); const id = str(f, "disputeId"); const back = str(f, "back") || `/disputes/${id}`;
  let q: Record<string, string> = { ok: "Vault sealed." };
  try { await sealVault(a, id); } catch (e) { q = { error: say(e) }; }
  redirect(go(back, q));
}

export async function verdictAction(f: FormData) {
  const a = await actor(); const id = str(f, "disputeId");
  const back = `/mediator/cases/${id}`;
  let q: Record<string, string>;
  try {
    const fault = str(f, "fault");
    await issueVerdict(a, id, {
      providerShareBps: Math.round(Number(str(f, "shareBps"))), findings: str(f, "findings"), rootCause: str(f, "rootCause"),
      disposition: str(f, "disposition") === "TERMINATE" ? "TERMINATE" : "RESUME", fault: fault === "CLIENT" || fault === "PROVIDER" || fault === "SHARED" ? fault : undefined,
    });
    q = { ok: "Verdict signed." };
  } catch (e) { q = { error: say(e) }; }
  revalidatePath(back);
  redirect(go(back, q));
}

export async function cosignAction(f: FormData) {
  const a = await actor(); const id = str(f, "disputeId");
  let q: Record<string, string> = { ok: "Co-signed. Settlement has started." };
  try { await cosignVerdict(a, id); } catch (e) { q = { error: say(e) }; }
  redirect(go(`/mediator/cases/${id}`, q));
}

export async function retryAction(f: FormData) {
  const a = await actor(); const id = str(f, "disputeId"); const back = str(f, "back") || `/disputes/${id}`;
  let q: Record<string, string>;
  try { const r = await retryExecution(a, id); q = r.done ? { ok: "Settlement finished." } : { error: `Settlement is still not finished: ${r.error ?? "try again shortly"}` }; }
  catch (e) { q = { error: say(e) }; }
  redirect(go(back, q));
}

export async function extendAction(f: FormData) {
  const a = await actor(); const id = str(f, "disputeId");
  let q: Record<string, string> = { ok: "Late evidence is allowed for the hours you set." };
  try { await grantExtension(a, id, Math.round(Number(str(f, "hours")))); } catch (e) { q = { error: say(e) }; }
  redirect(go(`/mediator/cases/${id}`, q));
}
