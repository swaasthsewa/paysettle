/**
 * Contracts: workspaces, revisions, policy gate, signing, locking into tranches, ops clearance.
 * F2.02 clone a blueprint into a workspace · F2.03 server-authoritative revisions · F2.04 prune/append/edit milestones ·
 * F2.05 clause engine (system clauses immutable) + risk score · F2.06 amounts to the cent · F2.07 tranching ·
 * F2.08 proof specs · F2.09 lock/dispute rules · F2.10 dual signature over the canonical hash · F2.11 ops clearance.
 * Deadline terms (late deduction, early bonus): SET_DEADLINE_TERMS is one more change (new revision, signatures
 * voided, canonical hash covers the terms), mirrored as two clauses so the contract text shows them; lock splits the bonus
 * pool over the tranches. Deadline extensions (signed by both parties) live in ./deadline.ts.
 * No money moves here (P1): locking only plans tranches; the money module funds them.
 */
import { feeBpsFor } from "@/server/control";
import { createHmac } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db, type Tx } from "@/db/client";
import {
  auditChain, blueprints, paypalLinks, revisions, signatures, tranches, users, workspaces, wsClauses, wsMilestones,
  type BlueprintClause, type BlueprintMilestone, type ProofSpec,
} from "@/db/schema";
import { SYSTEM_CLAUSES } from "@/data/blueprints/system";
import { changeOrders, changeOrderSignatures } from "@/db/schema-amend";
import { audit } from "@/lib/audit";
import { canonical, canonicalHash } from "@/lib/canonical";
import { sandboxMode } from "@/lib/clock";
import { milestoneMachine, workspaceMachine } from "@/lib/fsm";
import { newId } from "@/lib/ids";
import { verifyTotp } from "@/lib/identity/totp";
import { RISK_OPS_THRESHOLD, sameRevision, type Rail, type Tier, type Violation } from "@/lib/policy";
import { DEADLINE_CLAUSES, DEADLINE_CLAUSE_CODES, earlyClauseText, lateClauseText, normalizeTerms, zDeadlineTerms, type DeadlineTerms } from "@/lib/deadline";
import { canonical as canonicalJson } from "@/lib/canonical";
import { liveAvailable } from "@/lib/rails";
import { excludeSim, isSimWorkspaceSql, isTestOrgId } from "@/lib/sim";
import { can, canWrite } from "@/lib/rbac";
import { workspaceNow } from "../clock";
import { DomainError, type Actor, type Change, type WorkspaceView } from "../types";
import {
  byDay, canonicalDoc, diffDocs, evaluate, nextCode, openAtLock, planPools, planTranches, recomputeAmounts, recomputeTranches,
  type CanonicalDoc, type ClDraft, type Diff, type MsDraft, type WsHead,
} from "./core";

export { diffDocs, parseDollarsToCents, parsePctToBps } from "./core";
export type { Diff } from "./core";

type WsRow = typeof workspaces.$inferSelect;
/** Optional request context a server action may attach to the actor (never required by the shared signatures). */
type ActorCtx = Actor & { mfa?: boolean; ip?: string; userAgent?: string };

const EDITABLE = ["DRAFT", "READY_TO_SIGN", "PARTIALLY_SIGNED"];
const ORG_WIDE: string[] = ["ops", "admin", "finance", "mediator", "judge"];

/* ───────────── input validation (zod) ───────────── */
const zProof = z.object({
  artifacts: z.array(z.object({ kind: z.enum(["IMAGE", "VIDEO", "PDF", "LOG", "LINK", "SIGNATURE", "ORACLE"]), min: z.number().int().min(0).max(50), note: z.string().max(200).optional() })).max(12),
  gpsRadiusM: z.number().int().min(1).max(100_000).optional(),
  oracle: z.string().max(40).optional(),
  criteria: z.array(z.string().trim().min(1).max(300)).max(20),
});
const zDay = z.number().int().min(1).max(365);
const zBps = z.number().int().min(0).max(10_000);
const zCode = z.string().min(1).max(40);
const zMsIn = z.object({ title: z.string().trim().min(3).max(140), type: z.enum(["GATE", "PAY"]), day: zDay, bps: zBps, proof: zProof, lockRule: z.string().trim().max(300), disputeRule: z.string().trim().max(300) });
const zChange = z.union([
  z.object({ action: z.enum(["PRUNE", "RESTORE"]), milestoneCode: zCode }),
  z.object({ action: z.literal("APPEND"), milestone: zMsIn.extend({ afterCode: zCode.optional() }) }),
  z.object({ action: z.literal("SET_BPS"), shares: z.record(zCode, zBps) }),
  z.object({ action: z.literal("SET_DAY"), milestoneCode: zCode, day: zDay }),
  z.object({ action: z.literal("TOGGLE_CLAUSE"), clauseCode: zCode, active: z.boolean() }),
  z.object({ action: z.literal("APPEND_CLAUSE"), title: z.string().trim().min(3).max(120), body: z.string().trim().min(5).max(2000), linkedMilestone: zCode.optional() }),
  z.object({ action: z.literal("SET_TOTAL"), totalCents: z.number().int().min(1).max(100_000_000) }),
  z.object({ action: z.literal("SET_DEADLINE_TERMS"), terms: zDeadlineTerms.nullable() }),
]);
const zCreate = z.object({
  blueprintCode: zCode, title: z.string().trim().min(3).max(120), totalCents: z.number().int().min(1).max(100_000_000),
  providerId: z.string().min(1).max(64).optional(), inviteEmail: z.email().max(200).optional(), draft: z.unknown().optional(),
});
const zDraft = z.object({ milestones: z.array(zMsIn).min(1).max(50) });

