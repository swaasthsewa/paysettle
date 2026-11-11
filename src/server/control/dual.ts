/**
 * F5.03 Four-eyes dual control (STRIDE "Elevation of privilege"). A privileged action is proposed by one
 * person and executed only when a different permitted person approves it within 30 minutes. Self-approval is refused
 * here and by the database constraint four_eyes (approver_id <> initiator_id, src/db/sql/guards.sql).
 * Actions: CLEAR_BREAKER · REPLAY_WEBHOOK (F5.02) · EXTEND_VAULT · SET_TRUST_TIER (F5.10) · FLIP_FLAG ·
 * PUBLISH_BLUEPRINT (a template enters or leaves the catalogue only after a second person with blueprint.publish agrees).
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { blueprints, disputes, dualControl, flags, tranches, users, webhookEvents, type Role } from "@/db/schema";
import { dualControlOutcomes } from "@/db/schema-control";
import { blueprintReleases } from "@/db/schema-representment";
import { blueprintProblems, bumpVersion, compareVersions, SEMVER } from "./blueprint-release";
import { audit } from "@/lib/audit";
import { trancheMachine } from "@/lib/fsm";
import { newId } from "@/lib/ids";
import { can } from "@/lib/rbac";
import { DomainError, type Actor } from "../types";
import { auditActor, type Dbx } from "./common";
import { FLAG_DEFS, isFlagKey } from "./flags";
import { processWebhookEvent } from "../money/webhook";

export const DC_TTL_MS = 30 * 60_000;
type TrancheState = (typeof trancheMachine.states)[number];

export const DC_ACTIONS = {
  CLEAR_BREAKER: { label: "Clear a circuit breaker", roles: (r: Role) => can(r, "breaker.clear"), target: "Tranche" },
  REPLAY_WEBHOOK: { label: "Replay a dead-lettered webhook", roles: (r: Role) => can(r, "webhook.replay"), target: "Webhook transmission" },
  EXTEND_VAULT: { label: "Extend a dispute evidence vault", roles: (r: Role) => r === "ops" || r === "mediator", target: "Dispute" },
  SET_TRUST_TIER: { label: "Change a provider's trust tier", roles: (r: Role) => r === "ops" || r === "admin", target: "Provider" },
  FLIP_FLAG: { label: "Flip a switchboard flag", roles: (r: Role) => r === "admin" || r === "ops", target: "Flag" },
  PUBLISH_BLUEPRINT: { label: "Publish or withdraw a blueprint", roles: (r: Role) => can(r, "blueprint.publish"), target: "Blueprint" },
} as const;
export type DcAction = keyof typeof DC_ACTIONS;
export const DC_ACTION_KEYS = Object.keys(DC_ACTIONS) as DcAction[];
export const canDualControl = (role: Role, action: DcAction) => role !== "judge" && DC_ACTIONS[action].roles(role);

const PAYLOAD = {
  CLEAR_BREAKER: z.object({}).passthrough(),
  REPLAY_WEBHOOK: z.object({}).passthrough(),
  EXTEND_VAULT: z.object({ hours: z.number().int().min(1).max(72) }),
  SET_TRUST_TIER: z.object({ tier: z.enum(["platinum", "standard", "new", "probation"]) }),
  FLIP_FLAG: z.object({ on: z.boolean() }),
  PUBLISH_BLUEPRINT: z.object({ active: z.boolean(), version: z.string().regex(SEMVER, "Use a version like 1.2.0.").optional(), note: z.string().trim().max(300).optional() }),
} satisfies Record<DcAction, z.ZodType>;
const Proposal = z.object({ action: z.enum(DC_ACTION_KEYS as [DcAction, ...DcAction[]]), target: z.string().min(1).max(200), reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500) });

/* ── webhook replay: re-applies the stored, verified payload through the money module's handler (the one behind
   src/app/api/webhooks/paypal). Another handler can be registered (tests, future queue worker). ── */
export type WebhookReplayHandler = (event: { transmissionId: string; type: string; resourceId: string | null; payload: unknown }) => Promise<{ ok: boolean; detail?: string }>;
const hook = globalThis as unknown as { __psWebhookReplay?: WebhookReplayHandler };
export function registerWebhookReplayHandler(fn: WebhookReplayHandler | null) { hook.__psWebhookReplay = fn ?? undefined; }
const moneyReplay: WebhookReplayHandler = async (e) => {
  const state = await processWebhookEvent(e.transmissionId);
  return { ok: state === "PROCESSED", detail: state === "PROCESSED" ? "Applied by the PayPal webhook handler." : `Handler returned ${state}; the event stays in the dead-letter queue.` };
};
const replayHandler = () => hook.__psWebhookReplay ?? moneyReplay;

