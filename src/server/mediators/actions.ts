"use server";
/**
 * F4.05 F4.06 F4.07 — server actions behind the mediator network screens. Every input is checked
 * again (zod) in src/server/mediators; permissions are checked there too (can() / ownership).
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireViewer } from "@/lib/session";
import { rateLimitKey } from "@/lib/net";
import { DomainError, NotBuilt, type Actor } from "../types";
import * as M from "./index";
import type { ApplicationField } from "./rules";

async function actor(): Promise<Actor & { orgId: string }> {
  const v = await requireViewer();
  return { id: v.id, role: v.role, name: v.name, orgId: v.orgId };
}
const say = (e: unknown) => e instanceof DomainError ? e.message : e instanceof NotBuilt ? "That part of PaySettle is not built yet in this environment." : "Something went wrong. Nothing was changed.";
const go = (path: string, q: Record<string, string>) => `${path}?${new URLSearchParams(q).toString()}`;
const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const safeBack = (b: string, d: string) => (b.startsWith("/") && !b.startsWith("//") ? b : d);
const date = (f: FormData, k: string) => { const v = str(f, k).trim(); return v ? v : null; };

async function run(back: string, ok: string, fn: () => Promise<unknown>) {
  let q: Record<string, string> = { ok };
  try { await fn(); } catch (e) { q = { error: say(e) }; }
  revalidatePath(back.split("?")[0]);
  redirect(go(back.split("?")[0], q));
}

/* ── mediator: offers ── */
export async function acceptOfferAction(f: FormData) {
  const a = await actor();
  let to: string;
  try { const id = await M.acceptOffer(a, str(f, "offerId")); to = go(`/mediator/cases/${id}`, { ok: "You took the case. The sealed dossier is yours to decide." }); }
  catch (e) { to = go("/mediator/cases", { error: say(e) }); }
  revalidatePath("/mediator/cases");
  redirect(to);
}
export async function declineOfferAction(f: FormData) {
  const a = await actor();
  return run("/mediator/cases", "Declined. The case went to the next mediator in the ranking.", () => M.declineOffer(a, str(f, "offerId"), str(f, "reason")));
}

/* ── mediator: own profile ── */
export async function updateProfileAction(f: FormData) {
  const a = await actor();
  return run("/mediator/profile", "Profile saved.", () => M.updateProfile(a, {
    bio: str(f, "bio"), languages: f.getAll("languages").map(String), timezone: str(f, "timezone"), maxOpen: Math.round(Number(str(f, "maxOpen"))),
    declaredConflicts: str(f, "declaredConflicts").split(/\n+/).map((s) => s.trim()).filter(Boolean),
  }));
}
export async function availabilityAction(f: FormData) {
  const a = await actor();
  return run("/mediator/profile", "Availability saved.", () => M.setAvailability(a, { weeklyHours: Math.round(Number(str(f, "weeklyHours"))), leaveFrom: date(f, "leaveFrom"), leaveTo: date(f, "leaveTo"), paused: str(f, "paused") === "on" }));
}
export async function credentialAction(f: FormData) {
  const a = await actor();
  return run("/mediator/profile", "Credential added. Ops checks it before it counts.", async () => {
    const file = f.get("file");
    const up = file instanceof File && file.size > 0 ? { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) } : undefined;
    await M.addCredential(a, { type: str(f, "type"), issuer: str(f, "issuer"), number: str(f, "number"), expiresOn: date(f, "expiresOn") }, up);
  });
}
export async function calibrationAction(f: FormData) {
  const a = await actor();
  let q: Record<string, string>;
  try {
    const ids = f.getAll("caseId").map(String);
    const r = await M.submitCalibration(a, ids.map((id) => ({ caseId: id, shareBps: Math.round(Number(str(f, `share_${id}`)) * 100), rootCause: str(f, `root_${id}`) })));
    q = r.passed ? { ok: `Calibration passed (${r.scorePct}%). You are now on probation: your first 5 verdicts are co-signed by a Senior mediator.` }
      : { error: `Not passed this time (${r.scorePct}% of cases within 10 points with the right root cause). ${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? "" : "s"} left.` };
  } catch (e) { q = { error: say(e) }; }
  revalidatePath("/mediator/profile");
  redirect(go("/mediator/profile", q));
}

