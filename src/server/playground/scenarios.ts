/**
 * Scenario engine (S1–S6; F5.06 four-quadrant playground, F5.07 time machine, F5.08 chaos, P9).
 * Each scenario is an ordered list of steps {id, label, explain, run(ctx)}. A step acts as a seeded persona (client, provider,
 * mediator, ops, finance) through the other modules' index.ts exports only. While a module still throws NotBuilt the step reports
 * "waiting for module X" instead of crashing. Steps are resumable: ids carried between steps live in sim_progress.bag.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { blueprints, disputes, evidencePackages, ledgerEntries, releases, tranches, users, verdicts, webhookEvents, type BlueprintMilestone } from "@/db/schema";
import type { SimStepRecord } from "@/db/schema-playground";
import { audit } from "@/lib/audit";
import { idemKey, newId, sha256 } from "@/lib/ids";
import { formatCents, pct } from "@/lib/money";
import { mockControl } from "@/lib/rails/mock";
import { hotp, base32Decode, stepOf } from "@/lib/identity/totp";
import { DomainError, type Actor, type WorkspaceView } from "../types";
import * as contracts from "../contracts";
import * as money from "../money";
import * as evidence from "../evidence";
import * as disputesSvc from "../disputes";
import * as ai from "../ai";
import * as control from "../control";
import { SITE, SPOOF_POINT, VALID_POINT, filesForSpec, haversineM, noteForSpec, photo, type SimFile } from "./fixtures";
import {
  WaitingFor, actorFor, addFault, assertSandbox, getSim, hoursToDay, logDiff, logEvent, progressOf, railSnapshot, saveProgress,
  setSimWorkspace, simDay, simNow, travelInRun, withSimLock, moduleCall, type Sim,
} from "./session";
import { httpCall } from "./transport";

/* ── types ── */

export type Bag = Record<string, unknown> & {
  workspaceId?: string; blueprintCode?: string; approveUrls?: Record<string, string>; pkgs?: Record<string, { packageId: string; rootHash: string; signals: { code: string; level: string; detail: string }[] }>;
  disputeId?: string; newTrancheId?: string; tokens?: Record<string, string>; mcpWorkspaceId?: string; webhookId?: string; photoCode?: string;
};
export interface StepOutcome { status: "done" | "waiting" | "error" | "skipped"; detail: string; link?: string }
export interface StepCtx {
  sim: Sim; bag: Bag; stepId: string; baseUrl?: string; judge: { id: string; role: string };
  as(role: PersonaRole): Promise<Actor>;
  log(kind: "rail" | "webhook" | "mcp" | "ledger" | "state" | "fault", request: string, response: string, ok?: boolean): Promise<void>;
  refreshSim(): Promise<Sim>;
}
export interface Step { id: string; label: string; explain: string; who: PersonaRole | "system" | "judge"; run(ctx: StepCtx): Promise<StepOutcome> }
export type ScenarioId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";
export type PersonaRole = "client" | "provider" | "mediator" | "cosigner" | "ops" | "finance";
export interface Scenario { id: ScenarioId; title: string; proves: string; seconds: number; blueprints: string[]; personas: Record<PersonaRole, string>; steps: Step[] }

const done = (detail: string, link?: string): StepOutcome => ({ status: "done", detail, link });
const skipped = (detail: string): StepOutcome => ({ status: "skipped", detail });
const waiting = (detail: string, link?: string): StepOutcome => ({ status: "waiting", detail, link });
const failed = (detail: string): StepOutcome => ({ status: "error", detail });

const PERSONAS_A: Record<PersonaRole, string> = { client: "u_priya", provider: "u_meera", mediator: "u_med", cosigner: "u_med2", ops: "u_ops", finance: "u_fin" };
const PERSONAS_B: Record<PersonaRole, string> = { client: "u_dan", provider: "u_arjun", mediator: "u_med", cosigner: "u_med2", ops: "u_ops", finance: "u_fin" };

/* ── shared helpers ── */

async function pickBlueprint(codes: string[]): Promise<{ code: string; title: string; milestones: BlueprintMilestone[] }> {
  const rows = await db.select({ code: blueprints.code, title: blueprints.title, milestones: blueprints.milestones }).from(blueprints).where(inArray(blueprints.code, codes));
  for (const c of codes) { const r = rows.find((x) => x.code === c); if (r) return r; }
  throw new DomainError("BLUEPRINT_MISSING", `None of the blueprints ${codes.join(", ")} is seeded. Run npm run db:seed.`);
}

/** The workspace as the client sees it. */
async function view(ctx: StepCtx): Promise<WorkspaceView> {
  if (!ctx.bag.workspaceId) throw new DomainError("NO_WORKSPACE", "No contract yet: run the first step.");
  const c = await ctx.as("client");
  return moduleCall("contracts", () => contracts.getWorkspace(c, ctx.bag.workspaceId!));
}
const msOf = (v: WorkspaceView, code: string) => {
  const m = v.milestones.find((x) => x.code === code && x.active);
  if (!m) throw new DomainError("MILESTONE_MISSING", `Milestone ${code} is not in this contract.`);
  return m;
};
const firstPay = (v: WorkspaceView) => v.milestones.filter((m) => m.active && m.type === "PAY").sort((a, b) => a.targetDay - b.targetDay || a.seq - b.seq)[0];
const trancheOf = (v: WorkspaceView, idx = 1) => v.tranches.find((t) => t.idx === idx) ?? null;

/** A TOTP code for a seeded person who has an authenticator secret (none by default); avoids reusing a spent step. */
async function mfaFor(userId: string): Promise<string | undefined> {
  const [u] = await db.select({ s: users.mfaSecret, last: users.mfaLastStep }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.s) return undefined;
  const now = stepOf(Date.now());
  const step = Math.max(now - 1, u.last + 1);
  return step <= now + 1 ? hotp(base32Decode(u.s), step) : undefined;
}

const RELEASED = new Set(["RELEASED", "SETTLED_BY_VERDICT"]);
const OPENABLE = new Set(["OPEN", "REMEDIATION"]);

/* ── setup stages (S1 shows each; S2–S5 run them as one resumable step) ── */

interface SetupCfg { blueprints: string[]; title: string; totalCents: number | ((b: { milestones: BlueprintMilestone[] }) => number); afterCreate?: (ctx: StepCtx) => Promise<StepOutcome>; pick?: () => Promise<{ code: string; title: string; milestones: BlueprintMilestone[] }> }

async function stCreate(ctx: StepCtx, cfg: SetupCfg): Promise<StepOutcome> {
  if (ctx.bag.workspaceId) return skipped(`Contract ${ctx.bag.workspaceId} already exists.`);
  const b = cfg.pick ? await cfg.pick() : await pickBlueprint(cfg.blueprints);
  const total = typeof cfg.totalCents === "number" ? cfg.totalCents : cfg.totalCents(b);
  const client = await ctx.as("client"), provider = await ctx.as("provider");
  const id = await moduleCall("contracts", () => contracts.createWorkspace(client, {
    blueprintCode: b.code, title: `${cfg.title} (playground ${ctx.sim.id.slice(-6)})`, totalCents: total, providerId: provider.id,
    draft: { source: "judge-playground", simId: ctx.sim.id, site: { lat: SITE.lat, lng: SITE.lng, label: SITE.label } },
  }));
  ctx.bag.workspaceId = id; ctx.bag.blueprintCode = b.code;
  await setSimWorkspace(ctx.sim.id, id);
  const site = await setSite(ctx, id);
  const v = await view(ctx);
  const issues = v.violations.length ? ` Policy gate: ${v.violations.map((x) => `${x.rule} ${x.message}`).join(" ")}` : " Policy gate: all ten rules pass.";
  return done(`${client.name} cloned “${b.title}” for ${formatCents(total)} with ${provider.name}: ${v.milestones.filter((m) => m.active).length} milestones, state ${v.state}.${issues}${site}`);
}

/** The site location photos are checked against (evidence module). Simulated: a workshop in Pune. */
async function setSite(ctx: StepCtx, workspaceId: string): Promise<string> {
  const client = await ctx.as("client");
  try { await moduleCall("evidence", () => evidence.setWorkspaceSite(client, workspaceId, { lat: SITE.lat, lng: SITE.lng, label: SITE.label })); return ` Site location on file: ${SITE.label}.`; }
  catch (e) { if (e instanceof WaitingFor || e instanceof DomainError) return ` Site location not set (${e.message}).`; throw e; }
}

/** S2 on a blueprint without located photos: the client appends a GPS-checked payment milestone (Append-and-Prune) and rebalances. */
async function stEnsureGpsMilestone(ctx: StepCtx): Promise<StepOutcome> {
  const v = await view(ctx);
  const pay = v.milestones.filter((m) => m.active && m.type === "PAY").sort((a, b) => a.seq - b.seq);
  if (pay.some((m) => m.proof.gpsRadiusM && m.proof.artifacts.some((a) => a.kind === "IMAGE"))) return skipped("The blueprint already has located-photo milestones.");
  if (v.signatures.some((s) => !s.voided)) return skipped("Already signed; no more edits.");
  const last = pay[pay.length - 1];
  const client = await ctx.as("client");
  await moduleCall("contracts", () => contracts.applyChange(client, v.id, { action: "APPEND", milestone: { title: "On-site photo check at the workshop", type: "PAY", day: Math.max(2, Math.min(5, last.targetDay)), bps: 1000, proof: { artifacts: [{ kind: "IMAGE", min: 1, note: "Photo taken at the workshop" }], gpsRadiusM: 500, criteria: ["The photo shows the agreed work at the workshop"] }, lockRule: "Client approves the photo.", disputeRule: "A photo from elsewhere is retaken on site within 72 hours." } }));
  const after = await moduleCall("contracts", () => contracts.applyChange(client, v.id, { action: "SET_BPS", shares: { [last.code]: last.bps - 1000 } }));
  const added = after.milestones.find((m) => m.origin === "CUSTOM" && m.active);
  if (added) ctx.bag.photoCode = added.code;
  return done(`This blueprint has no located-photo milestone, so ${client.name} appended ${added?.code ?? "one"} “On-site photo check” (10%, photos within 500 m of the workshop) and moved 10 points from ${last.code}. Revision ${after.revision}, state ${after.state}.`);
}

async function stNegotiate(ctx: StepCtx): Promise<StepOutcome> {
  if (ctx.bag.negotiated) return skipped("Already negotiated.");
  const v = await view(ctx);
  if (v.signatures.some((s) => !s.voided)) return skipped("Someone already signed; no more edits.");
  const optional = v.clauses.find((c) => c.category === "BASELINE" && !c.protective && c.active);
  if (!optional) { ctx.bag.negotiated = true; return skipped("Nothing optional to prune; the blueprint terms stand."); }
  const provider = await ctx.as("provider");
  const after = await moduleCall("contracts", () => contracts.applyChange(provider, v.id, { action: "TOGGLE_CLAUSE", clauseCode: optional.code, active: false }));
  ctx.bag.negotiated = true;
  return done(`${provider.name} pruned the optional clause “${optional.title}” (Append-and-Prune). Revision ${v.revision} → ${after.revision}; state ${after.state}; risk score ${after.riskScore}.`);
}

async function stSign(ctx: StepCtx, role: "client" | "provider"): Promise<StepOutcome> {
  const v = await view(ctx);
  if (["SIGNED", "PENDING_OPS", "LOCKED"].includes(v.state)) return skipped(`Contract is already ${v.state}.`);
  if (v.signatures.some((s) => s.role === role && !s.voided && s.revNo === v.revision)) return skipped(`The ${role} already signed revision ${v.revision}.`);
  if (v.state === "DRAFT" && v.violations.length) return failed(`The policy gate blocks signing: ${v.violations.map((x) => `${x.rule} ${x.message}`).join(" ")}`);
  if (!v.canonicalHash) return failed(`Revision ${v.revision} has no hash yet (state ${v.state}).`);
  const a = await ctx.as(role);
  const after = await moduleCall("contracts", () => contracts.sign(a, v.id, v.revision, v.canonicalHash!, undefined));
  return done(`${a.name} signed revision ${v.revision} (hash ${v.canonicalHash.slice(0, 12)}…). State ${after.state}.`);
}

