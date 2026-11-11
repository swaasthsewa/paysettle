/**
 * Platform health (F5.01, F5.02, F5.04, observability): DB, PayPal mode, AI, webhook lag, last recon, audit chain.
 * The audit chain shows the last recorded check (hourly job or "Verify chain now"): recomputing the whole chain on every
 * page load would grow with every audit row, and many judges open this page at once.
 */
import type { ReactNode } from "react";
import { requireViewer } from "@/lib/session";
import { reasonClause } from "@/lib/ai/gateway";
import { aiHealth, dbHealth, lastCheck, lastRecon, paypalMode, webhookHealth } from "@/server/control/health";
import { hourlyAction, verifyChainAction } from "@/server/control/actions";
import { Flash, Head, one, Stat, type SP } from "@/components/console/parts";
import { fmtAge, fmtDate, human, stateClass } from "@/components/console/format";

export const metadata = { title: "Platform health" };

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["admin", "judge"]);
  const sp = await searchParams;
  const [dbh, ai, wh, recon, lastVerify] = await Promise.all([dbHealth(), aiHealth(), webhookHealth(), lastRecon(), lastCheck("AUDIT_VERIFY")]);
  const checked = (lastVerify?.detail ?? {}) as { rows?: number; brokenAt?: number | null };
  const chainTone = !lastVerify ? "warn" : lastVerify.ok ? "ok" : "danger";
  const pp = paypalMode();
  const lagTone = wh.lagMs > 15 * 60_000 ? "danger" : wh.lagMs > 2 * 60_000 ? "warn" : "ok";
  const rows: { tone: "ok" | "warn" | "danger"; name: string; body: ReactNode }[] = [
    { tone: dbh.ok ? "ok" : "danger", name: "Database", body: dbh.ok ? `Postgres answering in ${dbh.ms} ms.` : `Not reachable: ${dbh.error}` },
    { tone: pp.ok ? "ok" : "danger", name: "PayPal", body: <>{pp.label}. {pp.mode === "MOCK" ? "Money moves are simulated by the mock rail; nothing reaches PayPal." : "Calls go to the PayPal REST API with an idempotency key on every request."}</> },
    { tone: ai.available ? "ok" : "warn", name: "AI assistance", body: ai.available ? `${ai.model ?? "Model"} available · ${ai.usedTokensToday.toLocaleString("en-US")} of ${ai.capTokens.toLocaleString("en-US")} tokens used today.` : `Not available: ${reasonClause(ai.reason) || "reason unknown"}.${/rule-based/i.test(ai.reason ?? "") ? "" : " Rule-based checks still decide."}` },
    { tone: lagTone, name: "Webhooks", body: <>{wh.total} received · {wh.dead} in the dead-letter queue · {wh.quarantined} quarantined (bad signature). {wh.lagMs ? `Oldest unprocessed event waiting ${fmtAge(wh.lagMs)}.` : "Nothing waiting."} <a href="/admin/webhooks">Open webhooks</a></> },
    { tone: !recon ? "warn" : recon.verdict === "DRIFT" ? "danger" : recon.verdict === "IN_FLIGHT" ? "warn" : "ok", name: "Reconciliation", body: recon ? <>Last run {fmtDate(recon.createdAt)}: <span className={stateClass(recon.verdict)}>{human(recon.verdict)}</span> · {recon.matched} matched · {recon.inFlight} waiting · {recon.exceptions.length} exceptions.</> : "No run yet." },
    { tone: chainTone, name: "Audit chain", body: !lastVerify ? <>Not checked yet. The hourly job verifies it, or use Verify chain now.</> : lastVerify.ok ? <>Intact at the last check, {fmtDate(lastVerify.at)}: {(checked.rows ?? 0).toLocaleString("en-US")} entries recomputed and linked.</> : <>Broken at entry #{checked.brokenAt} at the last check, {fmtDate(lastVerify.at)}. Every entry after it is suspect. Admins are paged by the hourly check.</> },
  ];
  return (
    <>
      <Head title="Platform health" sub="Everything PaySettle depends on, checked when this page loads; the audit chain shows its last recorded check." />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <div className="cx-stats">
        <Stat label="Database" value={dbh.ok ? `${dbh.ms} ms` : "Down"} tone={dbh.ok ? "ok" : "danger"} />
        <Stat label="PayPal mode" value={pp.mode === "MOCK" ? "Simulated" : pp.mode === "SANDBOX" ? "Sandbox" : "Live"} tone={pp.ok ? "ok" : "danger"} />
        <Stat label="Webhook lag" value={wh.lagMs ? fmtAge(wh.lagMs) : "0 min"} tone={lagTone} href="/admin/webhooks" />
        <Stat label="Dead letters" value={wh.dead} tone={wh.dead ? "warn" : "ok"} href="/admin/webhooks" />
        <Stat label="Audit chain" value={!lastVerify ? "Not checked" : lastVerify.ok ? "Intact" : `Broken at #${checked.brokenAt}`} tone={chainTone} href="/admin/audit" />
      </div>
      <section className="c">
        <div className="c-head"><h2>Checks</h2>
          {v.role === "admin" && <div className="r">
            <form action={verifyChainAction}><input type="hidden" name="back" value="/admin" /><button className="btn btn-sm" type="submit">Verify chain now</button></form>
            <form action={hourlyAction}><button className="btn btn-g btn-sm" type="submit">Run hourly checks now</button></form>
          </div>}
        </div>
        <ul className="cx-health">
          {rows.map((r) => <li key={r.name}><span className="cx-dot" data-b={r.tone} aria-label={r.tone === "ok" ? "healthy" : r.tone === "warn" ? "needs attention" : "failing"} /><b>{r.name}</b><span>{r.body}</span></li>)}
        </ul>
        <p className="small muted">The hourly job (GET /api/admin/cron with the cron secret) expires four-eyes requests older than 30 minutes, verifies the audit chain and runs reconciliation.</p>
      </section>
    </>
  );
}
