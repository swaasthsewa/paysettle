/**
 * Growth analytics (F5.09 funnel, pruning heatmap, LTV · F2.12 template tracker, PII scrubbed).
 * Aggregates only: no names, emails or ids leave this module. Any cohort or cell under N = 5 is suppressed and shown
 * as “fewer than 5”; rates built on a suppressed number are suppressed too.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { blueprints } from "@/db/schema";
import { type Dbx, REAL_WS_SQL } from "./common";

export const MIN_COHORT = 5;
export type Shown = number | null; /* null = suppressed */
export const SUPPRESSED_LABEL = "fewer than 5";

/** Cohort suppression: counts 1–4 are hidden. 0 is shown (nothing to re-identify). */
export function suppress(n: number, min = MIN_COHORT): Shown { return n > 0 && n < min ? null : n; }
export const shown = (n: Shown) => (n === null ? SUPPRESSED_LABEL : n.toLocaleString("en-US"));
/** A rate is shown only when both its parts may be shown and the base cohort is at least N. */
export function rateBps(num: number, den: number, min = MIN_COHORT): Shown {
  if (den < min || suppress(num, min) === null) return null;
  return den ? Math.round((num * 10_000) / den) : 0;
}
/** Suppress a whole funnel row when its cohort (workspaces created) is under N. */
export function suppressRow<T extends Record<string, number>>(row: T, cohortKey: keyof T, min = MIN_COHORT): { [K in keyof T]: Shown } {
  const small = row[cohortKey] < min;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, small ? null : suppress(v, min)])) as { [K in keyof T]: Shown };
}

const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

export async function funnel(dbx: Dbx = db) {
  const r = rows<{ code: string; title: string; created: number; signed: number; funded: number; completed: number }>(await dbx.execute(sql`
    with ws as (
      select w.id, w.blueprint_code, w.state,
        exists (select 1 from tranches t where t.workspace_id = w.id and t.state in ('HELD','PARTIALLY_RELEASED','ROLLED_OVER','SETTLING','CLOSED','BREAKER')) as funded,
        (select count(*) from ws_milestones m where m.workspace_id = w.id and m.active and m.type = 'PAY') as pay,
        (select count(*) from ws_milestones m where m.workspace_id = w.id and m.active and m.type = 'PAY' and m.state in ('RELEASED','SETTLED_BY_VERDICT','REFUNDED')) as done
      from workspaces w where ${REAL_WS_SQL("w")})
    select b.code, b.title,
      count(ws.id)::int as created,
      count(ws.id) filter (where ws.state in ('SIGNED','PENDING_OPS','LOCKED'))::int as signed,
      count(ws.id) filter (where ws.funded)::int as funded,
      count(ws.id) filter (where ws.funded and ws.pay > 0 and ws.done = ws.pay)::int as completed
    from ${blueprints} b left join ws on ws.blueprint_code = b.code
    group by b.code, b.title order by count(ws.id) desc, b.code`));
  const total = r.reduce((a, x) => ({ created: a.created + x.created, signed: a.signed + x.signed, funded: a.funded + x.funded, completed: a.completed + x.completed }), { created: 0, signed: 0, funded: 0, completed: 0 });
  return {
    total: suppressRow(total, "created"),
    rawTotalCreated: total.created >= MIN_COHORT ? total.created : null,
    byBlueprint: r.map((x) => ({ code: x.code, title: x.title, ...suppressRow({ created: x.created, signed: x.signed, funded: x.funded, completed: x.completed }, "created") })),
  };
}

/** Most-pruned baseline milestones: distinct workspaces whose revision history has a PRUNE of that code. */
export async function pruneHeatmap(dbx: Dbx = db) {
  const bps = await dbx.select({ code: blueprints.code, title: blueprints.title, milestones: blueprints.milestones }).from(blueprints).orderBy(blueprints.code);
  const counts = rows<{ blueprint_code: string; code: string; n: number }>(await dbx.execute(sql`
    select w.blueprint_code, coalesce(r.change->>'milestoneCode', r.change->>'target', r.change->'detail'->>'milestoneCode') as code, count(distinct r.workspace_id)::int as n
    from revisions r join workspaces w on w.id = r.workspace_id
    where r.change->>'action' = 'PRUNE' and ${REAL_WS_SQL("w")}
    group by 1, 2`));
  const cohort = rows<{ blueprint_code: string; n: number }>(await dbx.execute(sql`select blueprint_code, count(*)::int as n from workspaces w where ${REAL_WS_SQL("w")} group by 1`));
  return bps.map((b) => {
    const size = cohort.find((c) => c.blueprint_code === b.code)?.n ?? 0;
    const cells = b.milestones.map((m) => {
      const n = counts.find((c) => c.blueprint_code === b.code && c.code === m.code)?.n ?? 0;
      return { code: m.code, title: m.title, type: m.type, pruned: size < MIN_COHORT ? null : suppress(n), rateBps: rateBps(n, size) };
    });
    return { code: b.code, title: b.title, cohort: suppress(size), cells };
  });
}