function invalid(e: z.ZodError): never { throw new DomainError("INVALID_INPUT", e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")); }

/* ───────────── loading ───────────── */
type Q = Tx | typeof db;
async function actorUser(q: Q, a: Actor) {
  const [u] = await q.select().from(users).where(eq(users.id, a.id)).limit(1);
  if (!u) throw new DomainError("FORBIDDEN", "Unknown person.");
  return u;
}
async function loadWs(q: Q, id: string, forUpdate = false): Promise<WsRow> {
  const base = q.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  const [w] = forUpdate ? await base.for("update") : await base;
  if (!w) throw new DomainError("NOT_FOUND", "This contract does not exist.");
  return w;
}
async function loadMs(q: Q, id: string): Promise<MsDraft[]> {
  const rows = await q.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, id)).orderBy(asc(wsMilestones.seq));
  return rows.map((r) => ({ id: r.id, seq: r.seq, code: r.code, origin: r.origin, active: r.active, prunedBy: r.prunedBy, type: r.type, title: r.title, targetDay: r.targetDay, bps: r.bps, amountCents: r.amountCents, proof: r.proof, lockRule: r.lockRule, disputeRule: r.disputeRule, dependsOn: r.dependsOn, trancheIdx: r.trancheIdx, state: r.state }));
}
async function loadCl(q: Q, id: string): Promise<ClDraft[]> {
  const rows = await q.select().from(wsClauses).where(eq(wsClauses.workspaceId, id));
  return rows.map((r) => ({ id: r.id, category: r.category, code: r.code, title: r.title, body: r.body, active: r.active, protective: r.protective, linkedMilestone: r.linkedMilestone, byUser: r.byUser }));
}
async function providerFacts(q: Q, providerId: string | null): Promise<{ payable: boolean; tier: Tier }> {
  if (!providerId) return { payable: false, tier: "new" };
  const [u] = await q.select({ tier: users.tier }).from(users).where(eq(users.id, providerId)).limit(1);
  const [l] = await q.select({ id: paypalLinks.id }).from(paypalLinks).where(and(eq(paypalLinks.userId, providerId), eq(paypalLinks.kind, "merchant"), eq(paypalLinks.receivable, true))).limit(1);
  return { payable: Boolean(l), tier: (u?.tier ?? "new") as Tier };
}
const head = (w: WsRow): WsHead => ({ id: w.id, title: w.title, blueprintCode: w.blueprintCode, currency: w.currency, totalCents: w.totalCents, feeBps: w.feeBps, rail: w.rail as Rail, clientId: w.clientId, providerId: w.providerId, inviteEmail: w.inviteEmail, reviewTimeoutRule: w.reviewTimeoutRule, deadline: normalizeTerms(w.deadlineTerms) });

/** Who may see a workspace: its two parties, or an operational role in the same organisation. */
async function assertCanRead(q: Q, a: Actor, w: WsRow) {
  if (a.id === w.clientId || a.id === w.providerId) return;
  if (ORG_WIDE.includes(a.role)) { const u = await actorUser(q, a); if (u.orgId === w.orgId) return; }
  throw new DomainError("FORBIDDEN", "You are not a party to this contract.");
}
function partyRole(a: Actor, w: WsRow): "client" | "provider" {
  if (a.id === w.clientId && a.role === "client") return "client";
  if (a.id === w.providerId && a.role === "provider") return "provider";
  throw new DomainError("FORBIDDEN", "Only the client and the provider of this contract can change or sign it.");
}

/* ───────────── persistence ───────────── */
async function saveMs(tx: Tx, wsId: string, ms: MsDraft[]) {
  for (const m of ms) {
    const set = { seq: m.seq, code: m.code, origin: m.origin, active: m.active, prunedBy: m.prunedBy, type: m.type, title: m.title, targetDay: m.targetDay, bps: m.bps, amountCents: m.amountCents, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn, trancheIdx: m.trancheIdx, state: m.state };
    await tx.insert(wsMilestones).values({ id: m.id, workspaceId: wsId, ...set }).onConflictDoUpdate({ target: wsMilestones.id, set });
  }
}
async function saveCl(tx: Tx, wsId: string, cl: ClDraft[]) {
  for (const c of cl) {
    const set = { category: c.category, code: c.code, title: c.title, body: c.body, active: c.active, protective: c.protective, linkedMilestone: c.linkedMilestone, byUser: c.byUser };
    await tx.insert(wsClauses).values({ id: c.id, workspaceId: wsId, ...set }).onConflictDoUpdate({ target: wsClauses.id, set });
  }
}
/** Writes an immutable revision (P5) and returns its hash. */
async function writeRevision(tx: Tx, h: WsHead, revNo: number, ms: MsDraft[], cl: ClDraft[], authorId: string, change: { action: string; target?: string; detail?: unknown }) {
  const doc = canonicalDoc(h, revNo, ms, cl);
  const hash = canonicalHash(doc);
  await tx.insert(revisions).values({ workspaceId: h.id, revNo, hash, canonical: JSON.parse(canonical(doc)), authorId, change });
  return hash;
}

/* ───────────── signing key (P8: from the environment; the dev default is refused in production) ───────────── */
function signingKey(): string {
  const k = process.env.SIGNING_KEY;
  if (k) return k;
  if (!sandboxMode()) throw new DomainError("CONFIG", "SIGNING_KEY is not set.");
  return "paysettle-dev-signing-key";
}
/** HMAC-SHA256 over the revision hash, bound to the workspace, revision and signer. The key never leaves the server. */
export const signatureFor = (wsId: string, revNo: number, hash: string, signerId: string, role: string) =>
  createHmac("sha256", signingKey()).update(`${wsId}|${revNo}|${hash}|${signerId}|${role}`).digest("hex");

