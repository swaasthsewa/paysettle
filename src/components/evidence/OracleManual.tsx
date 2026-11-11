/**
 * F3.05 External checks panel for the milestone page: the signed oracle attestations for this milestone's latest attempt,
 * labelled live / simulated / manual, and — for Operations, when a check is in hybrid manual mode or not green — a small
 * counter-verify form posting to /api/oracles/[id]/manual. Server component; renders nothing when no oracle ran.
 */
import type { Role } from "@/db/schema";
import { canWrite } from "@/lib/rbac";
import { attestationsFor, ORACLE_LABEL, type OracleId } from "@/server/evidence/oracles";

const MODE: Record<string, string> = { LIVE: "Live check", SIMULATED: "Simulated (sandbox)", MANUAL_PENDING: "Hybrid manual mode — waiting for Operations", MANUAL: "Counter-verified by Operations" };
const TONE: Record<string, string> = { ok: "ok", warn: "warn", fail: "danger" };
const when = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

export async function OracleManual({ milestoneId, role, back }: { milestoneId: string; role: Role; back: string }) {
  const rows = (await attestationsFor(milestoneId)).filter((r) => r.current);
  if (!rows.length) return null;
  const ops = canWrite(role, "oracle.manual_verify");
  return (
    <section className="c" aria-labelledby="orc-h">
      <div className="c-head"><h2 id="orc-h">External checks</h2></div>
      <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
        {rows.map((r) => (
          <li key={r.id} className="stack">
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <b>{ORACLE_LABEL[r.oracle as OracleId] ?? r.oracle}</b>
              <span className="chip" data-b={TONE[r.level]}>{r.result.status.replace(/_/g, " ").toLowerCase()}</span>
              <span className="chip" data-b="plain">{MODE[r.mode] ?? r.mode}</span>
            </div>
            <p className="small">{r.result.detail}</p>
            <p className="small muted">Attempt {r.attempt} · {when(r.at)}{r.tries > 1 ? ` · ${r.tries} tries` : ""} · signature <code>{r.signature.slice(0, 12)}…</code> {r.valid ? "verified" : "does not verify"}{r.mode === "SIMULATED" ? " · a real carrier or airline adapter is not connected in this build" : ""}</p>
            {ops && r.needsOps && (
              <form method="post" action={`/api/oracles/${encodeURIComponent(r.id)}/manual`} className="stack">
                <input type="hidden" name="back" value={back} />
                <label className="field">What you checked<textarea className="input" name="note" required minLength={3} maxLength={300} rows={2} /></label>
                <div className="row">
                  <button className="btn btn-g btn-sm" type="submit" name="decision" value="CONFIRMED">Confirm check</button>
                  <button className="btn btn-gh btn-sm" type="submit" name="decision" value="REJECTED">Not confirmed</button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