async function stSignWithMfa(ctx: StepCtx, role: "client" | "provider"): Promise<StepOutcome> {
  // MFA codes are generated for seeded people who have an authenticator secret; demo people sign with their demo session's MFA.
  const a = await ctx.as(role);
  const code = await mfaFor(a.id);
  if (!code) return stSign(ctx, role);
  const v = await view(ctx);
  if (["SIGNED", "PENDING_OPS", "LOCKED"].includes(v.state) || v.signatures.some((s) => s.role === role && !s.voided && s.revNo === v.revision)) return skipped(`Already signed by the ${role}.`);
  const after = await moduleCall("contracts", () => contracts.sign(a, v.id, v.revision, v.canonicalHash ?? "", code));
  return done(`${a.name} signed revision ${v.revision} with an authenticator code. State ${after.state}.`);
}

async function stLock(ctx: StepCtx): Promise<StepOutcome> {
  let v = await view(ctx);
  if (v.state === "LOCKED") return done(`Locked: ${v.tranches.length} tranche(s) — ${v.tranches.map((t) => `tranche ${t.idx} ${formatCents(t.amountCents)} days ${t.startDay}–${t.endDay}`).join("; ")}.`);
  if (!["SIGNED", "PENDING_OPS"].includes(v.state)) return failed(`Contract is ${v.state}; both parties must sign first.`);
  const ops = await ctx.as("ops");
  await moduleCall("contracts", () => contracts.clearContract(ops, v.id, "clear", `Judge Playground: risk ${v.riskScore} reviewed by simulated Ops.`));
  v = await view(ctx);
  if (v.state !== "LOCKED") return failed(`Expected LOCKED after Ops clearance, got ${v.state}.`);
  return done(`${ops.name} (Ops) cleared the contract at risk ${v.riskScore}. Locked into ${v.tranches.length} tranche(s): ${v.tranches.map((t) => `${formatCents(t.amountCents)} days ${t.startDay}–${t.endDay}`).join("; ")}.`);
}

async function stFund(ctx: StepCtx, idx = 1, trancheId?: string): Promise<StepOutcome> {
  const v = await view(ctx);
  const t = trancheId ? v.tranches.find((x) => x.id === trancheId) : trancheOf(v, idx);
  if (!t) return failed(`Tranche ${trancheId ?? idx} does not exist (contract ${v.state}).`);
  if (t.state !== "PLANNED") return skipped(`Tranche ${t.idx} is already ${t.state}.`);
  const client = await ctx.as("client");
  const r = await moduleCall("money", () => money.fundTranche(client, t.id));
  ctx.bag.approveUrls = { ...(ctx.bag.approveUrls ?? {}), [t.id]: r.approveUrl };
  return ctx.sim.mode === "LIVE"
    ? done(`PayPal order created for ${formatCents(t.amountCents)}. ${client.name} approves it in the PayPal Sandbox window (link).`, r.approveUrl)
    : done(`Order created on the mock rail for ${formatCents(t.amountCents)}; the simulated buyer approval is automatic in fast mode.`);
}

async function stConfirm(ctx: StepCtx, idx = 1, trancheId?: string): Promise<StepOutcome> {
  let v = await view(ctx);
  let t = trancheId ? v.tranches.find((x) => x.id === trancheId) : trancheOf(v, idx);
  if (!t) return failed(`Tranche ${trancheId ?? idx} does not exist.`);
  if (["HELD", "PARTIALLY_RELEASED"].includes(t.state)) return done(`${formatCents(t.amountCents)} held in PayPal for tranche ${t.idx}.`);
  const url = ctx.bag.approveUrls?.[t.id] ?? t.approveUrl ?? undefined;
  const client = await ctx.as("client");
  const tid = t.id;
  if (ctx.sim.mode === "LIVE") {
    try { await moduleCall("money", () => money.confirmTranche(client, tid)); }
    catch (e) { if (e instanceof WaitingFor) throw e; return waiting(`Waiting for the buyer to approve ${formatCents(t.amountCents)} in the PayPal Sandbox. Open the link, approve, then run this step again. (${(e as Error).message})`, url); }
  } else {
    let orderId: string | undefined;
    try { orderId = url ? new URL(url).searchParams.get("token") ?? undefined : undefined; } catch { orderId = undefined; }
    if (!orderId) { const [row] = await db.select({ o: tranches.paypalOrderId }).from(tranches).where(eq(tranches.id, tid)).limit(1); orderId = row?.o ?? undefined; }
    await moduleCall("money", () => money.confirmTranche(client, tid, orderId));
  }
  v = await view(ctx);
  t = v.tranches.find((x) => x.id === tid)!;
  if (!["HELD", "PARTIALLY_RELEASED"].includes(t.state)) return waiting(`Tranche ${t.idx} is ${t.state}; the hold is not confirmed yet.`, url);
  return done(`${formatCents(t.amountCents)} held in PayPal for tranche ${t.idx}. The hold clock starts now (simulated day ${simDay(ctx.sim)}).`);
}

/** S2–S6 helper: everything from draft to a funded hold, resumable. */
async function stSetup(ctx: StepCtx, cfg: SetupCfg): Promise<StepOutcome> {
  const lines: string[] = [];
  for (const stage of [
    () => stCreate(ctx, cfg), ...(cfg.afterCreate ? [() => cfg.afterCreate!(ctx)] : []), () => stSign(ctx, "client"), () => stSign(ctx, "provider"), () => stLock(ctx), () => stFund(ctx, 1), () => stConfirm(ctx, 1),
  ]) {
    const r = await stage();
    if (r.status === "waiting" || r.status === "error") return { ...r, detail: [...lines, r.detail].join(" · ") };
    if (r.status === "done") lines.push(r.detail);
  }
  return done(lines.join(" · ") || "Contract already set up and funded.");
}

/**
 * Pass the prerequisites of `code` (F3.03 DAG unlocker): every milestone it depends on, directly or through others, gets its
 * evidence and the client's approval, in sequence. Gates move no money; a payment prerequisite is released as normal.
 */
async function stGate(ctx: StepCtx, code: () => Promise<string>): Promise<StepOutcome> {
  let v = await view(ctx);
  const target = msOf(v, await code());
  if (OPENABLE.has(target.state) || target.state === "SUBMITTED") return skipped(`${target.code} is already ${target.state}; nothing to unlock.`);
  const act = v.milestones.filter((m) => m.active);
  const byCode = new Map(act.map((m) => [m.code, m]));
  const need = new Set<string>();
  if (act.some((m) => m.dependsOn.length > 0)) {
    // declared DAG: everything the target depends on, transitively
    const walk = (c: string) => { for (const d of byCode.get(c)?.dependsOn ?? []) if (byCode.has(d) && !need.has(d)) { need.add(d); walk(d); } };
    walk(target.code);
  } else {
    // no DAG declared: milestones run in date order, so every earlier-dated milestone comes first
    for (const m of act) if (m.targetDay < target.targetDay) need.add(m.code);
  }
  const todo = [...need].map((c) => byCode.get(c)!).filter((m) => !["APPROVED", ...RELEASED].includes(m.state)).sort((a, b) => a.targetDay - b.targetDay || a.seq - b.seq);
  if (!todo.length) return skipped(`${target.code} depends on nothing unfinished; it opens on first submission.`);
  const out: string[] = [];
  for (const g of todo) {
    const s = await stSubmit(ctx, g.code);
    if (s.status !== "done" && s.status !== "skipped") return { ...s, detail: [...out, s.detail].join(" · ") };
    const a = await stApprove(ctx, g.code);
    if (a.status !== "done" && a.status !== "skipped") return { ...a, detail: [...out, a.detail].join(" · ") };
    out.push(`${g.code} “${g.title}” ${g.type === "GATE" ? "passed" : "approved and released"}`);
  }
  v = await view(ctx);
  return done(`Prerequisites done in order: ${out.join("; ")}. ${target.code} is now ${msOf(v, target.code).state}.`);
}

async function stSubmit(ctx: StepCtx, code: string, files?: SimFile[], note?: string): Promise<StepOutcome> {
  const v = await view(ctx);
  const m = msOf(v, code);
  if (["SUBMITTED", "APPROVED", ...RELEASED].includes(m.state) && ctx.bag.pkgs?.[code]) return skipped(`${code} is already ${m.state}.`);
  const provider = await ctx.as("provider");
  const fs = files ?? filesForSpec(m.proof, code, simNow(ctx.sim), VALID_POINT);
  const text = noteForSpec(m.proof, code, note ?? `Playground evidence for ${code} “${m.title}” (simulated files).`);
  const r = await moduleCall("evidence", () => evidence.submitEvidence(provider, m.id, fs, text));
  ctx.bag.pkgs = { ...(ctx.bag.pkgs ?? {}), [code]: r };
  const sig = r.signals.length ? r.signals.map((s) => `${s.level.toUpperCase()} ${s.code}`).join(", ") : "no signals";
  return done(`${provider.name} submitted ${fs.length} file(s) for ${code} “${m.title}”: root hash ${r.rootHash.slice(0, 12)}…; signals: ${sig}.`);
}

async function releaseLine(milestoneId: string): Promise<string | null> {
  const rs = await db.select().from(releases).where(eq(releases.milestoneId, milestoneId)).orderBy(desc(releases.createdAt));
  if (!rs.length) return null;
  return rs.map((r) => `${r.kind === "VERDICT" ? "Verdict release" : "Released"} ${formatCents(r.grossCents)} (${r.status}): provider nets ${formatCents(r.netCents)}, platform fee ${formatCents(r.feeCents)}${r.paypalRef ? `, PayPal ref ${r.paypalRef}` : ""}`).join("; ");
}

async function stApprove(ctx: StepCtx, code: string): Promise<StepOutcome> {
  let v = await view(ctx);
  let m = msOf(v, code);
  if (RELEASED.has(m.state) || m.state === "APPROVED") { const l = await releaseLine(m.id); return skipped(`${code} is already ${m.state}.${l ? " " + l + "." : ""}`); }
  const pkg = ctx.bag.pkgs?.[code];
  if (!pkg) return failed(`No evidence package recorded for ${code}; run the submit step first.`);
  const client = await ctx.as("client");
  const mid = m.id;
  await moduleCall("evidence", () => evidence.approveMilestone(client, mid, pkg.rootHash, undefined));
  v = await view(ctx); m = msOf(v, code);
  const line = await releaseLine(m.id);
  if (m.type === "GATE") return done(`${client.name} approved gate ${code}; no money moves on a gate.`);
  if (!line) return waiting(`${client.name} approved ${code} (state ${m.state}); the release has not been recorded yet.`);
  return done(`${client.name} approved ${code} against root hash ${pkg.rootHash.slice(0, 12)}… with a signed approval. ${line}.`);
}

/* ── chaos helpers ── */

/** Posts a PayPal-shaped webhook to /api/webhooks/paypal marked as simulated (x-paysettle-sim: 1). */
async function postWebhook(ctx: StepCtx, event: { id: string; event_type: string; resource: Record<string, unknown> }, transmissionId: string) {
  const body = JSON.stringify({ ...event, create_time: simNow(ctx.sim).toISOString(), resource_type: "capture", summary: `Simulated ${event.event_type}` });
  const r = await httpCall("/api/webhooks/paypal", {
    method: "POST", body,
    headers: { "content-type": "application/json", "x-paysettle-sim": "1", "paypal-transmission-id": transmissionId, "paypal-transmission-time": new Date().toISOString(), "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/sim-cert", "paypal-transmission-sig": "simulated" },
  }, ctx.baseUrl, "money");
  await ctx.log("webhook", `POST /api/webhooks/paypal · ${event.event_type} · transmission ${transmissionId} (simulated, ${r.via})`, `${r.status} ${r.text.slice(0, 300)}`, r.status < 500);
  return r;
}

async function latestCapture(workspaceId: string): Promise<{ captureId: string; amountCents: number } | null> {
  const tr = await db.select({ id: tranches.id, cap: tranches.captureId }).from(tranches).where(eq(tranches.workspaceId, workspaceId));
  const ids = tr.map((t) => t.id);
  if (!ids.length) return null;
  const [r] = await db.select().from(releases).where(inArray(releases.trancheId, ids)).orderBy(desc(releases.createdAt)).limit(1);
  if (r?.paypalRef) return { captureId: r.paypalRef, amountCents: r.grossCents };
  const t = tr.find((x) => x.cap);
  return t?.cap ? { captureId: t.cap, amountCents: 0 } : null;
}

