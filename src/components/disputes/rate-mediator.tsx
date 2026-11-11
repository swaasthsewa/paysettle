/**
 * Rating the mediator after settlement (both parties, once each). Shown in the dispute room only when the case
 * is resolved by a Tier 3 verdict. Server form; the score and comment are checked again on the server.
 */
import { reviewAction } from "@/server/mediators/actions";

const LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

export function RateMediator({ disputeId, mediatorName, mine }: { disputeId: string; mediatorName: string; mine: { score: number; comment: string } | null }) {
  if (mine) return <p className="small">You rated {mediatorName} <b>{mine.score} of 5</b> ({LABELS[mine.score]}){mine.comment ? `: “${mine.comment}”` : "."} Ratings are final.</p>;
  return (
    <form action={reviewAction} className="stack" aria-labelledby="md-rate-h">
      <input type="hidden" name="disputeId" value={disputeId} />
      <b id="md-rate-h">Rate {mediatorName}</b>
      <fieldset className="md-stars">
        <legend>How well was the case handled? (one answer)</legend>
        {[1, 2, 3, 4, 5].map((n) => <label key={n}><input type="radio" name="score" value={n} required /> {n} · {LABELS[n]}</label>)}
      </fieldset>
      <div className="field">
        <label htmlFor="md-rate-c">Comment (optional, shown to Ops)</label>
        <textarea id="md-rate-c" name="comment" maxLength={1000} rows={3} />
      </div>
      <p className="small muted">Ratings feed the mediator&apos;s quality score in the router. They do not change the verdict or the money.</p>
      <div className="row"><button className="btn btn-sm" type="submit">Send rating</button></div>
    </form>
  );
}
