/** F2.01 blueprint discovery: search with facets (vertical, kind, maximum days); zero hits offer the guided builder. */
import Link from "next/link";
import { blueprintFacets, searchBlueprints } from "@/server/contracts/blueprints";
import { currentActor } from "@/server/contracts/web";
import { kindLabel } from "@/components/contracts/chips";
import "@/styles/contracts.css";

export const metadata = { title: "Blueprints" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; vertical?: string; kind?: string; maxDays?: string }> }) {
  const sp = await searchParams;
  const { v } = await currentActor();
  const q = (sp.q ?? "").slice(0, 120);
  const maxDays = /^\d{1,3}$/.test(sp.maxDays ?? "") ? Number(sp.maxDays) : undefined;
  const [facets, hits] = await Promise.all([blueprintFacets(), searchBlueprints({ q, vertical: sp.vertical || undefined, kind: sp.kind || undefined, maxDays })]);
  const filtered = Boolean(q || sp.vertical || sp.kind || maxDays);
  return (
    <>
      <div className="phead">
        <div><h1>Blueprints</h1><p className="sub">Tested milestone plans for common jobs. Each step names the proof that releases its money, and how disputes on it are settled.</p></div>
        <div className="stats"><div className="hstat"><div className="v">{hits.length}</div><div className="l">{filtered ? "Matching" : "Available"}</div></div></div>
      </div>
      <section className="c">
        <form className="bp-facets" method="get" role="search" aria-label="Search blueprints">
          <div className="field"><label htmlFor="bp-q">Search</label><input id="bp-q" name="q" type="search" defaultValue={q} placeholder="booking app, SAP rollout, kitchen millwork…" /></div>
          <div className="field"><label htmlFor="bp-v">Vertical</label><select id="bp-v" name="vertical" defaultValue={sp.vertical ?? ""}><option value="">All verticals</option>{facets.verticals.map((x) => <option key={x}>{x}</option>)}</select></div>
          <div className="field"><label htmlFor="bp-k">Kind</label><select id="bp-k" name="kind" defaultValue={sp.kind ?? ""}><option value="">All kinds</option>{facets.kinds.map((x) => <option key={x} value={x}>{kindLabel(x)}</option>)}</select></div>
          <div className="field"><label htmlFor="bp-d">Up to (days)</label><input id="bp-d" name="maxDays" type="number" min={1} max={365} defaultValue={maxDays ?? ""} /></div>
          <button className="btn btn-g">Search</button>
          {filtered && <Link className="btn btn-gh" href="/blueprints">Clear</Link>}
        </form>
      </section>
      {hits.some((h) => h.related) && <p className="notice">Nothing uses the words “{q}” exactly. These blueprints cover related work.</p>}
      {hits.length ? (
        <div className="grid-cards">
          {hits.map((b) => (
            <article key={b.code} className="c rowlink">
              <div className="row"><span className="chip" data-b="plain">{b.vertical}</span><span className="chip" data-b="none">{kindLabel(b.kind)}</span>{b.depth === "outline" && <span className="chip" data-b="warn">Outline</span>}</div>
              <h2 style={{ fontSize: 17 }}><Link className="stretch" href={`/blueprints/${b.code}`}>{b.title}</Link></h2>
              <p className="small muted">{b.summary}</p>
              <p className="small">{b.milestones} milestones · {b.payMilestones} paid · about {b.recommendedDays} days</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>No blueprint matches “{q || "these filters"}”.</p>
          {v.role === "client"
            ? <div className="row"><Link className="btn btn-g btn-sm" href={`/client/new${q ? `?brief=${encodeURIComponent(q)}` : ""}`}>Use the guided builder</Link><Link className="btn btn-sm" href="/blueprints">Show all blueprints</Link></div>
            : <Link className="btn btn-sm" href="/blueprints">Show all blueprints</Link>}
        </div>
      )}
    </>
  );
}