async function validateTarget(dbx: Dbx, action: DcAction, target: string, payload: Record<string, unknown>) {
  switch (action) {
    case "CLEAR_BREAKER": {
      const [t] = await dbx.select({ state: tranches.state }).from(tranches).where(eq(tranches.id, target)).limit(1);
      if (!t) throw new DomainError("NOT_FOUND", `Tranche ${target} does not exist.`);
      if (t.state !== "BREAKER") throw new DomainError("STATE", `Tranche ${target} is ${t.state}, not stopped by a breaker.`);
      return;
    }
    case "REPLAY_WEBHOOK": {
      const [e] = await dbx.select().from(webhookEvents).where(eq(webhookEvents.transmissionId, target)).limit(1);
      if (!e) throw new DomainError("NOT_FOUND", `Webhook ${target} was never received.`);
      if (!e.verified) throw new DomainError("UNVERIFIED", "Quarantined events failed signature checks and are never replayed (P7).");
      if (e.state !== "DEAD" && e.state !== "RECEIVED") throw new DomainError("STATE", `Webhook ${target} is ${e.state}; only dead-lettered or stuck events are replayed.`);
      return;
    }
    case "EXTEND_VAULT": {
      const [d] = await dbx.select({ state: disputes.state }).from(disputes).where(eq(disputes.id, target)).limit(1);
      if (!d) throw new DomainError("NOT_FOUND", `Dispute ${target} does not exist.`);
      if (["RESOLVED", "SUPERSEDED", "EXECUTING"].includes(d.state)) throw new DomainError("STATE", `Dispute ${target} is ${d.state}; its vault is closed.`);
      return;
    }
    case "SET_TRUST_TIER": {
      const [u] = await dbx.select({ role: users.role, tier: users.tier }).from(users).where(eq(users.id, target)).limit(1);
      if (!u || u.role !== "provider") throw new DomainError("NOT_FOUND", `${target} is not a provider.`);
      if (u.tier === payload.tier) throw new DomainError("STATE", `The provider is already ${u.tier}.`);
      return;
    }
    case "FLIP_FLAG":
      if (!isFlagKey(target)) throw new DomainError("NOT_FOUND", `Unknown flag ${target}.`);
      return;
    case "PUBLISH_BLUEPRINT": {
      const [b] = await dbx.select().from(blueprints).where(eq(blueprints.code, target)).limit(1);
      if (!b) throw new DomainError("NOT_FOUND", `Blueprint ${target} does not exist.`);
      /* an empty version means "the obvious one": next patch to publish a live template, the current one otherwise */
      if (!payload.version) payload.version = payload.active !== false && b.active ? bumpVersion(b.version) : b.version;
      const version = String(payload.version);
      if (payload.active === false) {
        if (!b.active) throw new DomainError("STATE", `${b.title} is already withdrawn.`);
        if (version !== b.version) throw new DomainError("INVALID", `A withdrawal keeps the version (${b.version}).`);
        return;
      }
      const cmp = compareVersions(version, b.version);
      if (b.active && cmp <= 0) throw new DomainError("INVALID", `${b.title} is live at ${b.version}. Publish a higher version, for example ${bumpVersion(b.version)}.`);
      if (!b.active && cmp < 0) throw new DomainError("INVALID", `The version cannot go back below ${b.version}.`);
      const problems = blueprintProblems(b);
      if (problems.length) throw new DomainError("INVALID", `Not ready to publish: ${problems.join(" ")}`);
      return;
    }
  }
}

