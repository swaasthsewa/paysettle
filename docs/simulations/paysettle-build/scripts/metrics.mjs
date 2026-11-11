import fs from "node:fs";
import { q, loadState } from "./lib.mjs";
const st = loadState();
const chain = [["Build period 1 (weeks 1–3)", st.p1], ["Build period 2 (weeks 4–7)", st.p2], ["Build period 3 (weeks 8–10)", st.p3], ...(st.maint ?? []).map((w, i) => [`Maintenance month ${i + 1}`, w])].filter((x) => x[1]);
const ids = chain.map((c) => c[1]);
const since = (await q("select min(created_at) t from audit_chain where target = $1", [st.p1]))[0]?.t ?? (await q("select created_at t from workspaces where id=$1", [st.p1]))[0].t;
const out = { since, periods: [] };
for (const [label, ws] of chain) {
  const [w] = await q("select id, title, state, total_cents, revision, risk_score, period_no, parent_workspace_id, fee_bps from workspaces where id=$1", [ws]);
  const ms = await q("select code, title, type, state, amount_cents, target_day, tranche_idx, active, carried_from from ws_milestones where workspace_id=$1 order by target_day, seq", [ws]);
  const tr = await q("select idx, state, amount_cents from tranches where workspace_id=$1 order by idx", [ws]);
  const led = await q("select l.type, sum(l.amount_cents)::bigint s, count(*) n from ledger_entries l join tranches t on t.id=l.tranche_id where t.workspace_id=$1 group by 1", [ws]);
  const cos = await q("select no, state, note, proposed_role, money, total_from_cents, total_to_cents, risk, continuation_id, returns from change_orders where workspace_id=$1 order by no", [ws]).catch(async () => q("select * from change_orders where workspace_id=$1", [ws]));
  const [clk] = await q("select clock_offset_hours from sim_sessions where workspace_id=$1 and scenario='SIMCLOCK'", [ws]);
  out.periods.push({ label, ws, w, ms, tr, led: Object.fromEntries(led.map((r) => [r.type, { cents: Number(r.s), n: Number(r.n) }])), cos, clockHours: clk?.clock_offset_hours ?? 0 });
}
out.ai = await q("select purpose, model, count(*) n, sum(tokens_in)::int tin, sum(tokens_out)::int tout, sum(cost_micros)::bigint cost, sum(case when ok then 0 else 1 end)::int failed, round(avg(latency_ms))::int lat from ai_calls where created_at >= $1 group by 1,2 order by 3 desc", [since]);
out.aiVerdicts = await q("select output->>'recommendation' rec, output->>'verdict' v, count(*) n from ai_calls where created_at >= $1 and purpose ilike '%verif%' group by 1,2", [since]).catch(() => []);
out.notices = await q("select kind, user_id, count(*) n from money_notices where workspace_id = any($1) group by 1,2 order by 1", [ids]).catch((e) => String(e));
out.evNotices = await q("select kind, to_user_id, to_role, count(*) n from evidence_notifications where workspace_id = any($1) group by 1,2,3 order by 1", [ids]);
out.audit = await q("select action, count(*) n from audit_chain where created_at >= $1 group by 1 order by 2 desc", [since]);
out.reviews = await q("select r.decision, r.mfa, count(*) n from evidence_reviews r join ws_milestones m on m.id=r.milestone_id where m.workspace_id = any($1) group by 1,2", [ids]);
out.disputes = await q("select count(*) n from disputes d join ws_milestones m on m.id=d.milestone_id where m.workspace_id = any($1)", [ids]);
fs.writeFileSync("/home/user/paysettle/sim/metrics.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ai: out.ai, verdicts: out.aiVerdicts, notices: out.notices, ev: out.evNotices, reviews: out.reviews, disputes: out.disputes }, null, 1));
for (const p of out.periods) console.log(p.label, p.w.state, p.w.total_cents, JSON.stringify(p.led), p.tr.map((t) => `${t.idx}:${t.state}:${t.amount_cents}`).join(","), "cos", p.cos.length);
process.exit(0);
