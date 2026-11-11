"use server";
/**
 * Server actions for the back-office consoles (F5.01, F5.03, F5.04, F3.11 fees). Each validates input,
 * checks the role, writes the audit chain (inside the called function) and returns to the page with a short notice.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/session";
import { can } from "@/lib/rbac";
import { DomainError, type Actor } from "../types";
import { runReconcile } from "./recon";
import { approve, propose, veto } from "./dual";
import { setFee } from "./fees";
import { hourly, verifyAndRecord } from "./health";
import { retryRepresentment } from "../representment";
import { representmentRail } from "../money/webhook";

const safeBack = (v: FormDataEntryValue | null, dflt: string) => { const s = String(v ?? ""); return s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") ? s.split("?")[0] : dflt; };
const withMsg = (path: string, k: "ok" | "err", m: string, extra = "") => `${path}?${k}=${encodeURIComponent(m.slice(0, 300))}${extra}`;
async function me(): Promise<Actor> { const v = await requireViewer(); return { id: v.id, role: v.role, name: v.name }; }
const message = (e: unknown) => (e instanceof DomainError ? e.message : e instanceof z.ZodError ? e.issues[0]?.message ?? "Invalid input." : "That did not work. Nothing was changed.");

export async function runReconAction(f: FormData) {
  const a = await me(), back = safeBack(f.get("back"), "/finance/recon");
  let to: string;
  try {
    const r = await runReconcile(a, undefined);
    const msg = r.verdict === "CLEAN" ? `Run finished: all ${r.lines.length} tranches match across contract, ledger and PayPal.` : r.verdict === "IN_FLIGHT" ? `Run finished: nothing has drifted; ${r.lines.filter((l) => l.status !== "MATCHED").length} tranche(s) still waiting on PayPal data.` : `Run finished: drift found on ${r.lines.filter((l) => l.status === "DRIFT").length} tranche(s). Their releases are paused by the circuit breaker.`;
    to = withMsg(back, r.verdict === "DRIFT" ? "err" : "ok", msg, `&run=${r.runId}`);
  } catch (e) { to = withMsg(back, "err", message(e)); }
  revalidatePath("/finance", "layout");
  redirect(to);
}

const ProposeIn = z.object({ action: z.string(), target: z.string().trim().min(1, "Choose what this applies to."), reason: z.string(), payload: z.string().optional() });
export async function proposeAction(f: FormData) {
  const a = await me(), back = safeBack(f.get("back"), "/admin/dual-control");
  let to: string;
  try {
    const p = ProposeIn.parse({ action: f.get("action"), target: f.get("target"), reason: f.get("reason") ?? "", payload: f.get("payload") ?? undefined });
    let payload: Record<string, unknown> = {};
    if (p.action === "FLIP_FLAG") payload = { on: String(f.get("on")) === "true" };
    else if (p.action === "SET_TRUST_TIER") payload = { tier: String(f.get("tier") ?? "") };
    else if (p.action === "EXTEND_VAULT") payload = { hours: Number(f.get("hours") ?? 24) };
    else if (p.action === "PUBLISH_BLUEPRINT") payload = { active: String(f.get("active")) !== "false", version: String(f.get("version") ?? "").trim() || undefined, note: String(f.get("note") ?? "").trim() || undefined };
    else if (p.payload) payload = JSON.parse(p.payload) as Record<string, unknown>;
    const id = await propose(a, p.action, p.target, payload, p.reason);
    to = withMsg(back, "ok", `Request ${id} is waiting for a second person. It expires in 30 minutes.`);
  } catch (e) { to = withMsg(back, "err", message(e)); }
  revalidatePath("/", "layout");
  redirect(to);
}

export async function approveAction(f: FormData) {
  const a = await me(), back = safeBack(f.get("back"), "/admin/dual-control"), id = String(f.get("id") ?? "");
  let to: string;
  try {
    const r = await approve(a, id);
    const note = typeof r.note === "string" ? r.note : r.replayed === true ? "Webhook replayed." : "Done.";
    to = withMsg(back, r.replayed === false ? "err" : "ok", `Approved and executed. ${note}`);
  } catch (e) { to = withMsg(back, "err", message(e)); }
  revalidatePath("/", "layout");
  redirect(to);
}

export async function vetoAction(f: FormData) {
  const a = await me(), back = safeBack(f.get("back"), "/admin/dual-control"), id = String(f.get("id") ?? "");
  let to: string;
  try { await veto(a, id, String(f.get("note") ?? "")); to = withMsg(back, "ok", "Request stopped. Nothing was executed."); }
  catch (e) { to = withMsg(back, "err", message(e)); }
  revalidatePath("/", "layout");
  redirect(to);
}

export async function setFeeAction(f: FormData) {
  const a = await me();
  let to: string;
  try {
    const pct = String(f.get("feePct") ?? "").trim();
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(pct)) throw new DomainError("INVALID", "Enter the fee as a percentage with up to two decimals, for example 2.50.");
    const [w, d = ""] = pct.split(".");
    const bps = Number(w) * 100 + Number((d + "00").slice(0, 2));
    const r = await setFee(a, { vertical: String(f.get("vertical") ?? ""), feeBps: bps, note: String(f.get("note") ?? "") });
    to = withMsg("/finance/fees", "ok", `Fee for ${String(f.get("vertical"))} is now ${(r.to / 100).toFixed(2)}% for new contracts (was ${(r.from / 100).toFixed(2)}%). Signed contracts keep their fee.`);
  } catch (e) { to = withMsg("/finance/fees", "err", message(e)); }
  revalidatePath("/finance/fees");
  redirect(to);
}

export async function verifyChainAction(f: FormData) {
  const v = await requireViewer();
  const back = safeBack(f.get("back"), "/admin/audit");
  if (!can(v.role, "audit.read") || v.role === "client" || v.role === "provider") redirect(withMsg(back, "err", "Your role cannot verify the whole chain."));
  const r = await verifyAndRecord({ id: v.id, role: v.role });
  revalidatePath("/admin", "layout");
  redirect(r.ok ? withMsg(back, "ok", `Chain intact: all ${r.rows} entries recomputed and linked.`, "&verify=ok") : withMsg(back, "err", `Chain broken at entry #${r.brokenAt}. Admins have been paged.`, `&verify=broken&at=${r.brokenAt}`));
}

export async function hourlyAction() {
  const v = await requireViewer(["admin"]);
  let to: string;
  try {
    const r = await hourly();
    to = withMsg("/admin", r.chain.ok && r.recon.verdict !== "DRIFT" ? "ok" : "err", `Checks ran: ${r.expired} request(s) expired, audit chain ${r.chain.ok ? "intact" : `broken at #${r.chain.brokenAt}`}, reconciliation ${r.recon.verdict.toLowerCase().replace("_", " ")}.`);
  } catch (e) { to = withMsg("/admin", "err", message(e)); }
  void v;
  revalidatePath("/", "layout");
  redirect(to);
}

/** F4.10: Ops sends a PayPal dispute dossier again (FAILED or not yet eligible). Same stored dossier and key. */
export async function retryRepresentmentAction(f: FormData) {
  const a = await me(), back = safeBack(f.get("back"), "/ops/representments"), id = String(f.get("id") ?? "");
  let to: string;
  try {
    const r = await retryRepresentment(a, id, representmentRail);
    to = r.status === "SUBMITTED" ? withMsg(back, "ok", `Dossier sent to PayPal for dispute ${r.disputeId}.`)
      : r.status === "NOT_ELIGIBLE" ? withMsg(back, "err", `PayPal is not taking seller evidence on ${r.disputeId} yet. Try again when the dispute asks for it.`)
      : withMsg(back, "err", `Not sent: ${r.lastError ?? "unknown error"}. The dossier is kept; try again.`);
  } catch (e) { to = withMsg(back, "err", message(e)); }
  revalidatePath("/ops", "layout");
  redirect(to);
}