/** LTV: platform fee revenue per client and per completed contract (aggregated, suppressed under N = 5 clients). */
export async function ltv(dbx: Dbx = db) {
  const [r] = rows<{ clients: number; fee_cents: number; gross_cents: number; repeat_clients: number }>(await dbx.execute(sql`
    with per as (
      select w.client_id, count(distinct w.id) as contracts,
        coalesce(sum(case when l.type = 'FEE' then l.amount_cents else 0 end), 0) as fee,
        coalesce(sum(case when l.type in ('RELEASE','FEE') then l.amount_cents else 0 end), 0) as gross
      from workspaces w left join tranches t on t.workspace_id = w.id left join ledger_entries l on l.tranche_id = t.id
      where ${REAL_WS_SQL("w")}
      group by w.client_id)
    select count(*)::int as clients, coalesce(sum(fee),0)::bigint as fee_cents, coalesce(sum(gross),0)::bigint as gross_cents,
      count(*) filter (where contracts > 1)::int as repeat_clients from per`));
  const clients = r?.clients ?? 0;
  if (clients < MIN_COHORT) return { clients: suppress(clients), feePerClientCents: null, grossPerClientCents: null, repeatRateBps: null };
  return {
    clients, feePerClientCents: Math.round(Number(r.fee_cents) / clients), grossPerClientCents: Math.round(Number(r.gross_cents) / clients),
    repeatRateBps: rateBps(r.repeat_clients, clients),
  };
}

/** Dispute rate per baseline milestone code (F4.12, flagged over 8%). Uses the disputes module's view when it exists. */
export async function disputeRates(dbx: Dbx = db) {
  /* the view has no org column, so it is used only while no test-org rows exist; otherwise the same query runs with the filter */
  const view = rows<{ t: string | null }>(await dbx.execute(sql`select to_regclass('public.dispute_rate_by_code')::text as t`))[0]?.t;
  const polluted = rows<{ n: number }>(await dbx.execute(sql`select count(*)::int as n from workspaces w where not (${REAL_WS_SQL("w")})`))[0]?.n ?? 0;
  const has = view && polluted === 0;
  const q = has
    ? sql`select blueprint_code, milestone_code, milestones, disputes from dispute_rate_by_code`
    : sql`select w.blueprint_code, m.code as milestone_code, count(*)::int as milestones, count(d.id)::int as disputes
          from ws_milestones m join workspaces w on w.id = m.workspace_id left join disputes d on d.milestone_id = m.id
          where m.active and m.origin = 'BASELINE' and m.state <> 'DRAFT' and ${REAL_WS_SQL("w")} group by 1, 2`;
  const r = rows<{ blueprint_code: string; milestone_code: string; milestones: number; disputes: number }>(await dbx.execute(q));
  return {
    source: "dispute records",
    rows: r.map((x) => {
      const rate = rateBps(x.disputes, x.milestones);
      return { blueprintCode: x.blueprint_code, milestoneCode: x.milestone_code, milestones: suppress(x.milestones), disputes: x.milestones < MIN_COHORT ? null : suppress(x.disputes), rateBps: rate, flagged: rate !== null && rate > 800 };
    }),
  };
}

/**
 * F5.09 ops-touch rate: the share of signed contracts that needed a person from PaySettle — Operations clearance
 * (risk score at or above the threshold sent it to PENDING_OPS) or a Tier 3 mediator on any milestone. Lower is better:
 * it is the cost-to-serve signal. Cohort = contracts both parties signed (or that went to Ops). Suppressed under N = 5.
 */
export async function opsTouch(dbx: Dbx = db, o: { workspaceIds?: string[] } = {}) {
  const scope = o.workspaceIds ? (o.workspaceIds.length ? sql`and w.id in (${sql.join(o.workspaceIds.map((id) => sql`${id}`), sql`, `)})` : sql`and false`) : sql``;
  const [r] = rows<{ cohort: number; ops: number; tier3: number; either: number }>(await dbx.execute(sql`
    with ws as (
      select w.id,
        exists (select 1 from audit_chain a where a.target = w.id and a.action = 'contract.pending_ops') as ops,
        exists (select 1 from disputes d join ws_milestones m on m.id = d.milestone_id where m.workspace_id = w.id and (d.tier >= 3 or d.state = 'TIER3')) as tier3
      from workspaces w
      where ${REAL_WS_SQL("w")} ${scope} and (w.state in ('SIGNED','PENDING_OPS','LOCKED') or exists (select 1 from audit_chain a where a.target = w.id and a.action in ('contract.sealed','contract.pending_ops'))))
    select count(*)::int as cohort, count(*) filter (where ops)::int as ops, count(*) filter (where tier3)::int as tier3, count(*) filter (where ops or tier3)::int as either from ws`));
  const cohort = r?.cohort ?? 0;
  const small = cohort < MIN_COHORT;
  return {
    cohort: suppress(cohort),
    touched: small ? null : suppress(r?.either ?? 0), opsClearance: small ? null : suppress(r?.ops ?? 0), tier3: small ? null : suppress(r?.tier3 ?? 0),
    rateBps: rateBps(r?.either ?? 0, cohort), opsRateBps: rateBps(r?.ops ?? 0, cohort), tier3RateBps: rateBps(r?.tier3 ?? 0, cohort),
  };
}
