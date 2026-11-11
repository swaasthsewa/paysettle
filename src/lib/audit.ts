/**
 * Hash-chained audit trail (F5.04). Writer pattern ported (REUSE.md): the call site says what
 * happened and to what; actor and request come from the context. Each row's hash covers the previous row's hash.
 */
import { desc, asc, sql } from "drizzle-orm";
import { auditChain } from "@/db/schema";
import { sha256 } from "./ids";
import { canonical } from "./canonical";
import type { Db, Tx } from "@/db/client";

export const GENESIS = "0".repeat(64);
export interface Actor { id: string | null; role: string | null; requestId?: string }

export async function audit(db: Db | Tx, actor: Actor, action: string, target: string, detail: Record<string, unknown> = {}) {
  /* Always run inside a transaction: on the pool this opens one (so the xact lock is held through the read and the insert,
     closing the fork race seen with concurrent writers); inside a caller's transaction it is a savepoint and the lock
     stays held until the caller commits. */
  return (db as Db).transaction((tx) => auditIn(tx, actor, action, target, detail));
}

async function auditIn(db: Tx, actor: Actor, action: string, target: string, detail: Record<string, unknown>) {
  await db.execute(sql`SELECT pg_advisory_xact_lock(4242)`);
  const [last] = await db.select({ hash: auditChain.hash }).from(auditChain).orderBy(desc(auditChain.seq)).limit(1);
  const prevHash = last?.hash ?? GENESIS;
  const at = new Date();
  const hash = sha256(prevHash + canonical({ actor: actor.id, role: actor.role, action, target, detail, at: at.toISOString() }));
  await db.insert(auditChain).values({ actorId: actor.id, actorRole: actor.role, action, target, detail, requestId: actor.requestId, prevHash, hash, at });
  return hash;
}

/** Recompute the chain; returns the first broken sequence number, or null when intact. */
export async function verifyChain(db: Db): Promise<{ ok: boolean; rows: number; brokenAt: number | null }> {
  const rows = await db.select().from(auditChain).orderBy(asc(auditChain.seq));
  let prev = GENESIS;
  for (const r of rows) {
    const h = sha256(prev + canonical({ actor: r.actorId, role: r.actorRole, action: r.action, target: r.target, detail: r.detail, at: r.at.toISOString() }));
    if (r.prevHash !== prev || r.hash !== h) return { ok: false, rows: rows.length, brokenAt: r.seq };
    prev = r.hash;
  }
  return { ok: true, rows: rows.length, brokenAt: null };
}