/* ───────────── create ───────────── */
function fromBlueprint(list: BlueprintMilestone[]): Omit<MsDraft, "id">[] {
  return list.map((m, i) => ({ seq: (i + 1) * 10, code: m.code, origin: "BASELINE", active: true, prunedBy: null, type: m.type, title: m.title, targetDay: m.day, bps: m.type === "GATE" ? 0 : m.bps, amountCents: 0, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn ?? [], trancheIdx: 1, state: "DRAFT" }));
}
function fromDraft(draft: unknown): Omit<MsDraft, "id">[] | null {
  const d = zDraft.safeParse(draft && typeof draft === "object" && "data" in draft ? (draft as { data: unknown }).data : draft);
  if (!d.success) return null;
  return [...d.data.milestones].sort((a, b) => a.day - b.day).map((m, i) => ({ seq: (i + 1) * 10, code: `M${String(i + 1).padStart(2, "0")}`, origin: "BASELINE", active: true, prunedBy: null, type: m.type, title: m.title, targetDay: m.day, bps: m.type === "GATE" ? 0 : m.bps, amountCents: 0, proof: m.proof as ProofSpec, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: [], trancheIdx: 1, state: "DRAFT" }));
}
function railFromEnv(): Rail {
  if (!liveAvailable()) return "MOCK";
  const r = process.env.PAYPAL_RAIL;
  if (r === "A2" && !sandboxMode()) return "A1";
  return r === "A1" || r === "A2" || r === "B" ? r : "A1";
}

export async function createWorkspace(a: Actor, i: { blueprintCode: string; title: string; totalCents: number; providerId?: string; inviteEmail?: string; draft?: unknown }): Promise<string> {
  const p = zCreate.safeParse({ ...i, inviteEmail: i.inviteEmail?.trim() || undefined, providerId: i.providerId || undefined });
  if (!p.success) invalid(p.error);
  if (!canWrite(a.role, "contract.create") || a.role !== "client") throw new DomainError("FORBIDDEN", "Only a client can start a contract.");
  const inp = p.data;
  const me = await actorUser(db, a);
  const [bp] = await db.select().from(blueprints).where(and(eq(blueprints.code, inp.blueprintCode), eq(blueprints.active, true))).limit(1);
  if (!bp) throw new DomainError("NOT_FOUND", "That blueprint does not exist.");

  let providerId: string | null = null;
  let inviteEmail: string | null = inp.inviteEmail?.toLowerCase() ?? null;
  const pick = inp.providerId
    ? await db.select().from(users).where(eq(users.id, inp.providerId)).limit(1)
    : inviteEmail ? await db.select().from(users).where(eq(users.email, inviteEmail)).limit(1) : [];
  if (pick[0]) {
    if (pick[0].role !== "provider" || pick[0].orgId !== me.orgId) throw new DomainError("INVALID_INPUT", "The provider must be a provider in your organisation.");
    providerId = pick[0].id; inviteEmail = null;
  } else if (inp.providerId) throw new DomainError("INVALID_INPUT", "That provider does not exist.");

  const id = newId("ws");
  const drafted = inp.draft !== undefined ? fromDraft(inp.draft) : null;
  const ms: MsDraft[] = (drafted ?? fromBlueprint(bp.milestones)).map((m) => ({ ...m, id: newId("ms") }));
  const bpClauses: BlueprintClause[] = [...SYSTEM_CLAUSES.filter((s) => !bp.clauses.some((c) => c.code === s.code)), ...bp.clauses];
  const cl: ClDraft[] = bpClauses.map((c) => ({ id: newId("cl"), category: c.category, code: c.code, title: c.title, body: c.body, active: true, protective: c.category === "SYSTEM" ? true : Boolean(c.protective), linkedMilestone: null, byUser: null }));
  const h: WsHead = { id, title: inp.title, blueprintCode: bp.code, currency: "USD", totalCents: inp.totalCents, feeBps: await feeBpsFor(bp.vertical), rail: railFromEnv(), clientId: a.id, providerId, inviteEmail, reviewTimeoutRule: "ESCALATE", deadline: null };
  recomputeAmounts(ms, h.totalCents);
  recomputeTranches(ms, h.rail);
  const facts = await providerFacts(db, providerId);
  const ev = evaluate(h, ms, cl, facts.payable, facts.tier);
  const state = ev.violations.length ? "DRAFT" : workspaceMachine.next("DRAFT", "gate_pass");

  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({ id, orgId: me.orgId, blueprintCode: bp.code, title: h.title, clientId: a.id, providerId, inviteEmail, currency: h.currency, totalCents: h.totalCents, feeBps: h.feeBps, rail: h.rail, state, revision: 1, riskScore: ev.risk.score });
    await saveMs(tx, id, ms);
    await saveCl(tx, id, cl);
    const hash = await writeRevision(tx, h, 1, ms, cl, a.id, { action: "CREATE", detail: { blueprint: bp.code, source: drafted ? "ai_draft" : "blueprint" } });
    await tx.update(workspaces).set({ canonicalHash: hash }).where(eq(workspaces.id, id));
    await audit(tx, a, "contract.create", id, { blueprint: bp.code, totalCents: h.totalCents, rail: h.rail, source: drafted ? "ai_draft" : "blueprint", providerId, invited: Boolean(inviteEmail) });
  });
  return id;
}

