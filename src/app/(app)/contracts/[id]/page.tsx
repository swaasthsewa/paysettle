/**
 * F2.03 F2.04 F2.05 F2.06 F2.07 F2.08 F2.09 F2.10 — the negotiation room, shared by both parties (others read only).
 * Server-rendered from the authoritative revision; a small poller refreshes it when the other party changes or signs.
 * "Deadline terms" panel (late deduction, early bonus) with a live preview; risk formula disclosure (red team 17).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { feeFor, formatCents, pct, BPS_FULL } from "@/lib/money";
import { RAIL_CAP_DAYS, RISK_FORMULA, RISK_OPS_THRESHOLD, type Rail } from "@/lib/policy";
import { DEADLINE_CLAUSE_CODES, type DeadlineTerms } from "@/lib/deadline";
import { DeadlineTermsForm } from "@/components/contracts/DeadlineTermsForm";
import { RiskFormula } from "@/components/contracts/deadline-parts";
import { getWorkspaceDetail, revisionStamp, type RevisionRow, type WorkspaceDetail } from "@/server/contracts";
import { currentActor, domainMessage } from "@/server/contracts/web";
import { LivePoll } from "@/components/contracts/live-poll";
import { sameNetworkSignal, type NetworkSignal } from "@/lib/identity/risk-signals";
import { MsChip, TrancheChip, WsChip, artifactLabel, railLabel } from "@/components/contracts/chips";
import {
  appendClauseAction, appendMilestoneAction, editMilestoneAction, pruneAction, restoreAction, setDeadlineTermsAction, setTotalAction, signAction, toggleClauseAction,
} from "./actions";
import { ChangeOrders } from "@/components/contracts/ChangeOrders";
import { changeOrderRoom, type ChangeOrderRoom } from "@/server/contracts/change-orders";
import { continueAction, declineChangeOrderAction, proposeChangeOrderAction, signChangeOrderAction } from "./change-order-actions";
import { ContinuePanel, PeriodChain } from "@/components/contracts/Continuation";
import { carryable, periodChain } from "@/server/contracts/continuation";
import "@/styles/contracts.css";

export const metadata = { title: "Contract" };
export const dynamic = "force-dynamic";

type View = WorkspaceDetail["view"];
type Ms = View["milestones"][number];
const SIGNABLE = ["DRAFT", "READY_TO_SIGN", "PARTIALLY_SIGNED"];
const fmt = (d: Date) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
const RISK_PARTS: [key: string, weight: number, label: string][] = RISK_FORMULA.map((f) => [f.key, f.weight, f.label]);
const CO_OK: Record<string, string> = {
  co_proposed: "Change order proposed. The other party reviews it; both sign before it takes effect.",
  co_applied: "Both parties signed. The change order is now the contract's latest revision.",
  co_awaiting_ops: "Both parties signed. Operations reviews the change order before it takes effect.",
  co_closed: "The change order is closed. The contract stays on its current terms.",
};

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; ok?: string; note?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { a } = await currentActor();
  let d: WorkspaceDetail;
  try { d = await getWorkspaceDetail(a, id); } catch (e) { domainMessage(e); notFound(); }
  const stamp = (await revisionStamp(a, id)).stamp;
  const v = d.view;
  /* F2.13 change orders on a locked contract */
  const coRoom: ChangeOrderRoom | null = v.state === "LOCKED" ? await changeOrderRoom(a, id) : null;
  /* F2.14 the period chain and the next-period panel */
  const chain = await periodChain(a, id);
  const carry = v.state === "LOCKED" && d.viewerRole ? await carryable(a, id) : [];
  const party = d.viewerRole;
  const editable = party !== null && SIGNABLE.includes(v.state);
  const active = v.milestones.filter((m) => m.active);
  const pay = active.filter((m) => m.type === "PAY");
  const sumBps = pay.reduce((x, m) => x + m.bps, 0);
  const feeTotal = pay.reduce((x, m) => x + feeFor(m.amountCents, v.feeBps), 0);
  const groups = [...new Set(v.milestones.map((m) => m.trancheIdx))].sort((x, y) => x - y);
  const cap = RAIL_CAP_DAYS[v.rail as Rail] ?? 26;
  const counterpart = party === "client" ? (v.provider?.name ?? v.inviteEmail ?? "the provider") : v.client.name;
  const liveSigs = d.signatureRows.filter((s) => s.voidedAtRev === null && s.revNo === v.revision);
  const iSigned = party !== null && liveSigs.some((s) => s.role === party);
  /* REG risk signal: same network or address seen for both parties (warning only; masked labels, never full IPs). */
  const net: NetworkSignal | null = v.provider && (party !== null || ["ops", "admin"].includes(a.role)) ? await sameNetworkSignal(v.client.id, v.provider.id).catch(() => null) : null;
  const back = party === "provider" ? "/provider/contracts" : party === "client" ? "/client/contracts" : a.role === "ops" ? "/ops/clearance" : "/blueprints";

  return (
    <>
      <div className="phead">
        <div>
          <p className="crumb"><Link href={back}>Contracts</Link> › {v.title}</p>
          <h1>{v.title}</h1>
          <PeriodChain chain={chain} />
          <p className="sub">{v.client.name} (client) ↔ {v.provider ? `${v.provider.name} (provider)` : v.inviteEmail ? `${v.inviteEmail} (invited)` : "no provider yet"} · from blueprint <Link href={`/blueprints/${v.blueprintCode}`}>{v.blueprintCode}</Link></p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v money">{formatCents(v.totalCents)}</div><div className="l">Total</div></div>
          <div className="hstat"><div className="v money">{formatCents(feeTotal)}</div><div className="l">Platform fee ({pct(v.feeBps)} per release)</div></div>
          <div className="hstat"><div className="v">{d.risk.score}</div><div className="l">Risk score</div></div>
        </div>
      </div>

      <div className="row">
        <WsChip state={v.state} />
        <span className="chip" data-b="plain">Revision {v.revision}</span>
        <span className="chip" data-b="plain">{railLabel(v.rail)}</span>
        {v.canonicalHash && <span className="small muted">Hash <code className="hash">{v.canonicalHash.slice(0, 12)}</code></span>}
        {v.canonicalHash && <a className="btn btn-sm btn-gh" href={`/api/pdf/contract/${v.id}`}>Download contract PDF</a>}
        <span className="sp" style={{ flex: 1 }} />
        {party && <LivePoll id={v.id} stamp={stamp} />}
        <Link className="btn btn-sm btn-gh" href={`/contracts/${v.id}/timeline`}>Timeline</Link>
      </div>

      {sp.err && <div className="notice" data-b="danger" role="alert">{sp.err}</div>}
      {sp.ok === "signed" && <div className="notice" data-b="ok" role="status">Your signature on revision {v.revision} is recorded.</div>}
      {sp.ok === "continued" && <div className="notice" data-b="ok" role="status">Period {chain.periodNo} is a draft. Review it, change it if needed, and both sign; then the client funds it through PayPal.</div>}
      {sp.ok?.startsWith("co_") && <div className="notice" data-b="ok" role="status">{CO_OK[sp.ok] ?? "Done."}</div>}
      {sp.note && <div className="notice" role="status">{sp.note}</div>}
      {d.opsNotes[0]?.decision === "returned" && v.state === "DRAFT" && (
        <div className="notice" data-b="warn">Operations returned this contract ({d.opsNotes[0].by}, {fmt(d.opsNotes[0].at)}): “{d.opsNotes[0].note}” Both signatures were voided; change and sign again.</div>
      )}
      {!party && <div className="notice">You are viewing this contract read-only. Only {v.client.name} and {v.provider?.name ?? "the provider"} can change or sign it.</div>}
      <MoneyLine v={v} />

      <div className="bento">
        <section className="c span8" id="ms" aria-labelledby="ms-h">
          <div className="c-head"><h2 id="ms-h">Milestones</h2><span className="r small muted">{active.length} active · {v.milestones.length - active.length} pruned</span></div>
          <div className="alloc" {...(sumBps !== BPS_FULL ? { "data-bad": "" } : {})}>
            <div className="row small"><span>Payout allocation</span><span className="sp" /><span className="alloc-sum">{pct(sumBps)} of 100%</span></div>
            <div className="alloc-bar" role="img" aria-label={`Payment milestones add up to ${pct(sumBps)}`}>
              {pay.map((m) => <i key={m.id} style={{ width: `${Math.min(100, m.bps / 100)}%` }} title={`${m.code} ${pct(m.bps)}`} />)}
            </div>
            {sumBps !== BPS_FULL && <p className="small" style={{ color: "var(--danger)" }}>Shares must add up to exactly 100% before anyone can sign.</p>}
          </div>
          {groups.map((g) => {
            const list = v.milestones.filter((m) => m.trancheIdx === g);
            const ac = list.filter((m) => m.active);
            const tr = v.tranches.find((t) => t.idx === g);
            const amt = ac.filter((m) => m.type === "PAY").reduce((x, m) => x + m.amountCents, 0);
            return (
              <div className="tr-group" key={g}>
                <h3>Tranche {g}<span className="muted small">days {tr?.startDay ?? (g === 1 ? 1 : ac[0]?.targetDay ?? "—")}–{tr?.endDay ?? ac[ac.length - 1]?.targetDay ?? "—"} · {formatCents(amt)} · hold cap {cap} days</span></h3>
                <ol className="ms-list">{list.map((m) => <MilestoneItem key={m.id} m={m} v={v} editable={editable} />)}</ol>
              </div>
            );
          })}
          {editable && <AppendMilestone v={v} />}
        </section>

        <div className="span4 stack" style={{ gap: 16 }}>
          <Signatures d={d} party={party} iSigned={iSigned} counterpart={counterpart} net={net} />
          <section className="c" aria-labelledby="vio-h">
            <div className="c-head"><h2 id="vio-h">Policy gate</h2><span className="r"><span className="chip" data-b={v.violations.length ? "danger" : "ok"}>{v.violations.length ? `${v.violations.length} to fix` : "All rules pass"}</span></span></div>
            {v.violations.length ? (
              <ul className="vio-list">{v.violations.map((x, i) => <li key={i}><b>{x.rule}</b> {x.message}</li>)}</ul>
            ) : <p className="small muted">All ten pre-signature rules pass for revision {v.revision}.</p>}
          </section>
          <section className="c" aria-labelledby="risk-h">
            <div className="c-head"><h2 id="risk-h">Risk score</h2><span className="r"><span className="risk-score" {...(d.risk.score >= RISK_OPS_THRESHOLD ? { "data-high": "" } : {})}>{d.risk.score}</span></span></div>
            <p className="small muted">{d.risk.score >= RISK_OPS_THRESHOLD ? `At ${RISK_OPS_THRESHOLD} or more, Operations reviews the contract after both sign (within 2 hours).` : `Below ${RISK_OPS_THRESHOLD}: the contract locks as soon as both sign.`} Provider tier: {d.providerTier}.</p>
            <div className="risk-parts">
              {RISK_PARTS.map(([k, w, label]) => {
                const part = d.risk.parts[k] ?? 0;
                return (
                  <div className="risk-part" key={k}>
                    <span>{label}</span><b>{Math.round(100 * w * part)} / {Math.round(100 * w)}</b>
                    <div className="prog" aria-hidden="true"><i style={{ width: `${Math.round(part * 100)}%` }} /></div>
                  </div>
                );
              })}
            </div>
            <RiskFormula score={d.risk.score} parts={d.risk.parts} />
          </section>
          {v.state === "LOCKED" || v.tranches.length ? <Tranches v={v} party={party} /> : null}
        </div>

        {coRoom && <ChangeOrders wsId={v.id} revision={v.revision} room={coRoom} party={party} proposeAction={proposeChangeOrderAction} signAction={signChangeOrderAction} declineAction={declineChangeOrderAction} />}

        {v.state === "LOCKED" && party && !chain.next && <ContinuePanel wsId={v.id} title={v.title} periodNo={chain.periodNo} carryable={carry} blocked={coRoom?.open ? `Change order ${coRoom.open.no} is open; sign, decline or withdraw it before starting the next period.` : null} action={continueAction} />}

        <section className="c span12" id="deadline" aria-labelledby="dl-h">
          <div className="c-head"><h2 id="dl-h">Deadline terms</h2><span className="r"><DeadlineChip t={v.deadline ?? null} /></span></div>
          {!editable && <DeadlineSummary t={v.deadline ?? null} />}
          <DeadlineTermsForm key={`${v.revision}`} workspaceId={v.id} revision={v.revision} totalCents={v.totalCents} terms={v.deadline ?? null} editable={editable} action={setDeadlineTermsAction}
            milestones={pay.map((m) => ({ code: m.code, title: m.title, amountCents: m.amountCents, targetDay: m.targetDay, trancheIdx: m.trancheIdx }))} />
        </section>

        <section className="c span7" aria-labelledby="cl-h">
          <div className="c-head"><h2 id="cl-h">Clauses</h2><span className="r small muted">System clauses are always on</span></div>
          <Clauses v={v} editable={editable} />
        </section>

        <section className="c span5" aria-labelledby="rev-h">
          <div className="c-head"><h2 id="rev-h">Revision history</h2></div>
          {editable && (
            <form action={setTotalAction} className="row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="wsId" value={v.id} /><input type="hidden" name="rev" value={v.revision} />
              <div className="field"><label htmlFor="total">Contract total (USD)</label><input id="total" name="total" inputMode="decimal" defaultValue={(v.totalCents / 100).toFixed(2)} /></div>
              <button className="btn btn-sm">Change total</button>
            </form>
          )}
          {d.diff && <DiffBox d={d} />}
          <ol className="rev-list">
            {d.revisions.map((r) => (
              <li key={r.revNo}>
                <span className="rev-no">r{r.revNo}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{changeLabel(r, v)}<br /><span className="muted small">{r.authorName} · {fmt(r.createdAt)}</span></span>
                <code className="hash">{r.hash.slice(0, 8)}</code>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

function DeadlineChip({ t }: { t: DeadlineTerms | null }) {
  if (!t) return <span className="chip" data-b="none">Off</span>;
  return <span className="chip" data-b="ok">{[t.late && "Late deduction on", t.early && "Early bonus on"].filter(Boolean).join(" · ")}</span>;
}
function DeadlineSummary({ t }: { t: DeadlineTerms | null }) {
  if (!t) return <p className="small muted">No deadline terms in this contract: each milestone pays its amount whenever it is approved.</p>;
  return (
    <ul className="small">
      {t.late && <li>Late: {pct(t.late.rateBps)} of the milestone per counted day after {t.late.graceDays} grace day{t.late.graceDays === 1 ? "" : "s"}, up to {pct(t.late.capBps)}; {t.late.milestones === "ALL" ? "every payment milestone" : t.late.milestones.join(", ")}.</li>}
      {t.early && <li>Early: {pct(t.early.rateBps)} per day from {t.early.minDaysEarly} days early, up to {pct(t.early.capBps)}, from a {formatCents(t.early.poolCents)} pool funded with the hold; {t.early.milestones === "ALL" ? "every payment milestone" : t.early.milestones.join(", ")}.</li>}
    </ul>
  );
}

function MoneyLine({ v }: { v: View }) {
  if (!v.tranches.length) {
    const first = v.milestones.filter((m) => m.active && m.type === "PAY" && m.trancheIdx === 1).reduce((x, m) => x + m.amountCents, 0);
    return <p className="notice">No money is held yet. After both parties sign revision {v.revision}, the client funds tranche 1 ({formatCents(first)}) through PayPal before work starts.</p>;
  }
  const t = v.tranches[0];
  const pool = v.bonusPools?.[t.id] ?? 0;
  const plus = pool > 0 ? ` plus a ${formatCents(pool)} early-finish bonus pool` : "";
  if (t.state === "PLANNED") return <p className="notice" data-b="ok">Locked. Nothing is held yet: tranche {t.idx} ({formatCents(t.amountCents)}{plus}) is ready for the client to fund through PayPal.</p>;
  if (t.state === "HELD" || t.state === "PARTIALLY_RELEASED") return <p className="notice" data-b="ok">{formatCents(t.amountCents)}{plus} for tranche {t.idx} is held in PayPal. Each milestone is released only on the client&apos;s signed approval.</p>;
  return <p className="notice">Tranche {t.idx} ({formatCents(t.amountCents)}): <TrancheChip state={t.state} /></p>;
}

function MilestoneItem({ m, v, editable }: { m: Ms; v: View; editable: boolean }) {
  return (
    <li className="ms" data-type={m.type} {...(!m.active ? { "data-pruned": "" } : {})}>
      <div className="ms-head">
        <span className="ms-code">{m.code}</span>
        <span className="ms-title">{v.state === "LOCKED" && m.active ? <Link href={`/contracts/${v.id}/m/${m.id}`}>{m.title}</Link> : m.title}</span>
        <span className="chip" data-b={m.type === "PAY" ? "plain" : "none"}>{m.type === "PAY" ? "Payment" : "Information step"}</span>
        <span className="chip" data-b={m.origin === "CUSTOM" ? "warn" : "plain"}>{m.origin === "CUSTOM" ? "Custom" : "Baseline"}</span>
        {!m.active ? <span className="chip" data-b="none">{v.state === "LOCKED" && m.state !== "DRAFT" ? "Removed by change order" : "Pruned"}</span> : v.state === "LOCKED" ? <MsChip state={m.state} /> : null}
      </div>
      <div className="ms-nums">
        <span>Day <b>{m.targetDay}</b></span>
        {m.type === "PAY" && <span>Share <b>{pct(m.bps)}</b></span>}
        {m.type === "PAY" && m.active && <span>Amount <b className="money">{formatCents(m.amountCents)}</b></span>}
        {m.dependsOn.length > 0 && <span>After {m.dependsOn.join(", ")}</span>}
      </div>
      <details>
        <summary>Proof, lock rule and dispute rule</summary>
        <div className="ms-spec">
          <div><h4>Proof the provider uploads</h4>
            {m.proof.artifacts.length ? <ul>{m.proof.artifacts.map((x, i) => <li key={i}>{x.min} × {artifactLabel(x.kind)}{x.note ? ` — ${x.note}` : ""}</li>)}</ul> : <p className="muted">No artifacts named.</p>}
            {m.proof.oracle && <p>Checked by oracle: {m.proof.oracle}</p>}
            {m.proof.gpsRadiusM && <p>Location within {m.proof.gpsRadiusM} m of the site</p>}
          </div>
          <div><h4>Acceptance criteria</h4>{m.proof.criteria.length ? <ul>{m.proof.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="muted">None yet.</p>}</div>
          <div><h4>Lock rule</h4><p>{m.lockRule || <span className="muted">Missing</span>}</p><h4 style={{ marginTop: 6 }}>Dispute rule</h4><p>{m.disputeRule || <span className="muted">Missing</span>}</p></div>
        </div>
      </details>
      {editable && (
        <div className="ms-edit">
          {m.active && (
            <form action={editMilestoneAction} className="row" style={{ alignItems: "flex-end" }}>
              <input type="hidden" name="wsId" value={v.id} /><input type="hidden" name="rev" value={v.revision} /><input type="hidden" name="code" value={m.code} />
              <input type="hidden" name="oldDay" value={m.targetDay} /><input type="hidden" name="oldBps" value={m.bps} />
              <div className="field"><label htmlFor={`d-${m.id}`}>Day</label><input id={`d-${m.id}`} name="day" type="number" min={1} max={365} defaultValue={m.targetDay} /></div>
              {m.type === "PAY" && <div className="field"><label htmlFor={`s-${m.id}`}>Share %</label><input id={`s-${m.id}`} name="share" inputMode="decimal" defaultValue={(m.bps / 100).toFixed(2)} /></div>}
              <button className="btn btn-sm">Save</button>
            </form>
          )}
          <span className="sp" />
          <form action={m.active ? pruneAction : restoreAction}>
            <input type="hidden" name="wsId" value={v.id} /><input type="hidden" name="rev" value={v.revision} /><input type="hidden" name="code" value={m.code} />
            <button className="btn btn-sm btn-gh" aria-label={`${m.active ? "Prune" : "Restore"} ${m.code} ${m.title}`}>{m.active ? "Prune" : "Restore"}</button>
          </form>
        </div>
      )}
    </li>
  );
}

function AppendMilestone({ v }: { v: View }) {
  return (
    <details className="ms">
      <summary><b>Append a milestone</b> <span className="muted small">— it becomes a custom step in a new revision</span></summary>
      <form action={appendMilestoneAction} className="form-grid" style={{ paddingTop: 10 }}>
        <input type="hidden" name="wsId" value={v.id} /><input type="hidden" name="rev" value={v.revision} />
        <div className="field wide"><label htmlFor="am-title">Title</label><input id="am-title" name="title" required minLength={3} maxLength={140} placeholder="Client provides system access" /></div>
        <div className="field"><label htmlFor="am-type">Kind</label><select id="am-type" name="type" defaultValue="PAY"><option value="PAY">Payment</option><option value="GATE">Information step (no money)</option></select></div>
        <div className="field"><label htmlFor="am-day">Target day</label><input id="am-day" name="day" type="number" min={1} max={365} required defaultValue={10} /></div>
        <div className="field"><label htmlFor="am-share">Share % (payment only)</label><input id="am-share" name="share" inputMode="decimal" defaultValue="0" /></div>
        <div className="field"><label htmlFor="am-after">Place after</label><select id="am-after" name="afterCode" defaultValue=""><option value="">At the end</option>{v.milestones.map((m) => <option key={m.id} value={m.code}>{m.code} {m.title}</option>)}</select></div>
        <div className="field"><label htmlFor="am-art">Proof artifact</label><select id="am-art" name="artifact" defaultValue="PDF">{["PDF", "IMAGE", "VIDEO", "LOG", "LINK", "SIGNATURE"].map((k) => <option key={k} value={k}>{artifactLabel(k)}</option>)}</select></div>
        <div className="field"><label htmlFor="am-min">How many</label><input id="am-min" name="min" type="number" min={0} max={50} defaultValue={1} /></div>
        <div className="field"><label htmlFor="am-note">What the artifact shows</label><input id="am-note" name="artifactNote" maxLength={200} placeholder="Test report with ≥ 95% passed" /></div>
        <div className="field wide"><label htmlFor="am-crit">Acceptance criteria (one per line)</label><textarea id="am-crit" name="criteria" placeholder={"Every item in scope is listed\nClient confirms access works"} /></div>
        <div className="field"><label htmlFor="am-lock">Lock rule</label><input id="am-lock" name="lockRule" required maxLength={300} placeholder="Client approves." /></div>
        <div className="field"><label htmlFor="am-disp">Dispute rule</label><input id="am-disp" name="disputeRule" required maxLength={300} placeholder="Missing items fixed within 72 hours." /></div>
        <div className="row wide"><button className="btn btn-g btn-sm">Append milestone</button><span className="small muted">Adding a step voids any signature on the current revision.</span></div>
      </form>
    </details>
  );
}

function Clauses({ v, editable }: { v: View; editable: boolean }) {
  /* The two deadline clauses are shown (and changed) in the Deadline terms panel */
  const cat = (c: "SYSTEM" | "BASELINE" | "CUSTOM") => v.clauses.filter((k) => k.category === c && !DEADLINE_CLAUSE_CODES.includes(k.code));
  const Toggle = ({ code, on }: { code: string; on: boolean }) => (
    <form action={toggleClauseAction}>
      <input type="hidden" name="wsId" value={v.id} /><input type="hidden" name="rev" value={v.revision} /><input type="hidden" name="code" value={code} /><input type="hidden" name="active" value={on ? "0" : "1"} />
      <button className="btn btn-sm btn-gh" aria-label={`${on ? "Switch off" : "Switch on"} clause ${code}`}>{on ? "Switch off" : "Switch on"}</button>
    </form>
  );
  return (
    <div className="stack">
      <p className="cl-h">System — locked</p>
      <ul className="cl-list">{cat("SYSTEM").map((k) => <li className="cl" key={k.id}><div className="cl-tx"><div className="cl-title">{k.title}</div>{k.body}</div><span className="chip" data-b="plain">Locked</span></li>)}</ul>
      <p className="cl-h">Baseline — from the blueprint</p>
      <ul className="cl-list">{cat("BASELINE").map((k) => (
        <li className="cl" key={k.id} {...(!k.active ? { "data-off": "" } : {})}>
          <div className="cl-tx"><div className="cl-title">{k.title} {k.protective && <span className="chip" data-b="ok">Protective</span>}</div>{k.body}</div>
          {editable ? <Toggle code={k.code} on={k.active} /> : <span className="chip" data-b={k.active ? "plain" : "none"}>{k.active ? "On" : "Off"}</span>}
        </li>
      ))}</ul>
      <p className="cl-h">Custom — appended by the parties</p>
      {cat("CUSTOM").length ? <ul className="cl-list">{cat("CUSTOM").map((k) => (
        <li className="cl" key={k.id} {...(!k.active ? { "data-off": "" } : {})}>
          <div className="cl-tx"><div className="cl-title">{k.title} <span className="ms-code">{k.code}</span></div>{k.body}</div>
          {editable ? <Toggle code={k.code} on={k.active} /> : <span className="chip" data-b={k.active ? "plain" : "none"}>{k.active ? "On" : "Off"}</span>}
        </li>
      ))}</ul> : <p className="small muted">No custom clauses yet.</p>}
      {editable && (
        <details>
          <summary className="small"><b>Add a custom clause</b></summary>
          <form action={appendClauseAction} className="form-grid" style={{ paddingTop: 10 }}>
            <input type="hidden" name="wsId" value={v.id} /><input type="hidden" name="rev" value={v.revision} />
            <div className="field"><label htmlFor="ac-title">Title</label><input id="ac-title" name="title" required minLength={3} maxLength={120} /></div>
            <div className="field"><label htmlFor="ac-link">Linked milestone (optional)</label><select id="ac-link" name="linked" defaultValue=""><option value="">None</option>{v.milestones.filter((m) => m.active).map((m) => <option key={m.id} value={m.code}>{m.code} {m.title}</option>)}</select></div>
            <div className="field wide"><label htmlFor="ac-body">Clause text</label><textarea id="ac-body" name="body" required minLength={5} maxLength={2000} /></div>
            <div className="row wide"><button className="btn btn-sm">Add clause</button><span className="small muted">Text that tries to override a system clause is blocked by rule R07.</span></div>
          </form>
        </details>
      )}
    </div>
  );
}

function Signatures({ d, party, iSigned, counterpart, net }: { d: WorkspaceDetail; party: "client" | "provider" | null; iSigned: boolean; counterpart: string; net: NetworkSignal | null }) {
  const v = d.view;
  const canSign = party !== null && SIGNABLE.includes(v.state) && !iSigned;
  const blocked = v.violations.length > 0;
  return (
    <section className="c" aria-labelledby="sig-h">
      <div className="c-head"><h2 id="sig-h">Signatures</h2></div>
      <p className="small muted">Both parties sign the same revision and hash. Any change after a signature voids it.</p>
      {d.signatureRows.length ? (
        <ul className="rev-list">{d.signatureRows.map((s, i) => (
          <li key={i}>
            <span style={{ flex: 1 }}><b>{s.signerName}</b> ({s.role}) signed r{s.revNo}{s.mfa ? " with MFA" : ""}<br /><span className="muted small">{fmt(s.at)}{s.voidedAtRev !== null ? ` · voided at revision ${s.voidedAtRev}` : ""}</span></span>
            <code className="hash">{s.hashPrefix}</code>
          </li>
        ))}</ul>
      ) : <p className="small muted">No signatures yet.</p>}
      {v.state === "PARTIALLY_SIGNED" && iSigned && <p className="notice small">Waiting for {counterpart} to countersign revision {v.revision}.</p>}
      {v.state === "PENDING_OPS" && <p className="notice small" data-b="warn">Both signed. Operations reviews high-risk contracts within 2 hours before they lock.</p>}
      {net && net.level !== "none" && <p className="notice small" data-b="warn" role="note"><b>Same network seen for both parties.</b> {net.summary} This is a warning only; signing is not blocked.</p>}
      {canSign && v.canonicalHash && (
        <form action={signAction} className="stack">
          <input type="hidden" name="wsId" value={v.id} /><input type="hidden" name="rev" value={v.revision} /><input type="hidden" name="hash" value={v.canonicalHash} />
          <div className="field"><label htmlFor="mfa">Authenticator code <span className="muted">(if you have MFA set up)</span></label><input id="mfa" name="mfa" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" /></div>
          <button className="btn btn-g" disabled={blocked} aria-describedby="sig-hash">Sign revision {v.revision}</button>
          <p id="sig-hash" className="small muted">You sign hash <code className="hash">{v.canonicalHash.slice(0, 16)}</code>{blocked ? " — fix the policy gate items first." : "."}</p>
        </form>
      )}
    </section>
  );
}

function Tranches({ v, party }: { v: View; party: "client" | "provider" | null }) {
  return (
    <section className="c" aria-labelledby="tr-h">
      <div className="c-head"><h2 id="tr-h">Tranches</h2></div>
      <ul className="rev-list">{v.tranches.map((t) => (
        <li key={t.id}>
          <span style={{ flex: 1 }}><b>Tranche {t.idx}</b> · days {t.startDay}–{t.endDay}<br /><span className="money">{formatCents(t.amountCents)}</span>{(v.bonusPools?.[t.id] ?? 0) > 0 && <span className="small muted"> + {formatCents(v.bonusPools![t.id])} bonus pool</span>} <TrancheChip state={t.state} /></span>
          {party === "client" && t.state === "PLANNED" && <Link className="btn btn-g btn-sm" href={`/contracts/${v.id}/fund/${t.id}`}>Fund tranche</Link>}
        </li>
      ))}</ul>
    </section>
  );
}

function DiffBox({ d }: { d: WorkspaceDetail }) {
  const x = d.diff!;
  const items: string[] = [];
  if (x.pruned.length) items.push(`Pruned: ${x.pruned.join(", ")}`);
  if (x.restored.length) items.push(`Restored: ${x.restored.join(", ")}`);
  if (x.appended.length) items.push(`Appended: ${x.appended.join(", ")}`);
  for (const c of x.changed) items.push(`Changed ${c.code}: ${c.fields.map((f) => (f === "bps" ? "share" : f)).join(", ")}`);
  if (x.clausesOff.length) items.push(`Clauses switched off: ${x.clausesOff.join(", ")}`);
  if (x.clausesOn.length) items.push(`Clauses switched on: ${x.clausesOn.join(", ")}`);
  if (x.clausesAdded.length) items.push(`Clauses added: ${x.clausesAdded.join(", ")}`);
  if (x.totalChanged) items.push(`Total: ${formatCents(x.totalChanged.from)} → ${formatCents(x.totalChanged.to)}`);
  if (x.deadlineChanged) items.push("Deadline terms changed");
  return (
    <div className="notice">
      <b className="small">Compared with revision 1</b>
      {items.length ? <ul className="diff-list">{items.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="small muted">Same terms as revision 1.</p>}
    </div>
  );
}

function changeLabel(r: RevisionRow, v: View): string {
  const det = (r.change.detail ?? {}) as Record<string, unknown>;
  const t = r.change.target ?? "";
  const title = (code: string) => v.milestones.find((m) => m.code === code)?.title ?? "";
  switch (r.change.action) {
    case "CREATE": if (det.source === "continuation") return `Created as period ${String(det.periodNo ?? "")}, continuing the previous contract${Array.isArray(det.carried) && det.carried.length ? ` (carries ${det.carried.join(", ")})` : ""}`;
      return det.source === "ai_draft" ? `Created from an AI draft (blueprint ${String(det.blueprint ?? "")})` : `Created from blueprint ${String(det.blueprint ?? v.blueprintCode)}`;
    case "PRUNE": return `Pruned ${t} ${title(t)}`;
    case "RESTORE": return `Restored ${t} ${title(t)}`;
    case "APPEND": return `Appended ${t} ${title(t)}`;
    case "SET_BPS": { const sh = (det.shares ?? {}) as Record<string, number>; return `Changed share: ${Object.entries(sh).map(([k, b]) => `${k} → ${pct(Number(b))}`).join(", ")}`; }
    case "SET_DAY": return `Moved ${t} to day ${String(det.day ?? "")}`;
    case "TOGGLE_CLAUSE": return `Switched clause ${t} ${det.active ? "on" : "off"}`;
    case "APPEND_CLAUSE": return `Added clause ${t} “${String(det.title ?? "")}”`;
    case "SET_TOTAL": return `Changed total to ${formatCents(Number(det.totalCents ?? 0))}`;
    case "ATTACH_PROVIDER": return "Provider joined from the e-mail invite";
    case "CHANGE_ORDER": return `Change order ${String(det.no ?? t.replace(/^CO/, ""))} signed by both parties${det.note ? `: “${String(det.note)}”` : ""}`;
    case "SET_DEADLINE_TERMS": { const tm = det.terms as DeadlineTerms | null | undefined; return tm ? `Set deadline terms: ${[tm.late && `late ${pct(tm.late.rateBps)}/day after ${tm.late.graceDays} grace, cap ${pct(tm.late.capBps)}`, tm.early && `early ${pct(tm.early.rateBps)}/day, pool ${formatCents(tm.early.poolCents)}`].filter(Boolean).join("; ")}` : "Switched the deadline terms off"; }
    default: return r.change.action;
  }
}
