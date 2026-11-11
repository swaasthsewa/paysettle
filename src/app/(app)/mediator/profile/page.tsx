/**
 * F4.05 F4.06 — /mediator/profile: the mediator's own network profile, scorecard, availability, credentials
 * (file hash only; bytes in the evidence store), calibration on three sealed sample cases, and fees paid by PaySettle.
 */
import Link from "next/link";
import "@/styles/disputes.css";
import "@/styles/mediators.css";
import { requireViewer } from "@/lib/session";
import { myProfile } from "@/server/mediators";
import { availabilityAction, calibrationAction, credentialAction, updateProfileAction } from "@/server/mediators/actions";
import { CALIBRATION_MAX_ATTEMPTS, COSIGN_FEE_CENTS, LANGUAGES, MEDIATOR_FEE_CENTS, PROBATION_COSIGNS, STATUS_CHIP, STATUS_LABEL } from "@/server/mediators/rules";
import { domainLabel } from "@/server/mediators/domains";
import { ROOT_CAUSES } from "@/server/disputes/rules";
import { Flash } from "@/components/disputes/parts";
import { money, when } from "@/components/disputes/format";

export const metadata = { title: "My mediator profile" };

const ZONES = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC"]; } })();
const today = () => new Date().toISOString().slice(0, 10);