export async function propose(a: Actor, actionIn: string, target: string, payloadIn: unknown, reason: string, o: { dbx?: Dbx; now?: Date } = {}): Promise<string> {
  const dbx = o.dbx ?? db, now = o.now ?? new Date();
  const p = Proposal.safeParse({ action: actionIn, target, reason });
  if (!p.success) throw new DomainError("INVALID", p.error.issues[0]?.message ?? "Invalid request.");
  const action = p.data.action;
  if (!canDualControl(a.role, action)) throw new DomainError("FORBIDDEN", `Your role (${a.role}) cannot propose “${DC_ACTIONS[action].label}”.`);
  const pl = PAYLOAD[action].safeParse(payloadIn ?? {});
  if (!pl.success) throw new DomainError("INVALID", pl.error.issues[0]?.message ?? "Invalid payload.");
  const payload = pl.data as Record<string, unknown>;
  await validateTarget(dbx, action, p.data.target, payload);
  const [dup] = await dbx.select({ id: dualControl.id }).from(dualControl)
    .where(and(eq(dualControl.action, action), eq(dualControl.target, p.data.target), eq(dualControl.state, "AWAITING"), sql`${dualControl.expiresAt} > ${now}`)).limit(1);
  if (dup) throw new DomainError("DUPLICATE", `A request for this is already waiting (${dup.id}).`);
  const id = newId("dc");
  await dbx.insert(dualControl).values({ id, action, target: p.data.target, payload, reason: p.data.reason, initiatorId: a.id, expiresAt: new Date(now.getTime() + DC_TTL_MS), createdAt: now });
  await audit(dbx, auditActor(a), "dual_control.propose", id, { action, target: p.data.target, payload, reason: p.data.reason });
  return id;
}

/** Executes the approved action inside the approval transaction. Returns what happened (stored in dual_control_outcomes). */
async function execute(tx: Dbx, a: Actor, row: typeof dualControl.$inferSelect): Promise<Record<string, unknown>> {
  const payload = row.payload as Record<string, unknown>;
  switch (row.action as DcAction) {
    case "CLEAR_BREAKER": {
      const [t] = await tx.select({ state: tranches.state }).from(tranches).where(eq(tranches.id, row.target)).limit(1);
      if (!t) throw new DomainError("NOT_FOUND", "Tranche disappeared.");
      const next = trancheMachine.next(t.state as TrancheState, "clear");
      await tx.update(tranches).set({ state: next }).where(and(eq(tranches.id, row.target), eq(tranches.state, t.state)));
      await audit(tx, auditActor(a), "breaker.cleared", row.target, { dualControlId: row.id, from: t.state, to: next, initiator: row.initiatorId });
      return { from: t.state, to: next, note: "Releases may resume. The next reconciliation run trips the breaker again if the drift is still there." };
    }
    case "REPLAY_WEBHOOK": {
      const [e] = await tx.select().from(webhookEvents).where(eq(webhookEvents.transmissionId, row.target)).limit(1);
      if (!e) throw new DomainError("NOT_FOUND", "Webhook disappeared.");
      return { deferred: true, eventState: e.state };
    }
    case "EXTEND_VAULT": {
      const hours = Number(payload.hours);
      const [d] = await tx.update(disputes).set({ vaultUntil: sql`${disputes.vaultUntil} + make_interval(hours => ${hours})` }).where(eq(disputes.id, row.target)).returning({ vaultUntil: disputes.vaultUntil });
      const meta = await tx.execute(sql`select to_regclass('public.dispute_meta') as t`);
      if ((meta.rows[0] as { t: string | null } | undefined)?.t) await tx.execute(sql`update dispute_meta set vault_extended_until = ${d.vaultUntil} where dispute_id = ${row.target}`);
      await audit(tx, auditActor(a), "dispute.vault_extended", row.target, { dualControlId: row.id, hours, vaultUntil: d.vaultUntil.toISOString() });
      return { hours, vaultUntil: d.vaultUntil.toISOString() };
    }
    case "SET_TRUST_TIER": {
      const [u] = await tx.select({ tier: users.tier }).from(users).where(eq(users.id, row.target)).limit(1);
      const tier = payload.tier as "platinum" | "standard" | "new" | "probation";
      await tx.update(users).set({ tier }).where(eq(users.id, row.target));
      await audit(tx, auditActor(a), "provider.tier_changed", row.target, { dualControlId: row.id, from: u?.tier, to: tier });
      return { from: u?.tier, to: tier };
    }
    case "FLIP_FLAG": {
      const on = Boolean(payload.on), key = row.target as keyof typeof FLAG_DEFS;
      const [before] = await tx.select({ on: flags.on }).from(flags).where(eq(flags.key, key)).limit(1);
      await tx.insert(flags).values({ key, on, note: FLAG_DEFS[key]?.note }).onConflictDoUpdate({ target: flags.key, set: { on, updatedAt: new Date() } });
      await audit(tx, auditActor(a), "flag.flipped", key, { dualControlId: row.id, from: before?.on ?? FLAG_DEFS[key]?.on, to: on });
      return { from: before?.on ?? FLAG_DEFS[key]?.on, to: on };
    }
    case "PUBLISH_BLUEPRINT": {
      const active = Boolean(payload.active), version = String(payload.version);
      const [b] = await tx.select().from(blueprints).where(eq(blueprints.code, row.target)).for("update").limit(1);
      if (!b) throw new DomainError("NOT_FOUND", "Blueprint disappeared.");
      /* re-check at approval time: the blueprint may have changed while the request waited */
      if (active && (b.active ? compareVersions(version, b.version) <= 0 : compareVersions(version, b.version) < 0)) throw new DomainError("STATE", `${b.title} changed to ${b.version} while this waited. Propose again.`);
      if (!active && !b.active) throw new DomainError("STATE", `${b.title} is already withdrawn.`);
      await tx.update(blueprints).set({ active, version }).where(eq(blueprints.code, row.target));
      await tx.insert(blueprintReleases).values({ id: newId("bpr"), blueprintCode: row.target, action: active ? "PUBLISH" : "WITHDRAW", fromVersion: b.version, toVersion: version, note: String(payload.note ?? row.reason).slice(0, 300), dualControlId: row.id, initiatorId: row.initiatorId, approverId: a.id });
      await audit(tx, auditActor(a), active ? "blueprint.published" : "blueprint.withdrawn", row.target, { dualControlId: row.id, from: { active: b.active, version: b.version }, to: { active, version }, initiator: row.initiatorId });
      return { from: { active: b.active, version: b.version }, to: { active, version }, note: active ? `${b.title} ${version} is live in the catalogue. Signed contracts keep the version they were made from.` : `${b.title} is withdrawn. New contracts cannot start from it; signed contracts are not affected.` };
    }
    default:
      throw new DomainError("INVALID", `Unknown action ${row.action}.`);
  }
}