/* ───────────── read ───────────── */
async function buildView(q: Q, w: WsRow): Promise<WorkspaceView> {
  const [ms, cl, trs, sigs] = await Promise.all([
    loadMs(q, w.id), loadCl(q, w.id),
    q.select().from(tranches).where(eq(tranches.workspaceId, w.id)).orderBy(asc(tranches.idx)),
    q.select().from(signatures).where(eq(signatures.workspaceId, w.id)).orderBy(asc(signatures.createdAt)),
  ]);
  const ids = [w.clientId, ...(w.providerId ? [w.providerId] : [])];
  const people = await q.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  const facts = await providerFacts(q, w.providerId);
  const ev = evaluate(head(w), ms, cl, facts.payable, facts.tier);
  const timers = await q.select({ id: wsMilestones.id, attempts: wsMilestones.attempts, reviewDueAt: wsMilestones.reviewDueAt }).from(wsMilestones).where(eq(wsMilestones.workspaceId, w.id));
  const extra = new Map(timers.map((r) => [r.id, r]));
  return {
    id: w.id, title: w.title, blueprintCode: w.blueprintCode, state: w.state, revision: w.revision, rail: w.rail, currency: w.currency,
    totalCents: w.totalCents, feeBps: w.feeBps, riskScore: w.riskScore, canonicalHash: w.canonicalHash,
    client: { id: w.clientId, name: nameOf(w.clientId) }, provider: w.providerId ? { id: w.providerId, name: nameOf(w.providerId) } : null, inviteEmail: w.inviteEmail,
    milestones: [...ms].sort(byDay).map((m) => ({ id: m.id, seq: m.seq, code: m.code, title: m.title, type: m.type, origin: m.origin, active: m.active, targetDay: m.targetDay, bps: m.bps, amountCents: m.amountCents, proof: m.proof, lockRule: m.lockRule, disputeRule: m.disputeRule, dependsOn: m.dependsOn, trancheIdx: m.trancheIdx, state: m.state, attempts: extra.get(m.id)?.attempts ?? 0, reviewDueAt: extra.get(m.id)?.reviewDueAt ?? null })),
    clauses: [...cl].sort((x, y) => catOrder(x.category) - catOrder(y.category) || x.code.localeCompare(y.code)).map((c) => ({ id: c.id, category: c.category, code: c.code, title: c.title, body: c.body, active: c.active, protective: c.protective })),
    tranches: trs.map((t) => ({ id: t.id, idx: t.idx, rail: t.rail, amountCents: t.amountCents, startDay: t.startDay, endDay: t.endDay, state: t.state, approveUrl: t.approveUrl, heldAt: t.heldAt, windowEndsAt: t.windowEndsAt })),
    signatures: sigs.map((s) => ({ role: s.role, signerId: s.signerId, revNo: s.revNo, voided: s.voidedAtRev !== null, at: s.createdAt })),
    violations: ev.violations,
    deadline: normalizeTerms(w.deadlineTerms),
    bonusPools: Object.fromEntries(trs.map((t) => [t.id, t.bonusPoolCents])),
  };
}
const catOrder = (c: string) => ({ SYSTEM: 0, BASELINE: 1, CUSTOM: 2 })[c] ?? 3;

export async function getWorkspace(a: Actor, id: string): Promise<WorkspaceView> {
  const w = await loadWs(db, id);
  await assertCanRead(db, a, w);
  return buildView(db, w);
}

/**
 * The contracts a person can open. Playground simulations and test organisations are left out by default
 * (`sim: "exclude"`); the playground lists its own with `sim: "only"`. A viewer in a test org keeps their test rows.
 */
export async function listWorkspaces(a: Actor, opts: { sim?: "exclude" | "only" | "include" } = {}): Promise<{ id: string; title: string; state: string; totalCents: number; counterpart: string; updatedAt: Date; periodNo: number; continues: boolean }[]> {
  const c = alias(users, "c"), p = alias(users, "p");
  const sel = db.select({ w: workspaces, cName: c.name, pName: p.name }).from(workspaces).innerJoin(c, eq(c.id, workspaces.clientId)).leftJoin(p, eq(p.id, workspaces.providerId));
  const [me] = await db.select({ orgId: users.orgId }).from(users).where(eq(users.id, a.id)).limit(1);
  const mode = opts.sim ?? "exclude";
  const simCond = mode === "include" ? undefined : mode === "only" ? isSimWorkspaceSql(workspaces.id) : excludeSim(workspaces.id, workspaces.orgId, { keepTest: isTestOrgId(me?.orgId) });
  let rows;
  if (a.role === "client") rows = await sel.where(and(eq(workspaces.clientId, a.id), simCond)).orderBy(desc(workspaces.updatedAt));
  else if (a.role === "provider") rows = await sel.where(and(eq(workspaces.providerId, a.id), simCond)).orderBy(desc(workspaces.updatedAt));
  else if (ORG_WIDE.includes(a.role)) { const u = await actorUser(db, a); rows = await sel.where(and(eq(workspaces.orgId, u.orgId), simCond)).orderBy(desc(workspaces.updatedAt)); }
  else return [];
  return rows.map(({ w, cName, pName }) => ({
    id: w.id, title: w.title, state: w.state, totalCents: w.totalCents, updatedAt: w.updatedAt, periodNo: w.periodNo, continues: Boolean(w.parentWorkspaceId),
    counterpart: a.role === "client" ? (pName ?? (w.inviteEmail ? `${w.inviteEmail} (invited)` : "No provider yet"))
      : a.role === "provider" ? cName : `${cName} ↔ ${pName ?? w.inviteEmail ?? "no provider"}`,
  }));
}

