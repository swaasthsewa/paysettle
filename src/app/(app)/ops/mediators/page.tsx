/**
 * F4.05 F4.06 F4.07 — /ops/mediators: the mediator network for Ops. Ops lead queue (cases nobody accepted),
 * applications, credential checks, roster with scorecards and status moves, coverage grid (domain × time-zone region:
 * routable mediators and open cases against capacity), random 5% second reviews, and mediator fees (Finance marks paid;
 * PaySettle pays them from its own fee income, never from a hold).
 */
import Link from "next/link";
import "@/styles/disputes.css";
import "@/styles/mediators.css";
import { requireViewer } from "@/lib/session";
import { opsNetwork } from "@/server/mediators";
import {
  decideApplicationAction, feePaidAction, moveStatusAction, networkFieldsAction, opsAssignAction, secondReviewAction, verifyCredentialAction,
} from "@/server/mediators/actions";
import { OPS_MOVES, STATUS_CHIP, STATUS_LABEL, LANGUAGES } from "@/server/mediators/rules";
import { DOMAINS, DOMAIN_KEYS, domainLabel, domainOf } from "@/server/mediators/domains";
import { offsetMinutes } from "@/server/mediators/router";
import { ROOT_CAUSES } from "@/server/disputes/rules";
import { Flash } from "@/components/disputes/parts";
import { money, pctOf, when } from "@/components/disputes/format";

export const metadata = { title: "Mediator network" };

const REGIONS = ["Americas", "Europe and Africa", "Asia and Pacific"] as const;
const regionOf = (tz: string, at: Date) => { const h = offsetMinutes(tz, at) / 60; return h <= -3 ? REGIONS[0] : h <= 4 ? REGIONS[1] : REGIONS[2]; };
const lang = (l: string) => LANGUAGES[l as keyof typeof LANGUAGES] ?? l;

