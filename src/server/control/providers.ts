/**
 * F5.10 Provider health and dispute-ratio monitor with trust tiers. Over the last 90 days:
 * ratio < 1% with ≥ 10 releases → Platinum; ≤ 1.5% → Standard; > 1.5% → Probation (new workspaces paused).
 * Rehabilitation: 5 consecutive milestones without a soft rejection lift Probation to Standard.
 * Ratio = disputes ÷ milestones decided (released or disputed) in the window. Tier changes go through four-eyes.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { DAY } from "@/lib/clock";
import type { Tier } from "@/lib/policy";
import { NOT_TEST_ORG_SQL, type Dbx, REAL_WS_SQL } from "./common";

export const WINDOW_DAYS = 90, PLATINUM_MIN_RELEASES = 10, PLATINUM_MAX_BPS = 100, STANDARD_MAX_BPS = 150, REHAB_STREAK = 5;

export interface HealthStats { releases: number; disputes: number; decided: number; cleanStreak: number; current: Tier }
export function ratioBps(s: Pick<HealthStats, "disputes" | "decided">) { return s.decided ? Math.round((s.disputes * 10_000) / s.decided) : 0; }

/** Pure tier rule (tested). */
export function suggestTier(s: HealthStats): { tier: Tier; reason: string } {
  const r = ratioBps(s);
  if (s.current === "probation") {
    if (s.cleanStreak >= REHAB_STREAK) return { tier: "standard", reason: `Rehabilitated: ${s.cleanStreak} clean milestones in a row.` };
    return { tier: "probation", reason: `${s.cleanStreak} of ${REHAB_STREAK} clean milestones in a row toward rehabilitation.` };
  }
  if (s.decided === 0) return { tier: s.current === "new" ? "new" : s.current, reason: "No finished milestones in the last 90 days." };
  if (r > STANDARD_MAX_BPS) return { tier: "probation", reason: `Dispute ratio ${(r / 100).toFixed(2)}% is over 1.5%.` };
  if (r < PLATINUM_MAX_BPS && s.releases >= PLATINUM_MIN_RELEASES) return { tier: "platinum", reason: `Dispute ratio ${(r / 100).toFixed(2)}% with ${s.releases} releases.` };
  if (s.current === "new" && s.decided < 3) return { tier: "new", reason: `Only ${s.decided} finished milestone${s.decided === 1 ? "" : "s"} so far.` };
  return { tier: "standard", reason: s.releases < PLATINUM_MIN_RELEASES ? `Dispute ratio ${(r / 100).toFixed(2)}%; Platinum needs ${PLATINUM_MIN_RELEASES} releases (has ${s.releases}).` : `Dispute ratio ${(r / 100).toFixed(2)}% (Platinum needs under 1%).` };
}

/** Clean streak from the newest milestone backwards: released without a soft rejection (one attempt) and never disputed. */
export function cleanStreak(history: { attempts: number; disputed: boolean }[]) {
  let n = 0;
  for (const h of history) { if (h.disputed || h.attempts > 1) break; n += 1; }
  return n;
}

export async function providerHealth(now = new Date(), dbx: Dbx = db) {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  const base = (await dbx.execute(sql`
    select u.id, u.name, u.tier, u.created_at,
      (select count(distinct r.milestone_id) from releases r join ws_milestones m on m.id = r.milestone_id join workspaces w on w.id = m.workspace_id
        where w.provider_id = u.id and ${REAL_WS_SQL("w")} and r.status = 'COMPLETED' and coalesce(r.completed_at, r.created_at) >= ${since})::int as releases,
      (select count(*) from disputes d join ws_milestones m on m.id = d.milestone_id join workspaces w on w.id = m.workspace_id
        where w.provider_id = u.id and ${REAL_WS_SQL("w")} and d.created_at >= ${since})::int as disputes,
      (select count(distinct x.mid) from (
         select r.milestone_id as mid from releases r join ws_milestones m on m.id = r.milestone_id join workspaces w on w.id = m.workspace_id
           where w.provider_id = u.id and ${REAL_WS_SQL("w")} and r.status = 'COMPLETED' and coalesce(r.completed_at, r.created_at) >= ${since}
         union select d.milestone_id from disputes d join ws_milestones m on m.id = d.milestone_id join workspaces w on w.id = m.workspace_id
           where w.provider_id = u.id and ${REAL_WS_SQL("w")} and d.created_at >= ${since}) x)::int as decided,
      (select count(*) from workspaces w where w.provider_id = u.id and ${REAL_WS_SQL("w")} and w.state not in ('ABANDONED'))::int as contracts,
      (select coalesce(sum(r.net_cents),0) from releases r join ws_milestones m on m.id = r.milestone_id join workspaces w on w.id = m.workspace_id
        where w.provider_id = u.id and ${REAL_WS_SQL("w")} and r.status = 'COMPLETED' and coalesce(r.completed_at, r.created_at) >= ${since})::bigint as paid_cents
    from users u where u.role = 'provider' and ${NOT_TEST_ORG_SQL("u")} order by u.name`)).rows as { id: string; name: string; tier: Tier; releases: number; disputes: number; decided: number; contracts: number; paid_cents: string | number }[];
  const hist = (await dbx.execute(sql`
    select w.provider_id, m.attempts, exists (select 1 from disputes d where d.milestone_id = m.id) as disputed, coalesce(r.completed_at, r.created_at) as at
    from ws_milestones m join workspaces w on w.id = m.workspace_id
    left join releases r on r.milestone_id = m.id and r.kind = 'MILESTONE'
    where w.provider_id is not null and ${REAL_WS_SQL("w")} and (r.id is not null or exists (select 1 from disputes d where d.milestone_id = m.id))
    order by at desc nulls last`)).rows as { provider_id: string; attempts: number; disputed: boolean }[];
  return base.map((p) => {
    const streak = cleanStreak(hist.filter((h) => h.provider_id === p.id));
    const s: HealthStats = { releases: p.releases, disputes: p.disputes, decided: p.decided, cleanStreak: streak, current: p.tier };
    const sug = suggestTier(s);
    return { id: p.id, name: p.name, tier: p.tier, contracts: p.contracts, paidCents: Number(p.paid_cents), ...s, ratioBps: ratioBps(s), suggested: sug.tier, reason: sug.reason };
  });
}