/* ───────────── change ───────────── */
function applyOne(c: Change, ms: MsDraft[], cl: ClDraft[], h: WsHead, a: Actor): { target?: string } {
  const findMs = (code: string) => { const m = ms.find((x) => x.code === code); if (!m) throw new DomainError("NOT_FOUND", `Milestone ${code} is not in this contract.`); return m; };
  switch (c.action) {
    case "PRUNE": { const m = findMs(c.milestoneCode); if (!m.active) throw new DomainError("NO_CHANGE", `${m.code} is already pruned.`); m.active = false; m.prunedBy = a.id; return { target: m.code }; }
    case "RESTORE": { const m = findMs(c.milestoneCode); if (m.active) throw new DomainError("NO_CHANGE", `${m.code} is already active.`); m.active = true; m.prunedBy = null; return { target: m.code }; }
    case "APPEND": {
      const nm = c.milestone;
      const code = nextCode("C", ms.map((m) => m.code));
      let seq = Math.max(0, ...ms.map((m) => m.seq)) + 10;
      if (nm.afterCode) {
        const after = findMs(nm.afterCode);
        for (const m of ms) if (m.seq > after.seq) m.seq += 10;
        seq = after.seq + 10;
      }
      ms.push({ id: newId("ms"), seq, code, origin: "CUSTOM", active: true, prunedBy: null, type: nm.type, title: nm.title, targetDay: nm.day, bps: nm.type === "GATE" ? 0 : nm.bps, amountCents: 0, proof: nm.proof, lockRule: nm.lockRule, disputeRule: nm.disputeRule, dependsOn: [], trancheIdx: 1, state: "DRAFT" });
      return { target: code };
    }
    case "SET_BPS": {
      const codes = Object.keys(c.shares);
      if (!codes.length) throw new DomainError("NO_CHANGE", "No shares given.");
      for (const code of codes) { const m = findMs(code); if (m.type !== "PAY") throw new DomainError("INVALID_INPUT", `${code} is an information step and carries no payment.`); m.bps = c.shares[code]; }
      return { target: codes.join(",") };
    }
    case "SET_DAY": { const m = findMs(c.milestoneCode); m.targetDay = c.day; return { target: m.code }; }
    case "TOGGLE_CLAUSE": {
      const k = cl.find((x) => x.code === c.clauseCode);
      if (!k) throw new DomainError("NOT_FOUND", `Clause ${c.clauseCode} is not in this contract.`);
      if (k.category === "SYSTEM") throw new DomainError("SYSTEM_CLAUSE_LOCKED", "System clauses cannot be switched off or pruned.");
      if (DEADLINE_CLAUSE_CODES.includes(k.code)) throw new DomainError("DEADLINE_TERMS", "Change the late deduction and the early bonus in the Deadline terms panel, so their numbers and their text stay the same.");
      if (k.active === c.active) throw new DomainError("NO_CHANGE", `Clause ${k.code} is already ${k.active ? "on" : "off"}.`);
      k.active = c.active; return { target: k.code };
    }
    case "APPEND_CLAUSE": {
      if (c.linkedMilestone) findMs(c.linkedMilestone);
      const code = nextCode("CUS_", cl.map((x) => x.code));
      cl.push({ id: newId("cl"), category: "CUSTOM", code, title: c.title, body: c.body, active: true, protective: false, linkedMilestone: c.linkedMilestone ?? null, byUser: a.id });
      return { target: code };
    }
    case "SET_TOTAL": { if (h.totalCents === c.totalCents) throw new DomainError("NO_CHANGE", "The total is unchanged."); h.totalCents = c.totalCents; return {}; }
    case "SET_DEADLINE_TERMS": {
      const next = normalizeTerms(c.terms);
      if (canonicalJson(next) === canonicalJson(h.deadline ?? null)) throw new DomainError("NO_CHANGE", "The deadline terms are unchanged.");
      h.deadline = next;
      syncDeadlineClauses(cl, next, a);
      return { target: [next?.late ? DEADLINE_CLAUSES.late : null, next?.early ? DEADLINE_CLAUSES.early : null].filter(Boolean).join(",") || "OFF" };
    }
  }
}

/** The two deadline terms also appear as clauses (text generated from the numbers; switched with the terms only). */
function syncDeadlineClauses(cl: ClDraft[], t: DeadlineTerms | null, a: Actor) {
  const want = [
    { code: DEADLINE_CLAUSES.late, title: "Late delivery deduction", on: Boolean(t?.late), body: t?.late ? lateClauseText(t.late) : null },
    { code: DEADLINE_CLAUSES.early, title: "Early-finish bonus", on: Boolean(t?.early), body: t?.early ? earlyClauseText(t.early) : null },
  ];
  for (const w of want) {
    const k = cl.find((x) => x.code === w.code);
    if (k) { k.active = w.on; if (w.body) k.body = w.body; k.title = w.title; }
    else if (w.on && w.body) cl.push({ id: newId("cl"), category: "BASELINE", code: w.code, title: w.title, body: w.body, active: true, protective: false, linkedMilestone: null, byUser: a.id });
  }
}

/**
 * F2.03 like applyChange, with optimistic concurrency: when `expectedRev` is given and the workspace has moved on,
 * the change is refused with MERGE_REQUIRED (HTTP 409 semantics) so nobody overwrites an edit they have not seen.
 */
export async function applyChangeAt(a: Actor, id: string, change: Change, expectedRev?: number): Promise<WorkspaceView> {
  const parsed = zChange.safeParse(change);
  if (!parsed.success) invalid(parsed.error);
  const c = parsed.data as Change;
  if (!canWrite(a.role, "contract.negotiate")) throw new DomainError("FORBIDDEN", "Your role cannot negotiate contracts.");
  const now = await workspaceNow(id);
  await db.transaction(async (tx) => {
    const w = await loadWs(tx, id, true);
    partyRole(a, w);
    if (expectedRev !== undefined && expectedRev !== w.revision) throw new DomainError("MERGE_REQUIRED", `This contract changed while you were editing (now revision ${w.revision}). Review the latest version and try again.`);
    if (!EDITABLE.includes(w.state) || !workspaceMachine.allows(w.state as never, "edit")) throw new DomainError("STATE", `A contract in state ${w.state} cannot be changed.`);
    const ms = await loadMs(tx, id), cl = await loadCl(tx, id);
    const h = head(w);
    const { target } = applyOne(c, ms, cl, h, a);
    recomputeAmounts(ms, h.totalCents);
    recomputeTranches(ms, h.rail);
    const facts = await providerFacts(tx, w.providerId);
    const ev = evaluate(h, ms, cl, facts.payable, facts.tier);
    const revNo = w.revision + 1;
    let state = workspaceMachine.next(w.state as never, "edit");
    if (!ev.violations.length) state = workspaceMachine.next(state, "gate_pass");
    await saveMs(tx, id, ms);
    await saveCl(tx, id, cl);
    const { action, ...detail } = c as Change & Record<string, unknown>;
    const hash = await writeRevision(tx, h, revNo, ms, cl, a.id, { action, target, detail });
    const voided = await tx.update(signatures).set({ voidedAtRev: revNo }).where(and(eq(signatures.workspaceId, id), isNull(signatures.voidedAtRev))).returning({ id: signatures.id, role: signatures.role });
    await tx.update(workspaces).set({ totalCents: h.totalCents, deadlineTerms: h.deadline ?? null, revision: revNo, canonicalHash: hash, riskScore: ev.risk.score, state, updatedAt: now }).where(eq(workspaces.id, id));
    await audit(tx, a, "contract.change", id, { revNo, action, target, violations: ev.violations.map((v) => v.code), risk: ev.risk.score, state });
    if (voided.length) await audit(tx, a, "contract.signature_voided", id, { revNo, roles: voided.map((v) => v.role) });
  });
  return getWorkspace(a, id);
}

