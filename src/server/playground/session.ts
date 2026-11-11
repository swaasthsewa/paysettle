/**
 * Sim sessions (F5.06–F5.08): create, read, time travel, faults, reset, the wire log and step progress.
 * P9: every exported function refuses to run outside sandbox mode. Audit rows are written for every mutation and never removed;
 * a reset starts a new sim session with a fresh workspace and simply abandons the old one.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { ledgerEntries, releases, refunds, simSessions, tranches, users, wsMilestones, type Role } from "@/db/schema";
import { simEvents, simProgress, type SimEventKind, type SimStepRecord } from "@/db/schema-playground";
import { simWorkspaces } from "@/db/schema-sim";
import { audit } from "@/lib/audit";
import { nowFor, sandboxMode } from "@/lib/clock";
import { newId } from "@/lib/ids";
import { formatCents } from "@/lib/money";
import { mockControl } from "@/lib/rails/mock";
import { liveAvailable } from "@/lib/rails";
import { DomainError, NotBuilt, type Actor } from "../types";
import * as money from "../money";
import * as evidence from "../evidence";
import * as disputes from "../disputes";

export const MAX_OFFSET_HOURS = 720;
export type SimMode = "LIVE" | "MOCK";
export type Sim = typeof simSessions.$inferSelect;

export class SandboxOnly extends DomainError { constructor() { super("SANDBOX_ONLY", "The Judge Playground runs only in sandbox mode (P9)."); } }
export function assertSandbox() { if (!sandboxMode()) throw new SandboxOnly(); }

/** Who may drive the playground: judges (sandbox only, via rbac) and platform admins. */
export const PLAYGROUND_ROLES: Role[] = ["judge", "admin"];

/** A step is waiting on another module: thrown when a service still throws NotBuilt. */
export class WaitingFor extends Error { constructor(readonly module: string, readonly what: string) { super(`Waiting for module ${module} (${what})`); } }

/** Calls another module's export; turns NotBuilt into a "waiting for module X" outcome instead of a crash. */
export async function moduleCall<T>(module: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof NotBuilt) throw new WaitingFor(module, e.message); throw e; }
}

/* ── personas ── */

