/**
 * Blueprint studio (F2.12 template analytics, F4.12 dispute rate per milestone code flagged over 8%; N = 5
 * suppression) + X2 F5.03: a blueprint is published or withdrawn only through four-eyes (proposer and approver differ,
 * both hold blueprint.publish), after a readiness check; every change is kept in the release history.
 */
import { desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { blueprints, users } from "@/db/schema";
import { blueprintReleases } from "@/db/schema-representment";
import { requireViewer } from "@/lib/session";
import { pct } from "@/lib/money";
import { disputeRates, funnel, shown, SUPPRESSED_LABEL } from "@/server/control/analytics";
import { canDualControl, expireDue, queue } from "@/server/control/dual";
import { proposeAction } from "@/server/control/actions";
import { blueprintProblems, bumpVersion } from "@/server/control/blueprint-release";
import { DualControlQueue, Flash, Head, one, Stat, type SP } from "@/components/console/parts";
import { fmtDate } from "@/components/console/format";
import "@/styles/console-extras.css";

export const metadata = { title: "Blueprint studio" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer(["marketing", "admin", "ops", "judge"]);
  const sp = await searchParams;
  await expireDue();
  const [bps, rates, f, q, hist] = await Promise.all([
    db.select().from(blueprints).orderBy(blueprints.vertical, blueprints.code), disputeRates(), funnel(), queue({ limit: 100 }),
    db.select().from(blueprintReleases).orderBy(desc(blueprintReleases.createdAt)).limit(20),
  ]);
  const people = hist.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...new Set(hist.flatMap((h) => [h.initiatorId, h.approverId]))])) : [];
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  const pub = q.filter((i) => i.action === "PUBLISH_BLUEPRINT");
  const waitingFor = (code: string) => pub.find((i) => i.state === "AWAITING" && i.target === code && i.expiresAt.getTime() > Date.now());
  const mayPropose = canDualControl(v.role, "PUBLISH_BLUEPRINT");
  const flagged = rates.rows.filter((r) => r.flagged);
  const ready = bps.filter((b) => blueprintProblems(b).length === 0);
  return (
    <>
      <Head title="Blueprint studio" sub={`How each template performs, and what is in the catalogue. Dispute rates come from the ${rates.source}; milestones disputed in more than 8% of contracts are flagged for a rewrite. Publishing needs a second person.`} />
      <Flash ok={one(sp.ok)} err={one(sp.err)} />
      <div className="cx-stats">
        <Stat label="Blueprints" value={bps.length} detail={`${bps.filter((b) => b.active).length} live in the catalogue`} />
        <Stat label="Ready to publish" value={ready.length} tone={ready.length === bps.length ? "ok" : "warn"} detail="pass the readiness check" />
        <Stat label="Waiting for approval" value={pub.filter((i) => i.state === "AWAITING").length} tone={pub.some((i) => i.state === "AWAITING") ? "held" : undefined} href="#publishing" />
        <Stat label="Milestones flagged" value={flagged.length} tone={flagged.length ? "warn" : "ok"} detail="dispute rate over 8%" />
      </div>

      <section className="c" id="publishing" aria-labelledby="pub-h">
        <div className="c-head"><h2 id="pub-h">Publishing (four-eyes)</h2><a className="r small" href="/admin/dual-control">All four-eyes requests</a></div>
        <p className="small">A template goes live, gets a new version, or is withdrawn only after a different person with publishing rights approves within 30 minutes. Signed contracts keep the version they were made from.</p>
        <DualControlQueue items={pub} viewer={v} back="/marketing/blueprints" />
        {pub.filter((i) => i.state === "AWAITING").map((i) => {
          const p = i.payload as { active?: boolean; version?: string; note?: string };
          return <p key={i.id} className="small muted">{i.id}: {p.active === false ? "withdraw" : `publish version ${p.version}`} of {i.target}{p.note ? ` — “${p.note}”` : ""}</p>;
        })}
        {mayPropose ? (
          <form action={proposeAction} className="cx-form cnx-pub" aria-describedby="pub-help">
            <input type="hidden" name="action" value="PUBLISH_BLUEPRINT" /><input type="hidden" name="back" value="/marketing/blueprints" />
            <div className="field"><label htmlFor="pb-target">Blueprint</label>
              <select id="pb-target" name="target" required defaultValue="">
                <option value="" disabled>Choose a blueprint</option>
                {bps.map((b) => <option key={b.code} value={b.code} disabled={Boolean(waitingFor(b.code))}>{b.title} — {b.active ? `live v${b.version}` : `withdrawn v${b.version}`}{waitingFor(b.code) ? " (request waiting)" : ""}</option>)}
              </select></div>
            <div className="field"><label htmlFor="pb-active">Change</label>
              <select id="pb-active" name="active" defaultValue="true"><option value="true">Publish (new version, or bring back)</option><option value="false">Withdraw from the catalogue</option></select></div>
            <div className="field"><label htmlFor="pb-version">Version</label>
              <input id="pb-version" name="version" className="input" pattern="\d{1,4}\.\d{1,4}\.\d{1,4}" inputMode="decimal" placeholder="next patch version" aria-describedby="pb-version-help" />
              <span id="pb-version-help" className="small muted">Leave empty for the next patch version (publish) or the current one (withdraw, bring back).</span></div>
            <div className="field wide"><label htmlFor="pb-reason">Reason (the approver reads this)</label><textarea id="pb-reason" name="reason" required minLength={10} maxLength={500} placeholder="Reworded M04 after the 9% dispute rate; proof now asks for a dated photo." /></div>
            <div className="field wide"><label htmlFor="pb-note">Release note (optional, kept in the history)</label><input id="pb-note" name="note" className="input" maxLength={300} /></div>
            <div className="row wide"><button className="btn btn-g" type="submit">Send for approval</button><span id="pub-help" className="small muted">The readiness check runs when you send: shares add up to 100%, proof and rules on every paid step, no contradicting clause.</span></div>
          </form>
        ) : <p className="small muted">Your role ({v.role}) can see publishing requests but not make them. Marketing and Operations publish.</p>}
        <h3 className="cnx-h3">Release history</h3>
        {hist.length === 0 ? <p className="muted small">No catalogue changes yet. The seeded catalogue is version 1.0.0.</p> : (
          <div className="tbwrap">
            <table className="ptable">
              <caption className="sr-only">Blueprint release history</caption>
              <thead><tr><th scope="col">When</th><th scope="col">Blueprint</th><th scope="col">Change</th><th scope="col">Proposed by</th><th scope="col">Approved by</th><th scope="col">Note</th></tr></thead>
              <tbody>{hist.map((h) => (
                <tr key={h.id}><td>{fmtDate(h.createdAt)}</td><td><code className="cx-code">{h.blueprintCode}</code></td><td>{h.action === "PUBLISH" ? `Published ${h.fromVersion} → ${h.toVersion}` : `Withdrawn at ${h.toVersion}`}</td><td>{nameOf(h.initiatorId)}</td><td>{nameOf(h.approverId)}</td><td className="small">{h.note}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {bps.map((b) => {
        const fr = f.byBlueprint.find((x) => x.code === b.code);
        const problems = blueprintProblems(b);
        const waiting = waitingFor(b.code);
        return (
          <section key={b.code} className="c" aria-labelledby={`bp-${b.code}`}>
            <div className="c-head"><h2 id={`bp-${b.code}`}>{b.title}</h2><span className="chip" data-b="plain">{b.vertical}</span><span className="chip" data-b={b.active ? "ok" : "none"}>{b.active ? "Live" : "Withdrawn"}</span><span className="small muted">v{b.version} · {b.depth} · {b.recommendedDays} days</span>
              <div className="r small muted">{fr ? `${shown(fr.created)} contracts · ${shown(fr.completed)} completed` : ""}</div></div>
            <p className="small">{b.summary}</p>
            <p className="small">
              {problems.length ? <><span className="chip" data-b="warn">Not ready to publish</span> {problems.join(" ")}</> : <span className="chip" data-b="ok">Ready to publish · next version {bumpVersion(b.version)}</span>}
              {waiting && <> <span className="chip" data-b="held">Request {waiting.id} waiting</span></>}
            </p>
            <div className="tbwrap">
              <table className="ptable">
                <caption className="sr-only">Milestones of {b.title} with dispute rate</caption>
                <thead><tr><th scope="col">Code</th><th scope="col">Milestone</th><th scope="col">Type</th><th scope="col" className="cx-r">Day</th><th scope="col" className="cx-r">Share</th><th scope="col" className="cx-r">In contracts</th><th scope="col" className="cx-r">Disputes</th><th scope="col" className="cx-r">Dispute rate</th></tr></thead>
                <tbody>
                  {b.milestones.map((m) => {
                    const r = rates.rows.find((x) => x.blueprintCode === b.code && x.milestoneCode === m.code);
                    return (
                      <tr key={m.code}>
                        <td><code className="cx-code">{m.code}</code></td><td>{m.title}</td><td>{m.type === "PAY" ? "Payment" : "Gate"}</td>
                        <td className="cx-r tnum">{m.day}</td><td className="cx-r tnum">{m.type === "PAY" ? pct(m.bps) : "—"}</td>
                        <td className="cx-r tnum">{r ? shown(r.milestones) : 0}</td>
                        <td className="cx-r tnum">{r ? (r.disputes === null ? <span className="small muted">{SUPPRESSED_LABEL}</span> : r.disputes) : 0}</td>
                        <td className="cx-r tnum">{!r ? "—" : r.rateBps === null ? <span className="small muted">{SUPPRESSED_LABEL}</span> : <span className="chip" data-b={r.flagged ? "danger" : "plain"}>{pct(r.rateBps)}{r.flagged ? " · rewrite" : ""}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