export async function applyChange(a: Actor, id: string, c: Change): Promise<WorkspaceView> {
  return applyChangeAt(a, id, c);
}

/* ───────────── lock (shared by sign and clear) ───────────── */
async function lockTx(tx: Tx, a: Actor, w: WsRow, now: Date) {
  const ms = await loadMs(tx, w.id);
  const open = openAtLock(ms);
  for (const m of ms) {
    if (!m.active) continue;
    m.state = milestoneMachine.next("DRAFT", "lock");
    if (open.has(m.id)) m.state = milestoneMachine.next("LOCKED", "open");
  }
  await saveMs(tx, w.id, ms);
  const plan = planTranches(ms);
  const pools = planPools(ms, normalizeTerms(w.deadlineTerms)); // the bonus pool is funded with the tranche holds
  for (const t of plan) await tx.insert(tranches).values({ id: newId("tr"), workspaceId: w.id, idx: t.idx, rail: w.rail, amountCents: t.amountCents, bonusPoolCents: pools.get(t.idx) ?? 0, startDay: t.startDay, endDay: t.endDay, state: "PLANNED" }).onConflictDoNothing();
  await tx.update(workspaces).set({ state: "LOCKED", updatedAt: now }).where(eq(workspaces.id, w.id));
  await audit(tx, a, "contract.locked", w.id, { revNo: w.revision, hash: w.canonicalHash, tranches: plan.map((t) => ({ idx: t.idx, amountCents: t.amountCents, bonusPoolCents: pools.get(t.idx) ?? 0, days: `${t.startDay}-${t.endDay}` })), opened: ms.filter((m) => open.has(m.id)).map((m) => m.code) });
}

/* ───────────── sign ───────────── */
export async function sign(a: Actor, id: string, revNo: number, hash: string, mfaCode?: string): Promise<WorkspaceView> {
  if (!canWrite(a.role, "contract.sign")) throw new DomainError("FORBIDDEN", "Your role cannot sign contracts.");
  const ctx = a as ActorCtx;
  const now = await workspaceNow(id);
  await db.transaction(async (tx) => {
    const w = await loadWs(tx, id, true);
    const role = partyRole(a, w);
    if (revNo !== w.revision || hash !== w.canonicalHash) throw new DomainError("REVISION_MISMATCH", `You are signing revision ${revNo}, but the contract is now at revision ${w.revision}. Review the latest version and sign that.`);
    const ms = await loadMs(tx, id), cl = await loadCl(tx, id);
    const facts = await providerFacts(tx, w.providerId);
    const ev = evaluate(head(w), ms, cl, facts.payable, facts.tier);
    const carry = await carryBlock(tx, w);
    if (carry) throw new DomainError("CARRY_PENDING", carry);
    if (ev.violations.length) throw new DomainError("POLICY_BLOCKED", `This revision cannot be signed yet: ${ev.violations.map((v) => `${v.rule} ${v.message}`).join(" ")}`);
    let state = w.state as Parameters<typeof workspaceMachine.next>[0];
    if (state === "DRAFT") state = workspaceMachine.next(state, "gate_pass");
    if (state !== "READY_TO_SIGN" && state !== "PARTIALLY_SIGNED") throw new DomainError("STATE", `A contract in state ${w.state} cannot be signed.`);

    const me = await actorUser(tx, a);
    let mfa = ctx.mfa === true;
    if (mfaCode && me.mfaSecret) {
      const r = verifyTotp(me.mfaSecret, mfaCode, Date.now(), me.mfaLastStep);
      if (!r.ok) throw new DomainError("MFA_FAILED", "That authenticator code is not right.");
      await tx.update(users).set({ mfaLastStep: r.step }).where(eq(users.id, me.id));
      mfa = true;
    }
    if (!mfa && !sandboxMode()) throw new DomainError("MFA_REQUIRED", "Signing needs a fresh authenticator code.");

    const live = await tx.select().from(signatures).where(and(eq(signatures.workspaceId, id), eq(signatures.revNo, revNo), isNull(signatures.voidedAtRev)));
    if (live.some((s) => s.role === role)) throw new DomainError("ALREADY_SIGNED", `You already signed revision ${revNo}.`);
    await tx.insert(signatures).values({ id: newId("sig"), workspaceId: id, revNo, hash, signerId: a.id, role, signature: signatureFor(id, revNo, hash, a.id, role), mfa, ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 300) ?? null });
    await audit(tx, a, "contract.sign", id, { revNo, hash, role, mfa });

    if (!live.length) {
      state = workspaceMachine.next(state, "sign");
      await tx.update(workspaces).set({ state, riskScore: ev.risk.score, updatedAt: now }).where(eq(workspaces.id, id));
      return;
    }
    const other = live[0];
    if (!sameRevision({ revNo, hash }, { revNo: other.revNo, hash: other.hash })) throw new DomainError("REVISION_MISMATCH", "Both signatures must reference the same revision and hash (R09).");
    state = workspaceMachine.next(state, "countersign");
    await audit(tx, a, "contract.sealed", id, { revNo, hash, risk: ev.risk.score, parts: ev.risk.parts });
    if (ev.risk.score >= RISK_OPS_THRESHOLD) {
      state = workspaceMachine.next(state, "needs_ops");
      await tx.update(workspaces).set({ state, riskScore: ev.risk.score, updatedAt: now }).where(eq(workspaces.id, id));
      await audit(tx, a, "contract.pending_ops", id, { risk: ev.risk.score, threshold: RISK_OPS_THRESHOLD });
      return;
    }
    await tx.update(workspaces).set({ state: workspaceMachine.next(state, "clear"), riskScore: ev.risk.score }).where(eq(workspaces.id, id));
    await lockTx(tx, a, { ...w, riskScore: ev.risk.score }, now);
  });
  return getWorkspace(a, id);
}