export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const v = await requireViewer(["mediator"]);
  const q = await searchParams;
  const m = await myProfile(v.id, v.orgId);
  if (!m) {
    return (
      <>
        <div className="phead"><div><h1>My profile and credentials</h1></div></div>
        <div className="empty"><b>You do not have a network profile yet.</b><span className="small">Ops creates it when an application is approved. Applications are on the public <Link href="/mediators">mediators page</Link>.</span></div>
      </>
    );
  }
  const p = m.profile, av = m.availability;
  const zones = ZONES.includes(p.timezone) ? ZONES : [p.timezone, ...ZONES];
  const roots = Object.entries(ROOT_CAUSES).filter(([k]) => k !== "AGREED_TIER1");
  const attemptsLeft = CALIBRATION_MAX_ATTEMPTS - p.calibrationAttempts;
  const verified = m.credentials.filter((c) => c.status === "VERIFIED" && (!c.expiresOn || c.expiresOn >= today()));
  const accrued = m.fees.filter((f) => f.status === "ACCRUED").reduce((a, f) => a + f.amountCents, 0);
  return (
    <>
      <div className="phead">
        <div>
          <h1>My profile and credentials</h1>
          <p className="sub">{v.name} · {p.firm ? p.firm : "Independent"} · {p.domains.map((d) => domainLabel(d)).join(", ") || "no domains yet"}</p>
        </div>
        <div className="stats">
          <div className="hstat"><div className="v" style={{ fontSize: 18 }}><span className="chip" data-b={STATUS_CHIP[p.status]}>{STATUS_LABEL[p.status]}</span></div><div className="l">Network status</div></div>
          <div className="hstat"><div className="v tnum">{p.verdictCount}</div><div className="l">Verdicts signed</div></div>
          <div className="hstat"><div className="v tnum">{m.card.slaPct === null ? "—" : `${m.card.slaPct}%`}</div><div className="l">Within 48 h (90 days)</div></div>
          <div className="hstat"><div className="v tnum">{m.card.rating === null ? "—" : m.card.rating.toFixed(1)}</div><div className="l">Rating ({m.card.ratingN})</div></div>
        </div>
      </div>
      <Flash ok={q.ok} error={q.error} />
      {p.status === "PROBATION" && <p className="notice">You are on probation: the Ops lead assigns your first cases, and a Senior mediator co-signs each of your first {PROBATION_COSIGNS} verdicts ({Math.min(p.verdictCount, PROBATION_COSIGNS)} signed so far). After {PROBATION_COSIGNS} co-signed verdicts you move to Active on your own.</p>}
      {p.status === "VERIFYING" && <p className="notice">Ops is checking your credentials. Calibration opens once at least one credential is verified ({verified.length} so far).</p>}

      <div className="bento">
        <section className="c span7" aria-labelledby="mp-prof">
          <div className="c-head"><h2 id="mp-prof">Profile</h2></div>
          <form action={updateProfileAction} className="stack">
            <div className="field"><label htmlFor="mp-bio">About you (shown to Ops and to parties on your cases)</label><textarea id="mp-bio" name="bio" maxLength={1200} defaultValue={p.bio} /></div>
            <fieldset className="md-checks"><legend>Languages you mediate in</legend>
              {Object.entries(LANGUAGES).map(([k, l]) => <label key={k}><input type="checkbox" name="languages" value={k} defaultChecked={p.languages.includes(k)} /> {l}</label>)}
            </fieldset>
            <div className="md-grid2">
              <div className="field"><label htmlFor="mp-tz">Time zone</label><select id="mp-tz" name="timezone" defaultValue={p.timezone}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select></div>
              <div className="field"><label htmlFor="mp-max">Most open cases at once</label><input id="mp-max" name="maxOpen" type="number" min={1} max={12} defaultValue={p.maxOpen} /></div>
            </div>
            <div className="field"><label htmlFor="mp-coi">Declared conflicts, one per line (people, e-mails or companies you must not judge)</label><textarea id="mp-coi" name="declaredConflicts" defaultValue={p.declaredConflicts.join("\n")} /></div>
            <p className="small muted">Domains ({p.domains.map((d) => domainLabel(d)).join(", ") || "none"}) and firm ({p.firm ?? "independent"}) are set by Ops, because they decide which cases and co-signatures you can take.</p>
            <div className="row"><button className="btn" type="submit">Save profile</button></div>
          </form>
        </section>

        <section className="c span5" aria-labelledby="mp-av">
          <div className="c-head"><h2 id="mp-av">Availability</h2></div>
          <form action={availabilityAction} className="stack">
            <div className="field"><label htmlFor="mp-wh">Hours a week for PaySettle cases</label><input id="mp-wh" name="weeklyHours" type="number" min={0} max={60} defaultValue={av?.weeklyHours ?? 10} /></div>
            <div className="md-grid2">
              <div className="field"><label htmlFor="mp-lf">Leave from</label><input id="mp-lf" name="leaveFrom" type="date" defaultValue={av?.leaveFrom ?? ""} /></div>
              <div className="field"><label htmlFor="mp-lt">Leave until</label><input id="mp-lt" name="leaveTo" type="date" defaultValue={av?.leaveTo ?? ""} /></div>
            </div>
            <label className="row small"><input type="checkbox" name="paused" defaultChecked={av?.paused ?? false} /> Pause new offers (cases you hold stay with you)</label>
            <div className="row"><button className="btn" type="submit">Save availability</button></div>
          </form>
          <dl className="kv">
            <div><dt>Open cases</dt><dd className="tnum">{m.card.open} of {p.maxOpen}</dd></div>
            <div><dt>Second reviews agreed</dt><dd>{m.card.agreePct === null ? "—" : `${m.card.agreePct}%`}</dd></div>
            <div><dt>Your fee per verdict</dt><dd className="money">{money(MEDIATOR_FEE_CENTS[p.status === "SENIOR" ? "SENIOR" : p.status === "PROBATION" ? "PROBATION" : "ACTIVE"])}<small>Co-signature {money(COSIGN_FEE_CENTS)}. Paid by PaySettle from its own fee income, never from a held amount.</small></dd></div>
          </dl>
        </section>

        <section className="c span12" aria-labelledby="mp-cr">
          <div className="c-head"><h2 id="mp-cr">Credentials</h2><span className="chip" data-b={verified.length ? "ok" : "warn"}>{verified.length} verified and current</span></div>
          {m.credentials.length ? (
            <div className="tbwrap"><table className="tb"><thead><tr><th>Credential</th><th>Number</th><th>Expires</th><th>File</th><th>Status</th></tr></thead><tbody>
              {m.credentials.map((c) => {
                const expired = !!c.expiresOn && c.expiresOn < today();
                return (
                  <tr key={c.id}><td><b>{c.type}</b><div className="small muted">{c.issuer}</div></td><td className="tnum">{c.numberMasked}</td>
                    <td className="small">{c.expiresOn ?? "No expiry"}{expired && <div><span className="chip" data-b="danger">Expired</span></div>}</td>
                    <td className="small">{c.fileSha256 ? <>{c.fileName}<div className="muted">SHA-256 {c.fileSha256.slice(0, 12)}…</div></> : "—"}</td>
                    <td><span className="chip" data-b={c.status === "VERIFIED" ? "ok" : c.status === "REJECTED" ? "danger" : "warn"}>{c.status === "VERIFIED" ? "Verified" : c.status === "REJECTED" ? "Rejected" : "Waiting for Ops"}</span>{c.note && <div className="small muted">{c.note}</div>}</td></tr>
                );
              })}
            </tbody></table></div>
          ) : <p className="muted small">No credentials yet. Add a licence, bar membership or mediation accreditation below.</p>}
          <form action={credentialAction} className="stack" encType="multipart/form-data">
            <div className="md-inline">
              <div className="field grow"><label htmlFor="mc-type">Type</label><input id="mc-type" name="type" required minLength={2} maxLength={80} placeholder="Mediation accreditation" /></div>
              <div className="field grow"><label htmlFor="mc-iss">Issuer</label><input id="mc-iss" name="issuer" required minLength={2} maxLength={120} /></div>
              <div className="field"><label htmlFor="mc-no">Number</label><input id="mc-no" name="number" required minLength={3} maxLength={60} autoComplete="off" aria-describedby="mc-no-h" /></div>
              <div className="field"><label htmlFor="mc-exp">Expires on</label><input id="mc-exp" name="expiresOn" type="date" /></div>
            </div>
            <div className="field"><label htmlFor="mc-file">Copy of the certificate (PDF, PNG or JPEG, up to 5 MB)</label><input id="mc-file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" /></div>
            <p id="mc-no-h" className="small muted">Only the last four characters of the number are kept. The file is stored under its SHA-256 and never shown inline.</p>
            <div className="row"><button className="btn" type="submit">Add credential</button></div>
          </form>
        </section>

        <section className="c span12" aria-labelledby="mp-cal">
          <div className="c-head"><h2 id="mp-cal">Calibration</h2>
            {p.calibrationScore !== null && <span className="chip" data-b={p.calibrationScore >= 100 ? "ok" : "warn"}>Best attempt {p.calibrationScore}%</span>}
            <span className="chip" data-b="plain">{p.calibrationAttempts} of {CALIBRATION_MAX_ATTEMPTS} attempts used</span></div>
          <p className="small">Three sealed sample cases built from real blueprints. Pass: every split within 10 points of the reference and the right root cause. The reference answers stay sealed; you see how many cases passed, not which.</p>
          {m.attempts.length > 0 && <ul className="small">{m.attempts.map((x) => <li key={x.attempt}>Attempt {x.attempt}: {x.passed} of {x.of} cases passed</li>)}</ul>}
          {p.status === "CALIBRATING" && attemptsLeft > 0 ? (
            <form action={calibrationAction} className="stack">
              {m.cases.map((c, i) => (
                <fieldset key={c.id} className="md-case">
                  <legend><b>Case {i + 1} · {c.title}</b> <span className="small muted">({c.blueprintCode} {c.milestoneCode}, {money(c.amountCents)} frozen)</span></legend>
                  <input type="hidden" name="caseId" value={c.id} />
                  <p className="small">{c.facts}</p>
                  <blockquote className="md-quote"><b>Client:</b> {c.client}</blockquote>
                  <blockquote className="md-quote"><b>Provider:</b> {c.provider}</blockquote>
                  <ul>{c.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
                  <div className="md-inline">
                    <div className="field"><label htmlFor={`cal-s-${c.id}`}>Share to the provider (%)</label><input id={`cal-s-${c.id}`} name={`share_${c.id}`} type="number" min={0} max={100} step={0.5} required /></div>
                    <div className="field grow"><label htmlFor={`cal-r-${c.id}`}>Root cause</label>
                      <select id={`cal-r-${c.id}`} name={`root_${c.id}`} required defaultValue=""><option value="" disabled>Pick one</option>{roots.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                  </div>
                </fieldset>
              ))}
              <div className="row"><button className="btn btn-g" type="submit">Submit calibration</button><span className="small muted">{attemptsLeft} attempt{attemptsLeft === 1 ? "" : "s"} left</span></div>
            </form>
          ) : (
            <p className="muted small">{p.status === "CALIBRATING" ? "No attempts left. Ops can reset calibration after a conversation." : ["PROBATION", "ACTIVE", "SENIOR"].includes(p.status) ? "Calibration passed." : "Calibration opens when your status is Calibrating."}</p>
          )}
        </section>

        <section className="c span12" aria-labelledby="mp-fee">
          <div className="c-head"><h2 id="mp-fee">Your fees</h2><span className="chip" data-b="plain">{money(accrued)} waiting to be paid</span></div>
          {m.fees.length ? (
            <div className="tbwrap"><table className="tb"><thead><tr><th>Case</th><th>For</th><th>Recorded</th><th className="n">Amount</th><th>Status</th></tr></thead><tbody>
              {m.fees.map((f) => <tr key={f.id}><td><Link href={`/mediator/cases/${f.disputeId}`}>{f.disputeId.slice(0, 14)}…</Link></td><td className="small">{f.role === "COSIGN" ? "Co-signature" : `Verdict (${f.tier.toLowerCase()})`}</td><td className="small">{when(f.createdAt)}</td><td className="n money">{money(f.amountCents)}</td><td><span className="chip" data-b={f.status === "PAID" ? "ok" : "warn"}>{f.status === "PAID" ? "Paid" : "Accrued"}</span></td></tr>)}
            </tbody></table></div>
          ) : <p className="muted small">No fees yet. Each verdict you sign records a flat fee; Finance pays it from PaySettle&apos;s own income.</p>}
        </section>
      </div>
    </>
  );
}
