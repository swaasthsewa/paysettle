/**
 * Milestone page /contracts/[id]/m/[milestoneId] (F3.04, F3.06, F3.07, F3.09, A3).
 * Left: what the contract requires. Right: provider upload with a live checklist, or the client's review of the latest
 * package (files, hashes, signals, AI advice, decision). Below: review countdown and attempt history.
 * Deadline panel (due date, on-time badge, adjustment, extensions) when the contract has deadline terms.
 */
import { SequenceOverridePanel } from "@/components/evidence/SequenceOverridePanel";
import Link from "next/link";
import { notFound } from "next/navigation";
import "@/styles/evidence.css";
import { requireViewer } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { HOUR } from "@/lib/clock";
import { getMilestoneDetail, type MilestoneDetail } from "@/server/evidence/view";
import { KIND_LABEL, parseNote, type Signal } from "@/server/evidence/spec";
import { REVIEW_HOURS, TIMEOUT_HOURS } from "@/server/evidence";
import { msStateClass, msStateLabel } from "@/components/evidence/state";
import { SignalList } from "@/components/evidence/SignalList";
import { AiPanel } from "@/components/evidence/AiPanel";
import { OracleManual } from "@/components/evidence/OracleManual";
import { UploadForm } from "@/components/evidence/UploadForm";
import { DecisionPanel } from "@/components/evidence/DecisionPanel";
import { approveAction, decideExtensionAction, recordExcusedAction, requestExtensionAction, requestFixAction } from "./actions";
import { deadlineFacts, type DeadlineFacts } from "@/server/money/deadline";
import { extensionsFor } from "@/server/contracts/deadline";
import { DeadlinePanel } from "@/components/contracts/DeadlinePanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Milestone" };