/**
 * F2.13 signing gate for a continuation: when the draft carries milestones from its parent, the parent's change order
 * that removes them must be applied first, so no milestone is ever paid twice. Returns a message, or null to go ahead.
 */
async function carryBlock(q: Q, w: WsRow): Promise<string | null> {
  if (!w.parentWorkspaceId) return null;
  const carried = await q.select({ code: wsMilestones.code }).from(wsMilestones).where(and(eq(wsMilestones.workspaceId, w.id), eq(wsMilestones.active, true), isNotNull(wsMilestones.carriedFrom)));
  if (!carried.length) return null;
  const [co] = await q.select().from(changeOrders).where(and(eq(changeOrders.workspaceId, w.parentWorkspaceId), eq(changeOrders.continuationId, w.id))).orderBy(desc(changeOrders.no)).limit(1);
  if (co?.state === "APPLIED") return null;
  const codes = carried.map((r) => r.code).join(", "), one = carried.length === 1;
  if (co && (co.state === "PROPOSED" || co.state === "AWAITING_OPS")) return `This period carries ${codes} over from the previous contract. Both parties sign change order ${co.no} there first (it removes ${one ? "it" : "them"} from that contract), so nothing is paid twice.`;
  return `${codes} ${one ? "was" : "were"} carried over from the previous contract, but the change order that removes ${one ? "it" : "them"} there is ${co ? co.state.toLowerCase() : "missing"}. Prune ${one ? "it" : "them"} here before signing, so nothing is paid twice.`;
}

/* ───────────── ops clearance (F2.11) ───────────── */
export async function clearContract(a: Actor, id: string, decision: "clear" | "return", note: string): Promise<void> {
  if (!canWrite(a.role, "contract.clear_high_risk")) throw new DomainError("FORBIDDEN", "Only Operations can clear high-risk contracts.");
  const n = z.string().trim().max(1000).safeParse(note ?? "");
  if (!n.success) invalid(n.error);
  if (decision === "return" && n.data.length < 3) throw new DomainError("INVALID_INPUT", "Say why the contract goes back, so both parties know what to change.");
  if (decision !== "clear" && decision !== "return") throw new DomainError("INVALID_INPUT", "Decision must be clear or return.");
  const now = await workspaceNow(id);
  await db.transaction(async (tx) => {
    const w = await loadWs(tx, id, true);
    await assertCanRead(tx, a, w);
    if (w.state !== "PENDING_OPS") throw new DomainError("STATE", `Only a contract waiting for Operations can be cleared (this one is ${w.state}).`);
    if (decision === "clear") {
      workspaceMachine.next("PENDING_OPS", "clear");
      await audit(tx, a, "contract.cleared", id, { note: n.data, risk: w.riskScore });
      await lockTx(tx, a, w, now);
    } else {
      const state = workspaceMachine.next("PENDING_OPS", "return");
      await tx.update(signatures).set({ voidedAtRev: w.revision }).where(and(eq(signatures.workspaceId, id), isNull(signatures.voidedAtRev)));
      await tx.update(workspaces).set({ state, updatedAt: now }).where(eq(workspaces.id, id));
      await audit(tx, a, "contract.returned", id, { note: n.data, risk: w.riskScore });
    }
  });
}

/* ───────────── extra read models for this module's screens ───────────── */
export interface RevisionRow { revNo: number; hash: string; authorId: string; authorName: string; change: { action: string; target?: string; detail?: unknown }; createdAt: Date }
export interface WorkspaceDetail {
  view: WorkspaceView; revisions: RevisionRow[]; diff: Diff | null; risk: { score: number; parts: Record<string, number> };
  providerPayable: boolean; providerTier: Tier; opsNotes: { decision: "cleared" | "returned"; note: string; at: Date; by: string }[];
  signatureRows: { role: "client" | "provider"; signerName: string; revNo: number; hashPrefix: string; mfa: boolean; voidedAtRev: number | null; at: Date }[];
  viewerRole: "client" | "provider" | null;
}