/* ── MCP (S6) ── */

async function mcpCall(ctx: StepCtx, who: "client" | "provider", tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; result: unknown; text: string }> {
  const token = ctx.bag.tokens?.[who];
  if (!token) throw new DomainError("NO_TOKEN", `No agent token for the ${who}; run the token step first.`);
  const body = JSON.stringify({ jsonrpc: "2.0", id: newId("rpc"), method: "tools/call", params: { name: tool, arguments: args } });
  const r = await httpCall("/api/mcp", { method: "POST", body, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` } }, ctx.baseUrl, "ai");
  const j = r.json as { result?: { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }; error?: { message: string } } | null;
  const text = j?.error?.message ?? j?.result?.content?.map((c) => c.text ?? "").join(" ") ?? r.text;
  let result: unknown = j?.result?.structuredContent;
  if (result === undefined) { try { result = JSON.parse(j?.result?.content?.[0]?.text ?? "null"); } catch { result = null; } }
  const ok = r.status < 400 && !j?.error && !j?.result?.isError;
  const shown = result && typeof result === "object" ? JSON.stringify(result) : text;
  await ctx.log("mcp", `MCP tools/call ${tool} as ${who} agent (${r.via}) ${JSON.stringify(args).slice(0, 200)}`, `${r.status} ${shown.slice(0, 500)}`, ok);
  return { ok, result, text };
}
const pick = (o: unknown, ...keys: string[]): string | undefined => {
  if (!o || typeof o !== "object") return undefined;
  for (const k of keys) { const v = (o as Record<string, unknown>)[k]; if (typeof v === "string") return v; }
  return undefined;
};

/* ── scenario definitions ── */

const WEB = ["UC_WEB_MVP"];
const s1Cfg: SetupCfg = { blueprints: WEB, title: "Web MVP sprint", totalCents: 600_000 };

const S1: Scenario = {
  id: "S1", title: "Happy path — Web MVP $6,000", seconds: 6, blueprints: WEB, personas: PERSONAS_A,
  proves: "PayPal authorize and partial captures, the double-entry ledger and receipts, end to end.",
  steps: [
    { id: "create", who: "client", label: "Clone the Web MVP blueprint for $6,000", explain: "The client copies a vetted blueprint into a negotiation workspace; the policy gate checks all ten rules.", run: (c) => stCreate(c, s1Cfg) },
    { id: "negotiate", who: "provider", label: "Negotiate: prune an optional clause", explain: "Append-and-Prune: the provider switches off an optional baseline clause. System clauses cannot be touched.", run: stNegotiate },
    { id: "sign-client", who: "client", label: "Client signs the revision", explain: "The signature binds to the revision number and its canonical hash.", run: (c) => stSignWithMfa(c, "client") },
    { id: "sign-provider", who: "provider", label: "Provider countersigns", explain: "Same revision and hash (rule R09); the contract is sealed.", run: (c) => stSignWithMfa(c, "provider") },
    { id: "lock", who: "ops", label: "Lock into tranches", explain: "Locking splits the contract into hold-window tranches (26-day cap). Ops clears it if the risk score needs review.", run: stLock },
    { id: "fund", who: "client", label: "Fund tranche 1 through PayPal", explain: "Creates a PayPal order with intent AUTHORIZE. In live mode the client approves it in the PayPal Sandbox.", run: (c) => stFund(c, 1) },
    { id: "confirm", who: "client", label: "Confirm the hold", explain: "After approval the order is authorized: the money is held in PayPal, not by PaySettle. Ledger: HOLD.", run: (c) => stConfirm(c, 1) },
    { id: "gate", who: "provider", label: "Finish prerequisites of M02, if any", explain: "A milestone opens once the milestones it depends on are done. Gates carry no money.", run: (c) => stGate(c, async () => "M02") },
    { id: "submit-m02", who: "provider", label: "Submit evidence for M02 (design)", explain: "Files are hashed into a root hash; signals (type, counts, GPS, dates) are computed.", run: (c) => stSubmit(c, "M02") },
    { id: "approve-m02", who: "client", label: "Approve M02 → release", explain: "The client's signed approval (P4) triggers a partial capture; fee and net are split in integer cents.", run: (c) => stApprove(c, "M02") },
    { id: "submit-m03", who: "provider", label: "Submit evidence for M03 (API on staging)", explain: "Second payment milestone of the same authorization.", run: (c) => stSubmit(c, "M03") },
    { id: "approve-m03", who: "client", label: "Approve M03 → second partial capture", explain: "Another capture against the same PayPal authorization.", run: (c) => stApprove(c, "M03") },
    { id: "submit-m04", who: "provider", label: "Submit evidence for M04 (core features)", explain: "Third payment milestone: walkthrough video, staging link, test report.", run: (c) => stSubmit(c, "M04") },
    { id: "approve-m04", who: "client", label: "Approve M04 → third release", explain: "Three releases from one hold; the remainder stays held in PayPal.", run: (c) => stApprove(c, "M04") },
    { id: "ledger", who: "finance", label: "Check the ledger and the receipts", explain: "Every HOLD, RELEASE and FEE row is double-entry; held + released equals the authorization.", run: stLedgerCheck },
  ],
};

async function stLedgerCheck(ctx: StepCtx): Promise<StepOutcome> {
  const v = await view(ctx);
  const rows: Awaited<ReturnType<typeof money.ledgerFor>> = [];
  for (const t of v.tranches) rows.push(...(await moduleCall("money", () => money.ledgerFor(t.id))));
  const by = (type: string) => rows.filter((r) => r.type === type).reduce((a, r) => a + r.amountCents, 0);
  const rel = await db.select().from(releases).where(inArray(releases.milestoneId, v.milestones.map((m) => m.id)));
  const paid = rel.filter((r) => r.status === "COMPLETED" && r.grossCents > 0);
  const remaining = by("HOLD") - by("RELEASE") - by("FEE") - by("REFUND") - by("VOID");
  const heldTotal = v.tranches.filter((t) => ["HELD", "PARTIALLY_RELEASED"].includes(t.state)).reduce((a, t) => a + t.amountCents, 0);
  const gross = paid.reduce((a, r) => a + r.grossCents, 0);
  const balanced = heldTotal === 0 || remaining === heldTotal - gross;
  return (balanced ? done : failed)(`${rows.length} double-entry ledger rows. Held ${formatCents(by("HOLD"))} → released to the provider ${formatCents(by("RELEASE"))} net + ${formatCents(by("FEE"))} fees across ${paid.length} payment release(s) (${formatCents(gross)} gross); returned ${formatCents(by("REFUND") + by("VOID"))}. Still held in PayPal: ${formatCents(remaining)}${balanced ? " — the ledger balances against the captures" : " — does not match the captures"}.`);
}

/* S2 — spoofed evidence */
const CAR = ["UC_CLASSIC_CAR", ...WEB];
const MAX_FILES_PER_SUBMISSION = 20; // evidence module limit (src/server/evidence/spec.ts MAX_FILES)
const uploads = (m: BlueprintMilestone) => m.proof.artifacts.filter((a) => ["IMAGE", "PDF", "VIDEO", "LOG"].includes(a.kind)).reduce((n, a) => n + Math.max(0, a.min), 0);
/** A blueprint suits S2 if a GPS-checked photo milestone and every milestone before it can be submitted within the file limit. */
function gpsPathFits(ms: BlueprintMilestone[]): boolean {
  const dag = ms.some((m) => (m.dependsOn ?? []).length > 0);
  const byCode = new Map(ms.map((m) => [m.code, m]));
  return ms.filter((m) => m.type === "PAY" && m.proof.gpsRadiusM && m.proof.artifacts.some((a) => a.kind === "IMAGE")).some((target) => {
    const need = new Set<string>();
    if (dag) { const walk = (c: string) => { for (const d of byCode.get(c)?.dependsOn ?? []) if (!need.has(d)) { need.add(d); walk(d); } }; walk(target.code); }
    else for (const m of ms) if (m.day < target.day) need.add(m.code);
    return [target, ...[...need].map((c) => byCode.get(c)).filter((x): x is BlueprintMilestone => Boolean(x))].every((m) => uploads(m) <= MAX_FILES_PER_SUBMISSION);
  });
}
async function pickS2(): Promise<{ code: string; title: string; milestones: BlueprintMilestone[] }> {
  for (const code of CAR) { try { const b = await pickBlueprint([code]); if (code === "UC_WEB_MVP" || gpsPathFits(b.milestones)) return b; } catch { /* not seeded */ } }
  return pickBlueprint(WEB);
}
async function photoCode(ctx: StepCtx): Promise<string> {
  if (ctx.bag.photoCode) return ctx.bag.photoCode;
  const v = await view(ctx);
  const pay = v.milestones.filter((m) => m.active && m.type === "PAY").sort((a, b) => a.targetDay - b.targetDay || a.seq - b.seq);
  const m = pay.find((x) => x.proof.gpsRadiusM && x.proof.artifacts.some((a) => a.kind === "IMAGE")) ?? pay.find((x) => x.proof.artifacts.some((a) => a.kind === "IMAGE")) ?? pay[0];
  ctx.bag.photoCode = m.code;
  return m.code;
}
const S2: Scenario = {
  id: "S2", title: "Spoofed evidence — photo 85 km away", seconds: 5, blueprints: CAR, personas: { ...PERSONAS_B, provider: "u_meera" },
  proves: "Evidence signals (EXIF GPS distance) flag a photo taken 85 km from the workshop; the AI verifier reads the valid proof; release follows the client's approval.",
  steps: [
    { id: "setup", who: "client", label: "Set up and fund the contract", explain: "Clone, both sign, lock, fund and confirm the hold (one resumable step).", run: (c) => stSetup(c, { blueprints: CAR, title: "Located-photo evidence", totalCents: 1_200_000, pick: pickS2, afterCreate: stEnsureGpsMilestone }) },
    { id: "gate", who: "provider", label: "Finish the prerequisites of the photo milestone", explain: "Milestones it depends on are delivered and approved first (DAG unlocker).", run: (c) => stGate(c, () => photoCode(c)) },
    { id: "spoof", who: "provider", label: "Inject a photo with GPS 85 km away", explain: `A real JPEG whose EXIF GPS (${SPOOF_POINT.lat}, ${SPOOF_POINT.lng}) is ${(haversineM(SITE, SPOOF_POINT) / 1000).toFixed(0)} km from the workshop. EXIF is a signal, not proof — but a distant one must block or warn.`, run: stSpoof },
    { id: "fix", who: "client", label: "Client asks for an in-app capture", explain: "Soft rejection: the client lists what to fix; the provider has 72 hours.", run: stAskFix },
    { id: "valid", who: "provider", label: "Submit a valid photo (40 m from site)", explain: "Same proof set with a photo taken at the workshop.", run: stValidPhoto },
    { id: "ai-report", who: "system", label: "AI verifier report (advisory)", explain: "The AI reads the criteria against the evidence and recommends; it never approves or releases (P3).", run: stAiReport },
    { id: "approve", who: "client", label: "Client approves → release", explain: "Release needs the client's signed approval (P4).", run: async (c) => stApprove(c, await photoCode(c)) },
  ],
};

async function stSpoof(ctx: StepCtx): Promise<StepOutcome> {
  const code = await photoCode(ctx);
  const v = await view(ctx);
  const m = msOf(v, code);
  if (ctx.bag.spoofed) return skipped("The spoofed photo was already injected.");
  await addFault(ctx.sim.id, "spoofed_gps");
  const when = simNow(ctx.sim);
  const files = filesForSpec(m.proof, code, when, SPOOF_POINT);
  if (!files.some((f) => f.type === "image/jpeg")) files.push(photo(SPOOF_POINT, `${code.toLowerCase()}-site-photo.jpg`, when));
  await ctx.log("fault", `inject spoofed photo for ${code}`, `EXIF GPS ${SPOOF_POINT.lat}, ${SPOOF_POINT.lng} · ${(haversineM(SITE, SPOOF_POINT) / 1000).toFixed(1)} km from ${SITE.label}`);
  ctx.bag.spoofed = true;
  try {
    const r = await stSubmit(ctx, code, files, "Simulated chaos: photo taken 85 km away");
    const pkg = ctx.bag.pkgs?.[code];
    const flagged = pkg?.signals.filter((s) => s.level !== "ok") ?? [];
    if (flagged.length) return done(`Flagged as expected — ${flagged.map((s) => `${s.level.toUpperCase()} ${s.code}: ${s.detail}`).join("; ")}. ${r.detail}`);
    return failed(`The spoofed photo was accepted with no warning. ${m.proof.gpsRadiusM ? "" : `Milestone ${code} names no GPS radius, so the evidence module may not check location for it. `}${r.detail}`);
  } catch (e) {
    if (e instanceof DomainError) { delete ctx.bag.pkgs?.[code]; return /GPS|km/.test(e.message) ? done(`Blocked as expected: ${e.code} — ${e.message.replace(/^.*?: /, "")}`) : failed(`Blocked, but not for the GPS reason: ${e.code} — ${e.message}`); }
    throw e;
  }
}

async function stAskFix(ctx: StepCtx): Promise<StepOutcome> {
  const code = await photoCode(ctx);
  const v = await view(ctx);
  const m = msOf(v, code);
  if (m.state !== "SUBMITTED") return skipped(`${code} is ${m.state}: the spoofed upload never reached the client, nothing to reject.`);
  const client = await ctx.as("client");
  await moduleCall("evidence", () => evidence.requestFix(client, m.id, [`The photo's GPS is ${(haversineM(SITE, SPOOF_POINT) / 1000).toFixed(0)} km from the workshop. Please retake it in the app at the site.`]));
  const after = msOf(await view(ctx), code);
  return done(`${client.name} sent it back for a fix (state ${after.state}); the 72-hour fix window starts.`);
}

async function stValidPhoto(ctx: StepCtx): Promise<StepOutcome> {
  const code = await photoCode(ctx);
  const v = await view(ctx);
  const m = msOf(v, code);
  if (m.state === "SUBMITTED" && ctx.bag.validSubmitted) return skipped(`${code} already has the valid photo.`);
  const when = simNow(ctx.sim);
  const files = filesForSpec(m.proof, code, when, VALID_POINT);
  if (!files.some((f) => f.type === "image/jpeg")) files.push(photo(VALID_POINT, `${code.toLowerCase()}-site-photo.jpg`, when));
  if (ctx.bag.pkgs?.[code]) delete ctx.bag.pkgs[code];
  const r = await stSubmit(ctx, code, files, "Retaken at the workshop");
  ctx.bag.validSubmitted = true;
  return { ...r, detail: `${r.detail} Photo GPS is ${haversineM(SITE, VALID_POINT).toFixed(0)} m from the site.` };
}

async function stAiReport(ctx: StepCtx): Promise<StepOutcome> {
  const code = await photoCode(ctx);
  const pkg = ctx.bag.pkgs?.[code];
  if (!pkg) return failed("No evidence package to read.");
  const [row] = await db.select().from(evidencePackages).where(eq(evidencePackages.id, pkg.packageId)).limit(1);
  const fmt = (r: { recommendation?: string; summary?: string; criteria?: { criterion: string; verdict: string }[] }) =>
    `Recommendation: ${r.recommendation ?? "?"}. ${r.summary ?? ""} ${(r.criteria ?? []).map((c) => `[${c.verdict}] ${c.criterion}`).join(" ")}`.trim();
  const stored = row?.verifier as { available?: boolean; reason?: string; data?: Parameters<typeof fmt>[0]; model?: string } | null | undefined;
  const rules = `rule-based signals: ${pkg.signals.map((s) => `${s.level.toUpperCase()} ${s.code}`).join(", ") || "none"}`;
  if (stored && stored.available === true && stored.data) return done(`AI verifier (${stored.model ?? "model"}, advisory, stored with the package): ${fmt(stored.data)}`);
  if (stored && stored.available === false) return done(`AI verifier is off (${stored.reason ?? "no key"}). The client decides from the evidence and the ${rules}. People decide; AI only advises (P3).`);
  const v = await view(ctx);
  const m = msOf(v, code);
  const r = await moduleCall("ai", () => ai.verifyEvidence(m.proof, (row?.files ?? []).map((f) => ({ name: f.name, type: f.kind, signals: pkg.signals }))));
  if (!r.available) return done(`AI is off (${r.reason ?? "no key"}); the rule-based signals stand: ${pkg.signals.map((s) => `${s.level} ${s.code}`).join(", ") || "none"}. People decide.`);
  return done(`AI verifier (${r.model ?? "model"}, advisory): ${fmt(r.data ?? {})}`);
}

/* S3 — window pressure */
const TRAVEL = ["UC_TRAVEL_TOUR", ...WEB];
async function jumpTo(ctx: StepCtx, day: number): Promise<StepOutcome> {
  const sim = await ctx.refreshSim();
  const h = hoursToDay(sim, day);
  if (h <= 0) return skipped(`Already at simulated day ${simDay(sim)}.`);
  const r = await travelInRun(ctx.judge, sim.id, h, ctx.stepId);
  ctx.sim = await ctx.refreshSim();
  const acts = r.watchdog.map((a) => a.action).join(", ") || "no watchdog action";
  const timers = r.reviewTimers.map((a) => a.action).join(", ");
  if (r.waiting.length) return waiting(`Jumped to simulated day ${r.day}. ${r.waiting.join("; ")}`);
  return done(`Simulated clock now day ${r.day} (+${r.offsetHours} h). Watchdog: ${acts}.${timers ? ` Review timers: ${timers}.` : ""}`);
}
async function stWarned(ctx: StepCtx, expect: "warn" | "rollover"): Promise<StepOutcome> {
  const r = await jumpTo(ctx, expect === "warn" ? 22 : 25);
  if (r.status !== "done") return r;
  const [t] = await db.select().from(tranches).where(and(eq(tranches.workspaceId, ctx.bag.workspaceId!), eq(tranches.idx, 1))).limit(1);
  const notes = t?.warned ?? [];
  return done(`${r.detail} Tranche 1 notices so far: ${notes.join(", ") || "none recorded"}. ${expect === "warn" ? "The parties are told the hold window is closing." : "A rollover is offered: approved work is released, the remainder moves to a new hold."}`);
}
async function stRollover(ctx: StepCtx): Promise<StepOutcome> {
  if (ctx.bag.newTrancheId) return skipped(`Already rolled over into ${ctx.bag.newTrancheId}.`);
  const v = await view(ctx);
  const t = trancheOf(v, 1);
  if (!t) return failed("No tranche 1.");
  const client = await ctx.as("client");
  const r = await moduleCall("money", () => money.rollover(client, t.id));
  ctx.bag.newTrancheId = r.newTrancheId;
  const after = await view(ctx);
  const nt = after.tranches.find((x) => x.id === r.newTrancheId);
  return done(`${client.name} accepted the rollover. Tranche 1 is ${after.tranches.find((x) => x.id === t.id)?.state}; new tranche ${nt?.idx ?? "?"} for ${nt ? formatCents(nt.amountCents) : "the remainder"} is ${nt?.state ?? "created"}.`);
}
const S3: Scenario = {
  id: "S3", title: "Window pressure — Travel", seconds: 5, blueprints: TRAVEL, personas: { ...PERSONAS_A, provider: "u_arjun" },
  proves: "The hold-expiry watchdog acts on the virtual clock (day 22 warn, day 25 rollover offer) and a rollover moves the remainder to a new hold.",
  steps: [
    { id: "setup", who: "client", label: "Set up and fund the contract", explain: "Clone, both sign, lock, fund and confirm the hold.", run: (c) => stSetup(c, { blueprints: TRAVEL, title: "Custom tour", totalCents: 480_000 }) },
    { id: "gate", who: "provider", label: "Finish prerequisites of the first payment", explain: "Milestones it depends on are delivered and approved first.", run: (c) => stGate(c, async () => firstPay(await view(c)).code) },
    { id: "submit", who: "provider", label: "Deliver the first payment milestone", explain: "Something is released before the window closes.", run: async (c) => stSubmit(c, firstPay(await view(c)).code) },
    { id: "approve", who: "client", label: "Approve it → release", explain: "Released milestones are untouched by the rollover.", run: async (c) => stApprove(c, firstPay(await view(c)).code) },
    { id: "day22", who: "system", label: "Time travel to day 22 → warning", explain: "Simulated time only: the watchdog warns both parties that the hold window is closing.", run: (c) => stWarned(c, "warn") },
    { id: "day25", who: "system", label: "Time travel to day 25 → rollover offer", explain: "Simulated time only: the watchdog offers a rollover two days before settlement.", run: (c) => stWarned(c, "rollover") },
    { id: "rollover", who: "client", label: "Accept the rollover", explain: "The old remainder is voided or refunded; a new tranche is created for it.", run: stRollover },
    { id: "fund-new", who: "client", label: "Fund the new hold", explain: "The buyer approves the new hold in PayPal (automatic in fast mode).", run: async (c) => { const r = await stFund(c, 0, c.bag.newTrancheId); return r.status === "error" || r.status === "waiting" ? r : stConfirm(c, 0, c.bag.newTrancheId); } },
  ],
};

/* S4 — dispute */
const INTERIOR = ["UC_INTERIOR_MILLWORK", ...WEB];
/** Total so that the first payment milestone is about $2,000. */
const totalForTwoThousand = (b: { milestones: BlueprintMilestone[] }) => { const p = b.milestones.find((m) => m.type === "PAY"); return p ? Math.round((200_000 * 10_000) / p.bps) : 800_000; };
async function disputeRow(ctx: StepCtx) {
  if (!ctx.bag.disputeId) throw new DomainError("NO_DISPUTE", "No dispute yet; open it first.");
  const [d] = await db.select().from(disputes).where(eq(disputes.id, ctx.bag.disputeId)).limit(1);
  return d;
}
const S4: Scenario = {
  id: "S4", title: "Dispute — about $2,000 milestone", seconds: 7, blueprints: INTERIOR, personas: PERSONAS_A,
  proves: "A dispute freezes only its milestone; sealed bids miss; the vault seals; the AI proposes (advisory); a mediator's 75/25 verdict executes as two legs.",
  steps: [
    { id: "setup", who: "client", label: "Set up and fund the contract", explain: "The total is chosen so the first payment milestone is about $2,000.", run: (c) => stSetup(c, { blueprints: INTERIOR, title: "Interior design and millwork", totalCents: totalForTwoThousand }) },
    { id: "gate", who: "provider", label: "Finish prerequisites of the disputed milestone", explain: "Milestones it depends on are delivered and approved first.", run: (c) => stGate(c, async () => firstPay(await view(c)).code) },
    { id: "submit", who: "provider", label: "Provider submits the milestone", explain: "The client disagrees with what was delivered.", run: async (c) => stSubmit(c, firstPay(await view(c)).code) },
    { id: "open", who: "client", label: "Client opens a dispute", explain: "Only this milestone freezes; the rest of the contract continues (blast radius).", run: stOpenDispute },
    { id: "bids", who: "client", label: "Sealed bids: client 30%, provider 85%", explain: "Blind offers of the provider's share. A gap of more than 5 points means no settlement.", run: stBids },
    { id: "impasse", who: "system", label: "Impasse → evidence vault", explain: "Simulated time moves past the 48-hour bidding window; the dispute moves to Tier 2.", run: stImpasse },
    { id: "rebuttals", who: "provider", label: "Both parties file rebuttals", explain: "Hashed statements go into the vault before it seals.", run: stRebuttals },
    { id: "seal", who: "mediator", label: "Seal the vault", explain: "Sealed contents are immutable (P5); the dossier root hash is fixed.", run: stSeal },
    { id: "ai", who: "system", label: "AI mediation proposal (advisory)", explain: "The AI proposes a split with findings and confidence; it never executes (P3).", run: stAiProposal },
    { id: "verdict", who: "mediator", label: "Mediator verdict 75/25", explain: "The mediator signs 75% to the provider, 25% back to the client (co-signed above $5,000).", run: stVerdict },
    { id: "legs", who: "system", label: "Two legs execute", explain: "Leg 1 returns the client's share; leg 2 releases the provider's share with its own idempotency key.", run: stLegs },
  ],
};

async function stOpenDispute(ctx: StepCtx): Promise<StepOutcome> {
  if (ctx.bag.disputeId) return skipped(`Dispute ${ctx.bag.disputeId} is open.`);
  const v = await view(ctx);
  const m = firstPay(v);
  const client = await ctx.as("client");
  const id = await moduleCall("disputes", () => disputesSvc.openDispute(client, m.id, "QUALITY", `Delivered ${m.title.toLowerCase()} does not match the agreed proof spec (simulated).`));
  ctx.bag.disputeId = id;
  const after = await view(ctx);
  const frozen = after.milestones.filter((x) => x.state === "DISPUTED").map((x) => x.code);
  return done(`${client.name} disputed ${m.code} for ${formatCents(m.amountCents)}. Frozen: ${frozen.join(", ") || m.code}; every other milestone keeps its state.`);
}
async function stBids(ctx: StepCtx): Promise<StepOutcome> {
  if (ctx.bag.bidsPlaced) return skipped("Bids already placed.");
  const id = ctx.bag.disputeId!;
  const client = await ctx.as("client"), provider = await ctx.as("provider");
  const a = await moduleCall("disputes", () => disputesSvc.placeBid(client, id, 3000));
  const b = a.settled ? a : await moduleCall("disputes", () => disputesSvc.placeBid(provider, id, 8500));
  ctx.bag.bidsPlaced = true;
  if (b.settled) return failed(`Unexpectedly settled at ${pct(b.shareBps ?? 0)}.`);
  return done(`Client offered ${pct(3000)} to the provider; provider asked ${pct(8500)}. Gap ${pct(5500)} > 5 points: no settlement, and neither side sees the other's number.`);
}
async function stImpasse(ctx: StepCtx): Promise<StepOutcome> {
  let d = await disputeRow(ctx);
  if (d.state !== "TIER1") return skipped(`Dispute is already ${d.state}.`);
  const sim = await ctx.refreshSim();
  const now = simNow(sim);
  const h = Math.max(1, Math.ceil((d.tier1Until.getTime() - now.getTime()) / 3_600_000) + 1);
  const r = await travelInRun(ctx.judge, sim.id, h, ctx.stepId);
  ctx.sim = await ctx.refreshSim();
  d = await disputeRow(ctx);
  if (d.state === "TIER1") { await moduleCall("disputes", () => disputesSvc.advanceDispute(d.id)); d = await disputeRow(ctx); }
  if (d.state !== "TIER2") return failed(`Expected Tier 2 after the bidding window, got ${d.state}.`);
  return done(`Simulated clock +${h} h to day ${r.day}: the 48-hour bidding window closed without agreement. Dispute is now Tier 2: the evidence vault is open until ${d.vaultUntil.toISOString().slice(0, 16).replace("T", " ")} UTC (simulated).`);
}
async function stRebuttals(ctx: StepCtx): Promise<StepOutcome> {
  if (ctx.bag.rebutted) return skipped("Rebuttals already filed.");
  const id = ctx.bag.disputeId!;
  const client = await ctx.as("client"), provider = await ctx.as("provider");
  const cText = "Two cabinet fronts are a different veneer from the approved sample (simulated).";
  const pText = "Veneer batch changed by the supplier; the client was told on day 4 and did not object (simulated).";
  await moduleCall("disputes", () => disputesSvc.addRebuttal(client, id, { kind: "NOTE", narrative: cText, sha256: sha256(cText) }));
  await moduleCall("disputes", () => disputesSvc.addRebuttal(provider, id, { kind: "NOTE", narrative: pText, sha256: sha256(pText) }));
  ctx.bag.rebutted = true;
  return done(`Both statements filed with their SHA-256: client ${sha256(cText).slice(0, 10)}…, provider ${sha256(pText).slice(0, 10)}….`);
}
async function stSeal(ctx: StepCtx): Promise<StepOutcome> {
  let d = await disputeRow(ctx);
  if (d.state === "TIER3" || d.dossierRoot) return skipped(`Vault already sealed (root ${d.dossierRoot?.slice(0, 12) ?? "?"}…).`);
  const client = await ctx.as("client"), provider = await ctx.as("provider");
  // Both parties lock their side of the vault; when both have, it seals at once (otherwise it seals at hour 96).
  await moduleCall("disputes", () => disputesSvc.lockVault(client, d.id));
  const r = await moduleCall("disputes", () => disputesSvc.lockVault(provider, d.id));
  if (!r.sealed) await moduleCall("disputes", () => disputesSvc.sealVault(null, d.id));
  d = await disputeRow(ctx);
  const [med] = d.mediatorId ? await db.select({ name: users.name }).from(users).where(eq(users.id, d.mediatorId)).limit(1) : [];
  return done(`Both parties locked the vault, so it sealed: dossier root ${d.dossierRoot?.slice(0, 16) ?? "(pending)"}…, now immutable. Tier 3, assigned to ${med?.name ?? "the next free mediator"}.`);
}
async function stAiProposal(ctx: StepCtx): Promise<StepOutcome> {
  const d = await disputeRow(ctx);
  const p = d.aiProposal as { providerShareBps?: number; findings?: string[]; confidence?: number; available?: boolean } | null;
  if (p && typeof p.providerShareBps === "number") return done(`AI proposal (advisory): ${pct(p.providerShareBps)} to the provider, confidence ${p.confidence ?? "?"}. ${(p.findings ?? []).slice(0, 3).join(" ")}`);
  const r = await moduleCall("ai", () => ai.mediate({ disputeRule: "Per-item deduction for mismatched work", clauses: [], evidence: [d.narrative], rebuttals: [], bids: [{ role: "client", shareBps: 3000 }, { role: "provider", shareBps: 8500 }], amountCents: d.amountCents }));
  if (!r.available || !r.data) return done(`AI is off (${r.reason ?? "no key"}); the mediator decides from the sealed dossier alone.`);
  return done(`AI proposal (advisory, shown to the mediator only): ${pct(r.data.providerShareBps)} to the provider, confidence ${r.data.confidence}. ${r.data.findings.slice(0, 3).join(" ")}`);
}
/** The assigned mediator signs; if the routing found none free of conflicts, the sandbox judge signs as mediator (P9). */
async function mediatorFor(ctx: StepCtx, d: { mediatorId: string | null }): Promise<Actor> {
  if (d.mediatorId) return actorFor(d.mediatorId, `sim:${ctx.sim.id}:${ctx.stepId}`);
  return actorFor("u_judge", `sim:${ctx.sim.id}:${ctx.stepId}`);
}
async function stVerdict(ctx: StepCtx): Promise<StepOutcome> {
  const d = await disputeRow(ctx);
  const [existing] = await db.select().from(verdicts).where(eq(verdicts.disputeId, d.id)).limit(1);
  const med = await mediatorFor(ctx, d);
  if (!existing) await moduleCall("disputes", () => disputesSvc.issueVerdict(med, d.id, { providerShareBps: 7500, findings: "Work was delivered substantially as specified; two items do not match the approved sample (simulated case).", rootCause: "QUALITY_DEFECT", disposition: "RESUME", fault: "SHARED" }));
  let note = "";
  const [v0] = await db.select().from(verdicts).where(eq(verdicts.disputeId, d.id)).limit(1);
  if (v0 && d.amountCents > 500_000 && !v0.cosignerId) {
    const coId = ["u_med2", "u_med", "u_judge"].find((x) => x !== v0.mediatorId)!;
    const co = await actorFor(coId, `sim:${ctx.sim.id}:${ctx.stepId}`);
    await moduleCall("disputes", () => disputesSvc.cosignVerdict(co, d.id));
    note = ` Co-signed by ${co.name} (above $5,000).`;
  }
  const [v] = await db.select().from(verdicts).where(eq(verdicts.disputeId, d.id)).limit(1);
  if (!v) return waiting("Verdict not recorded yet.");
  return done(`${med.name}${med.role === "judge" ? " (sandbox judge acting as mediator)" : ""} signed: ${pct(v.providerShareBps)} to the provider. Refund ${formatCents(v.refundCents)} to the client, release ${formatCents(v.releaseCents)} to the provider (the refund rounds half up, so the total never exceeds the hold).${note}`);
}
async function stLegs(ctx: StepCtx): Promise<StepOutcome> {
  const d = await disputeRow(ctx);
  const [v] = await db.select().from(verdicts).where(eq(verdicts.disputeId, d.id)).limit(1);
  if (!v) return failed("No verdict.");
  const rel = await releaseLine(d.milestoneId);
  const fin = (x: string) => x === "DONE" || x === "SKIPPED";
  if (!fin(v.leg1) || !fin(v.leg2)) return (v.leg1 === "FAILED" || v.leg2 === "FAILED" ? failed : waiting)(`Legs in progress: leg 1 (refund ${formatCents(v.refundCents)}) ${v.leg1}, leg 2 (release ${formatCents(v.releaseCents)}) ${v.leg2}.${rel ? " " + rel : ""}`);
  return done(`Leg 1 refund ${formatCents(v.refundCents)} ${v.leg1}; leg 2 release ${formatCents(v.releaseCents)} ${v.leg2}. ${rel ?? ""}`);
}

/* S5 — chaos */
const S5: Scenario = {
  id: "S5", title: "Chaos — 503, duplicate webhook, ledger drift", seconds: 6, blueprints: WEB, personas: PERSONAS_B,
  proves: "Idempotent retries give exactly one payout through a PayPal 503; duplicate webhooks are deduplicated; one cent of ledger drift trips the circuit breaker.",
  steps: [
    { id: "setup", who: "client", label: "Set up and fund the contract", explain: "Clone, both sign, lock, fund and confirm the hold.", run: (c) => stSetup(c, { blueprints: WEB, title: "Web MVP sprint", totalCents: 600_000 }) },
    { id: "gate", who: "provider", label: "Finish prerequisites of M02, if any", explain: "Opens M02.", run: (c) => stGate(c, async () => "M02") },
    { id: "submit", who: "provider", label: "Submit evidence for M02", explain: "Ready for release.", run: (c) => stSubmit(c, "M02") },
    { id: "inject-503", who: "judge", label: "Inject a PayPal 503 on the next release", explain: "The mock rail fails the next capture once with a transient 503.", run: stInject503 },
    { id: "release", who: "client", label: "Approve → release retried, one payout", explain: "The retry reuses the same idempotency key, so PayPal sees one capture.", run: stReleaseUnderFault },
    { id: "dup-webhook", who: "judge", label: "Post the same webhook twice", explain: "Same transmission id twice to /api/webhooks/paypal (marked simulated): the second is a duplicate.", run: stDupWebhook },
    { id: "drift", who: "judge", label: "Insert one cent of ledger drift", explain: "A ledger row with no PayPal counterpart — the kind of error reconciliation must catch.", run: stDrift },
    { id: "recon", who: "finance", label: "Run reconciliation → breaker", explain: "Three-way reconciliation (ledger, PayPal, contract) finds the drift and trips the tranche breaker.", run: stRecon },
  ],
};

/**
 * F5.08 the ids a PayPal fault of this run is scoped to: its tranches, orders, authorizations and captures. The mock
 * rail is shared by every judge's run, so a fault fires only on a call about one of these ids (src/lib/rails/mock.ts).
 */
async function railScope(workspaceId: string | undefined): Promise<string[]> {
  if (!workspaceId) return [];
  const ts = await db.select({ id: tranches.id, o: tranches.paypalOrderId, a: tranches.authorizationId, c: tranches.captureId }).from(tranches).where(eq(tranches.workspaceId, workspaceId));
  return ts.flatMap((t) => [t.id, t.o, t.a, t.c]).filter((x): x is string => Boolean(x));
}
const NO_SCOPE = "No tranche yet. A PayPal 503 is armed only on this run's own tranches, so lock the contract first.";

async function stInject503(ctx: StepCtx): Promise<StepOutcome> {
  if (ctx.sim.mode === "LIVE") return skipped("Fault injection works on the mock rail only; the live PayPal Sandbox is never sabotaged.");
  const scope = await railScope(ctx.bag.workspaceId);
  if (!scope.length) return failed(NO_SCOPE);
  mockControl.inject("release_503", scope);
  await addFault(ctx.sim.id, "release_503");
  await ctx.log("fault", "mockControl.inject('release_503', this run's tranche)", "next capture on this run's authorization answers 503 once (simulated)");
  return done("Armed: the next capture on this run's tranche answers a transient PayPal 503 once.");
}
async function stReleaseUnderFault(ctx: StepCtx): Promise<StepOutcome> {
  const r = await stApprove(ctx, "M02");
  if (r.status !== "done") return r;
  const v = await view(ctx);
  const m = msOf(v, "M02");
  const rel = await db.select().from(releases).where(eq(releases.milestoneId, m.id));
  const [t] = await db.select().from(tranches).where(eq(tranches.id, rel[0]?.trancheId ?? "")).limit(1);
  const caps = ctx.sim.mode === "MOCK" && t?.authorizationId ? mockControl.txns().filter((x) => x.type === "CAPTURE" && x.ref === t.authorizationId) : [];
  const keys = new Set(rel.map((x) => x.idemKey));
  const capNote = ctx.sim.mode === "MOCK" ? ` Mock rail captures on this authorization: ${caps.length}.` : "";
  const ok = rel.length === 1 && keys.size === 1 && (ctx.sim.mode !== "MOCK" || caps.length === 1);
  return ok ? done(`One release row, one idempotency key (${rel[0].idemKey.slice(0, 13)}…), one payout.${capNote} ${r.detail}`) : failed(`Expected exactly one payout: ${rel.length} release row(s), ${keys.size} key(s).${capNote}`);
}
async function stDupWebhook(ctx: StepCtx): Promise<StepOutcome> {
  const cap = await latestCapture(ctx.bag.workspaceId!);
  const tid = ctx.bag.webhookId ?? `SIM-${ctx.sim.id.slice(-8)}-${Date.now().toString(36)}`;
  ctx.bag.webhookId = tid;
  const event = { id: `WH-${tid}`, event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: cap?.captureId ?? "SIM-CAPTURE", status: "COMPLETED", amount: { currency_code: "USD", value: ((cap?.amountCents ?? 0) / 100).toFixed(2) }, custom_id: ctx.bag.workspaceId } };
  await addFault(ctx.sim.id, "duplicate_webhook");
  const a = await postWebhook(ctx, event, tid);
  const b = await postWebhook(ctx, event, tid);
  const rows = await db.select().from(webhookEvents).where(eq(webhookEvents.transmissionId, tid));
  const state = rows[0]?.state ?? "not stored";
  if (a.status >= 500 || b.status >= 500) return failed(`Webhook receiver answered ${a.status} then ${b.status}.`);
  return done(`First delivery ${a.status}, second ${b.status}. One stored event for transmission ${tid} (state ${state}): ${rows.length === 1 ? "deduplicated" : `${rows.length} rows`}. ${b.text.slice(0, 120)}`);
}
async function stDrift(ctx: StepCtx): Promise<StepOutcome> {
  if (ctx.bag.driftId) return skipped(`Drift row ${ctx.bag.driftId} already inserted.`);
  const v = await view(ctx);
  const t = trancheOf(v, 1);
  if (!t) return failed("No tranche to drift.");
  // P9 chaos: sandbox-only, labelled, audited. The ledger is append-only, so drift is added, never edited in.
  // Timestamped 20 minutes back: reconciliation treats differences younger than 15 minutes as in flight, so the simulated
  // drift is made old enough to count — the row is labelled SIM-DRIFT and the audit entry says so.
  const at = new Date(Date.now() - 20 * 60_000);
  const [row] = await db.insert(ledgerEntries).values({ trancheId: t.id, milestoneId: null, type: "FEE", debit: "platform:fees", credit: `paypal:hold:${t.id}`, amountCents: 1, paypalRef: `SIM-DRIFT-${idemKey("drift", ctx.sim.id).slice(0, 8)}`, at }).returning({ id: ledgerEntries.id });
  ctx.bag.driftId = row.id;
  await addFault(ctx.sim.id, "ledger_drift");
  await audit(db, { id: ctx.judge.id, role: ctx.judge.role }, "sandbox.chaos", t.id, { fault: "ledger_drift", ledgerEntryId: row.id, amountCents: 1, simId: ctx.sim.id, backdatedMinutes: 20 });
  await ctx.log("fault", `insert ledger row #${row.id} (simulated drift)`, `FEE ${formatCents(1)} on tranche ${t.idx} with no PayPal counterpart`);
  return done(`Inserted ledger row #${row.id}: a ${formatCents(1)} fee that PayPal never moved (labelled SIM-DRIFT, timestamped 20 minutes ago so it is past the 15-minute in-flight allowance).`);
}
async function stRecon(ctx: StepCtx): Promise<StepOutcome> {
  const fin = await ctx.as("finance");
  // only this run's tranches: a run over every tranche would check (and could pause) other judges' runs too
  const trancheIds = (await view(ctx)).tranches.map((t) => t.id);
  if (!trancheIds.length) return failed("No tranche to reconcile yet.");
  const r = await moduleCall("control", () => control.reconcile(fin, undefined, { trancheIds }));
  const v = await view(ctx);
  const t = trancheOf(v, 1);
  await ctx.log("state", `reconcile → run ${r.runId}`, `verdict ${r.verdict}; tranche 1 ${t?.state}`, r.verdict === "DRIFT");
  if (r.verdict !== "DRIFT" || t?.state !== "BREAKER") return failed(`Reconciliation verdict ${r.verdict}; tranche 1 is ${t?.state}. Expected DRIFT and a tripped breaker on this tranche.`);
  return done(`Run ${r.runId}: verdict DRIFT. Tranche 1 is ${t?.state}${t?.state === "BREAKER" ? " — releases are paused until Ops and Finance clear it with four eyes" : ""}.`);
}

/* S6 — agentic over MCP */
const CONSULT = ["UC_CONSULTING_SPRINT", ...WEB];
const S6: Scenario = {
  id: "S6", title: "Agentic — Consulting sprint over MCP", seconds: 6, blueprints: CONSULT, personas: PERSONAS_B,
  proves: "An agent drafts a contract, requests funding and submits evidence over MCP; funding and release still need a person (PayPal approval, in-app MFA).",
  steps: [
    { id: "tokens", who: "judge", label: "Mint agent tokens for both parties", explain: "Each person gives their agent a scoped bearer token with a spend limit.", run: stTokens },
    { id: "draft", who: "client", label: "Agent: draft_contract", explain: "The client's agent drafts a consulting sprint from a one-paragraph brief.", run: stMcpDraft },
    { id: "negotiate", who: "provider", label: "Provider agent: propose_changes", explain: "The provider's agent appends a link-only first milestone and rebalances; the counterparty sees the diff.", run: stMcpNegotiate },
    { id: "sign", who: "client", label: "People review and sign", explain: "Agents cannot sign: both people sign the same revision; Ops locks it if needed.", run: stHumansSign },
    { id: "funding", who: "client", label: "Agent: request_funding", explain: "The agent asks for funding; the answer is a PayPal approval link for the person.", run: stMcpFunding },
    { id: "approve-hold", who: "client", label: "Person approves the hold", explain: "The client approves in PayPal (automatic in fast mode).", run: stHumanApproveHold },
    { id: "evidence", who: "provider", label: "Provider agent: submit_evidence", explain: "The provider's agent attaches files and submits the first payment milestone.", run: stMcpEvidence },
    { id: "release", who: "client", label: "Agent: approve_release", explain: "The agent can only request a release; the response is the person's approval link.", run: stMcpRelease },
    { id: "human", who: "client", label: "Person approves with MFA → release", explain: "The client confirms in the app with their own session; only then does money move (P4).", run: stHumanRelease },
  ],
};

type Mint = (a: Actor, p: { label?: string; spendLimitCents?: number; ttlHours?: number }) => Promise<{ token: string; id: string }>;
async function stTokens(ctx: StepCtx): Promise<StepOutcome> {
  if (ctx.bag.tokens?.client && ctx.bag.tokens?.provider) return skipped("Tokens already minted.");
  const mint = (ai as unknown as { mintAgentToken?: Mint }).mintAgentToken;
  if (typeof mint !== "function") throw new WaitingFor("ai", "mintAgentToken is not exported from src/server/ai/index.ts yet");
  const out: Record<string, string> = {};
  for (const who of ["client", "provider"] as const) {
    const a = await ctx.as(who);
    const r = await mint(a, { label: `Playground ${ctx.sim.id.slice(-6)} ${who} agent`, spendLimitCents: 1_500_000, ttlHours: 4 });
    out[who] = r.token;
    await ctx.log("mcp", `mint agent token for ${a.name}`, `token ${r.token.slice(0, 10)}… (only its hash is stored) · spend limit ${formatCents(1_500_000)} · 4 h`);
  }
  ctx.bag.tokens = out;
  return done("Two scoped agent tokens minted, one per person; each may ask for at most $15,000 of funding.");
}
async function stMcpDraft(ctx: StepCtx): Promise<StepOutcome> {
  if (ctx.bag.workspaceId) return skipped(`Draft ${ctx.bag.workspaceId} exists.`);
  const provider = await ctx.as("provider");
  const r = await mcpCall(ctx, "client", "draft_contract", { brief: "Enterprise software consulting sprint for our ERP planning system: assess the current process, design, configure, integration test, user acceptance test, go-live and hypercare in about 24 days.", budgetCents: 1_200_000, days: 24, providerId: provider.id });
  if (!r.ok) return failed(`draft_contract failed: ${r.text.slice(0, 240)}`);
  const id = pick(r.result, "contractId", "workspaceId", "id");
  if (!id) return failed(`draft_contract answered without a contract id: ${r.text.slice(0, 200)}`);
  ctx.bag.workspaceId = id; ctx.bag.mcpWorkspaceId = id;
  await setSimWorkspace(ctx.sim.id, id);
  const v = await view(ctx);
  return done(`The client's agent drafted “${v.title}” (${v.blueprintCode}) for ${formatCents(v.totalCents)} with ${v.milestones.filter((m) => m.active).length} milestones; drafter: ${pick(r.result, "drafter") ?? "?"}. State ${v.state}: nothing is signed or funded.`);
}
async function stMcpNegotiate(ctx: StepCtx): Promise<StepOutcome> {
  const v = await view(ctx);
  if (v.milestones.some((m) => m.origin === "CUSTOM" && m.active && m.title.startsWith("Kickoff workshop notes"))) return skipped("The agent's change is already in the draft.");
  if (v.signatures.some((s) => !s.voided)) return skipped("Already signed; no more edits.");
  const pay = v.milestones.filter((m) => m.active && m.type === "PAY").sort((a, b) => a.targetDay - b.targetDay);
  const last = pay[pay.length - 1];
  const r = await mcpCall(ctx, "provider", "propose_changes", { contractId: v.id, changes: [
    { action: "APPEND", milestone: { title: "Kickoff workshop notes shared", type: "PAY", day: 1, bps: 500, proof: { artifacts: [{ kind: "LINK", min: 1, note: "Link to the shared workshop notes" }], criteria: ["Notes list every process in scope and the named key users"] }, lockRule: "Client approves the notes.", disputeRule: "Missing processes are added within 48 hours." } },
    { action: "SET_BPS", shares: { [last.code]: last.bps - 500 } },
  ] });
  if (!r.ok) return failed(`propose_changes failed: ${r.text.slice(0, 240)}`);
  const after = await view(ctx);
  const added = after.milestones.find((m) => m.origin === "CUSTOM" && m.title.startsWith("Kickoff workshop notes"));
  if (added) ctx.bag.agentCode = added.code;
  return done(`The provider's agent appended ${added?.code ?? "a milestone"} “Kickoff workshop notes shared” (5%, proof: one link) and took 5 points from ${last.code}. Revision ${v.revision} → ${after.revision}; the client sees the diff before signing.`);
}
async function stHumansSign(ctx: StepCtx): Promise<StepOutcome> {
  const lines: string[] = [];
  for (const st of [() => stSign(ctx, "client"), () => stSign(ctx, "provider"), () => stLock(ctx)]) {
    const r = await st();
    if (r.status === "error" || r.status === "waiting") return { ...r, detail: [...lines, r.detail].join(" · ") };
    lines.push(r.detail);
  }
  return done(`Agents cannot sign. ${lines.join(" · ")}`);
}
async function stMcpFunding(ctx: StepCtx): Promise<StepOutcome> {
  const v = await view(ctx);
  const t = trancheOf(v, 1);
  if (!t) return failed("No tranche to fund.");
  if (!["PLANNED", "AWAITING_APPROVAL"].includes(t.state)) return skipped(`Tranche 1 is ${t.state}.`);
  const r = await mcpCall(ctx, "client", "request_funding", { contractId: v.id, trancheIdx: 1 });
  if (!r.ok) return failed(`request_funding failed: ${r.text.slice(0, 240)}`);
  const url = pick(r.result, "approveUrl");
  if (url) ctx.bag.approveUrls = { ...(ctx.bag.approveUrls ?? {}), [t.id]: url };
  return done(`The agent's request created a PayPal order for ${formatCents(t.amountCents)}. Human gate: nothing is held until the client approves it in PayPal${ctx.sim.mode === "MOCK" ? " (simulated in fast mode)" : ""}.`, url);
}
async function stHumanApproveHold(ctx: StepCtx) { return stConfirm(ctx, 1); }
/** The milestone an agent can evidence alone: its proof asks only for links, signatures or external checks. */
async function agentMilestone(ctx: StepCtx) {
  const v = await view(ctx);
  const pay = v.milestones.filter((m) => m.active && m.type === "PAY").sort((a, b) => a.targetDay - b.targetDay || a.seq - b.seq);
  const code = (ctx.bag.agentCode as string | undefined)
    ?? (pay.find((m) => m.proof.artifacts.every((a) => a.min <= 0 || ["LINK", "SIGNATURE", "ORACLE"].includes(a.kind))) ?? pay[0]).code;
  ctx.bag.agentCode = code;
  return { v, m: msOf(v, code) };
}
async function stMcpEvidence(ctx: StepCtx): Promise<StepOutcome> {
  const { v, m } = await agentMilestone(ctx);
  if (["SUBMITTED", "APPROVED", ...RELEASED].includes(m.state) && ctx.bag.pkgs?.[m.code]) return skipped(`${m.code} is ${m.state}.`);
  if (!OPENABLE.has(m.state)) { const g = await stGate(ctx, async () => m.code); if (g.status === "error" || g.status === "waiting") return g; }
  const needsFiles = m.proof.artifacts.some((a) => a.min > 0 && !["LINK", "SIGNATURE", "ORACLE"].includes(a.kind));
  if (needsFiles) {
    const r = await stSubmit(ctx, m.code);
    return r.status === "done" ? done(`Agents send notes and links only; ${m.code} needs files, so the provider uploaded them in the app. ${r.detail}`) : r;
  }
  const urls = [`https://evidence.example.com/${m.code.toLowerCase()}/signed-sheet`, `https://evidence.example.com/${m.code.toLowerCase()}/summary`];
  const note = noteForSpec(m.proof, m.code, `Submitted by the provider's agent for ${m.code} “${m.title}”. Signed sheet and summary are at the links (simulated).`);
  const r = await mcpCall(ctx, "provider", "submit_evidence", { contractId: v.id, milestoneId: m.id, note, urls });
  if (!r.ok) return failed(`submit_evidence failed: ${r.text.slice(0, 240)}`);
  const rootHash = pick(r.result, "rootHash") ?? "", packageId = pick(r.result, "packageId") ?? "";
  ctx.bag.pkgs = { ...(ctx.bag.pkgs ?? {}), [m.code]: { packageId, rootHash, signals: [] } };
  const after = msOf(await view(ctx), m.code);
  return done(`The provider's agent submitted ${m.code} “${m.title}” as a note with ${urls.length} links: root hash ${rootHash.slice(0, 12)}…; state ${after.state}.`);
}
async function stMcpRelease(ctx: StepCtx): Promise<StepOutcome> {
  const { v, m } = await agentMilestone(ctx);
  if (RELEASED.has(m.state)) return skipped(`${m.code} is already ${m.state}.`);
  const r = await mcpCall(ctx, "client", "approve_release", { contractId: v.id, milestoneId: m.id, note: "Agent recommends release: the evidence matches the proof spec (simulated)." });
  if (!r.ok) return failed(`approve_release failed: ${r.text.slice(0, 240)}`);
  const url = pick(r.result, "confirmUrl", "approvalUrl", "url");
  ctx.bag.agentApprovalId = pick(r.result, "approvalId");
  const after = msOf(await view(ctx), m.code);
  if (RELEASED.has(after.state)) return failed(`Money moved without a person — this must not happen (P4). ${m.code} is ${after.state}.`);
  return done(`Request recorded (${pick(r.result, "approvalId") ?? "approval"} PENDING); no money moved, ${m.code} is still ${after.state}. Human gate: the client confirms in the app.`, url);
}
async function stHumanRelease(ctx: StepCtx): Promise<StepOutcome> {
  const { m } = await agentMilestone(ctx);
  if (!ctx.bag.pkgs?.[m.code]?.rootHash) {
    const [p] = await db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, m.id)).orderBy(desc(evidencePackages.attempt)).limit(1);
    if (p) ctx.bag.pkgs = { ...(ctx.bag.pkgs ?? {}), [m.code]: { packageId: p.id, rootHash: p.rootHash, signals: p.signals } };
  }
  const r = await stApprove(ctx, m.code);
  if (r.status !== "done") return r;
  const id = ctx.bag.agentApprovalId as string | undefined;
  if (id) {
    const client = await ctx.as("client");
    try { await moduleCall("ai", () => ai.resolveAgentApproval(client, id, "CONFIRMED")); } catch (e) { if (!(e instanceof DomainError)) throw e; }
  }
  return done(`${r.detail} The agent's request is marked confirmed.`);
}

