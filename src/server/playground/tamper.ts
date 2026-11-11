/**
 * A6 "Try to cheat" (F5.04 audit chain, F5.06/F5.08 playground, P5, P9). Sandbox only, simulations only.
 *
 * What the judge sees, in order:
 *  1. attemptDirectAuditEditForDemo — a direct SQL UPDATE on one REAL audit_chain row of this simulation, inside a
 *     transaction that is always rolled back. The append-only trigger (P5) refuses it; if the trigger were missing the
 *     rollback still discards the change, and the result says the guard is missing.
 *  2. tamperSimAuditCopyForDemo — the simulation's audit rows are copied into sandbox_audit_copies, and one copied row is
 *     edited with direct SQL ("edit": change a value; "rehash": change a value and recompute that row's own hash).
 *  3. verifySimAuditCopy — the same check as verifyChain (src/lib/audit.ts): each row's hash must equal
 *     SHA-256(prev hash + canonical row), and the next row of the REAL chain must point at it. The edited row turns red.
 *  4. repairSimAuditForDemo — drops this simulation's copy and re-runs the scenario reset (fresh sim at day 0).
 *
 * Safety: every exported function calls assertSandbox() (P9) and resolveSimScope(), which requires the simulation's
 * workspace to be recorded in sim_workspaces (src/lib/sim.ts). The SQL that edits always filters on that sim id and on the
 * sequence numbers of that simulation's own rows; the real audit chain is never changed.
 */
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditChain, disputes, evidencePackages, refunds, releases, simSessions, tranches, verdicts, wsMilestones } from "@/db/schema";
import { sandboxAuditCopies } from "@/db/schema-evidence";
import { simWorkspaces } from "@/db/schema-sim";
import { GENESIS, audit } from "@/lib/audit";
import { canonical } from "@/lib/canonical";
import { sha256 } from "@/lib/ids";
import { formatCents } from "@/lib/money";
import { DomainError } from "../types";
import { assertSandbox, resetSim, type Sim } from "./session";

const MAX_ROWS = 200;
export class NotASimulation extends DomainError { constructor(msg = "The tamper demo runs only on a playground simulation's own contract.") { super("NOT_SIM", msg); } }

export interface TamperRow { seq: number; action: string; target: string; actorRole: string | null; at: string; hash: string; prevHash: string; tampered: string | null; status: "ok" | "content" | "link"; why: string | null }
export interface TamperState { simId: string; workspaceId: string; rows: TamperRow[]; ok: boolean; brokenAt: number | null; explanation: string; realIntact: boolean; copied: boolean }

/* ── scope: only a sandbox simulation's own workspace ── */

/** The sim and its workspace, after proving the workspace is a recorded simulation (sim_workspaces). */
export async function resolveSimScope(simId: string): Promise<{ sim: Sim; workspaceId: string }> {
  assertSandbox();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(simId)) throw new NotASimulation();
  const [sim] = await db.select().from(simSessions).where(eq(simSessions.id, simId)).limit(1);
  if (!sim) throw new DomainError("SIM_NOT_FOUND", "That playground session does not exist. Start a scenario.");
  if (!sim.workspaceId) throw new DomainError("NO_WORKSPACE", "Run the first step so this simulation has a contract to cheat on.");
  const [tag] = await db.select({ simId: simWorkspaces.simId }).from(simWorkspaces).where(eq(simWorkspaces.workspaceId, sim.workspaceId)).limit(1);
  if (!tag || (tag.simId !== null && tag.simId !== sim.id)) throw new NotASimulation();
  return { sim, workspaceId: sim.workspaceId };
}