/* ── parties: rating after settlement ── */
export async function reviewAction(f: FormData) {
  const a = await actor(); const id = str(f, "disputeId");
  return run(`/disputes/${id}`, "Thank you. Your rating is recorded.", () => M.submitReview(a, id, Math.round(Number(str(f, "score"))), str(f, "comment")));
}

/* ── Ops ── */
const OPS = "/ops/mediators";
export async function decideApplicationAction(f: FormData) {
  const a = await actor();
  const decision = str(f, "decision") === "APPROVE" ? "APPROVE" : "REJECT";
  return run(OPS, decision === "APPROVE" ? "Approved. A profile in Verifying was created; check the credentials next." : "Application rejected.", () => M.decideApplication(a, a.orgId, str(f, "applicationId"), decision, str(f, "note")));
}
export async function verifyCredentialAction(f: FormData) {
  const a = await actor();
  const d = str(f, "decision") === "VERIFIED" ? "VERIFIED" : "REJECTED";
  return run(OPS, d === "VERIFIED" ? "Credential verified." : "Credential rejected.", () => M.verifyCredential(a, str(f, "credentialId"), d, str(f, "note")));
}
export async function moveStatusAction(f: FormData) {
  const a = await actor();
  return run(OPS, "Status changed.", () => M.moveStatus(a, str(f, "userId"), str(f, "to"), str(f, "note")));
}
export async function networkFieldsAction(f: FormData) {
  const a = await actor();
  const firm = str(f, "firm").trim();
  return run(OPS, "Network details saved.", () => M.setNetworkFields(a, str(f, "userId"), { domains: f.getAll("domains").map(String), firm: firm || null, maxOpen: Math.round(Number(str(f, "maxOpen"))) }));
}
export async function opsAssignAction(f: FormData) {
  const a = await actor();
  return run(OPS, "Offered to the mediator you picked. They have the usual window to accept.", () => M.opsAssign(a, str(f, "disputeId"), str(f, "mediatorId")));
}
export async function secondReviewAction(f: FormData) {
  const a = await actor();
  return run(OPS, "Second review recorded.", () => M.recordSecondReview(a, str(f, "disputeId"), str(f, "outcome") === "DISAGREE" ? "DISAGREE" : "AGREE", str(f, "reviewerId"), str(f, "note")));
}
export async function feePaidAction(f: FormData) {
  const a = await actor();
  return run(safeBack(str(f, "back"), OPS), "Marked as paid.", () => M.markFeePaid(a, str(f, "feeId")));
}

/* ── public application (no sign-in) ── */
export interface ApplyState { ok: boolean; message: string; errors?: Partial<Record<ApplicationField, string>> }
export async function applyAction(_prev: ApplyState | null, f: FormData): Promise<ApplyState> {
  const input: Record<string, unknown> = {};
  for (const k of ["name", "email", "timezone", "firm", "credentials", "conflicts", "weeklyHours", "website"]) { const v = f.get(k); if (typeof v === "string") input[k] = v; }
  input.domains = f.getAll("domains").filter((x): x is string => typeof x === "string");
  input.languages = f.getAll("languages").filter((x): x is string => typeof x === "string");
  try {
    const r = await M.submitApplication(input, rateLimitKey(await headers()));
    if (r.ok) return { ok: true, message: r.code === "already" ? "We already have an application from this address. Ops will reply by e-mail." : "Thank you. Ops reviews applications within five working days and replies by e-mail." };
    if (r.code === "limit") return { ok: false, message: `Too many attempts from this network. Try again in ${Math.ceil(r.retryAfterS / 60)} minutes.` };
    return { ok: false, message: "Some answers need a fix. They are marked below.", errors: r.errors };
  } catch {
    return { ok: false, message: "We could not save the application. Nothing was stored; please try again." };
  }
}
