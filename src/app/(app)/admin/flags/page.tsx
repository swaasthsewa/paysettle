/** Switchboard (F5.03, P9): platform flags. Every flip is a four-eyes request. */
import { requireViewer } from "@/lib/session";
import { allFlags } from "@/server/control/flags";
import { canDualControl, expireDue, queue } from "@/server/control/dual";
import { proposeAction } from "@/server/control/actions";
import { DualControlQueue, Flash, Head, one, type SP } from "@/components/console/parts";
import { fmtDate } from "@/components/console/format";

export const metadata = { title: "Switchboard" };

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["admin", "ops", "judge"]);
  const sp = await searchParams;
  await expireDue();
  const [fl, q] = await Promise.all([allFlags(), queue({ limit: 40 })]);
  const pending = q.filter((i) => i.action === "FLIP_FLAG");
  const may = canDualControl(v.role, "FLIP_FLAG");
  return (
    <>
      <Head title="Switchboard" sub="Platform switches. A flip is proposed by one person and takes effect when a second person approves it." />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <section className="c">
        <ul className="cx-flags">
          {fl.map((f) => {
            const waiting = pending.find((p) => p.target === f.key && p.state === "AWAITING");
            return (
              <li key={f.key} className="cx-flag">
                <div className="stack" style={{ gap: 4 }}>
                  <div className="row"><b>{f.label}</b><code className="cx-code">{f.key}</code></div>
                  <p>{f.note}</p>
                  <p className="small">{f.stored ? `Last changed ${fmtDate(f.updatedAt)}` : "Default value (never changed)"}</p>
                </div>
                <div className="stack" style={{ alignItems: "flex-end" }}>
                  <span className="cx-switch" data-on={f.on || undefined}><i aria-hidden="true" />{f.on ? "On" : "Off"}</span>
                  {waiting ? <span className="chip" data-b="warn">Change to {f.on ? "off" : "on"} waiting for approval</span> : may && (
                    <form action={proposeAction} className="cx-inline">
                      <input type="hidden" name="action" value="FLIP_FLAG" /><input type="hidden" name="target" value={f.key} /><input type="hidden" name="on" value={String(!f.on)} /><input type="hidden" name="back" value="/admin/flags" />
                      <label className="sr-only" htmlFor={`fr-${f.key}`}>Reason to turn {f.label} {f.on ? "off" : "on"}</label>
                      <input id={`fr-${f.key}`} name="reason" className="input" required minLength={10} placeholder="Reason" />
                      <button className="btn btn-sm" type="submit">Propose turning {f.on ? "off" : "on"}</button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="c">
        <div className="c-head"><h2>Flag requests</h2></div>
        <DualControlQueue items={pending} viewer={v} back="/admin/flags" />
      </section>
    </>
  );
}