const fmtTime = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
function span(ms: number) {
  const m = Math.round(Math.abs(ms) / 60_000), h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} m` : `${m} m`;
}
const shortHash = (h: string) => `${h.slice(0, 12)}…${h.slice(-6)}`;
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function MilestonePage({ params, searchParams }: { params: Promise<{ id: string; milestoneId: string }>; searchParams: Promise<{ dl?: string; dlerr?: string }> }) {
  const v = await requireViewer();
  const { id, milestoneId } = await params;
  const sp = await searchParams;
  const d = await getMilestoneDetail(v, id, milestoneId);
  if (!d) notFound();
  const dl = await deadlineFacts(d.milestone.id);
  const exts = dl ? await extensionsFor(d.milestone.id) : [];
  const { milestone: m, workspace: ws, tranche, packages, as } = d;
  const amount = formatCents(m.amountCents, ws.currency);
  const latest = packages[0] ?? null;
  const released = d.releases.find((r) => r.status === "COMPLETED");
  const fixReview = [...d.reviews].reverse().find((r) => r.decision === "REQUEST_FIX");
  const funded = tranche && ["HELD", "PARTIALLY_RELEASED"].includes(tranche.state);
  const canUpload = as === "provider" && ws.state === "LOCKED" && (m.state === "OPEN" || m.state === "REMEDIATION" || (m.state === "LOCKED" && funded && d.prerequisitesSettled)) && m.attempts < 3;
  const canDecide = as === "client" && latest && (m.state === "SUBMITTED" || m.state === "ESCALATED");
  const queued = as === "client" && latest && m.state === "APPROVED" && !released;

  return (
    <>
      <div className="phead">
        <div>
          <p className="muted small"><Link href={`/contracts/${ws.id}`}>{ws.title}</Link> · {ws.clientName ?? "Client"} ↔ {ws.providerName ?? "Provider"}</p>
          <h1>{m.code} · {m.title}</h1>
          <p className="sub">{moneyLine(d, amount, dl)}</p>
        </div>
        <div className="stats">
          <span className={`state ${msStateClass(m.state)}`}>{msStateLabel(m.state)}</span>
          <span className="money">{m.type === "GATE" ? "Gate" : amount}</span>
        </div>
      </div>

      <div className="ev-grid">
        <section className="c ev-spec" aria-labelledby="ev-req-h">
          <div className="c-head"><h2 id="ev-req-h">What the contract requires</h2></div>
          <dl className="kv">
            <div><dt>Type</dt><dd>{m.type === "PAY" ? "Payment milestone" : "Gate (no payment)"}</dd></div>
            <div><dt>Amount</dt><dd className="money">{m.type === "GATE" ? "—" : amount}<small>{(m.bps / 100).toFixed(m.bps % 100 ? 2 : 0)}% of the contract · tranche {m.trancheIdx}</small></dd></div>
            <div><dt>Due</dt><dd>Day {m.targetDay}{dl?.dueAt && <small>{fmtTime(dl.dueAt)} (contract clock)</small>}</dd></div>
            <div><dt>State</dt><dd>{msStateLabel(m.state)}<small>Attempts used: {m.attempts} of 3</small></dd></div>
          </dl>
          <div className="stack">
            <h3 className="small">Proof to submit</h3>
            <ul className="ev-proof">
              {m.proof.artifacts.filter((x) => x.min > 0).map((x, i) => (
                <li key={i}><span className="chip" data-b="plain">{x.min} × {KIND_LABEL[x.kind][x.min === 1 ? 0 : 1]}</span> {x.note ?? ""}</li>
              ))}
              {m.proof.oracle && <li><span className="chip" data-b="plain">External check</span> {m.proof.oracle}</li>}
              {m.proof.gpsRadiusM ? <li><span className="chip" data-b="plain">GPS</span> Photos within {m.proof.gpsRadiusM} m of {d.site ? d.site.label : "the site (no location on file yet)"}</li> : null}
            </ul>
          </div>
          <div className="stack">
            <h3 className="small">Acceptance criteria</h3>
            <ol className="ev-criteria">{m.proof.criteria.map((c, i) => <li key={i}>{c}</li>)}</ol>
          </div>
          <dl className="kv">
            <div><dt>Lock rule</dt><dd className="ev-rule">{m.lockRule}</dd></div>
            <div><dt>Dispute rule</dt><dd className="ev-rule">{m.disputeRule}</dd></div>
            <div><dt>If the client is silent</dt><dd className="ev-rule">Review within {REVIEW_HOURS} h; reminders at 24 h and 36 h; at {TIMEOUT_HOURS} h {ws.reviewTimeoutRule === "DEEMED_APPROVED" ? "the evidence is deemed approved" : "Operations takes over"}.</dd></div>
          </dl>
        </section>

        <div className="stack ev-main">
          <Countdown d={d} />
          <SequenceOverridePanel d={d} />
          {sp.dl && <p className="notice" data-b="ok" role="status">{sp.dl}</p>}
          {sp.dlerr && <p className="notice" data-b="danger" role="alert">{sp.dlerr}</p>}
          {dl && <DeadlinePanel f={dl} extensions={exts} as={as ?? "other"} viewerId={v.id} workspaceId={ws.id} currency={ws.currency} disputeId={d.dispute?.id ?? null}
            actions={{ request: requestExtensionAction, decide: decideExtensionAction, excuse: recordExcusedAction }} />}
          {as === "provider" && m.state === "REMEDIATION" && fixReview && (
            <div className="notice" data-b="warn" role="note">
              <b>The client asked for these fixes:</b>
              <ul>{fixReview.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {canUpload && (
            <section className="c" aria-labelledby="ev-up-h">
              <div className="c-head"><h2 id="ev-up-h">{m.state === "REMEDIATION" ? "Submit the fixed evidence" : "Submit evidence"}</h2></div>
              <UploadForm milestoneId={m.id} code={m.code} proof={m.proof} attempt={m.attempts + 1} />
            </section>
          )}
          {as === "provider" && !canUpload && !latest && (
            <section className="c"><p className="muted">{m.state === "LOCKED" ? (funded ? `Evidence opens once ${m.dependsOn.length ? m.dependsOn.join(", ") : "the earlier milestones"} ${m.dependsOn.length === 1 ? "is" : "are"} settled.` : `Evidence opens once tranche ${m.trancheIdx} is held in PayPal.`) : `Nothing to submit while the milestone is ${msStateLabel(m.state).toLowerCase()}.`}</p></section>
          )}

          {latest ? <PackageView d={d} /> : as !== "provider" && <section className="c"><p className="muted">No evidence submitted yet. {m.state === "OPEN" ? "The provider can upload now." : ""}</p></section>}
          {latest && <AiPanel verifier={latest.verifier ?? null} criteria={m.proof.criteria} />}
          {latest && (m.proof.oracle || m.proof.artifacts.some((x) => x.kind === "ORACLE")) && <OracleManual milestoneId={m.id} role={v.role} back={`/contracts/${id}/m/${m.id}`} />}

          {(canDecide || queued) && latest && (
            <section className="c" aria-labelledby="ev-dec-h">
              <div className="c-head"><h2 id="ev-dec-h">Your decision</h2>{m.state === "ESCALATED" && <span className="chip" data-b="warn">Escalated — you can still decide</span>}</div>
              <DecisionPanel workspaceId={ws.id} milestoneId={m.id} code={m.code} rootHash={latest.rootHash} amountLabel={amount} isGate={m.type === "GATE"}
                state={m.state} attempts={m.attempts} disputeHref={`/client/disputes/new?milestone=${encodeURIComponent(m.id)}`}
                approve={approveAction} requestFix={requestFixAction} retryOnly={Boolean(queued)} />
            </section>
          )}
          {m.state === "DISPUTED" && (
            <div className="notice" data-b="warn">{amount} stays held in PayPal while the dispute runs.{d.dispute ? <> Dispute {d.dispute.state.toLowerCase()} — <Link href={as === "client" ? `/client/disputes` : as === "provider" ? `/provider/contracts` : `/mediator/cases`}>see disputes</Link>.</> : " The dispute is being opened."}</div>
          )}

          <History d={d} />
        </div>
      </div>
    </>
  );
}

function moneyLine(d: MilestoneDetail, amount: string, dl: DeadlineFacts | null): string {
  const { milestone: m, tranche, as } = d;
  if (m.type === "GATE") return "A gate: no money moves; approving it lets dependent milestones start.";
  const rel = d.releases.find((r) => r.status === "COMPLETED");
  const adj = dl?.stored;
  if (rel && adj && (adj.deductionCents || adj.bonusCents)) return `${formatCents(rel.netCents, d.workspace.currency)} released to ${d.workspace.providerName ?? "the provider"}'s PayPal account: ${amount}${adj.deductionCents ? ` − ${formatCents(adj.deductionCents, d.workspace.currency)} late deduction (back to the client)` : ""}${adj.bonusCents ? ` + ${formatCents(adj.bonusCents, d.workspace.currency)} early bonus` : ""}, fee ${formatCents(rel.feeCents, d.workspace.currency)}.`;
  if (rel) return `${formatCents(rel.netCents, d.workspace.currency)} released to ${d.workspace.providerName ?? "the provider"}'s PayPal account (fee ${formatCents(rel.feeCents, d.workspace.currency)}).`;
  if (m.state === "DISPUTED") return `${amount} held in PayPal until the dispute is resolved.`;
  if (m.state === "APPROVED") return `Approved. ${amount} is being released from the PayPal hold to ${d.workspace.providerName ?? "the provider"}.`;
  if (m.state === "REFUNDED") return `${amount} was returned to the client.`;
  if (!tranche || !["HELD", "PARTIALLY_RELEASED"].includes(tranche.state)) return `${amount} is not funded yet — tranche ${m.trancheIdx} is ${tranche ? tranche.state.toLowerCase().replace(/_/g, " ") : "not created"}.`;
  return as === "client" ? `${amount} held in PayPal until you approve ${m.code}.` : `${amount} held in PayPal until ${d.workspace.clientName ?? "the client"} approves ${m.code}.`;
}