/** Every id an audit row of this simulation can target: the sim, its workspace and the workspace's children. */
async function targetsOf(simId: string, workspaceId: string): Promise<string[]> {
  const ms = await db.select({ id: wsMilestones.id }).from(wsMilestones).where(eq(wsMilestones.workspaceId, workspaceId));
  const tr = await db.select({ id: tranches.id }).from(tranches).where(eq(tranches.workspaceId, workspaceId));
  const mIds = ms.map((m) => m.id), tIds = tr.map((t) => t.id);
  const pk = mIds.length ? await db.select({ id: evidencePackages.id }).from(evidencePackages).where(inArray(evidencePackages.milestoneId, mIds)) : [];
  const rl = mIds.length ? await db.select({ id: releases.id }).from(releases).where(inArray(releases.milestoneId, mIds)) : [];
  const dp = mIds.length ? await db.select({ id: disputes.id }).from(disputes).where(inArray(disputes.milestoneId, mIds)) : [];
  const vd = dp.length ? await db.select({ id: verdicts.id }).from(verdicts).where(inArray(verdicts.disputeId, dp.map((d) => d.id))) : [];
  const rf = tIds.length ? await db.select({ id: refunds.id }).from(refunds).where(inArray(refunds.trancheId, tIds)) : [];
  return [simId, workspaceId, ...mIds, ...tIds, ...pk.map((x) => x.id), ...rl.map((x) => x.id), ...dp.map((x) => x.id), ...vd.map((x) => x.id), ...rf.map((x) => x.id)];
}

/** The real audit rows of this simulation (latest MAX_ROWS, oldest first). */
async function realRowsOf(simId: string, workspaceId: string) {
  const ids = await targetsOf(simId, workspaceId);
  const rows = await db.select().from(auditChain)
    .where(or(inArray(auditChain.target, ids), sql`${auditChain.detail}->>'workspaceId' = ${workspaceId}`))
    .orderBy(desc(auditChain.seq)).limit(MAX_ROWS);
  return rows.reverse();
}

/* ── hashing: the formula of src/lib/audit.ts ── */
type RowLike = { actorId: string | null; actorRole: string | null; action: string; target: string; detail: Record<string, unknown>; at: Date };
export const rowHash = (prevHash: string, r: RowLike) => sha256(prevHash + canonical({ actor: r.actorId, role: r.actorRole, action: r.action, target: r.target, detail: r.detail, at: r.at.toISOString() }));

/* ── 1. a direct edit of the real chain (always rolled back) ── */

