/**
 * F5.06, P9: one place that decides what is "not real demo data".
 *  - Simulated workspaces: created by the judge playground (src/server/playground), recorded in sim_workspaces.
 *  - Test organisations: rows left by automated tests live in orgs named org_test_*, org_t_*, org_t9_* …
 * Default views (client/provider overviews, contract lists, receipts, payouts, mediator queue and schedule, marketing
 * analytics, reconciliation, the ops radar and the finance ledger) exclude both. The playground shows its own sims.
 * A viewer who is themselves in a test organisation (automated tests) still sees their own test rows.
 */
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/** Organisations whose ids match this pattern hold automated-test data. */
export const TEST_ORG_PATTERN = "^org_(t[0-9]*|test)_";
const TEST_ORG_RE = new RegExp(TEST_ORG_PATTERN);
export const isTestOrgId = (orgId: string | null | undefined): boolean => Boolean(orgId && TEST_ORG_RE.test(orgId));

type Col = AnyColumn | SQL;

/** TRUE when the workspace id (a column or SQL expression) belongs to a playground simulation. */
export const isSimWorkspaceSql = (workspaceId: Col): SQL => sql`exists (select 1 from sim_workspaces sw where sw.workspace_id = ${workspaceId})`;

/** TRUE when the organisation id is not a test organisation. */
export const notTestOrgSql = (orgId: Col): SQL => sql`(${orgId} !~ ${TEST_ORG_PATTERN})`;

/**
 * The default-view filter: not a playground simulation and (when an org column is given) not a test organisation.
 * Pass `keepTest: true` when the viewer is in a test organisation, so tests still see their own rows.
 */
export function excludeSim(workspaceId: Col, orgId?: Col, opts: { keepTest?: boolean } = {}): SQL {
  const notSim = sql`not ${isSimWorkspaceSql(workspaceId)}`;
  return orgId && !opts.keepTest ? sql`(${notSim} and ${notTestOrgSql(orgId)})` : sql`(${notSim})`;
}

/** Same filter for raw SQL written against a workspaces alias (e.g. `w`): `${excludeSimAlias("w")}`. */
export const excludeSimAlias = (alias: string): SQL => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("bad alias");
  return sql.raw(`(not exists (select 1 from sim_workspaces sw where sw.workspace_id = ${alias}.id) and ${alias}.org_id !~ '${TEST_ORG_PATTERN}')`);
};
