/**
 * Mediator case queue: my cases, open cases free of conflicts (F4.05), co-signatures above $5,000 (F4.06).
 * Offers waiting for my answer (accept / decline with a reason), co-signatures for probation verdicts (Seniors only).
 */
import Link from "next/link";
import "@/styles/disputes.css";
import { requireViewer } from "@/lib/session";
import { mediatorQueue } from "@/server/disputes/queries";
import { left, money, when } from "@/components/disputes/format";
import { StateChip, Flash } from "@/components/disputes/parts";
import { acceptOfferAction, declineOfferAction } from "@/server/mediators/actions";
import { COSIGN_REASON_LABEL } from "@/server/mediators/rules";
import "@/styles/mediators.css";

export const metadata = { title: "Case queue" };

const LANES = [
  { key: "mine", title: "Your cases", empty: "No cases assigned to you." },
  { key: "cosign", title: "Waiting for your co-signature", empty: "No verdicts waiting for a second mediator." },
  { key: "open", title: "Open — free of conflicts for you", empty: "No unassigned sealed cases." },
  { key: "upcoming", title: "Coming up (Tier 1 and 2)", empty: "No disputes in the early tiers." },
  { key: "done", title: "Resolved by you", empty: "None yet." },
] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const v = await requireViewer(["mediator", "judge", "ops", "admin"]);
  const sp = await searchParams;
  const q = await mediatorQueue(v);
  const offered = q.filter((x) => x.lane === "offered");
  return (
    <>
      <div className="phead"><div><h1>Case queue</h1><p className="sub">Sealed cases are offered to the best-scoring eligible mediator: domain fit, load, verdicts on time, quality and working hours, after removing anyone with a case involving either party in the last 180 days. Each offer is open for 2 hours (30 minutes on fast track).</p></div></div>
      <Flash ok={sp.ok} error={sp.error} />
      {v.role === "mediator" && (
        <section className="c" aria-labelledby="lane-offered">
          <div className="c-head"><h2 id="lane-offered">Offered to you</h2><span className="chip" data-b={offered.length ? "warn" : "plain"}>{offered.length}</span></div>
          {offered.length ? offered.map((x) => (
            <div key={x.id} className="md-offer">
              <div className="md-offer-main">
                <Link href={`/mediator/cases/${x.id}`}><b>{x.milestone}</b></Link>
                <span className="small muted">{x.workspace} · {x.client} and {x.provider} · <span className="money">{money(x.amountCents, x.currency)}</span>{x.fastTrack ? " · fast track" : ""}</span>
                <span className="small">Answer by <b>{when(x.offer!.expiresAt)}</b> ({left(x.now, x.offer!.expiresAt)}){x.offer!.total !== null ? ` · you scored ${x.offer!.total} of 1,000` : ""}</span>
              </div>
              <form action={acceptOfferAction}><input type="hidden" name="offerId" value={x.offer!.id} /><button className="btn btn-g btn-sm" type="submit">Accept</button></form>
              <form action={declineOfferAction}>
                <input type="hidden" name="offerId" value={x.offer!.id} />
                <div className="field"><label htmlFor={`dr-${x.offer!.id}`}>Reason for declining</label><input id={`dr-${x.offer!.id}`} name="reason" required minLength={3} maxLength={300} /></div>
                <button className="btn btn-gh btn-sm" type="submit">Decline</button>
              </form>
            </div>
          )) : <p className="muted small">No open offers. When a vault seals and you are the best fit, the case appears here.</p>}
        </section>
      )}
      <div className="dz-lanes">
        {LANES.map((l) => {
          const rows = q.filter((x) => x.lane === l.key);
          return (
            <section key={l.key} className="c" aria-labelledby={`lane-${l.key}`}>
              <div className="c-head"><h2 id={`lane-${l.key}`}>{l.title}</h2><span className="chip" data-b="plain">{rows.length}</span></div>
              {rows.length ? (
                <div className="tbwrap"><table className="tb"><thead><tr><th>Case</th><th>Stage</th><th>Deadline</th><th className="n">Frozen</th></tr></thead><tbody>
                  {rows.map((x) => (
                    <tr key={x.id} className="rowlink">
                      <td><Link className="stretch" href={l.key === "upcoming" ? `/disputes/${x.id}` : `/mediator/cases/${x.id}`}><b>{x.milestone}</b></Link>
                        <div className="small muted">{x.workspace} · {x.client} and {x.provider}{x.mediator && l.key !== "mine" ? ` · ${x.mediator}` : ""}</div></td>
                      <td><StateChip state={x.state} />{x.fastTrack && <div className="small muted">fast track</div>}</td>
                      <td className="small">{x.due ? <>{when(x.due)}<div className="muted">{x.overdue ? "past due" : left(x.now, x.due)}</div></> : "—"}</td>
                      <td className="n money">{money(x.amountCents, x.currency)}{x.cosignReasons.length > 0 ? <div className="small muted">{x.cosignReasons.map((r) => COSIGN_REASON_LABEL[r]).join("; ")}</div> : x.highValue && <div className="small muted">two signatures</div>}</td>
                    </tr>
                  ))}
                </tbody></table></div>
              ) : <p className="muted small">{l.empty}</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
