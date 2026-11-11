/** F2.02 F2.03 — the provider's contracts: title, client, state, total, last update. */
import Link from "next/link";
import { listWorkspaces } from "@/server/contracts";
import { currentActor } from "@/server/contracts/web";
import { ContractList } from "@/components/contracts/list";

export const metadata = { title: "Contracts" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const { a } = await currentActor(["provider"]);
  const rows = await listWorkspaces(a);
  const toSign = rows.filter((r) => r.state === "READY_TO_SIGN" || r.state === "PARTIALLY_SIGNED").length;
  return (
    <>
      <div className="phead">
        <div><h1>Contracts</h1><p className="sub">Contracts clients have invited you to. Prune, append and sign them in the negotiation room.</p></div>
        <div className="stats">
          <div className="hstat"><div className="v">{toSign}</div><div className="l">Ready to sign</div></div>
          <div className="hstat"><div className="v">{rows.filter((r) => r.state === "LOCKED").length}</div><div className="l">Locked</div></div>
        </div>
      </div>
      <section className="c">
        <div className="c-head"><h2>All contracts</h2></div>
        <ContractList rows={rows} counterpartLabel="Client" empty={<><p>No contracts yet. When a client invites you, the contract appears here.</p><Link className="btn btn-sm" href="/blueprints">See the blueprints clients use</Link></>} />
      </section>
    </>
  );
}
