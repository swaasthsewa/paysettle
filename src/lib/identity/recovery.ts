// F1.2 · IDENTITY — recovery codes: issued ten at a time, shown once, kept only as hashes, each usable once.
//
// The rules live here against a small store interface, so they are tested without a database; `dbRecoveryStore`
// is the Postgres implementation over the recovery_codes table. Redeeming is a single conditional UPDATE
// (used_at IS NULL), so two requests racing with the same code cannot both succeed.
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import { recoveryCodes } from "@/db/schema";
import { newRecoveryCodes, normalizeRecoveryCode, recoveryCodeHash } from "./totp";

export interface RecoveryStore {
  /** Replace every code of the person with these hashes. */
  replace(userId: string, hashes: string[]): Promise<void>;
  /** Mark one unused code as used. True only for the call that actually used it. */
  consume(userId: string, hash: string, at: Date): Promise<boolean>;
  /** How many unused codes remain. */
  remaining(userId: string): Promise<number>;
}

/** Make a fresh set: the plain codes go to the person once; only their hashes are stored. */
export async function issueRecoveryCodes(store: RecoveryStore, userId: string, n = 10): Promise<string[]> {
  const codes = newRecoveryCodes(n);
  await store.replace(userId, codes.map(recoveryCodeHash));
  return codes;
}

export type RedeemResult = { ok: true; remaining: number } | { ok: false; reason: "format" | "unknown" };

/** Use one code. A code already used, or not one of the person's, is refused the same way (no hint which). */
export async function redeemRecoveryCode(store: RecoveryStore, userId: string, code: string, at: Date): Promise<RedeemResult> {
  const clean = normalizeRecoveryCode(code);
  if (clean.length !== 10) return { ok: false, reason: "format" };
  const used = await store.consume(userId, recoveryCodeHash(clean), at);
  if (!used) return { ok: false, reason: "unknown" };
  return { ok: true, remaining: await store.remaining(userId) };
}

/** An in-memory store, for tests and for the sandbox playground. */
export function memoryRecoveryStore(): RecoveryStore & { rows: { userId: string; codeHash: string; usedAt: Date | null }[] } {
  const rows: { userId: string; codeHash: string; usedAt: Date | null }[] = [];
  return {
    rows,
    async replace(userId, hashes) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].userId === userId) rows.splice(i, 1);
      for (const h of hashes) rows.push({ userId, codeHash: h, usedAt: null });
    },
    async consume(userId, hash, at) {
      const r = rows.find((x) => x.userId === userId && x.codeHash === hash && x.usedAt === null);
      if (!r) return false;
      r.usedAt = at; return true;
    },
    async remaining(userId) { return rows.filter((x) => x.userId === userId && x.usedAt === null).length; },
  };
}

export function dbRecoveryStore(db: Db | Tx): RecoveryStore {
  return {
    async replace(userId, hashes) {
      await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      if (hashes.length) await db.insert(recoveryCodes).values(hashes.map((codeHash) => ({ userId, codeHash })));
    },
    async consume(userId, hash, at) {
      const r = await db.update(recoveryCodes).set({ usedAt: at })
        .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hash), isNull(recoveryCodes.usedAt)))
        .returning({ h: recoveryCodes.codeHash });
      return r.length === 1;
    },
    async remaining(userId) {
      const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(recoveryCodes).where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
      return r?.n ?? 0;
    },
  };
}