/* S7 — late and early (deadline deduction and early-finish bonus) */
const S7_TERMS = { late: { rateBps: 50, graceDays: 1, capBps: 1000, milestones: "ALL" as const }, early: { poolCents: 12_000, rateBps: 25, minDaysEarly: 2, capBps: 100, milestones: "ALL" as const } };
const s7Cfg: SetupCfg = { blueprints: WEB, title: "Web MVP with deadline terms", totalCents: 600_000 };
const S7: Scenario = {
  id: "S7", title: "Late and early — deadline deduction and bonus", seconds: 7, blueprints: WEB, personas: PERSONAS_A,
  proves: "Opt-in deadline terms: a bonus pool funded with the hold, a late milestone released with a capped deduction, an early one with a bonus from the pool, and reconciliation with zero drift.",
  steps: [
    { id: "create", who: "client", label: "Clone the Web MVP blueprint for $6,000", explain: "Deadline terms are off by default; the contract starts without them.", run: (c) => stCreate(c, s7Cfg) },
    { id: "terms", who: "client", label: "Switch on the late deduction and the early bonus", explain: "Parameters, not free text: 0.5% a day after 1 grace day (cap 10%); 0.25% a day from 2 days early (cap 1%) from a $120 pool. A new revision voids any signature.", run: stDeadlineTerms },
    { id: "sign", who: "provider", label: "Both parties sign the revision with the terms", explain: "Signing the revision is the opt-in: the terms are inside the canonical hash both signatures bind to.", run: async (c) => { const a = await stSign(c, "client"); if (a.status === "error") return a; const b = await stSign(c, "provider"); if (b.status === "error") return b; return stLock(c); } },
    { id: "fund", who: "client", label: "Fund tranche 1 with the bonus pool", explain: "One PayPal authorization covers the milestones and the pool; the ledger shows HOLD and BONUS_POOL.", run: stDeadlineFund },
    { id: "gate", who: "provider", label: "Pass the kickoff gate (M01)", explain: "Gates carry no money and no deadline adjustment.", run: (c) => stGate(c, async () => "M02") },
    { id: "late", who: "provider", label: "Deliver M02 two days late → deduction", explain: "Time travel to two days after M02's due date, submit, approve. One grace day, so one day counts: 0.5% of $900.", run: stDeliverLate },
    { id: "early", who: "provider", label: "Deliver M03 three days early → bonus", explain: "M03 is due on day 11 and delivered on day 8: 3 × 0.25% of $1,200, paid from the pool in the same capture.", run: stDeliverEarly },
    { id: "recon", who: "finance", label: "Three-way check: zero drift", explain: "Contract, ledger and PayPal agree to the cent: the pool is part of the hold, the deduction stays authorized for the client.", run: stDeadlineRecon },
  ],
};