const actorCache = new Map<string, Actor>();
export async function actorFor(userId: string, requestId?: string): Promise<Actor> {
  let a = actorCache.get(userId);
  if (!a) {
    const [u] = await db.select({ id: users.id, role: users.role, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new DomainError("PERSONA_MISSING", `Demo person ${userId} is not seeded. Run npm run db:seed.`);
    a = { id: u.id, role: u.role, name: u.name };
    actorCache.set(userId, a);
  }
  return { ...a, requestId };
}

/* ── sim sessions ── */

export async function createSim(judge: { id: string; role: string }, scenario: string, mode: SimMode): Promise<Sim> {
  assertSandbox();
  const m: SimMode = mode === "LIVE" && liveAvailable() ? "LIVE" : "MOCK";
  const id = newId("sim");
  const [s] = await db.insert(simSessions).values({ id, judgeId: judge.id, scenario, mode: m, clockOffsetHours: 0, faults: [] }).returning();
  await db.insert(simProgress).values({ simId: id, steps: {}, bag: {} });
  await audit(db, { id: judge.id, role: judge.role }, "sandbox.start", id, { scenario, mode: m });
  await logEvent(id, "start", "state", `start scenario ${scenario}`, `sim ${id} · mode ${m === "LIVE" ? "Live PayPal Sandbox" : "Fast mock"} · simulated day 0`, true, 0);
  return s;
}

export async function getSim(simId: string): Promise<Sim> {
  assertSandbox();
  const [s] = await db.select().from(simSessions).where(eq(simSessions.id, simId)).limit(1);
  if (!s) throw new DomainError("SIM_NOT_FOUND", "That playground session does not exist. Start a scenario.");
  return s;
}

/*
 * One action at a time per run. Judges share one account, and a step reads the run's progress, works, then saves it; two
 * overlapping calls on the same run (two tabs, the live-mode auto-retry, a double click) would race and the last save
 * would win. The app runs as one server process, so an in-memory set is enough; it sits on globalThis because route
 * handlers and server actions may load this module separately.
 */
const g = globalThis as unknown as { __psSimBusy?: Set<string> };
const busy: Set<string> = (g.__psSimBusy ??= new Set<string>());
export class SimBusy extends DomainError { constructor() { super("SIM_BUSY", "This run is busy with a step; try again in a moment."); } }
export async function withSimLock<T>(simId: string, fn: () => Promise<T>): Promise<T> {
  if (busy.has(simId)) throw new SimBusy();
  busy.add(simId);
  try { return await fn(); } finally { busy.delete(simId); }
}

export async function setSimWorkspace(simId: string, workspaceId: string) {
  assertSandbox();
  await db.update(simSessions).set({ workspaceId }).where(eq(simSessions.id, simId));
  // Tag the workspace as simulated so the demo personas' real screens leave it out (src/lib/sim.ts).
  await db.insert(simWorkspaces).values({ workspaceId, simId }).onConflictDoNothing();
}

/** The sim's virtual "now" (real time + its offset). */
export const simNow = (s: Pick<Sim, "clockOffsetHours">) => nowFor(s.clockOffsetHours);
export const simDay = (s: Pick<Sim, "clockOffsetHours">) => Math.round((s.clockOffsetHours / 24) * 10) / 10;

/* ── progress (step status + carried ids) ── */

export async function progressOf(simId: string) {
  const [p] = await db.select().from(simProgress).where(eq(simProgress.simId, simId)).limit(1);
  return p ?? { simId, steps: {} as Record<string, SimStepRecord>, bag: {} as Record<string, unknown>, updatedAt: new Date() };
}
export async function saveProgress(simId: string, steps: Record<string, SimStepRecord>, bag: Record<string, unknown>) {
  await db.insert(simProgress).values({ simId, steps, bag, updatedAt: new Date() })
    .onConflictDoUpdate({ target: simProgress.simId, set: { steps, bag, updatedAt: new Date() } });
}

/* ── wire log ── */

export async function logEvent(simId: string, step: string, kind: SimEventKind, request: string, response: string, ok = true, offsetHours?: number) {
  let h = offsetHours;
  if (h === undefined) { const [s] = await db.select({ h: simSessions.clockOffsetHours }).from(simSessions).where(eq(simSessions.id, simId)).limit(1); h = s?.h ?? 0; }
  await db.insert(simEvents).values({ simId, step, kind, request: request.slice(0, 600), response: response.slice(0, 1200), ok, simOffsetHours: h });
}
export async function eventsOf(simId: string, limit = 200) {
  return db.select().from(simEvents).where(eq(simEvents.simId, simId)).orderBy(asc(simEvents.id)).limit(limit);
}

/**
 * What the rails and the ledger did for one workspace, as a comparable snapshot. Diffing two snapshots gives the wire-log
 * lines of a step (orders, authorizations, captures, refunds, ledger rows, state changes) in Live and Mock mode alike.
 */
export interface RailSnapshot { lines: Map<string, { kind: SimEventKind; request: string; response: string }> }
export async function railSnapshot(workspaceId: string | null): Promise<RailSnapshot> {
  const lines: RailSnapshot["lines"] = new Map();
  if (!workspaceId) return { lines };
  const tr = await db.select().from(tranches).where(eq(tranches.workspaceId, workspaceId)).orderBy(asc(tranches.idx));
  const ms = await db.select({ id: wsMilestones.id, code: wsMilestones.code, state: wsMilestones.state }).from(wsMilestones).where(eq(wsMilestones.workspaceId, workspaceId));
  const code = new Map(ms.map((m) => [m.id, m.code]));
  for (const t of tr) {
    const amt = formatCents(t.amountCents);
    lines.set(`t:${t.id}:state:${t.state}`, { kind: "state", request: `tranche ${t.idx}`, response: `state ${t.state}` });
    if (t.paypalOrderId) lines.set(`t:${t.id}:order`, { kind: "rail", request: `POST /v2/checkout/orders · intent AUTHORIZE · ${amt} (tranche ${t.idx})`, response: `201 order ${t.paypalOrderId}${t.approveUrl ? " · buyer approval link issued" : ""}` });
    if (t.authorizationId) lines.set(`t:${t.id}:auth`, { kind: "rail", request: `POST /v2/checkout/orders/${t.paypalOrderId ?? "…"}/authorize`, response: `201 authorization ${t.authorizationId} · ${amt} held in PayPal` });
    if (t.reauthorized) lines.set(`t:${t.id}:reauth`, { kind: "rail", request: `POST /v2/payments/authorizations/${t.authorizationId}/reauthorize`, response: "201 reauthorized" });
    for (const w of t.warned ?? []) lines.set(`t:${t.id}:warn:${w}`, { kind: "state", request: `watchdog · tranche ${t.idx}`, response: `notice ${w}` });
  }
  const tIds = tr.map((t) => t.id), mIds = ms.map((m) => m.id);
  if (mIds.length) {
    const rel = await db.select().from(releases).where(inArray(releases.milestoneId, mIds));
    for (const r of rel) lines.set(`r:${r.id}:${r.status}`, { kind: "rail", request: `POST /v2/payments/authorizations/…/capture · ${formatCents(r.grossCents)} for ${code.get(r.milestoneId) ?? "?"} (${r.kind.toLowerCase()})`, response: `${r.status} ${r.paypalRef ?? ""} · fee ${formatCents(r.feeCents)} · provider nets ${formatCents(r.netCents)}` });
    for (const m of ms) lines.set(`m:${m.id}:${m.state}`, { kind: "state", request: `milestone ${m.code}`, response: `state ${m.state}` });
  }
  if (tIds.length) {
    const rf = await db.select().from(refunds).where(inArray(refunds.trancheId, tIds));
    for (const r of rf) lines.set(`f:${r.id}:${r.status}`, { kind: "rail", request: `POST refund/void · ${formatCents(r.amountCents)} back to the client (${r.reason.slice(0, 60)})`, response: `${r.status} ${r.paypalRef ?? ""}` });
    const le = await db.select().from(ledgerEntries).where(inArray(ledgerEntries.trancheId, tIds)).orderBy(asc(ledgerEntries.id));
    for (const l of le) lines.set(`l:${l.id}`, { kind: "ledger", request: `ledger ${l.type}${l.milestoneId ? " · " + (code.get(l.milestoneId) ?? "") : ""}`, response: `debit ${l.debit} → credit ${l.credit} · ${formatCents(l.amountCents)}${l.paypalRef ? " · " + l.paypalRef : ""}` });
  }
  return { lines };
}
export async function logDiff(simId: string, step: string, before: RailSnapshot, after: RailSnapshot) {
  for (const [k, v] of after.lines) if (!before.lines.has(k)) await logEvent(simId, step, v.kind, v.request, v.response, true);
}

/* ── time machine (F5.07) ── */

export interface TimeTravelResult { offsetHours: number; day: number; simulatedNow: string; watchdog: { trancheId: string; action: string }[]; reviewTimers: { milestoneId: string; action: string }[]; disputeTimers: { disputeId: string; action: string }[]; waiting: string[] }

export function checkTravel(current: number, hours: number): number {
  if (!Number.isInteger(hours)) throw new DomainError("TIME_BOUNDS", "Hours must be a whole number.");
  if (hours <= 0) throw new DomainError("TIME_BOUNDS", "Simulated time only moves forward. Use Reset to go back to day 0.");
  const next = current + hours;
  if (next > MAX_OFFSET_HOURS) throw new DomainError("TIME_BOUNDS", `The time machine stops at day ${MAX_OFFSET_HOURS / 24} (+${MAX_OFFSET_HOURS} h). This jump would reach +${next} h.`);
  return next;
}

/** Adds `hours` to the sim clock (0–720 h in total), then runs the hold watchdog and the review timers for its workspace. */
export async function timeTravel(actor: { id: string; role: string }, simId: string, hours: number, step = "time-machine"): Promise<TimeTravelResult> {
  assertSandbox();
  return withSimLock(simId, () => travelInRun(actor, simId, hours, step));
}

/** timeTravel for a scenario step, which already holds the run's lock. */
export async function travelInRun(actor: { id: string; role: string }, simId: string, hours: number, step = "time-machine"): Promise<TimeTravelResult> {
  assertSandbox();
  const s = await getSim(simId);
  const next = checkTravel(s.clockOffsetHours, hours);
  await db.update(simSessions).set({ clockOffsetHours: next }).where(eq(simSessions.id, simId));
  await audit(db, { id: actor.id, role: actor.role }, "sandbox.time_travel", simId, { from: s.clockOffsetHours, to: next, workspaceId: s.workspaceId });
  const now = nowFor(next);
  const before = await railSnapshot(s.workspaceId);
  const out: TimeTravelResult = { offsetHours: next, day: Math.round((next / 24) * 10) / 10, simulatedNow: now.toISOString(), watchdog: [], reviewTimers: [], disputeTimers: [], waiting: [] };
  await logEvent(simId, step, "time", `time travel +${hours} h`, `simulated day ${out.day} · ${now.toISOString().slice(0, 16).replace("T", " ")} UTC (simulated)`, true, next);
  if (s.workspaceId) {
    // The timers take real time and add the workspace's offset themselves (evidence documents this; money takes the later
    // of the two; disputes reads workspaceNow when no time is given), so the offset is never applied twice.
    const real = new Date();
    try { out.watchdog = (await moduleCall("money", () => money.runWatchdog(real, s.workspaceId!))).actions; }
    catch (e) { if (e instanceof WaitingFor) out.waiting.push(e.message); else throw e; }
    try { out.reviewTimers = (await moduleCall("evidence", () => evidence.runReviewTimers(real, s.workspaceId!))).actions; }
    catch (e) { if (e instanceof WaitingFor) out.waiting.push(e.message); else throw e; }
    try { out.disputeTimers = (await moduleCall("disputes", () => disputes.runDisputeTimers(undefined, s.workspaceId!))).actions; }
    catch (e) { if (e instanceof WaitingFor) out.waiting.push(e.message); else throw e; }
    for (const a of out.watchdog) await logEvent(simId, step, "state", `watchdog @ day ${out.day}`, `${a.action} · tranche ${a.trancheId}`, true, next);
    for (const a of out.reviewTimers) await logEvent(simId, step, "state", `review timer @ day ${out.day}`, `${a.action} · milestone ${a.milestoneId}`, true, next);
    for (const a of out.disputeTimers) await logEvent(simId, step, "state", `dispute timer @ day ${out.day}`, `${a.action} · dispute ${a.disputeId}`, true, next);
    for (const w of out.waiting) await logEvent(simId, step, "state", `timers @ day ${out.day}`, w, false, next);
    await logDiff(simId, step, before, await railSnapshot(s.workspaceId));
  }
  return out;
}

/** Hours needed to reach a given simulated day (relative to the sim start). */
export const hoursToDay = (s: Pick<Sim, "clockOffsetHours">, day: number) => day * 24 - s.clockOffsetHours;

/* ── chaos (F5.08) ── */

export async function addFault(simId: string, fault: string) {
  const s = await getSim(simId);
  const faults = [...new Set([...(s.faults ?? []), fault])];
  await db.update(simSessions).set({ faults }).where(eq(simSessions.id, simId));
}

/* ── reset (F5.08: one click back to day 0) ── */

export async function resetSim(actor: { id: string; role: string }, simId: string): Promise<Sim> {
  assertSandbox();
  return withSimLock(simId, async () => {
    const old = await getSim(simId);
    mockControl.reset(); // mock rail state only; database rows (ledger, audit, old workspaces) are kept and simply abandoned
    const fresh = await createSim(actor, old.scenario, old.mode);
    await audit(db, { id: actor.id, role: actor.role }, "sandbox.reset", simId, { replacedBy: fresh.id, abandonedWorkspace: old.workspaceId });
    await logEvent(fresh.id, "reset", "state", `reset from ${simId}`, `fresh session at simulated day 0; previous workspace ${old.workspaceId ?? "(none)"} left as it was`, true, 0);
    return fresh;
  });
}
