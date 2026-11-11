/**
 * A3 Evidence Verifier panel (P3: advisory only). Shows per-criterion verdict, confidence, cited files and the
 * recommendation beside the client's decision — it never approves anything itself.
 */
import { reasonClause } from "@/lib/ai/gateway";
interface Crit { criterion: string; verdict: "met" | "not_met" | "unclear"; confidence: number; cites: string[] }
interface Verifier { available?: boolean; reason?: string; model?: string; confidence?: number; at?: string; data?: { criteria?: Crit[]; recommendation?: "approve" | "request_fix" | "unclear"; summary?: string } }

const VERDICT = { met: ["Met", "ok"], not_met: ["Not met", "danger"], unclear: ["Unclear", "warn"] } as const;
const REC = { approve: "Looks ready to approve", request_fix: "Suggests requesting a fix", unclear: "Could not tell — inspect closely" } as const;
const pctOf = (c: number) => `${Math.round((c <= 1 ? c * 100 : c))}%`;

export function AiPanel({ verifier, criteria }: { verifier: Record<string, unknown> | null; criteria: string[] }) {
  const v = (verifier ?? {}) as Verifier;
  const list = v.data?.criteria ?? [];
  return (
    <section className="c ev-ai" aria-labelledby="ev-ai-h">
      <div className="c-head">
        <h2 id="ev-ai-h">AI verifier</h2>
        <span className="chip" data-b="plain">AI advice — you decide</span>
        {v.available && v.data?.recommendation && <span className="r chip" data-b={v.data.recommendation === "approve" ? "ok" : v.data.recommendation === "request_fix" ? "danger" : "warn"}>{REC[v.data.recommendation]}</span>}
      </div>
      {!v.available ? (
        <p className="notice">AI unavailable{reasonClause(v.reason) ? ` — ${reasonClause(v.reason)}` : ""}. The rule-based checks above still ran; inspect the files against the criteria: {criteria.join("; ") || "none listed"}.</p>
      ) : (
        <>
          {v.data?.summary && <p>{v.data.summary}</p>}
          {list.length > 0 ? (
            <table className="ptable">
              <thead><tr><th scope="col">Criterion</th><th scope="col">Verdict</th><th scope="col">Confidence</th><th scope="col">Cited files</th></tr></thead>
              <tbody>
                {list.map((c, i) => (
                  <tr key={i}>
                    <td>{c.criterion}</td>
                    <td><span className="chip" data-b={VERDICT[c.verdict]?.[1] ?? "plain"}>{VERDICT[c.verdict]?.[0] ?? c.verdict}</span></td>
                    <td className="tnum">{pctOf(c.confidence)}</td>
                    <td className="small">{c.cites?.length ? c.cites.join(", ") : <span className="muted">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted small">The verifier returned no per-criterion findings.</p>}
          <p className="muted small">{v.model ? `Model ${v.model}. ` : ""}{v.confidence !== undefined ? `Overall confidence ${pctOf(v.confidence)}. ` : ""}The AI can be wrong; it cannot approve, reject or move money.</p>
        </>
      )}
    </section>
  );
}