async function stDeadlineTerms(ctx: StepCtx): Promise<StepOutcome> {
  const v = await view(ctx);
  if (v.deadline) return skipped("Deadline terms are already on.");
  if (v.signatures.some((s) => !s.voided)) return skipped("Already signed; no more edits.");
  const client = await ctx.as("client");
  const after = await moduleCall("contracts", () => contracts.applyChange(client, v.id, { action: "SET_DEADLINE_TERMS", terms: S7_TERMS }));
  const rules = after.violations.filter((x) => x.rule === "R11" || x.rule === "R12");
  if (rules.length) return failed(`Policy gate: ${rules.map((x) => `${x.rule} ${x.message}`).join(" ")}`);
  return done(`${client.name} switched on both deadline terms (revision ${v.revision} → ${after.revision}, hash ${after.canonicalHash?.slice(0, 12)}…). Late: 0.5% a day after 1 grace day, cap 10%. Early: 0.25% a day from 2 days early, cap 1%, from a ${formatCents(S7_TERMS.early.poolCents)} pool. R11 and R12 pass; state ${after.state}.`);
}

async function stDeadlineFund(ctx: StepCtx): Promise<StepOutcome> {
  const f = await stFund(ctx, 1);
  if (f.status === "error" || f.status === "waiting") return f;
  const c = await stConfirm(ctx, 1);
  if (c.status !== "done") return c;
  const v = await view(ctx);
  const t = trancheOf(v, 1)!;
  const led = await moduleCall("money", () => money.ledgerFor(t.id));
  const pool = led.filter((e) => e.type === "BONUS_POOL").reduce((s, e) => s + e.amountCents, 0);
  const hold = led.filter((e) => e.type === "HOLD").reduce((s, e) => s + e.amountCents, 0);
  return done(`${formatCents(hold + pool)} held in PayPal under one authorization: ${formatCents(hold)} for the milestones of tranche 1 and ${formatCents(pool)} bonus pool. Ledger: HOLD ${formatCents(hold)}, BONUS_POOL ${formatCents(pool)}.`);
}