function Countdown({ d }: { d: MilestoneDetail }) {
  const { milestone: m, now } = d;
  if (!m.reviewDueAt || !["SUBMITTED", "REMEDIATION"].includes(m.state)) return null;
  const left = m.reviewDueAt.getTime() - now.getTime();
  if (m.state === "REMEDIATION") {
    return <div className="notice ev-count" data-b={left < 0 ? "danger" : "warn"} role="status">{left >= 0 ? `Fix due in ${span(left)}` : `The 72-hour fix window passed ${span(left)} ago`} · due {fmtTime(m.reviewDueAt)} (contract clock)</div>;
  }
  const tail = m.reviewDueAt.getTime() + (TIMEOUT_HOURS - REVIEW_HOURS) * HOUR - now.getTime();
  const rule = d.workspace.reviewTimeoutRule === "DEEMED_APPROVED" ? "deemed approval" : "escalation to Operations";
  return (
    <div className="notice ev-count" data-b={left < 0 ? "danger" : left < 12 * HOUR ? "warn" : undefined} role="status">
      {left >= 0 ? <>Client review due in <b className="tnum">{span(left)}</b></> : <>The {REVIEW_HOURS}-hour review window passed {span(left)} ago; {tail > 0 ? `${rule} in ${span(tail)}` : `${rule} applies now`}</>}
      <span className="muted small"> · due {fmtTime(m.reviewDueAt)} (contract clock)</span>
    </div>
  );
}