export async function getWorkspaceDetail(a: Actor, id: string): Promise<WorkspaceDetail> {
  const w = await loadWs(db, id);
  await assertCanRead(db, a, w);
  const view = await buildView(db, w);
  const revs = await db.select({ r: revisions, name: users.name }).from(revisions).leftJoin(users, eq(users.id, revisions.authorId)).where(eq(revisions.workspaceId, id)).orderBy(desc(revisions.revNo));
  const first = revs.find((x) => x.r.revNo === 1)?.r.canonical as CanonicalDoc | undefined;
  const cur = revs.find((x) => x.r.revNo === w.revision)?.r.canonical as CanonicalDoc | undefined;
  const ms = await loadMs(db, id), cl = await loadCl(db, id);
  const facts = await providerFacts(db, w.providerId);
  const ev = evaluate(head(w), ms, cl, facts.payable, facts.tier);
  const notes = await db.select().from(auditChain).where(and(eq(auditChain.target, id), or(eq(auditChain.action, "contract.cleared"), eq(auditChain.action, "contract.returned")))).orderBy(desc(auditChain.seq));
  const noteBy = notes.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, notes.map((x) => x.actorId ?? ""))) : [];
  const sigs = await db.select({ s: signatures, name: users.name }).from(signatures).innerJoin(users, eq(users.id, signatures.signerId)).where(eq(signatures.workspaceId, id)).orderBy(desc(signatures.createdAt));
  return {
    view,
    revisions: revs.map(({ r, name }) => ({ revNo: r.revNo, hash: r.hash, authorId: r.authorId, authorName: name ?? r.authorId, change: r.change, createdAt: r.createdAt })),
    diff: first && cur && w.revision > 1 ? diffDocs(first, cur) : null,
    risk: ev.risk, providerPayable: facts.payable, providerTier: facts.tier,
    opsNotes: notes.map((x) => ({ decision: x.action === "contract.cleared" ? "cleared" as const : "returned" as const, note: String((x.detail as { note?: string }).note ?? ""), at: x.at, by: noteBy.find((u) => u.id === x.actorId)?.name ?? "Operations" })),
    signatureRows: sigs.map(({ s, name }) => ({ role: s.role, signerName: name, revNo: s.revNo, hashPrefix: s.hash.slice(0, 12), mfa: s.mfa, voidedAtRev: s.voidedAtRev, at: s.createdAt })),
    viewerRole: a.id === w.clientId && a.role === "client" ? "client" : a.id === w.providerId && a.role === "provider" ? "provider" : null,
  };
}

/** Polling stamp for the live negotiation room (F2.03): changes whenever the revision, state or signatures change. */
export async function revisionStamp(a: Actor, id: string): Promise<{ revision: number; state: string; signatures: number; stamp: string }> {
  const w = await loadWs(db, id);
  await assertCanRead(db, a, w);
  const sigs = await db.select({ id: signatures.id, v: signatures.voidedAtRev }).from(signatures).where(eq(signatures.workspaceId, id));
  const live = sigs.filter((s) => s.v === null).length;
  /* F2.12 change orders (proposed, signed, declined) refresh the room too */
  const [co] = await db.select({ id: changeOrders.id, state: changeOrders.state }).from(changeOrders).where(eq(changeOrders.workspaceId, id)).orderBy(desc(changeOrders.no)).limit(1);
  const coSigs = co ? (await db.select({ id: changeOrderSignatures.id }).from(changeOrderSignatures).where(eq(changeOrderSignatures.changeOrderId, co.id))).length : 0;
  return { revision: w.revision, state: w.state, signatures: live, stamp: `${w.revision}:${w.state}:${live}:${sigs.length}:${co ? `${co.id}:${co.state}:${coSigs}` : "-"}` };
}

/** F2.11 queue: contracts waiting for Operations, with the risk parts that put them there. */
export async function clearanceQueue(a: Actor): Promise<{ id: string; title: string; client: string; provider: string; totalCents: number; risk: { score: number; parts: Record<string, number> }; waitingSince: Date; waitingMinutes: number; revision: number; violations: Violation[] }[]> {
  if (!can(a.role, "contract.clear_high_risk")) throw new DomainError("FORBIDDEN", "Only Operations can see the clearance queue.");
  const me = await actorUser(db, a);
  // Playground simulations are cleared by the playground's own Ops step, not from the real Ops queue
  const ws = await db.select().from(workspaces).where(and(eq(workspaces.orgId, me.orgId), eq(workspaces.state, "PENDING_OPS"), excludeSim(workspaces.id, workspaces.orgId, { keepTest: isTestOrgId(me.orgId) }))).orderBy(asc(workspaces.updatedAt));
  const out = [];
  for (const w of ws) {
    const ms = await loadMs(db, w.id), cl = await loadCl(db, w.id);
    const facts = await providerFacts(db, w.providerId);
    const ev = evaluate(head(w), ms, cl, facts.payable, facts.tier);
    const ppl = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [w.clientId, w.providerId ?? w.clientId]));
    const [sealed] = await db.select({ at: auditChain.at }).from(auditChain).where(and(eq(auditChain.target, w.id), eq(auditChain.action, "contract.pending_ops"))).orderBy(desc(auditChain.seq)).limit(1);
    const since = sealed?.at ?? w.updatedAt;
    const waitingMinutes = Math.max(0, Math.floor(((await workspaceNow(w.id)).getTime() - since.getTime()) / 60_000));
    out.push({ id: w.id, title: w.title, client: ppl.find((p) => p.id === w.clientId)?.name ?? "", provider: ppl.find((p) => p.id === w.providerId)?.name ?? "—", totalCents: w.totalCents, risk: ev.risk, waitingSince: since, waitingMinutes, revision: w.revision, violations: ev.violations });
  }
  return out;
}

/** Providers a client can pick when starting a contract (same organisation). */
export async function providerOptions(a: Actor): Promise<{ id: string; name: string; email: string; tier: string; payable: boolean }[]> {
  const me = await actorUser(db, a);
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, tier: users.tier }).from(users).where(and(eq(users.orgId, me.orgId), eq(users.role, "provider"))).orderBy(asc(users.name));
  const links = rows.length ? await db.select({ userId: paypalLinks.userId }).from(paypalLinks).where(and(inArray(paypalLinks.userId, rows.map((r) => r.id)), eq(paypalLinks.kind, "merchant"), eq(paypalLinks.receivable, true))) : [];
  return rows.map((r) => ({ ...r, payable: links.some((l) => l.userId === r.id) }));
}

/** Shared with ./change-orders and ./continuation (same module; not part of the cross-module contract). */
export const internals = { actorUser, loadWs, loadMs, loadCl, providerFacts, head, assertCanRead, partyRole, saveMs, saveCl, writeRevision, railFromEnv, ORG_WIDE };
