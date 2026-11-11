/** Server-rendered parts shared by the dispute room and the mediator workbench. F4.01 F4.02 F4.03 F4.04 F4.08 F4.10. */
import Link from "next/link";
import type { DisputeCase } from "@/server/disputes/queries";
import { retryAction } from "@/server/disputes/actions";
import { COSIGN_REASON_LABEL } from "@/server/mediators/rules";
import { DISPUTE_STATE, EVENT_LABEL, LEG_LABEL, MS_LABEL, left, legChip, money, msClass, pctOf, when } from "./format";

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <p className="notice" data-b="danger" role="alert">{error}</p>;
  if (ok) return <p className="notice" data-b="ok" role="status">{ok}</p>;
  return null;
}

export function StateChip({ state }: { state: string }) {
  const s = DISPUTE_STATE[state] ?? { label: state, chip: "plain" };
  return <span className="chip" data-b={s.chip}>{s.label}</span>;
}

/** Tier timeline with deadlines on the workspace's clock (F4.01). */
export function Timeline({ c }: { c: DisputeCase }) {
  const s = c.d.state;
  const order = ["TIER1", "TIER2", "TIER3", "SETTLE"];
  const at = s === "AGREED" || s === "EXECUTING" || s === "RESOLVED" ? 3 : Math.max(0, order.indexOf(s));
  const skippedT2 = s === "AGREED" || c.verdict?.origin === "TIER1";
  const steps = [
    { key: "TIER1", title: "Tier 1 · sealed offers", sub: `Up to 3 rounds · until ${when(c.d.tier1Until)}`, until: c.d.tier1Until },
    { key: "TIER2", title: "Tier 2 · evidence vault", sub: skippedT2 ? "Not needed — offers met" : `Write-once · until ${when(c.vaultEnd)}`, until: c.vaultEnd },
    { key: "TIER3", title: "Tier 3 · mediator", sub: skippedT2 ? "Not needed" : c.meta ? `Verdict due ${when(c.meta.tier3Until)}${c.mediatorName ? ` · ${c.mediatorName}` : ""}` : "", until: c.meta?.tier3Until ?? null },
    { key: "SETTLE", title: "Settlement", sub: "Leg 1 refund, then leg 2 release", until: null },
  ];
  return (
    <ol className="dz-tl" aria-label="Dispute stages">
      {steps.map((st, i) => {
        const status = s === "RESOLVED" || i < at ? "done" : i === at ? "now" : "next";
        return (
          <li key={st.key} data-s={status} data-skip={skippedT2 && (st.key === "TIER2" || st.key === "TIER3") ? "" : undefined}>
            <b>{st.title}</b>
            <span className="small muted">{st.sub}</span>
            {status === "now" && st.until && s !== "RESOLVED" && <span className="chip" data-b="warn">{left(c.now, st.until)}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The frozen milestone and every other milestone, unaffected (F4.01 scoped freeze). */
export function Milestones({ c }: { c: DisputeCase }) {
  const cur = c.workspace.currency;
  return (
    <div className="tbwrap">
      <table className="tb">
        <thead><tr><th>Milestone</th><th>State</th><th className="n">Amount</th></tr></thead>
        <tbody>
          {c.milestones.filter((m) => m.active).map((m) => (
            <tr key={m.id} data-dz-on={m.id === c.milestone.id ? "" : undefined}>
              <td><b>{m.code}</b> {m.title}{m.id === c.milestone.id && <span className="small muted"> · this dispute</span>}
                {c.meta?.frozenDependants.includes(m.code) && <span className="small muted"> · waits for {c.milestone.code}</span>}</td>
              <td><span className={`state ${msClass(m.state)}`}>{MS_LABEL[m.state] ?? m.state}</span></td>
              <td className="n money">{m.type === "GATE" ? "—" : money(m.amountCents, cur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Where the money is, in one sentence. */
export function WhereMoney({ c }: { c: DisputeCase }) {
  const cur = c.workspace.currency, amt = money(c.d.amountCents, cur), v = c.verdict;
  if (c.d.state === "SUPERSEDED") return <p>A PayPal dispute on this payment has taken over. PaySettle moves none of the {amt} while PayPal decides.</p>;
  if (c.d.state === "RESOLVED" && v) return <p><span className="money">{money(v.refundCents, cur)}</span> went back to {c.clientName}; <span className="money">{money(v.releaseCents, cur)}</span> was released to {c.providerName}.</p>;
  if (v && (c.d.state === "EXECUTING" || c.d.state === "AGREED")) return <p>Settling {amt}: <span className="money">{money(v.refundCents, cur)}</span> back to the client, <span className="money">{money(v.releaseCents, cur)}</span> to the provider.</p>;
  return <p><span className="money">{amt}</span> is frozen in the PayPal hold for {c.milestone.code} until this dispute ends. Settled milestones stay paid; other milestones carry on.</p>;
}

export function Legs({ c, back }: { c: DisputeCase; back: string }) {
  const v = c.verdict;
  if (!v) return null;
  const cur = c.workspace.currency;
  const stuck = c.d.state === "EXECUTING" && (v.leg1 === "FAILED" || v.leg2 === "FAILED" || (c.meta?.terminated ?? []).some((t) => t.status === "FAILED") || !!c.meta?.legError);
  return (
    <div className="stack">
      <dl className="kv">
        <div><dt>Leg 1 · refund to {c.clientName}</dt><dd><span className="money">{money(v.refundCents, cur)}</span> <span className="chip" data-b={legChip(v.leg1)}>{LEG_LABEL[v.leg1] ?? v.leg1}</span>{c.meta?.leg1Key && <small>Key {c.meta.leg1Key}</small>}</dd></div>
        <div><dt>Leg 2 · release to {c.providerName}</dt><dd><span className="money">{money(v.releaseCents, cur)}</span> <span className="chip" data-b={legChip(v.leg2)}>{LEG_LABEL[v.leg2] ?? v.leg2}</span>{c.meta?.leg2Key && <small>Key {c.meta.leg2Key}</small>}</dd></div>
        {(c.meta?.terminated ?? []).length > 0 && <div><dt>Unstarted milestones returned</dt><dd>{c.meta!.terminated.map((t) => <span key={t.milestoneId} className="row small">{t.code} · {money(t.amountCents, cur)} <span className="chip" data-b={legChip(t.status)}>{LEG_LABEL[t.status] ?? t.status}</span></span>)}</dd></div>}
      </dl>
      {c.meta?.legError && c.d.state !== "RESOLVED" && <p className="notice" data-b="warn">Stopped at {c.meta.legError}. A retry continues where it stopped and never repeats a finished leg.</p>}
      {stuck && <RetryButton disputeId={c.d.id} back={back} />}
    </div>
  );
}

function RetryButton({ disputeId, back }: { disputeId: string; back: string }) {
  return (
    <form action={retryAction}><input type="hidden" name="disputeId" value={disputeId} /><input type="hidden" name="back" value={back} />
      <button className="btn btn-sm" type="submit">Retry settlement</button></form>
  );
}

export function VerdictSummary({ c }: { c: DisputeCase }) {
  const v = c.verdict;
  if (!v) return null;
  return (
    <div className="stack">
      <div className="row"><b>{v.origin === "TIER1" ? "Agreed by both parties" : `Verdict by ${c.names[v.mediatorId ?? ""] ?? "the mediator"}`}</b>
        {v.cosignerId && <span className="chip" data-b="ok">Co-signed by {c.names[v.cosignerId] ?? v.cosignerId}</span>}
        {c.cosignOpen && <span className="chip" data-b="warn">Waiting for a co-signature</span>}</div>
      {c.cosignOpen && c.cosignReasons.length > 0 && <p className="small muted">A second mediator signs because {c.cosignReasons.map((r) => COSIGN_REASON_LABEL[r]).join(" and ")}.</p>}
      <p>{pctOf(v.providerShareBps)} to the provider · {v.disposition === "TERMINATE" ? "contract ended" : "contract resumes"}{v.fault ? ` · fault: ${v.fault.toLowerCase()}` : ""}</p>
      <p className="small dz-pre">{v.findings}</p>
      {c.fee && c.fee.totalCents > 0 && <p className="small muted">Mediation fee {money(c.fee.totalCents, c.workspace.currency)}: client {money(c.fee.clientCents, c.workspace.currency)}, provider {money(c.fee.providerCents, c.workspace.currency)}.</p>}
      {c.mediatorFees.length > 0 && <p className="small muted">Mediator fees {c.mediatorFees.map((f) => `${c.names[f.mediatorId] ?? "mediator"} ${money(f.amountCents, c.workspace.currency)} (${f.role === "COSIGN" ? "co-signature" : `${f.tier.toLowerCase()} verdict`})`).join(", ")}: paid by PaySettle from its own fee income, never from the held amount.</p>}
      <p className="small muted">Signature {v.signature.slice(0, 16)}…</p>
    </div>
  );
}

export function Events({ c }: { c: DisputeCase }) {
  return (
    <ol className="dz-events">
      {c.events.map((e) => (
        <li key={e.seq}><span className="small muted tnum">{when(e.at)}</span> <span>{EVENT_LABEL[e.action] ?? e.action}</span>
          {e.actorId && <span className="small muted"> · {c.names[e.actorId] ?? e.actorRole}</span>}</li>
      ))}
    </ol>
  );
}

/** Evidence from Phase 3 and the vault entries with their marks (F4.03, F4.04). */
export function Vault({ c, fileHref }: { c: DisputeCase; fileHref: (sha: string) => string }) {
  const fileName = (sha: string) => c.evidence.flatMap((p) => p.files).find((f) => f.sha256 === sha)?.name ?? c.files.find((f) => f.sha256 === sha)?.name ?? sha.slice(0, 10);
  return (
    <div className="stack">
      {c.evidence.length === 0 && <p className="muted small">No evidence package is on record for this milestone.</p>}
      {c.evidence.map((p) => (
        <div key={p.id} className="dz-pkg">
          <div className="row"><b>Attempt {p.attempt}</b><span className="small muted">root {p.rootHash.slice(0, 12)}… · {when(p.createdAt)}</span></div>
          <ul className="dz-files">{p.files.map((f) => <li key={f.sha256}><span>{f.name}</span> <span className="small muted">{f.kind} · {f.sha256.slice(0, 10)}…</span></li>)}</ul>
          {p.signals.length > 0 && <div className="row">{p.signals.map((s) => <span key={s.code} className="chip" data-b={s.level === "ok" ? "ok" : s.level === "warn" ? "warn" : "danger"} title={s.detail}>{s.code}</span>)}</div>}
          {p.note && <p className="small">{p.note}</p>}
        </div>
      ))}
      {c.rebuttals.map((r) => (
        <div key={r.id} className="dz-reb" data-role={r.role}>
          <div className="row"><b>{r.role === "client" ? c.clientName : r.role === "provider" ? c.providerName : "Judge"}</b><span className="chip" data-b="plain">{r.kind.toLowerCase()}</span><span className="small muted">{when(r.createdAt)} · {r.sha256.slice(0, 10)}…</span></div>
          <p className="dz-pre">{r.narrative}</p>
          {r.kind === "FILE" && c.files.some((f) => f.sha256 === r.sha256) && <a className="small" href={fileHref(r.sha256)}>Open {fileName(r.sha256)}</a>}
          {r.annotations.length > 0 && <ul className="dz-marks">{r.annotations.map((n, i) => <li key={i}><b>{i + 1}.</b> {n.clause && <span className="chip" data-b="plain">{n.clause}</span>} {n.comment} <span className="small muted">on {fileName(n.fileSha)} at {Math.round(n.box[0] * 100)}%,{Math.round(n.box[1] * 100)}% ({Math.round(n.box[2] * 100)}×{Math.round(n.box[3] * 100)}%)</span></li>)}</ul>}
        </div>
      ))}
      {c.d.dossierRoot && <p className="small muted">Dossier root {c.d.dossierRoot}</p>}
    </div>
  );
}

export function External({ c }: { c: DisputeCase }) {
  if (!c.external.length) return null;
  return (
    <section className="c" aria-labelledby="dz-ext">
      <div className="c-head"><h2 id="dz-ext">PayPal disputes on this payment</h2></div>
      <p className="small muted">A dispute opened in PayPal locks payouts on the hold. PaySettle shows it here; PayPal decides it.</p>
      <ul className="dz-files">{c.external.map((e) => <li key={e.id}>{e.type} · {e.resourceId ?? "—"} <span className="small muted">{when(e.at)} · {e.state.toLowerCase()}</span></li>)}</ul>
    </section>
  );
}

export const ContractLink = ({ id, title }: { id: string; title: string }) => <Link href={`/contracts/${id}`}>{title}</Link>;
