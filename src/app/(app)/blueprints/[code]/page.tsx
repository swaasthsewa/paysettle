/** F2.01 F2.08 F2.09 blueprint detail: milestones with proof specs, lock and dispute rules, and clauses. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCents, pct } from "@/lib/money";
import { SYSTEM_CLAUSES } from "@/data/blueprints/system";
import { getBlueprint } from "@/server/contracts/blueprints";
import { currentActor } from "@/server/contracts/web";
import { artifactLabel, kindLabel } from "@/components/contracts/chips";
import "@/styles/contracts.css";

export const metadata = { title: "Blueprint" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { v } = await currentActor();
  const b = await getBlueprint(code);
  if (!b) notFound();
  const clauses = [...SYSTEM_CLAUSES.filter((s) => !b.clauses.some((c) => c.code === s.code)), ...b.clauses];
  const ms = [...b.milestones].sort((x, y) => x.day - y.day);
  const example = 600_000;
  return (
    <>
      <div className="phead">
        <div>
          <p className="crumb"><Link href="/blueprints">Blueprints</Link> › {b.title}</p>
          <h1>{b.title}</h1>
          <p className="sub">{b.summary}</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v">{ms.length}</div><div className="l">Milestones</div></div>
          <div className="hstat"><div className="v">{b.recommendedDays}</div><div className="l">Days (recommended)</div></div>
        </div>
      </div>
      <div className="row">
        <span className="chip" data-b="plain">{b.vertical}</span><span className="chip" data-b="none">{kindLabel(b.kind)}</span><span className="chip" data-b="plain">v{b.version}</span>
        <span style={{ flex: 1 }} />
        {v.role === "client" ? <Link className="btn btn-g" href={`/client/new?blueprint=${encodeURIComponent(b.code)}`}>Start a contract from this</Link> : <span className="small muted">Clients start contracts from blueprints.</span>}
      </div>
      <div className="bento">
        <section className="c span8" aria-labelledby="bm-h">
          <div className="c-head"><h2 id="bm-h">Milestones</h2><span className="r small muted">Amounts shown for an example {formatCents(example)} contract</span></div>
          <ol className="ms-list">
            {ms.map((m) => (
              <li key={m.code} className="ms" data-type={m.type}>
                <div className="ms-head">
                  <span className="ms-code">{m.code}</span><span className="ms-title">{m.title}</span>
                  <span className="chip" data-b={m.type === "PAY" ? "plain" : "none"}>{m.type === "PAY" ? "Payment" : "Information step"}</span>
                </div>
                <div className="ms-nums"><span>Day <b>{m.day}</b></span>{m.type === "PAY" && <><span>Share <b>{pct(m.bps)}</b></span><span>Example <b className="money">{formatCents(Math.floor((example * m.bps) / 10_000))}</b></span></>}</div>
                <div className="ms-spec">
                  <div><h4>Proof</h4><ul>{m.proof.artifacts.map((x, i) => <li key={i}>{x.min} × {artifactLabel(x.kind)}{x.note ? ` — ${x.note}` : ""}</li>)}</ul>{m.proof.oracle && <p>Oracle: {m.proof.oracle}</p>}</div>
                  <div><h4>Acceptance criteria</h4><ul>{m.proof.criteria.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
                  <div><h4>Lock rule</h4><p>{m.lockRule}</p><h4 style={{ marginTop: 6 }}>Dispute rule</h4><p>{m.disputeRule}</p></div>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="c span4" aria-labelledby="bc-h">
          <div className="c-head"><h2 id="bc-h">Clauses</h2></div>
          <ul className="cl-list">
            {clauses.map((c) => (
              <li key={c.code} className="cl"><div className="cl-tx"><div className="cl-title">{c.title}</div>{c.body}</div>
                <span className="chip" data-b={c.category === "SYSTEM" ? "plain" : c.protective ? "ok" : "none"}>{c.category === "SYSTEM" ? "System" : c.protective ? "Protective" : "Baseline"}</span></li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