/** Moves the sim clock so that the virtual now is `targetMs` (whole hours, forward only). */
async function travelTo(ctx: StepCtx, targetMs: number): Promise<string> {
  const sim = await ctx.refreshSim();
  const h = Math.ceil((targetMs - simNow(sim).getTime()) / 3_600_000);
  if (h <= 0) return `Clock already at simulated day ${simDay(sim)}.`;
  const r = await travelInRun(ctx.judge, sim.id, h, ctx.stepId);
  ctx.sim = await ctx.refreshSim();
  return `Simulated clock +${h} h to day ${r.day}.`;
}

async function adjustmentLine(milestoneId: string): Promise<string> {
  const m = await moduleCall("money", () => money.adjustmentsFor([milestoneId]));
  const a = m.get(milestoneId);
  if (!a) return "No deadline adjustment recorded.";
  const when = a.timing === "LATE" ? `${a.daysLate} day(s) late, ${a.excusedDays} excused, ${a.countedDays} counted after the grace day` : a.timing === "EARLY" ? `${a.daysEarly} day(s) early` : "on time";
  return `${when}: base ${formatCents(a.baseCents)}${a.deductionCents ? `, deduction −${formatCents(a.deductionCents)} (back to the client)` : ""}${a.bonusCents ? `, bonus +${formatCents(a.bonusCents)} from the pool` : ""} → released ${formatCents(a.releasedCents)}.`;
}

