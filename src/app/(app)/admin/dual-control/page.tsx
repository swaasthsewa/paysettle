/** Four-eyes queue (F5.03): propose, approve (refused for the initiator), veto or withdraw, 30-minute expiry. */
import { requireViewer } from "@/lib/session";
import { expireDue, queue, DC_ACTION_KEYS, DC_ACTIONS, canDualControl, type DcAction } from "@/server/control/dual";
import { proposeAction } from "@/server/control/actions";
import { DualControlQueue, Flash, Head, one, Stat, type SP } from "@/components/console/parts";

export const metadata = { title: "Four-eyes queue" };

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["admin", "ops", "finance", "mediator", "judge"]);
  const sp = await searchParams;
  await expireDue();
  const items = await queue({ limit: 60 });
  const mine = DC_ACTION_KEYS.filter((a) => canDualControl(v.role, a));
  const waiting = items.filter((i) => i.state === "AWAITING");
  return (
    <>
      <Head title="Four-eyes queue" sub="Privileged actions run only after a second, different person approves within 30 minutes. The database refuses self-approval too." />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <div className="cx-stats">
        <Stat label="Waiting" value={waiting.length} tone={waiting.length ? "held" : "ok"} />
        <Stat label="Waiting on someone else" value={waiting.filter((i) => i.initiatorId !== v.id && canDualControl(v.role, i.action as DcAction)).length} detail="you can approve these" />
        <Stat label="Executed (recent)" value={items.filter((i) => i.state === "EXECUTED").length} tone="ok" />
        <Stat label="Expired or stopped" value={items.filter((i) => i.state === "EXPIRED" || i.state === "VETOED").length} />
      </div>
      <section className="c">
        <div className="c-head"><h2>Requests</h2></div>
        <DualControlQueue items={items} viewer={v} back="/admin/dual-control" />
      </section>
      {mine.length > 0 && (
        <section className="c">
          <div className="c-head"><h2>Propose an action</h2></div>
          <form action={proposeAction} className="cx-form">
            <input type="hidden" name="back" value="/admin/dual-control" />
            <div className="field"><label htmlFor="p-action">Action</label>
              <select id="p-action" name="action" required>{mine.map((a) => <option key={a} value={a}>{DC_ACTIONS[a].label}</option>)}</select></div>
            <div className="field"><label htmlFor="p-target">Applies to (id)</label><input id="p-target" name="target" required placeholder="Tranche, transmission, dispute, provider or flag id" /></div>
            <div className="field"><label htmlFor="p-tier">Tier (trust-tier changes)</label>
              <select id="p-tier" name="tier" defaultValue="standard"><option value="platinum">Platinum</option><option value="standard">Standard</option><option value="new">New</option><option value="probation">Probation</option></select></div>
            <div className="field"><label htmlFor="p-hours">Hours (vault extensions)</label><input id="p-hours" name="hours" type="number" min={1} max={72} defaultValue={24} /></div>
            <div className="field"><label htmlFor="p-on">Flag value (flag flips)</label><select id="p-on" name="on" defaultValue="true"><option value="true">On</option><option value="false">Off</option></select></div>
            <div className="field wide"><label htmlFor="p-reason">Reason (the approver reads this)</label><textarea id="p-reason" name="reason" required minLength={10} maxLength={500} /></div>
            <div className="row wide"><button className="btn btn-g" type="submit">Send for approval</button><span className="small muted">Most requests start from their own screen: breakers on Finance, replays on Webhooks, tiers on Provider health, flags on the Switchboard.</span></div>
          </form>
        </section>
      )}
    </>
  );
}