export async function approve(a: Actor, id: string, o: { dbx?: Dbx; now?: Date } = {}): Promise<Record<string, unknown>> {
  const now = o.now ?? new Date();
  const run = async (tx: Dbx) => {
    const [row] = await tx.select().from(dualControl).where(eq(dualControl.id, id)).for("update").limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "That request does not exist.");
    if (row.state !== "AWAITING") throw new DomainError("STATE", `That request is already ${row.state.toLowerCase()}.`);
    if (row.expiresAt.getTime() <= now.getTime()) {
      await tx.update(dualControl).set({ state: "EXPIRED" }).where(eq(dualControl.id, id));
      await tx.insert(dualControlOutcomes).values({ dualControlId: id, decision: "EXPIRED", decidedBy: null, ok: false, result: { note: "Not approved within 30 minutes." } }).onConflictDoNothing();
      await audit(tx, auditActor(a), "dual_control.expired", id, { action: row.action, target: row.target });
      return { expired: true } as const;
    }
    if (row.initiatorId === a.id) throw new DomainError("FOUR_EYES", "You proposed this, so someone else has to approve it.");
    if (!canDualControl(a.role, row.action as DcAction)) throw new DomainError("FORBIDDEN", `Your role (${a.role}) cannot approve “${row.action}”.`);
    await tx.update(dualControl).set({ state: "EXECUTED", approverId: a.id }).where(eq(dualControl.id, id));
    await audit(tx, auditActor(a), "dual_control.approve", id, { action: row.action, target: row.target, initiator: row.initiatorId });
    const result = await execute(tx, a, row);
    await tx.insert(dualControlOutcomes).values({ dualControlId: id, decision: "EXECUTED", decidedBy: a.id, ok: true, result });
    return { row, result } as const;
  };
  const out = o.dbx ? await run(o.dbx) : await db.transaction(run);
  if ("expired" in out) throw new DomainError("EXPIRED", "This request expired (30 minutes). Propose it again if it is still needed.");
  /* webhook replay runs after the approval is committed: the handler uses its own transaction */
  if (out.result.deferred) {
    const dbx = o.dbx ?? db;
    const [e] = await dbx.select().from(webhookEvents).where(eq(webhookEvents.transmissionId, out.row.target)).limit(1);
    let r: { ok: boolean; detail?: string };
    try { r = await replayHandler()({ transmissionId: e.transmissionId, type: e.type, resourceId: e.resourceId, payload: e.payload }); }
    catch (err) { r = { ok: false, detail: err instanceof Error ? err.message : String(err) }; }
    const result = { replayed: r.ok, detail: r.detail ?? null, note: r.ok ? "Webhook replayed and applied." : `Replay did not apply: ${r.detail ?? "unknown error"}` };
    await dbx.update(dualControlOutcomes).set({ ok: r.ok, result, decision: r.ok ? "EXECUTED" : "FAILED" }).where(eq(dualControlOutcomes.dualControlId, id));
    await audit(dbx, auditActor(a), r.ok ? "webhook.replayed" : "webhook.replay_failed", e.transmissionId, { dualControlId: id, detail: r.detail ?? null });
    return result;
  }
  return out.result;
}

