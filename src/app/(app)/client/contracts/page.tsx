/** F2.02 F2.03 — the client's contracts: title, provider, state, total, last update. */
import Link from "next/link";
import { listWorkspaces } from "@/server/contracts";
import { currentActor } from "@/server/contracts/web";
import { ContractList } from "@/components/contracts/list";

export const metadata = { title: "Contracts" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { a } = await currentActor(["client"]);
  const rows = await listWorkspaces(a);
  const live = rows.filter((r) => r.state !== "ABANDONED");
  return (
    <>
      <div className="phead">
        <div><h1>Contracts</h1><p className="sub">Every contract you started, from first draft to locked tranches.</p></div>
        <div className="stats">
          <div className="hstat"><div className="v">{live.filter((r) => r.state !== "LOCKED").length}</div><div className="l">In negotiation</div></div>
          <div className="hstat"><div className="v">{live.filter((r) => r.state === "LOCKED").length}</div><div className="l">Locked</div></div>
        </div>
      </div>
      <section className="c">
        <div className="c-head"><h2>All contracts</h2><span className="r"><Link className="btn btn-g btn-sm" href="/client/new">New contract</Link></span></div>
        <ContractList rows={rows} counterpartLabel="Provider" empty={<><p>No contracts yet.</p><div className="row"><Link className="btn btn-g btn-sm" href="/client/new">Start a contract</Link><Link className="btn btn-sm" href="/blueprints">Browse blueprints</Link></div></>} />
      </section>
    </>
  );
}