class Rollback extends Error {}
export async function attemptDirectAuditEditForDemo(actor: { id: string; role: string }, simId: string): Promise<{ seq: number; refused: boolean; message: string }> {
  const { workspaceId } = await resolveSimScope(simId);
  const rows = await realRowsOf(simId, workspaceId);
  const row = pickRow(rows);
  if (!row) throw new DomainError("NO_ROWS", "This simulation has no audit rows yet. Run a step first.");
  let refused = false, message = "";
  try {
    await db.transaction(async (tx) => {
      try {
        // The WHERE clause names this simulation's own row only; the transaction is rolled back in every case.
        await tx.execute(sql`UPDATE audit_chain SET detail = detail || '{"editedByJudge": true}'::jsonb WHERE seq = ${row.seq} AND target = ${row.target}`);
        message = "The database accepted the edit, so the append-only guard is missing on this database (run npm run db:guards). The edit was rolled back; nothing changed.";
      } catch (e) {
        refused = true;
        message = `The database refused: “${String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message).replace(/^.*PaySettle: /, "PaySettle: ").slice(0, 160)}”. Audit rows can only be added, never changed (P5).`;
      }
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
  await audit(db, actor, "sandbox.tamper_direct_attempt", simId, { workspaceId, seq: row.seq, refused });
  return { seq: row.seq, refused, message };
}

/* ── 2. copy and edit ── */

/** Copies this simulation's real audit rows into the sandbox table (replacing an earlier copy of the same sim). */
export async function copySimAudit(simId: string): Promise<number> {
  const { workspaceId } = await resolveSimScope(simId);
  const rows = await realRowsOf(simId, workspaceId);
  await db.transaction(async (tx) => {
    await tx.delete(sandboxAuditCopies).where(eq(sandboxAuditCopies.simId, simId));
    if (rows.length) await tx.insert(sandboxAuditCopies).values(rows.map((r) => ({ simId, workspaceId, seq: r.seq, actorId: r.actorId, actorRole: r.actorRole, action: r.action, target: r.target, detail: r.detail, prevHash: r.prevHash, hash: r.hash, at: r.at })));
  });
  return rows.length;
}

const MONEY_KEYS = ["amountCents", "grossCents", "netCents", "totalCents", "refundCents", "releaseCents", "feeCents"];
/** The most telling row to edit: one that carries an amount, preferring holds and releases. */
function pickRow<T extends { seq: number; action: string; detail: Record<string, unknown> }>(rows: T[]): T | undefined {
  const money = rows.filter((r) => MONEY_KEYS.some((k) => typeof r.detail?.[k] === "number"));
  return money.find((r) => /release|fund|hold|capture/.test(r.action)) ?? money[0] ?? rows.find((r) => r.action.startsWith("contract.")) ?? rows[0];
}

export type TamperMode = "edit" | "rehash";
/**
 * Edits ONE copied row of this simulation with direct SQL. "edit" changes a value only; "rehash" also recomputes the row's
 * own hash so it looks self-consistent — the next row of the real chain still points at the old hash.
 */
export async function tamperSimAuditCopyForDemo(actor: { id: string; role: string }, simId: string, opts: { seq?: number; mode: TamperMode }): Promise<{ seq: number; change: string }> {
  const { workspaceId } = await resolveSimScope(simId);
  let copy = await db.select().from(sandboxAuditCopies).where(eq(sandboxAuditCopies.simId, simId)).orderBy(asc(sandboxAuditCopies.seq));
  if (!copy.length || copy.some((r) => r.tampered)) { await copySimAudit(simId); copy = await db.select().from(sandboxAuditCopies).where(eq(sandboxAuditCopies.simId, simId)).orderBy(asc(sandboxAuditCopies.seq)); }
  const row = opts.seq !== undefined ? copy.find((r) => r.seq === opts.seq) : pickRow(copy);
  if (!row) throw new NotASimulation("That audit row does not belong to this simulation.");

  const key = MONEY_KEYS.find((k) => typeof row.detail?.[k] === "number");
  const before = key ? (row.detail[key] as number) : null;
  const after = before !== null ? (before === 0 ? 100_000 : before * 10) : null;
  const detail: Record<string, unknown> = key ? { ...row.detail, [key]: after } : { ...row.detail, note: "edited after the fact" };
  const change = key ? `${key} ${formatCents(before!)} → ${formatCents(after!)} on row #${row.seq} (${row.action})` : `added a note to row #${row.seq} (${row.action})`;
  const newHash = opts.mode === "rehash" ? rowHash(row.prevHash, { ...row, detail }) : row.hash;
  // Direct SQL on the sandbox copy only: this sim's id, this row's sequence number, and only while the workspace is a recorded simulation.
  const res = await db.execute(sql`UPDATE sandbox_audit_copies SET detail = ${JSON.stringify(detail)}::jsonb, hash = ${newHash}, tampered = ${opts.mode === "rehash" ? `${change} — and re-hashed` : change}
    WHERE sim_id = ${simId} AND seq = ${row.seq} AND workspace_id = ${workspaceId}
      AND EXISTS (SELECT 1 FROM sim_workspaces sw WHERE sw.workspace_id = ${workspaceId})`);
  if (!res.rowCount) throw new NotASimulation();
  await audit(db, actor, "sandbox.tamper_copy", simId, { workspaceId, seq: row.seq, mode: opts.mode });
  return { seq: row.seq, change: opts.mode === "rehash" ? `${change}, and the row's own hash recomputed` : change };
}

/* ── 3. verify ── */

/**
 * Verifies the copy: each row's stored hash against its contents, and each row against the REAL chain — the next real row
 * must carry this row's hash as its prev_hash (the head of the chain is compared with the real row itself).
 */
export async function verifySimAuditCopy(simId: string): Promise<TamperState> {
  const { workspaceId } = await resolveSimScope(simId);
  let copy = await db.select().from(sandboxAuditCopies).where(eq(sandboxAuditCopies.simId, simId)).orderBy(asc(sandboxAuditCopies.seq));
  let copied = copy.length > 0;
  if (!copied) { await copySimAudit(simId); copy = await db.select().from(sandboxAuditCopies).where(eq(sandboxAuditCopies.simId, simId)).orderBy(asc(sandboxAuditCopies.seq)); copied = copy.length > 0; }
  const seqs = copy.map((r) => r.seq);
  const real = seqs.length ? await db.select().from(auditChain).where(inArray(auditChain.seq, seqs)) : [];
  const realBy = new Map(real.map((r) => [r.seq, r]));
  // For every copied row: the real row written just before it and just after it (sequence numbers can have gaps).
  const nb = seqs.length ? (await db.execute<{ seq: number; prev_real_hash: string | null; next_seq: number | null; next_prev_hash: string | null }>(sql`
    SELECT c.seq, p.hash AS prev_real_hash, n.seq AS next_seq, n.prev_hash AS next_prev_hash
    FROM unnest(ARRAY[${sql.raw(seqs.map((x) => String(Math.trunc(Number(x)))).join(","))}]::int[]) AS c(seq)
    LEFT JOIN LATERAL (SELECT hash FROM audit_chain WHERE seq < c.seq ORDER BY seq DESC LIMIT 1) p ON true
    LEFT JOIN LATERAL (SELECT seq, prev_hash FROM audit_chain WHERE seq > c.seq ORDER BY seq ASC LIMIT 1) n ON true`)).rows : [];
  const around = new Map(nb.map((x) => [Number(x.seq), x]));
  const rows: TamperRow[] = [];
  let brokenAt: number | null = null, explanation = "", realIntact = true;
  for (const r of copy) {
    const re = realBy.get(r.seq);
    if (!re || re.hash !== rowHash(re.prevHash, re)) realIntact = false;
    let status: TamperRow["status"] = "ok", why: string | null = null;
    if (r.hash !== rowHash(r.prevHash, r)) { status = "content"; why = "The stored hash no longer matches the row's contents."; }
    else {
      const a = around.get(r.seq);
      if (r.prevHash !== (a?.prev_real_hash ?? GENESIS)) { status = "link"; why = "Its previous-hash pointer does not match the row before it in the real chain."; }
      else if (a?.next_seq != null ? a.next_prev_hash !== r.hash : re?.hash !== r.hash) { status = "link"; why = a?.next_seq != null ? `Row #${a.next_seq}, written after it, still points at the original hash — the chain link is broken.` : "It no longer matches the head of the real chain."; }
    }
    if (status !== "ok" && brokenAt === null) { brokenAt = r.seq; explanation = `Row #${r.seq} (${r.action}): ${why}`; }
    rows.push({ seq: r.seq, action: r.action, target: r.target, actorRole: r.actorRole, at: r.at.toISOString(), hash: r.hash, prevHash: r.prevHash, tampered: r.tampered, status, why });
  }
  if (brokenAt === null) explanation = rows.length ? `All ${rows.length} rows verify: every hash matches its row and the real chain points at it.` : "No audit rows yet.";
  return { simId, workspaceId, rows, ok: brokenAt === null, brokenAt, explanation, realIntact, copied };
}

/* ── 4. repair ── */

/** Drops this simulation's copy and re-runs the scenario reset: a fresh sim at day 0 (the old one is left as it was). */
export async function repairSimAuditForDemo(actor: { id: string; role: string }, simId: string): Promise<Sim> {
  assertSandbox();
  const { sim } = await resolveSimScope(simId);
  await db.delete(sandboxAuditCopies).where(and(eq(sandboxAuditCopies.simId, sim.id)));
  return resetSim(actor, sim.id);
}
