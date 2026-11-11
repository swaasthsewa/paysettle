/** Shared helpers (F5.01, F5.03, F5.04). Actor mapping for the audit writer and permission guards. */
import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import type { Db, Tx } from "@/db/client";
import type { Role } from "@/db/schema";
import { can, canWrite, type Permission } from "@/lib/rbac";
import { TEST_ORG_PATTERN, excludeSim, excludeSimAlias } from "@/lib/sim";
import { DomainError, type Actor } from "../types";

export type Dbx = Db | Tx;
export const SYSTEM = { id: null, role: "system" } as const;
export const auditActor = (a: Actor | null) => (a ? { id: a.id, role: a.role, requestId: a.requestId } : SYSTEM);

export function mustWrite(a: Actor, p: Permission) {
  if (!canWrite(a.role, p)) throw new DomainError("FORBIDDEN", `Your role (${a.role}) cannot do this (${p}).`);
}
export function mustRead(role: Role, p: Permission) {
  if (!can(role, p)) throw new DomainError("FORBIDDEN", `Your role (${role}) cannot see this (${p}).`);
}

/** Other modules' tests leave rows in orgs named org_t_*, org_t9_*, org_test_*; consoles and scheduled runs ignore them. */
export { TEST_ORG_PATTERN };
export const notTestOrg = (col: AnyColumn | SQL) => sql`${col} !~ ${TEST_ORG_PATTERN}`;
export const NOT_TEST_ORG_SQL = (alias: string) => sql.raw(`${alias}.org_id !~ '${TEST_ORG_PATTERN}'`);
/** Default console views also leave out playground simulations — for a workspaces alias in raw SQL, or columns. */
export const REAL_WS_SQL = (alias: string) => excludeSimAlias(alias);
export const realWorkspace = (id: AnyColumn | SQL, orgId: AnyColumn | SQL) => excludeSim(id, orgId);

/** Thrown to roll back a transaction on purpose (used by tests and dry runs). */
export class Rollback extends Error { constructor() { super("rollback"); } }