async function stDeliverLate(ctx: StepCtx): Promise<StepOutcome> {
  let v = await view(ctx);
  const m = msOf(v, "M02");
  if (RELEASED.has(m.state)) return skipped(`M02 is already ${m.state}. ${await adjustmentLine(m.id)}`);
  const t = trancheOf(v, 1);
  if (!t?.heldAt) return failed("Tranche 1 is not held yet.");
  const dueMs = t.heldAt.getTime() + m.targetDay * 86_400_000;
  const travel = OPENABLE.has(m.state) ? await travelTo(ctx, dueMs + 2 * 86_400_000 + 3_600_000) : "";
  const s = await stSubmit(ctx, "M02");
  if (s.status !== "done" && s.status !== "skipped") return s;
  const a = await stApprove(ctx, "M02");
  if (a.status !== "done") return a;
  v = await view(ctx);
  return done(`${travel} M02 was due on day ${m.targetDay}. ${await adjustmentLine(m.id)} ${(await releaseLine(m.id)) ?? ""}`.trim());
}

async function stDeliverEarly(ctx: StepCtx): Promise<StepOutcome> {
  const v = await view(ctx);
  const m = msOf(v, "M03");
  if (RELEASED.has(m.state)) return skipped(`M03 is already ${m.state}. ${await adjustmentLine(m.id)}`);
  const s = await stSubmit(ctx, "M03");
  if (s.status !== "done" && s.status !== "skipped") return s;
  const a = await stApprove(ctx, "M03");
  if (a.status !== "done") return a;
  return done(`M03 was due on day ${m.targetDay} and delivered on simulated day ${simDay(ctx.sim)}. ${await adjustmentLine(m.id)} ${(await releaseLine(m.id)) ?? ""}`.trim());
}

