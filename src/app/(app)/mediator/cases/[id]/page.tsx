/**
 * Three-pane arbitration workbench (F4.06): contract clauses, dispute rule and contract diff | evidence,
 * rebuttals and marks (F4.03, F4.04) | verdict panel with the AI proposal labelled as advice (A4, P3), split to the cent
 * (F4.07), disposition (F4.09), root cause (F4.12), co-sign above $5,000, settlement legs (F4.08).
 * "why this mediator" breakdown, accept/decline of an open offer, co-sign reasons (probation) and Senior-only co-sign,
 * and the mediator's own fee (paid by PaySettle from its fee income).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import "@/styles/disputes.css";
import "@/styles/mediators.css";
import { requireViewer } from "@/lib/session";
import { disputeCase, workbenchExtras } from "@/server/disputes/queries";
import { COSIGN_ABOVE_CENTS, REASONS, ROOT_CAUSES, mediationFeeCents } from "@/server/disputes/rules";
import { cosignAction, extendAction, sealNowAction } from "@/server/disputes/actions";
import { VerdictPanel } from "@/components/disputes/verdict-panel";
import { Events, External, Flash, Legs, StateChip, Timeline, Vault, VerdictSummary, WhereMoney } from "@/components/disputes/parts";
import { money, pctOf, when } from "@/components/disputes/format";
import { splitDispute } from "@/lib/money";
import { signerOutlook } from "@/server/mediators";
import { COSIGN_REASON_LABEL, STATUS_LABEL } from "@/server/mediators/rules";
import { acceptOfferAction, declineOfferAction } from "@/server/mediators/actions";
import { WhyMediator } from "@/components/disputes/why-mediator";

export const metadata = { title: "Workbench" };

interface Ai { available?: boolean; reason?: string | null; model?: string | null; confidence?: number | null; at?: string; data?: { providerShareBps: number; findings: string[]; missing: string[]; confidence: number } | null }

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const v = await requireViewer(["mediator", "judge", "ops", "admin"]);
  const { id } = await params;
  const q = await searchParams;
  const c = await disputeCase(v, id);
  if (!c) notFound();
  const x = await workbenchExtras(c);
  const cur = c.workspace.currency;
  const ai = (c.d.aiProposal ?? null) as Ai | null;
  const judge = v.role === "judge";
  const canSign = c.d.state === "TIER3" && !c.verdict && (judge || (v.role === "mediator" && (c.d.mediatorId === v.id || !c.d.mediatorId)));
  const disabled = c.d.state === "TIER1" || c.d.state === "TIER2" ? `The parties are still in ${c.d.state === "TIER1" ? "Tier 1" : "Tier 2"}. The verdict panel opens when the vault seals (${when(c.vaultEnd)}).`
    : !canSign && !c.verdict ? "This case is assigned to another mediator." : null;
  const me = v.role === "mediator" ? await signerOutlook(v.id, v.orgId, c.d.amountCents, COSIGN_ABOVE_CENTS) : null;
  const seniorOk = !me || !me.network || me.status === "SENIOR";
  const canCosign = c.cosignOpen && (judge || (v.role === "mediator" && c.verdict?.mediatorId !== v.id && seniorOk));
  const conf = ai?.data?.confidence ?? ai?.confidence ?? null;
  const myOffer = v.role === "mediator" ? c.assignment.offers.find((o) => o.mediatorId === v.id && o.answer === null) ?? null : null;
  const willNeed = judge ? (c.d.amountCents > COSIGN_ABOVE_CENTS ? ["HIGH_VALUE" as const] : []) : me?.reasons ?? [];

  return (
    <>
      <div className="phead">
        <div>
          <p className="crumb"><Link href="/mediator/cases">Case queue</Link> › {c.workspace.title}</p>
          <h1>{c.milestone.code} · {c.milestone.title}</h1>
          <p className="sub">{c.clientName} (client) and {c.providerName} (provider) · {REASONS[c.d.reason as keyof typeof REASONS] ?? c.d.reason} · {c.mediatorName ? `assigned to ${c.mediatorName}` : "unassigned"}</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v money">{money(c.d.amountCents, cur)}</div><div className="l">Frozen{c.d.amountCents > COSIGN_ABOVE_CENTS ? " · two signatures" : ""}</div></div>
          <div className="hstat"><div className="v" style={{ fontSize: 18 }}><StateChip state={c.d.state} /></div><div className="l">Verdict due {when(c.meta?.tier3Until)}</div></div>
        </div>
      </div>
      <Flash ok={q.ok} error={q.error} />
      {myOffer && !c.verdict && (
        <section className="c" aria-labelledby="wb-offer">
          <div className="c-head"><h2 id="wb-offer">This case is offered to you</h2><span className="chip" data-b="warn">Answer by {when(myOffer.expiresAt)}</span></div>
          <p>Accept to take the sealed dossier, or decline with a short reason so the next mediator in the ranking gets it at once. Signing a verdict also counts as accepting.</p>
          <div className="md-offer">
            <form action={acceptOfferAction}><input type="hidden" name="offerId" value={myOffer.id} /><button className="btn btn-g" type="submit">Accept the case</button></form>
            <form action={declineOfferAction}>
              <input type="hidden" name="offerId" value={myOffer.id} />
              <div className="field"><label htmlFor="wb-dr">Reason for declining</label><input id="wb-dr" name="reason" required minLength={3} maxLength={300} placeholder="For example: on site visits all week" /></div>
              <button className="btn btn-gh" type="submit">Decline</button>
            </form>
          </div>
        </section>
      )}
      <section className="c" aria-label="Stages"><Timeline c={c} /></section>

      <div className="dz-bench">
        {/* pane 1: the contract */}
        <section className="c" aria-labelledby="wb-k">
          <div className="c-head"><h2 id="wb-k">Contract</h2><div className="r"><Link className="small" href={`/disputes/${c.d.id}`}>Dispute room</Link></div></div>
          <dl className="kv">
            <div><dt>Dispute rule</dt><dd>{c.milestone.disputeRule}</dd></div>
            <div><dt>Lock rule</dt><dd>{c.milestone.lockRule}</dd></div>
            <div><dt>Proof asked for</dt><dd>{c.milestone.proof.artifacts.map((a) => `${a.min} × ${a.kind.toLowerCase()}${a.note ? ` (${a.note})` : ""}`).join(", ") || "—"}{c.milestone.proof.oracle && <small>Oracle: {c.milestone.proof.oracle}</small>}</dd></div>
          </dl>
          {c.milestone.proof.criteria.length > 0 && <div className="stack" style={{ gap: 4 }}><b className="small">Acceptance criteria</b><ul className="dz-diff">{c.milestone.proof.criteria.map((k) => <li key={k}>{k}</li>)}</ul></div>}
          <div className="stack" style={{ gap: 4 }}>
            <b className="small">Changes from the blueprint ({x.blueprintTitle}) · {x.revisions} revision{x.revisions === 1 ? "" : "s"}</b>
            {x.diff.length ? <ul className="dz-diff">{x.diff.map((d, i) => <li key={i} data-k={d.kind}>{d.text}</li>)}</ul> : <p className="small muted">Signed as the blueprint baseline: nothing pruned, appended or re-weighted.</p>}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Clauses</b>
            {x.clauses.map((k) => (
              <div key={k.id} className="dz-clause" data-off={k.active ? undefined : ""}>
                <div className="row"><b>{k.code}</b><span className="chip" data-b="plain">{k.category.toLowerCase()}</span>{!k.active && <span className="chip" data-b="none">off</span>}{k.protective && <span className="chip" data-b="ok">protective</span>}</div>
                <span>{k.title}: {k.body}</span>
              </div>
            ))}
          </div>
        </section>

        {/* pane 2: evidence */}
        <section className="c" aria-labelledby="wb-e">
          <div className="c-head"><h2 id="wb-e">Evidence and rebuttals</h2></div>
          <div className="dz-reb" data-role={c.d.openedBy === c.workspace.clientId ? "client" : "provider"}>
            <div className="row"><b>Opening statement</b><span className="small muted">by {c.names[c.d.openedBy] ?? c.d.openedBy}</span></div>
            <p className="dz-pre">{c.d.narrative}</p>
          </div>
          <Vault c={c} fileHref={(sha) => `/disputes/${c.d.id}/file/${sha}`} />
          <p className="small muted">Tier 1: {c.roundsDone} sealed round{c.roundsDone === 1 ? "" : "s"} without agreement{c.meta?.skippedBy ? ` · ${c.meta.skippedBy} skipped to the vault` : ""}. Sealed offers stay hidden.</p>
          <div className="stack"><b className="small">Activity</b><Events c={c} /></div>
        </section>

        {/* pane 3: verdict */}
        <section className="c" aria-labelledby="wb-v">
          <div className="c-head"><h2 id="wb-v">Verdict</h2></div>
          <WhereMoney c={c} />
          {c.d.state !== "TIER1" && c.d.state !== "TIER2" && (
            <div className="dz-ai" aria-labelledby="wb-ai">
              <div className="row"><b id="wb-ai">{ai?.available ? "AI mediator proposal" : "Rule-based proposal"}</b><span className="chip" data-b="warn">Advice — not a decision</span></div>
              {!ai?.available && ai?.reason && <p className="small muted">AI unavailable: {ai.reason}</p>}
              {ai?.data ? (
                <>
                  <p><b>{pctOf(ai.data.providerShareBps)}</b> to the provider would be <span className="money">{money(splitDispute(c.d.amountCents, ai.data.providerShareBps).releaseCents, cur)}</span>.</p>
                  {conf !== null && <div className="stack" style={{ gap: 4 }}><span className="small muted">Confidence {Math.round(conf * 100)}%</span><div className="dz-conf" aria-hidden="true"><i style={{ width: `${Math.round(conf * 100)}%` }} /></div></div>}
                  {ai.data.findings.length > 0 && <><span className="small"><b>Findings</b></span><ul>{ai.data.findings.map((f, i) => <li key={i}>{f}</li>)}</ul></>}
                  {ai.data.missing.length > 0 && <><span className="small"><b>Missing evidence</b></span><ul>{ai.data.missing.map((f, i) => <li key={i}>{f}</li>)}</ul></>}
                  <p className="small muted">{ai.model ?? "model"} · {when(ai.at)}. You decide and sign; the proposal is never carried out.</p>
                </>
              ) : <p className="small muted">No proposal for this case. Decide from the dossier.</p>}
            </div>
          )}
          {!c.verdict && (
            <VerdictPanel disputeId={c.d.id} amountCents={c.d.amountCents} currency={cur} aiShareBps={ai?.data ? ai.data.providerShareBps : null}
              feeCents={mediationFeeCents()} needsCosign={willNeed.length > 0} cosignWhy={willNeed.map((r) => COSIGN_REASON_LABEL[r]).join(" and ")} mediatorFee={me ? me.fee : null}
              rootCauses={Object.entries(ROOT_CAUSES).filter(([k]) => k !== "AGREED_TIER1").map(([code, label]) => ({ code, label }))}
              inProgress={x.parallel.map((m) => `${m.code} ${m.title}`)} disabled={disabled} />
          )}
          {c.verdict && <VerdictSummary c={c} />}
          {canCosign && (
            <form action={cosignAction} className="stack">
              <input type="hidden" name="disputeId" value={c.d.id} />
              <p className="notice">This verdict needs a second mediator because {c.cosignReasons.map((r) => COSIGN_REASON_LABEL[r]).join(" and ") || "the amount is above $5,000"}.{me ? ` Your co-signature fee: ${money(me.cosignFeeCents, cur)}, paid by PaySettle.` : ""} Co-signing starts the settlement: {money(c.verdict!.refundCents, cur)} back to the client, then {money(c.verdict!.releaseCents, cur)} to the provider.</p>
              <div className="row"><button className="btn btn-g" type="submit">Co-sign verdict</button></div>
            </form>
          )}
          {c.cosignOpen && !canCosign && <p className="notice">Waiting for a second, different mediator to co-sign{c.cosignReasons.length ? ` (${c.cosignReasons.map((r) => COSIGN_REASON_LABEL[r]).join(" and ")})` : ""}. {me?.network && me.status !== "SENIOR" && c.verdict?.mediatorId !== v.id ? `Co-signers must be Senior; you are ${me.status ? STATUS_LABEL[me.status] : "not in the network"}. ` : ""}No money moves until then.</p>}
          {c.verdict && <Legs c={c} back={`/mediator/cases/${c.d.id}`} />}
          {(c.d.state === "TIER3" && (c.d.mediatorId === v.id || judge)) && (
            <form action={extendAction} className="row">
              <input type="hidden" name="disputeId" value={c.d.id} />
              <label className="small" htmlFor="wb-h">Allow late evidence for</label>
              <input id="wb-h" name="hours" type="number" min={1} max={48} defaultValue={24} className="input dz-num" />
              <span className="small">hours</span>
              <button className="btn btn-sm" type="submit">Allow</button>
              {c.meta?.vaultExtendedUntil && <span className="small muted">Open until {when(c.meta.vaultExtendedUntil)}</span>}
            </form>
          )}
          {judge && c.d.state === "TIER2" && (
            <form action={sealNowAction}><input type="hidden" name="disputeId" value={c.d.id} /><input type="hidden" name="back" value={`/mediator/cases/${c.d.id}`} /><button className="btn btn-sm btn-gh" type="submit">Seal the vault now (sandbox judge)</button></form>
          )}
        </section>
      </div>
      <WhyMediator a={c.assignment} detail="full" now={c.now} />
      <External c={c} />
    </>
  );
}