export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const v = await requireViewer(["ops", "admin", "finance"]);
  const q = await searchParams;
  const n = await opsNetwork(v.orgId);
  const finance = v.role === "finance";
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 60 * 86_400_000).toISOString().slice(0, 10);
  const routable = n.profiles.filter((p) => p.status === "ACTIVE" || p.status === "SENIOR");
  const seniors = n.profiles.filter((p) => p.status === "SENIOR");
  const newApps = n.applications.filter((a) => a.status === "NEW");
  const pendingCreds = n.credentials.filter((c) => c.status === "PENDING");
  const expiring = n.credentials.filter((c) => c.status === "VERIFIED" && c.expiresOn && c.expiresOn <= soon);
  const openReviews = n.secondReviews.filter((r) => !r.outcome);
  const accrued = n.fees.filter((f) => f.status === "ACCRUED");
  const accruedCents = accrued.reduce((a, f) => a + f.amountCents, 0);
  const paidCents = n.fees.filter((f) => f.status === "PAID").reduce((a, f) => a + f.amountCents, 0);

  /* coverage: for each domain and region, the routable mediators who cover it, and their open cases against capacity */
  const cov = DOMAIN_KEYS.map((d) => ({
    d, cells: REGIONS.map((r) => {
      const ms = routable.filter((p) => regionOf(p.timezone, now) === r && (p.domains.includes(d) || p.domains.some((x) => domainOf(x) === d) || p.domains.includes("*")));
      return { r, count: ms.length, open: ms.reduce((a, p) => a + p.card.open, 0), cap: ms.reduce((a, p) => a + p.maxOpen, 0) };
    }),
  }));

  return (
    <>
      <div className="phead">
        <div><h1>Mediator network</h1><p className="sub">{finance ? "Mediator fees recorded on verdicts and co-signatures. PaySettle pays them from its own fee income; they never come out of a held amount." : "Applications, credentials, status, coverage and the Ops lead queue. Every change here is written to the audit chain."}</p></div>
        <div className="stats">
          {!finance && <>
            <div className="hstat"><div className="v tnum">{routable.length}</div><div className="l">Taking cases ({seniors.length} Senior)</div></div>
            <div className="hstat"><div className="v tnum">{n.queue.length}</div><div className="l">Ops lead queue</div></div>
            <div className="hstat"><div className="v tnum">{newApps.length}</div><div className="l">New applications</div></div>
            <div className="hstat"><div className="v tnum">{pendingCreds.length}</div><div className="l">Credentials to check</div></div>
          </>}
          <div className="hstat"><div className="v money">{money(accruedCents)}</div><div className="l">Fees to pay</div></div>
        </div>
      </div>
      <Flash ok={q.ok} error={q.error} />
      {n.mode === "legacy" && !finance && <p className="notice" data-b="warn">This organisation has no network profiles yet, so cases go to every mediator as a generalist (conflict-checked). Approve an application or run the mediator seed to start the network.</p>}

      <div className="bento">
        {!finance && (
          <section className="c span12" aria-labelledby="om-q">
            <div className="c-head"><h2 id="om-q">Ops lead queue</h2><span className="chip" data-b={n.queue.length ? "danger" : "ok"}>{n.queue.length}</span></div>
            <p className="small muted">Sealed cases that 3 mediators declined or let expire, or where nobody was eligible. Pick an eligible mediator: they get the usual window to accept.</p>
            {n.queue.length ? (
              <div className="tbwrap"><table className="tb"><thead><tr><th>Case</th><th>Why here</th><th className="n">Frozen</th><th>Assign</th></tr></thead><tbody>
                {n.queue.map((x) => (
                  <tr key={x.d.id}>
                    <td><Link href={`/mediator/cases/${x.d.id}`}><b>{x.m.code} · {x.m.title}</b></Link><div className="small muted">{x.w.title} · {x.w.blueprintCode}</div></td>
                    <td className="small">{x.f.opsQueueReason}<div className="muted">since {when(x.f.opsQueueAt)} · {x.f.misses} miss{x.f.misses === 1 ? "" : "es"}</div></td>
                    <td className="n money">{money(x.d.amountCents, x.w.currency)}</td>
                    <td>{x.eligible.length ? (
                      <form action={opsAssignAction} className="md-inline">
                        <input type="hidden" name="disputeId" value={x.d.id} />
                        <div className="field"><label htmlFor={`oa-${x.d.id}`}>Mediator</label>
                          <select id={`oa-${x.d.id}`} name="mediatorId">{x.eligible.map((e) => <option key={e.id} value={e.id}>{n.names[e.id] ?? e.id} · {e.total} pts</option>)}</select></div>
                        <button className="btn btn-sm" type="submit">Offer</button>
                      </form>
                    ) : <span className="small">Nobody eligible. Widen a mediator&apos;s domains or capacity below.</span>}</td>
                  </tr>
                ))}
              </tbody></table></div>
            ) : <p className="muted small">Empty. Every sealed case has a mediator or an open offer.</p>}
          </section>
        )}

        {!finance && (
          <section className="c span12" aria-labelledby="om-apps">
            <div className="c-head"><h2 id="om-apps">Applications</h2><span className="chip" data-b="plain">{newApps.length} new</span></div>
            {n.applications.length ? (
              <div className="tbwrap"><table className="tb"><thead><tr><th>Applicant</th><th>Domains and languages</th><th>Credentials and conflicts</th><th>Decision</th></tr></thead><tbody>
                {n.applications.map((a) => (
                  <tr key={a.id}>
                    <td><b>{a.name}</b><div className="small muted">{a.email}</div><div className="small muted">{a.firm ?? "Independent"} · {a.timezone} · {a.weeklyHours} h/week</div><div className="small muted">{when(a.createdAt)}</div></td>
                    <td className="small">{a.domains.map((d) => domainLabel(d)).join(", ")}<div className="muted">{a.languages.map(lang).join(", ")}</div></td>
                    <td className="small dz-pre">{a.credentials}{a.conflicts && <div className="muted">Conflicts: {a.conflicts}</div>}</td>
                    <td>{a.status === "NEW" ? (
                      <form action={decideApplicationAction} className="stack">
                        <input type="hidden" name="applicationId" value={a.id} />
                        <div className="field"><label htmlFor={`ap-n-${a.id}`}>Note (optional)</label><input id={`ap-n-${a.id}`} name="note" maxLength={500} /></div>
                        <div className="row"><button className="btn btn-sm btn-g" name="decision" value="APPROVE" type="submit">Approve</button><button className="btn btn-sm btn-gh" name="decision" value="REJECT" type="submit">Reject</button></div>
                      </form>
                    ) : <><span className="chip" data-b={a.status === "APPROVED" ? "ok" : "none"}>{a.status === "APPROVED" ? "Approved" : "Rejected"}</span>{a.note && <div className="small muted">{a.note}</div>}</>}</td>
                  </tr>
                ))}
              </tbody></table></div>
            ) : <p className="muted small">No applications yet. They arrive from the public <Link href="/mediators">mediators page</Link>.</p>}
          </section>
        )}

        {!finance && (
          <section className="c span12" aria-labelledby="om-cred">
            <div className="c-head"><h2 id="om-cred">Credential checks</h2><span className="chip" data-b={pendingCreds.length ? "warn" : "ok"}>{pendingCreds.length} waiting</span>{expiring.length > 0 && <span className="chip" data-b="risk">{expiring.length} expire within 60 days</span>}</div>
            {n.credentials.length ? (
              <div className="tbwrap"><table className="tb"><thead><tr><th>Mediator</th><th>Credential</th><th>Expires</th><th>File hash</th><th>Status</th></tr></thead><tbody>
                {n.credentials.map((c) => {
                  const expired = !!c.expiresOn && c.expiresOn < today;
                  return (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td><b>{c.type}</b><div className="small muted">{c.issuer} · {c.numberMasked}</div></td>
                      <td className="small">{c.expiresOn ?? "No expiry"}{expired && <div><span className="chip" data-b="danger">Expired</span></div>}</td>
                      <td className="small tnum">{c.fileSha256 ? `${c.fileSha256.slice(0, 16)}…` : "No file"}</td>
                      <td>{c.status === "PENDING" ? (
                        <form action={verifyCredentialAction} className="md-inline">
                          <input type="hidden" name="credentialId" value={c.id} />
                          <div className="field"><label htmlFor={`cr-${c.id}`}>Note</label><input id={`cr-${c.id}`} name="note" maxLength={300} placeholder="Needed to reject" /></div>
                          <button className="btn btn-sm btn-g" name="decision" value="VERIFIED" type="submit">Verify</button><button className="btn btn-sm btn-gh" name="decision" value="REJECTED" type="submit">Reject</button>
                        </form>
                      ) : <><span className="chip" data-b={c.status === "VERIFIED" ? "ok" : "danger"}>{c.status === "VERIFIED" ? "Verified" : "Rejected"}</span>{c.verifiedAt && <div className="small muted">{when(c.verifiedAt)}</div>}</>}</td>
                    </tr>
                  );
                })}
              </tbody></table></div>
            ) : <p className="muted small">No credentials on file.</p>}
          </section>
        )}

        {!finance && (
          <section className="c span12" aria-labelledby="om-roster">
            <div className="c-head"><h2 id="om-roster">Roster and scorecards</h2><span className="chip" data-b="plain">{n.profiles.length} profiles</span></div>
            <div className="tbwrap"><table className="tb"><thead><tr><th>Mediator</th><th>Domains</th><th className="n">Open</th><th className="n">Verdicts</th><th className="n">On time</th><th className="n">Rating</th><th className="n">Agreed</th><th>Status</th></tr></thead><tbody>
              {n.profiles.map((p) => (
                <tr key={p.userId}>
                  <td><b>{p.name}</b><div className="small muted">{p.firm ?? "Independent"} · {p.timezone} · {p.languages.map(lang).join(", ")}</div>
                    <details className="md-details"><summary className="small">Edit domains, firm, capacity</summary>
                      <form action={networkFieldsAction} className="stack">
                        <input type="hidden" name="userId" value={p.userId} />
                        <fieldset className="md-checks"><legend>Domains</legend>{DOMAIN_KEYS.map((d) => <label key={d}><input type="checkbox" name="domains" value={d} defaultChecked={p.domains.includes(d)} /> {DOMAINS[d].label}</label>)}</fieldset>
                        <div className="md-inline">
                          <div className="field grow"><label htmlFor={`nf-f-${p.userId}`}>Firm (empty = independent)</label><input id={`nf-f-${p.userId}`} name="firm" defaultValue={p.firm ?? ""} maxLength={120} /></div>
                          <div className="field"><label htmlFor={`nf-m-${p.userId}`}>Max open</label><input id={`nf-m-${p.userId}`} name="maxOpen" type="number" min={1} max={12} defaultValue={p.maxOpen} /></div>
                          <button className="btn btn-sm" type="submit">Save</button>
                        </div>
                        {p.domains.filter((d) => !DOMAIN_KEYS.includes(d as never)).map((d) => <input key={d} type="hidden" name="domains" value={d} />)}
                        {p.domains.some((d) => !DOMAIN_KEYS.includes(d as never)) && <p className="small muted">Also lists specific blueprints (exact fit, kept): {p.domains.filter((d) => !DOMAIN_KEYS.includes(d as never)).join(", ")}.</p>}
                      </form>
                    </details></td>
                  <td className="small">{p.domains.map((d) => domainLabel(d)).join(", ")}</td>
                  <td className="n tnum">{p.card.open}/{p.maxOpen}</td>
                  <td className="n tnum">{p.verdictCount}</td>
                  <td className="n tnum">{p.card.slaPct === null ? "—" : `${p.card.slaPct}%`}<div className="small muted">{p.card.slaN ? `of ${p.card.slaN}` : ""}</div></td>
                  <td className="n tnum">{p.card.rating === null ? "—" : p.card.rating.toFixed(1)}<div className="small muted">{p.card.ratingN ? `${p.card.ratingN} ratings` : ""}</div></td>
                  <td className="n tnum">{p.card.agreePct === null ? "—" : `${p.card.agreePct}%`}</td>
                  <td><span className="chip" data-b={STATUS_CHIP[p.status]}>{STATUS_LABEL[p.status]}</span>
                    {OPS_MOVES[p.status].length > 0 && (
                      <form action={moveStatusAction} className="md-inline">
                        <input type="hidden" name="userId" value={p.userId} />
                        <div className="field"><label htmlFor={`ms-${p.userId}`}>Move to</label><select id={`ms-${p.userId}`} name="to">{OPS_MOVES[p.status].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
                        <div className="field"><label htmlFor={`msn-${p.userId}`}>Note</label><input id={`msn-${p.userId}`} name="note" maxLength={300} /></div>
                        <button className="btn btn-sm" type="submit">Move</button>
                      </form>
                    )}</td>
                </tr>
              ))}
            </tbody></table></div>
          </section>
        )}

        {!finance && (
          <section className="c span7" aria-labelledby="om-cov">
            <div className="c-head"><h2 id="om-cov">Coverage</h2></div>
            <p className="small muted">Mediators taking cases (Active or Senior) per domain and time-zone region, with their open cases against capacity.</p>
            <div className="tbwrap"><table className="md-cov"><caption className="sr-only">Coverage by domain and region</caption>
              <thead><tr><th scope="col">Domain</th>{REGIONS.map((r) => <th key={r} scope="col">{r}</th>)}</tr></thead>
              <tbody>{cov.map((row) => (
                <tr key={row.d}><th scope="row">{DOMAINS[row.d].label}</th>
                  {row.cells.map((c) => <td key={c.r} data-l={c.count === 0 ? 0 : c.cap > 0 && c.open >= c.cap ? 3 : c.count === 1 ? 1 : 2}>{c.count ? <><b className="tnum">{c.count}</b> <span className="small">· {c.open}/{c.cap} open</span></> : "none"}</td>)}</tr>
              ))}</tbody>
            </table></div>
            <p className="small muted">Amber: one mediator only. Red: at capacity. Grey: nobody, so cases from that domain and region wait in the Ops lead queue.</p>
          </section>
        )}

        {!finance && (
          <section className="c span5" aria-labelledby="om-sr">
            <div className="c-head"><h2 id="om-sr">Second reviews</h2><span className="chip" data-b={openReviews.length ? "warn" : "ok"}>{openReviews.length} open</span></div>
            <p className="small muted">5% of closed Tier 3 verdicts, picked from the verdict signature&apos;s hash. A Senior mediator who did not sign re-reads the dossier; agreement feeds the quality score.</p>
            {n.secondReviews.length ? n.secondReviews.map((r) => (
              <div key={r.disputeId} className="md-case">
                <div className="row"><Link href={`/mediator/cases/${r.disputeId}`}><b>{r.workspace}</b></Link><span className="sp" />{r.outcome ? <span className="chip" data-b={r.outcome === "AGREE" ? "ok" : "danger"}>{r.outcome === "AGREE" ? "Agreed" : "Disagreed"}</span> : <span className="chip" data-b="warn">Open</span>}</div>
                <span className="small">{n.names[r.mediatorId ?? ""] ?? "Mediator"}: {pctOf(r.shareBps)} to the provider · {ROOT_CAUSES[r.rootCause as keyof typeof ROOT_CAUSES] ?? r.rootCause}</span>
                {r.outcome ? <p className="small muted">{n.names[r.reviewerId ?? ""] ?? "Reviewer"}: {r.note}</p> : (
                  <form action={secondReviewAction} className="stack">
                    <input type="hidden" name="disputeId" value={r.disputeId} />
                    <div className="md-inline">
                      <div className="field"><label htmlFor={`sr-r-${r.disputeId}`}>Reviewer</label><select id={`sr-r-${r.disputeId}`} name="reviewerId">{seniors.filter((s) => s.userId !== r.mediatorId && s.userId !== r.cosignerId).map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}</select></div>
                      <div className="field"><label htmlFor={`sr-o-${r.disputeId}`}>Outcome</label><select id={`sr-o-${r.disputeId}`} name="outcome"><option value="AGREE">Agrees with the verdict</option><option value="DISAGREE">Disagrees</option></select></div>
                    </div>
                    <div className="field"><label htmlFor={`sr-n-${r.disputeId}`}>What the reviewer found</label><textarea id={`sr-n-${r.disputeId}`} name="note" required minLength={10} maxLength={1000} rows={2} /></div>
                    <div className="row"><button className="btn btn-sm" type="submit">Record</button></div>
                  </form>
                )}
              </div>
            )) : <p className="muted small">No verdict picked yet.</p>}
          </section>
        )}

        <section className="c span12" aria-labelledby="om-fees">
          <div className="c-head"><h2 id="om-fees">Mediator fees</h2><span className="chip" data-b="warn">{money(accruedCents)} accrued</span><span className="chip" data-b="ok">{money(paidCents)} paid</span></div>
          <p className="small muted">Flat per verdict by tier (probation $40, active $60, senior $90) and $25 per co-signature. Paid by PaySettle from its own fee income: no PayPal hold is touched.</p>
          {n.fees.length ? (
            <div className="tbwrap"><table className="tb"><thead><tr><th>Mediator</th><th>Case</th><th>For</th><th>Recorded</th><th className="n">Amount</th><th>Status</th></tr></thead><tbody>
              {n.fees.map((f) => (
                <tr key={f.id}><td>{f.name}</td><td className="small">{f.workspace}</td><td className="small">{f.role === "COSIGN" ? "Co-signature" : `Verdict (${f.tier.toLowerCase()})`}</td><td className="small">{when(f.createdAt)}</td>
                  <td className="n money">{money(f.amountCents, f.currency)}</td>
                  <td>{f.status === "PAID" ? <span className="chip" data-b="ok">Paid</span> : finance ? (
                    <form action={feePaidAction}><input type="hidden" name="feeId" value={f.id} /><input type="hidden" name="back" value="/ops/mediators" /><button className="btn btn-sm" type="submit">Mark paid</button></form>
                  ) : <span className="chip" data-b="warn">Accrued</span>}</td></tr>
              ))}
            </tbody></table></div>
          ) : <p className="muted small">No mediator fees yet.</p>}
        </section>
      </div>
    </>
  );
}
