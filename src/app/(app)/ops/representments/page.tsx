/**
 * F4.10 (X2) Ops → PayPal disputes: every representment PaySettle made — which contract and tranche, what was sent
 * (dossier hash, documents), PayPal's answer, and a retry for dossiers PayPal did not take yet or that failed.
 * Releases on a disputed tranche stay paused until PayPal resolves the dispute; the money stays where PayPal holds it.
 */
import { requireViewer } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { listRepresentments, representmentCounts } from "@/server/representment";
import { retryRepresentmentAction } from "@/server/control/actions";
import { canWrite } from "@/lib/rbac";
import { Flash, Head, one, Stat, type SP } from "@/components/console/parts";
import { fmtDate } from "@/components/console/format";
import "@/styles/console-extras.css";

export const metadata = { title: "PayPal disputes" };
export const dynamic = "force-dynamic";

const TONE = { SUBMITTED: "ok", PENDING: "held", NOT_ELIGIBLE: "warn", FAILED: "danger" } as const;
const LABEL = { SUBMITTED: "Sent to PayPal", PENDING: "Being sent", NOT_ELIGIBLE: "PayPal not taking evidence yet", FAILED: "Not sent" } as const;

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["ops", "admin", "finance", "judge"]);
  const sp = await searchParams;
  const includeSim = one(sp.include) === "sim";
  const [rows, n] = await Promise.all([listRepresentments({ limit: 100, includeSim }), representmentCounts(undefined, { includeSim })]);
  const mayRetry = canWrite(v.role, "webhook.replay");
  return (
    <>
      <Head title="PayPal disputes" sub="When a buyer opens a PayPal dispute on a payment, PaySettle pauses releases on that tranche and sends PayPal the signed contract, the approvals and the evidence hashes. This is the record of what was sent." />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <div className="cx-stats">
        <Stat label="Dossiers sent" value={n.submitted} tone="ok" />
        <Stat label="Waiting on PayPal" value={n.notEligible + n.pending} tone={n.notEligible + n.pending ? "warn" : undefined} detail="not taking seller evidence yet" />
        <Stat label="Not sent" value={n.failed} tone={n.failed ? "danger" : "ok"} detail="kept; retry below" />
      </div>
      <section className="c" aria-labelledby="rep-h">
        <div className="c-head"><h2 id="rep-h">Representments</h2><span className="r small">{includeSim ? <a href="/ops/representments">Hide playground and test contracts</a> : <a href="/ops/representments?include=sim">Include playground and test contracts</a>}</span></div>
        {rows.length === 0 ? (
          <div className="empty"><p>No PayPal dispute has been opened on a PaySettle payment.</p><p className="small muted">When one arrives (CUSTOMER.DISPUTE.CREATED), it shows here with the dossier PaySettle sent.{includeSim ? "" : " Playground chargebacks are hidden; include them with the link above."}</p></div>
        ) : (
          <ul className="cx-queue">
            {rows.map((r) => (
              <li key={r.id} className="cx-item" aria-labelledby={`rep-${r.id}`}>
                <div className="row">
                  <b id={`rep-${r.id}`}>{r.title}</b><code className="cx-code">{r.disputeId}</code>
                  {r.reason && <span className="chip" data-b="plain">{r.reason.replace(/_/g, " ").toLowerCase()}</span>}
                  <span className="sp" /><span className="chip" data-b={TONE[r.status]}>{LABEL[r.status]}</span>
                </div>
                <p className="small">
                  {r.tranches.map((t) => <span key={t.id}>Tranche {t.idx}: <span className="money">{formatCents(t.amountCents)}</span> {t.state === "CLOSED" ? "settled" : "held in PayPal, releases paused"}. </span>)}
                  Rail {r.rail}. Attempts: {r.attempts}. {r.submittedAt ? `Sent ${fmtDate(r.submittedAt)}.` : `Opened ${fmtDate(r.createdAt)}.`}
                </p>
                {r.note && <p className="small">{r.note}</p>}
                {r.lastError && <p className="small" role="status"><b>Last error:</b> {r.lastError}</p>}
                <p className="meta">Dossier SHA-256 <span className="cnx-hash">{r.dossierHash}</span> · key <span className="cnx-hash">{r.idemKey}</span>{r.railRef ? <> · PayPal ref <span className="cnx-hash">{r.railRef}</span></> : null}</p>
                <div className="row">
                  <a className="btn btn-sm" href={`/api/pdf/representment/${r.id}`}>Download dossier PDF</a>
                  {(v.role === "ops" || v.role === "admin") && <a className="btn btn-sm btn-gh" href={`/api/pdf/contract/${r.workspaceId}`}>Contract PDF</a>}
                  {mayRetry && (r.status === "FAILED" || r.status === "NOT_ELIGIBLE") && (
                    <form action={retryRepresentmentAction}>
                      <input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value="/ops/representments" />
                      <button className="btn btn-sm btn-g" type="submit">Send again</button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