function PackageView({ d }: { d: MilestoneDetail }) {
  const p = d.packages[0];
  const note = parseNote(p.note ?? "");
  const images = p.files.filter((f) => f.kind.startsWith("image/"));
  return (
    <section className="c" aria-labelledby="ev-pkg-h">
      <div className="c-head">
        <h2 id="ev-pkg-h">Evidence · attempt {p.attempt}</h2>
        <span className="chip" data-b={p.state === "APPROVED" ? "ok" : p.state === "SUBMITTED" ? "plain" : "warn"}>{p.state.replace(/_/g, " ").toLowerCase()}</span>
        <span className="r muted small">Submitted {fmtTime(p.createdAt)}</span>
      </div>
      <p className="small ev-hash">Root hash <code title={p.rootHash}>{p.rootHash}</code></p>
      {images.length > 0 && (
        <ul className="ev-thumbs" aria-label="Photos">
          {images.map((f) => (
            <li key={f.sha256}>
              <a href={f.url ?? `/api/evidence/file/${f.sha256}`} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url ?? `/api/evidence/file/${f.sha256}`} alt={f.name} loading="lazy" />
              </a>
              <span className="small">{f.name}</span>
            </li>
          ))}
        </ul>
      )}
      <table className="ptable">
        <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Size</th><th scope="col">SHA-256</th></tr></thead>
        <tbody>
          {p.files.map((f) => (
            <tr key={f.sha256}>
              <td><a href={f.url ?? `/api/evidence/file/${f.sha256}`} {...(f.kind.startsWith("image/") ? { target: "_blank", rel: "noopener noreferrer" } : { download: f.name })}>{f.name}</a></td>
              <td className="small">{f.kind}</td>
              <td className="small tnum">{kb(f.size)}</td>
              <td className="small ev-hash"><code title={f.sha256}>{shortHash(f.sha256)}</code></td>
            </tr>
          ))}
          {!p.files.length && <tr><td colSpan={4} className="muted">No files — this package is links and confirmations only.</td></tr>}
        </tbody>
      </table>
      {(note.text || note.confirmed.length || note.gpsWaiver) && (
        <div className="stack">
          <h3 className="small">Provider&apos;s note</h3>
          {note.text && <p className="ev-note">{note.text}</p>}
          {note.urls.length > 0 && <ul className="small">{note.urls.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer nofollow ugc">{u}</a> <span className="muted">(external link — opens outside PaySettle)</span></li>)}</ul>}
          {note.confirmed.length > 0 && <p className="small">Confirmed by the provider: {note.confirmed.map((k) => KIND_LABEL[k][0]).join(", ")}</p>}
          {note.gpsWaiver && <p className="notice" data-b="warn">The provider used the GPS waiver — check the note for the reason.</p>}
        </div>
      )}
      <SignalList signals={p.signals as Signal[]} title="Checks" />
    </section>
  );
}

function History({ d }: { d: MilestoneDetail }) {
  if (!d.packages.length && !d.reviews.length) return null;
  const DEC: Record<string, string> = { APPROVE: "Approved (signed)", REQUEST_FIX: "Fix requested", THIRD_REJECTION: "Rejected — dispute", DEEMED_APPROVED: "Deemed approved", ESCALATED: "Escalated (review timed out)" };
  return (
    <section className="c" aria-labelledby="ev-hist-h">
      <div className="c-head"><h2 id="ev-hist-h">History of attempts</h2></div>
      <table className="ptable">
        <thead><tr><th scope="col">Attempt</th><th scope="col">Submitted</th><th scope="col">Files</th><th scope="col">Root</th><th scope="col">Outcome</th></tr></thead>
        <tbody>
          {d.packages.map((p) => {
            const rv = d.reviews.filter((r) => r.packageId === p.id);
            return (
              <tr key={p.id}>
                <td className="tnum">{p.attempt}</td>
                <td className="small">{fmtTime(p.createdAt)}</td>
                <td className="tnum">{p.files.length}</td>
                <td className="small ev-hash"><code title={p.rootHash}>{shortHash(p.rootHash)}</code></td>
                <td className="small">
                  {rv.length ? rv.map((r) => (
                    <div key={r.id}>{DEC[r.decision] ?? r.decision} · {fmtTime(r.createdAt)}{r.items.length ? <ul>{r.items.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}{r.signature ? <span className="muted"> · sig {r.signature.slice(0, 10)}…</span> : null}</div>
                  )) : <span className="muted">Awaiting the client</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