async function stDeadlineRecon(ctx: StepCtx): Promise<StepOutcome> {
  const v = await view(ctx);
  const ids = v.tranches.filter((t) => t.heldAt).map((t) => t.id);
  if (!ids.length) return failed("No funded tranche to check.");
  const lines = await moduleCall("money", () => money.reconcileTranches(ids));
  const led = (await Promise.all(ids.map((id) => moduleCall("money", () => money.ledgerFor(id))))).flat();
  const by = (k: string) => led.filter((e) => e.type === k).reduce((s, e) => s + e.amountCents, 0);
  const bad = lines.filter((l) => l.status === "DRIFT" || l.issues.length);
  await ctx.log("ledger", `three-way check on ${ids.length} tranche(s)`, lines.map((l) => `${l.status}${l.issues.length ? ` · ${l.issues.map((x) => x.note).join("; ")}` : ""}`).join(" | "), !bad.length);
  const summary = `Ledger: HOLD ${formatCents(by("HOLD"))} + BONUS_POOL ${formatCents(by("BONUS_POOL"))}; released ${formatCents(by("RELEASE") + by("FEE"))} (fees ${formatCents(by("FEE"))}); LATE_DEDUCTION ${formatCents(by("LATE_DEDUCTION"))} back to the client; EARLY_BONUS ${formatCents(by("EARLY_BONUS"))} from the pool; ${formatCents(by("BONUS_POOL") - by("EARLY_BONUS") - by("POOL_RETURN"))} of the pool still held (returned at tranche close if unused).`;
  if (bad.length) return failed(`Drift found: ${bad.flatMap((l) => l.issues.map((x) => `${x.plane}: ${x.note}`)).join(" ")} ${summary}`);
  return done(`Contract, ledger and PayPal agree on every tranche (${lines.map((l) => l.status).join(", ")}): zero drift. ${summary}`);
}

export const SCENARIOS: Record<ScenarioId, Scenario> = { S1, S2, S3, S4, S5, S6, S7 };
export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];
export const scenarioOf = (id: string): Scenario => {
  const s = SCENARIOS[id as ScenarioId];
  if (!s) throw new DomainError("SCENARIO_UNKNOWN", `Unknown scenario ${id}.`);
  return s;
};

/* ── runner ── */

function makeCtx(judge: { id: string; role: string }, sim: Sim, scenario: Scenario, stepId: string, bag: Bag, baseUrl?: string): StepCtx {
  return {
    sim, bag, stepId, baseUrl, judge,
    as: (role) => actorFor(scenario.personas[role], `sim:${sim.id}:${stepId}`),
    log: (kind, req, res, ok = true) => logEvent(sim.id, stepId, kind, req, res, ok),
    refreshSim: () => getSim(sim.id),
  };
}

export interface RunResult { stepId: string; label: string; outcome: StepOutcome; ms: number }

async function runOne(judge: { id: string; role: string }, sim: Sim, scenario: Scenario, step: Step, bag: Bag, baseUrl?: string): Promise<RunResult> {
  const started = Date.now();
  const ctx = makeCtx(judge, sim, scenario, step.id, bag, baseUrl);
  const before = await railSnapshot(bag.workspaceId ?? sim.workspaceId);
  let outcome: StepOutcome;
  try { outcome = await step.run(ctx); }
  catch (e) {
    if (e instanceof WaitingFor) outcome = waiting(`${e.message}. This step runs once that module lands.`);
    else if (e instanceof DomainError) outcome = failed(`${e.code}: ${e.message}`);
    else outcome = failed(`Unexpected error: ${(e as Error).message ?? String(e)}`);
  }
  await logDiff(sim.id, step.id, before, await railSnapshot(bag.workspaceId ?? null));
  await logEvent(sim.id, step.id, "step", step.label, `${outcome.status.toUpperCase()} · ${outcome.detail}`, outcome.status !== "error");
  return { stepId: step.id, label: step.label, outcome, ms: Date.now() - started };
}

/** Runs the next unfinished step (or `stepId`) of a sim. One action at a time per run (withSimLock). */
export async function runNext(judge: { id: string; role: string }, simId: string, opts: { baseUrl?: string; stepId?: string } = {}): Promise<RunResult | null> {
  assertSandbox();
  return withSimLock(simId, () => stepOnce(judge, simId, opts));
}

async function stepOnce(judge: { id: string; role: string }, simId: string, opts: { baseUrl?: string; stepId?: string }): Promise<RunResult | null> {
  const sim = await getSim(simId);
  const scenario = scenarioOf(sim.scenario);
  const prog = await progressOf(simId);
  const steps = prog.steps as Record<string, SimStepRecord>;
  const bag = prog.bag as Bag;
  const step = opts.stepId ? scenario.steps.find((s) => s.id === opts.stepId) : scenario.steps.find((s) => !["done", "skipped"].includes(steps[s.id]?.status ?? ""));
  if (!step) return null;
  const r = await runOne(judge, sim, scenario, step, bag, opts.baseUrl);
  const after = await getSim(simId);
  steps[step.id] = { status: r.outcome.status, detail: r.outcome.detail, at: new Date().toISOString(), simDay: simDay(after), ms: r.ms, link: r.outcome.link };
  await saveProgress(simId, steps, bag);
  await audit(db, { id: judge.id, role: judge.role }, "sandbox.step", simId, { scenario: scenario.id, step: step.id, status: r.outcome.status });
  return r;
}

/** Runs steps until one waits or fails, the scenario ends, or the time budget is spent. */
export async function runAll(judge: { id: string; role: string }, simId: string, opts: { baseUrl?: string; budgetMs?: number } = {}): Promise<RunResult[]> {
  assertSandbox();
  return withSimLock(simId, async () => {
    const out: RunResult[] = [];
    const until = Date.now() + (opts.budgetMs ?? 45_000);
    while (Date.now() < until) {
      const r = await stepOnce(judge, simId, { baseUrl: opts.baseUrl });
      if (!r) break;
      out.push(r);
      if (r.outcome.status === "waiting" || r.outcome.status === "error") break;
    }
    return out;
  });
}


/* ── chaos injector (F5.08): one-click faults on the current sim ── */

export const FAULTS = ["release_503", "fund_503", "refund_503", "duplicate_webhook", "chargeback_webhook", "ledger_drift", "spoofed_gps", "valid_photo"] as const;
export type Fault = (typeof FAULTS)[number];

export async function injectFault(judge: { id: string; role: string }, simId: string, fault: Fault, opts: { baseUrl?: string } = {}): Promise<StepOutcome> {
  assertSandbox();
  return withSimLock(simId, () => injectOnce(judge, simId, fault, opts));
}

async function injectOnce(judge: { id: string; role: string }, simId: string, fault: Fault, opts: { baseUrl?: string }): Promise<StepOutcome> {
  const sim = await getSim(simId);
  const scenario = scenarioOf(sim.scenario);
  const prog = await progressOf(simId);
  const bag = prog.bag as Bag;
  const ctx = makeCtx(judge, sim, scenario, "chaos", bag, opts.baseUrl);
  await audit(db, { id: judge.id, role: judge.role }, "sandbox.chaos", simId, { fault });
  const before = await railSnapshot(bag.workspaceId ?? null);
  let out: StepOutcome;
  try {
    switch (fault) {
      case "release_503": case "fund_503": case "refund_503": {
        if (sim.mode === "LIVE") { out = skipped("Faults are injected on the mock rail only; the live PayPal Sandbox is never sabotaged."); break; }
        const scope = await railScope(bag.workspaceId);
        if (!scope.length) { out = failed(NO_SCOPE); break; }
        mockControl.inject(fault, scope); await addFault(simId, fault);
        await ctx.log("fault", `mockControl.inject('${fault}', this run's tranches)`, "the next matching rail call on this run answers a transient 503 once (simulated)");
        out = done(`Armed ${fault}: the next ${fault.split("_")[0]} call on this run's tranches answers 503 once; the money module retries with the same idempotency key.`);
        break;
      }
      case "duplicate_webhook": out = bag.workspaceId ? await stDupWebhook(ctx) : failed("Start the scenario first: no contract yet."); break;
      case "chargeback_webhook": {
        if (!bag.workspaceId) { out = failed("Start the scenario first: no contract yet."); break; }
        const cap = await latestCapture(bag.workspaceId);
        const tid = `SIM-CB-${sim.id.slice(-6)}-${Date.now().toString(36)}`;
        await addFault(simId, "chargeback_webhook");
        const r = await postWebhook(ctx, { id: `WH-${tid}`, event_type: "CUSTOMER.DISPUTE.CREATED", resource: { dispute_id: `PP-D-${tid}`, reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", status: "OPEN", disputed_transactions: [{ seller_transaction_id: cap?.captureId ?? "SIM-CAPTURE" }], dispute_amount: { currency_code: "USD", value: ((cap?.amountCents ?? 0) / 100).toFixed(2) } } }, tid);
        out = r.status < 500 ? done(`PayPal chargeback (CUSTOMER.DISPUTE.CREATED) posted for capture ${cap?.captureId ?? "(none yet)"}: receiver answered ${r.status}. PayPal's own buyer protection takes precedence over the in-app dispute.`) : failed(`Receiver answered ${r.status}.`);
        break;
      }
      case "ledger_drift": out = bag.workspaceId ? await stDrift(ctx) : failed("Start the scenario first: no contract yet."); break;
      case "spoofed_gps": case "valid_photo": {
        if (!bag.workspaceId) { out = failed("Start the scenario first: no contract yet."); break; }
        const v = await view(ctx);
        const open = v.milestones.filter((x) => x.active && x.type === "PAY" && OPENABLE.has(x.state)).sort((a, b) => a.targetDay - b.targetDay || a.seq - b.seq);
        const m = open.find((x) => x.proof.gpsRadiusM) ?? open[0];
        if (!m) { out = failed("No payment milestone is open for evidence right now."); break; }
        const point = fault === "spoofed_gps" ? SPOOF_POINT : VALID_POINT;
        const when = simNow(sim);
        const files = filesForSpec(m.proof, m.code, when, point);
        if (!files.some((f) => f.type === "image/jpeg")) files.push(photo(point, `${m.code.toLowerCase()}-site-photo.jpg`, when));
        await addFault(simId, fault);
        await ctx.log("fault", `inject ${fault === "spoofed_gps" ? "spoofed" : "valid"} photo for ${m.code}`, `EXIF GPS ${point.lat}, ${point.lng} · ${(haversineM(SITE, point) / 1000).toFixed(2)} km from the site`);
        try {
          out = await stSubmit(ctx, m.code, files, `Chaos injector: ${fault}`);
          if (!m.proof.gpsRadiusM && out.status === "done") out = { ...out, detail: `${out.detail} ${m.code} does not ask for located photos, so its GPS is not checked; the photo is kept as extra context.` };
        }
        catch (e) { if (e instanceof DomainError) out = done(`Blocked: ${e.code} — ${e.message}`); else throw e; }
        break;
      }
    }
  } catch (e) {
    if (e instanceof WaitingFor) out = waiting(e.message);
    else if (e instanceof DomainError) out = failed(`${e.code}: ${e.message}`);
    else out = failed(`Unexpected error: ${(e as Error).message}`);
  }
  await saveProgress(simId, prog.steps as Record<string, SimStepRecord>, bag);
  await logDiff(simId, "chaos", before, await railSnapshot(bag.workspaceId ?? null));
  await logEvent(simId, "chaos", "fault", `chaos: ${fault}`, `${out.status.toUpperCase()} · ${out.detail}`, out.status !== "error");
  return out;
}