export async function veto(a: Actor, id: string, note: string, o: { dbx?: Dbx; now?: Date } = {}) {
  const dbx = o.dbx ?? db;
  const [row] = await dbx.select().from(dualControl).where(eq(dualControl.id, id)).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "That request does not exist.");
  if (row.state !== "AWAITING") throw new DomainError("STATE", `That request is already ${row.state.toLowerCase()}.`);
  const self = row.initiatorId === a.id;
  if (!self && !canDualControl(a.role, row.action as DcAction)) throw new DomainError("FORBIDDEN", `Your role (${a.role}) cannot veto “${row.action}”.`);
  const r = await dbx.update(dualControl).set({ state: "VETOED" }).where(and(eq(dualControl.id, id), eq(dualControl.state, "AWAITING"))).returning({ id: dualControl.id });
  if (!r.length) throw new DomainError("STATE", "That request was decided a moment ago.");
  await dbx.insert(dualControlOutcomes).values({ dualControlId: id, decision: "VETOED", decidedBy: a.id, ok: true, result: { note: note.slice(0, 500), withdrawn: self } }).onConflictDoNothing();
  await audit(dbx, auditActor(a), self ? "dual_control.withdraw" : "dual_control.veto", id, { action: row.action, target: row.target, note: note.slice(0, 500) });
}

/** Sweep: requests past their 30-minute TTL become EXPIRED (cron and page loads). */
export async function expireDue(o: { dbx?: Dbx; now?: Date } = {}): Promise<number> {
  const dbx = o.dbx ?? db, now = o.now ?? new Date();
  const rows = await dbx.update(dualControl).set({ state: "EXPIRED" }).where(and(eq(dualControl.state, "AWAITING"), lt(dualControl.expiresAt, now))).returning({ id: dualControl.id, action: dualControl.action, target: dualControl.target });
  for (const r of rows) {
    await dbx.insert(dualControlOutcomes).values({ dualControlId: r.id, decision: "EXPIRED", decidedBy: null, ok: false, result: { note: "Not approved within 30 minutes." } }).onConflictDoNothing();
    await audit(dbx, { id: null, role: "system" }, "dual_control.expired", r.id, { action: r.action, target: r.target });
  }
  return rows.length;
}

export async function queue(o: { dbx?: Dbx; limit?: number } = {}) {
  const dbx = o.dbx ?? db;
  const rows = await dbx.select({ dc: dualControl, outcome: dualControlOutcomes }).from(dualControl)
    .leftJoin(dualControlOutcomes, eq(dualControlOutcomes.dualControlId, dualControl.id))
    .orderBy(sql`case when ${dualControl.state} = 'AWAITING' then 0 else 1 end`, desc(dualControl.createdAt)).limit(o.limit ?? 100);
  const ids = [...new Set(rows.flatMap((r) => [r.dc.initiatorId, r.dc.approverId, r.outcome?.decidedBy]).filter((x): x is string => Boolean(x)))];
  const people = ids.length ? await dbx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.id, ids)) : [];
  const who = (id: string | null | undefined) => (id ? people.find((p) => p.id === id) ?? { id, name: id, role: "?" } : null);
  return rows.map((r) => ({ ...r.dc, outcome: r.outcome, initiator: who(r.dc.initiatorId), approver: who(r.dc.approverId), decider: who(r.outcome?.decidedBy) }));
}
