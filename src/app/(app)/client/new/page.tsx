/** F2.01 F2.02 A1 — new contract: blueprint, title, total, provider (or invite) and an optional brief for the AI drafter. */
import Link from "next/link";
import { listBlueprintOptions } from "@/server/contracts/blueprints";
import { providerOptions } from "@/server/contracts";
import { currentActor } from "@/server/contracts/web";
import { createContractAction } from "./actions";
import "@/styles/contracts.css";

export const metadata = { title: "New contract" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ blueprint?: string; err?: string; brief?: string }> }) {
  const sp = await searchParams;
  const { a } = await currentActor(["client"]);
  const [bps, providers] = await Promise.all([listBlueprintOptions(), providerOptions(a)]);
  const chosen = bps.find((b) => b.code === sp.blueprint) ?? bps[0];
  return (
    <>
      <div className="phead">
        <div><p className="crumb"><Link href="/client/contracts">Contracts</Link> › New</p><h1>New contract</h1>
          <p className="sub">Start from a blueprint, or describe the job and let the drafter propose milestones. Nothing is signed or funded until both of you agree on one revision.</p></div>
      </div>
      {sp.err && <div className="notice" data-b="danger" role="alert">{sp.err}</div>}
      <section className="c">
        <form action={createContractAction} className="form-grid">
          <div className="field"><label htmlFor="n-bp">Blueprint</label>
            <select id="n-bp" name="blueprint" defaultValue={chosen?.code} required>{bps.map((b) => <option key={b.code} value={b.code}>{b.title} (~{b.recommendedDays} days)</option>)}</select>
            <span className="small muted"><Link href="/blueprints">Browse blueprints</Link></span></div>
          <div className="field"><label htmlFor="n-title">Title</label><input id="n-title" name="title" maxLength={120} placeholder={chosen?.title ?? "Booking app MVP"} /></div>
          <div className="field"><label htmlFor="n-total">Total (USD)</label><input id="n-total" name="total" inputMode="decimal" required placeholder="6,000" /></div>
          <div className="field"><label htmlFor="n-prov">Provider</label>
            <select id="n-prov" name="provider" defaultValue={providers[0]?.id ?? "invite"}>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.tier}{p.payable ? "" : " · PayPal not linked yet"}</option>)}
              <option value="invite">Invite someone by email</option>
            </select></div>
          <div className="field"><label htmlFor="n-inv">Invite email (if not listed)</label><input id="n-inv" name="inviteEmail" type="email" maxLength={200} placeholder="studio@example.com" /></div>
          <div className="field wide"><label htmlFor="n-brief">Describe the job (optional)</label>
            <textarea id="n-brief" name="brief" maxLength={4000} defaultValue={sp.brief ?? ""} placeholder="Build a booking web app MVP: customers pick a slot, pay a deposit, get reminders. 4 weeks." />
            <span className="small muted">With a description, the AI drafter proposes milestones; without one, or when AI is unavailable, the blueprint is used as is.</span></div>
          <div className="row wide"><button className="btn btn-g">Create the contract</button><span className="small muted">You can prune, append and edit everything in the negotiation room.</span></div>
        </form>
      </section>
    </>
  );
}
