/**
 * F1.10 Identity auditor (/admin/identities, admin and ops): search and filter people by role, onboarding state, lock,
 * MFA, last sign-in, PayPal link and terms status (F1.8); open one person's audit trail (entries where they are actor or
 * target). Read-only. Anyone else gets "access denied" and the attempt is written to the audit chain.
 */
import { db } from "@/db/client";
import { ROLES } from "@/db/schema";
import { common } from "@/copy/common";
import { audit } from "@/lib/audit";
import { requireViewer } from "@/lib/session";
import { TERMS_VERSION } from "@/lib/identity/handshake";
import { DataTable } from "@/components/console/DataTable";
import { Head, one, Stat, type SP } from "@/components/console/parts";
import { fmtDate, human, iso } from "@/components/console/format";
import { applyFilter, auditorAccess, identityRows, parseFilter, userById, userTrail } from "./query";
import { LicenceSuggestions } from "@/components/identity/licence-suggestions";
import { licenceReview } from "@/server/identity/licences";

export const metadata = { title: "Identity auditor" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: SP }) {
  const v = await requireViewer();
  if (!auditorAccess(v.role)) {
    await audit(db, { id: v.id, role: v.role }, "identity.auditor_denied", "/admin/identities", {});
    return (
      <>
        <Head title="Access denied" sub="The identity auditor is open to platform administrators and Operations only." />
        <p className="notice" data-b="danger" role="alert">You do not have access to this page. The attempt was recorded in the audit trail.</p>
      </>
    );
  }
  const sp = await searchParams;
  const raw = { q: one(sp.q), role: one(sp.role), state: one(sp.state), locked: one(sp.locked), mfa: one(sp.mfa), seen: one(sp.seen), paypal: one(sp.paypal), terms: one(sp.terms) };
  const f = parseFilter(raw);
  const now = new Date();
  const all = await identityRows();
  const rows = applyFilter(all, f, now);
  const states = [...new Set(all.map((r) => r.state))].sort();
  const focus = one(sp.user);
  const person = focus && /^[A-Za-z0-9_-]{1,64}$/.test(focus) ? await userById(focus) : null;
  const trail = person ? await userTrail(person.id) : [];
  const lic = person && person.role === "provider" ? await licenceReview(v.role, person.id) : null;
  if (person) await audit(db, { id: v.id, role: v.role }, "identity.auditor_view", person.id, { entries: trail.length });
  const qs = (extra: Record<string, string>) => "?" + new URLSearchParams(Object.entries({ ...raw, ...extra }).filter(([, x]) => x)).toString();
  const locked = all.filter((r) => r.lockedUntil && r.lockedUntil > now).length;
  const staffNoMfa = all.filter((r) => ["admin", "ops", "mediator", "finance", "provider"].includes(r.role) && !r.mfa).length;
  const pendingTerms = all.filter((r) => r.terms !== "ACCEPTED").length;

  return (
    <>
      <Head title="Identity auditor" sub="Who can sign in, how they are secured, and everything they did or had done to their account. Read-only.">
        <Stat label="People" value={all.length} />
        <Stat label="Paused accounts" value={locked} tone={locked ? "warn" : "ok"} />
        <Stat label="Need MFA, not set up" value={staffNoMfa} tone={staffNoMfa ? "warn" : "ok"} detail="Sandbox sign-in skips this check" />
        <Stat label={`Terms ${TERMS_VERSION} not accepted`} value={pendingTerms} tone={pendingTerms ? "warn" : "ok"} />
      </Head>
      <section className="c">
        <form className="cx-form" method="get" aria-label="Filter people">
          <div className="field"><label htmlFor="i-q">Name, email or id</label><input id="i-q" name="q" type="search" defaultValue={raw.q} /></div>
          <div className="field"><label htmlFor="i-role">Role</label>
            <select id="i-role" name="role" defaultValue={raw.role}><option value="">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{common.roles[r]}</option>)}</select></div>
          <div className="field"><label htmlFor="i-state">Onboarding state</label>
            <select id="i-state" name="state" defaultValue={raw.state}><option value="">Any</option>{states.map((s) => <option key={s} value={s}>{human(s)}</option>)}</select></div>
          <div className="field"><label htmlFor="i-locked">Paused</label>
            <select id="i-locked" name="locked" defaultValue={raw.locked}><option value="">Any</option><option value="yes">Paused now</option><option value="no">Not paused</option></select></div>
          <div className="field"><label htmlFor="i-mfa">Authenticator (MFA)</label>
            <select id="i-mfa" name="mfa" defaultValue={raw.mfa}><option value="">Any</option><option value="on">On</option><option value="off">Off</option></select></div>
          <div className="field"><label htmlFor="i-seen">Last sign-in</label>
            <select id="i-seen" name="seen" defaultValue={raw.seen}><option value="">Any time</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="older">More than 30 days ago</option><option value="never">Never</option></select></div>
          <div className="field"><label htmlFor="i-pp">PayPal</label>
            <select id="i-pp" name="paypal" defaultValue={raw.paypal}><option value="">Any</option><option value="none">Not linked</option><option value="linked">Linked, cannot receive</option><option value="receivable">Linked, can receive</option></select></div>
          <div className="field"><label htmlFor="i-terms">Platform terms</label>
            <select id="i-terms" name="terms" defaultValue={raw.terms}><option value="">Any</option><option value="ACCEPTED">Accepted</option><option value="PENDING">Not yet</option><option value="DECLINED">Declined</option></select></div>
          <div className="row"><button className="btn btn-d btn-sm" type="submit">Apply</button><a className="btn btn-gh btn-sm" href="/admin/identities">Clear</a></div>
        </form>
        <DataTable caption={`People (${rows.length} of ${all.length})`} getRowId="id" quickFilter pagination paginationPageSize={25}
          columnDefs={[
            { field: "name", headerName: "Person", type: "link" },
            { field: "email", headerName: "Email", type: "code" },
            { field: "role", headerName: "Role", filter: true },
            { field: "state", headerName: "Onboarding", type: "state" },
            { field: "locked", headerName: "Paused", type: "chip" },
            { field: "mfa", headerName: "MFA", type: "chip" },
            { field: "last", headerName: "Last sign-in", type: "date" },
            { field: "paypal", headerName: "PayPal", type: "chip" },
            { field: "terms", headerName: "Terms", type: "chip" },
          ]}
          rowData={rows.map((r) => ({
            id: r.id, name: { href: qs({ user: r.id }), label: r.name + (r.persona ? " (demo)" : "") }, email: r.email, role: common.roles[r.role], state: r.state,
            locked: r.lockedUntil && r.lockedUntil > now ? { label: `until ${fmtDate(r.lockedUntil)}`, tone: "danger" } : { label: "no", tone: "plain" },
            mfa: r.mfa ? { label: "on", tone: "ok" } : { label: "off", tone: ["client", "judge", "marketing"].includes(r.role) ? "plain" : "warn" },
            last: iso(r.lastSignIn),
            paypal: r.paypal === "receivable" ? { label: "can receive", tone: "ok" } : r.paypal === "linked" ? { label: "linked", tone: "warn" } : { label: "not linked", tone: "plain" },
            terms: r.terms === "ACCEPTED" ? { label: "accepted", tone: "ok" } : r.terms === "DECLINED" ? { label: "declined", tone: "danger" } : { label: "not yet", tone: "warn" },
          }))}
          emptyText="Nobody matches these filters." />
      </section>
      {focus && !person && <p className="notice" role="alert">No person with id {focus}.</p>}
      {person && (
        <section className="c" aria-labelledby="trail-h">
          <div className="c-head"><h2 id="trail-h">Audit trail · {person.name}</h2><a className="btn btn-gh btn-sm" href={qs({})}>Close</a></div>
          <p className="small muted">{person.email} · {common.roles[person.role]} · the latest {trail.length} entries where {person.name.split(" ")[0]} acted or was acted on. Opening this trail is itself recorded.</p>
          <DataTable caption={`Audit trail for ${person.name}`} getRowId="seq"
            columnDefs={[
              { field: "seq", headerName: "#", type: "number", width: 70 },
              { field: "at", headerName: "When", type: "date" },
              { field: "who", headerName: "Who", type: "chip" },
              { field: "action", headerName: "Action", type: "code", filter: true },
              { field: "target", headerName: "Target", type: "code" },
              { field: "detail", headerName: "Detail" },
            ]}
            rowData={trail.map((t) => ({
              seq: t.seq, at: iso(t.at), who: t.actorId === person.id ? { label: "this person", tone: "plain" } : { label: t.actorRole ?? "system", tone: "warn" },
              action: t.action, target: t.target, detail: JSON.stringify(t.detail).slice(0, 140),
            }))}
            emptyText="No audit entries for this person yet." />
          {lic && (<div className="stack"><h3>Licences · suggested fields (OCR assist, advice only)</h3><LicenceSuggestions licences={lic.licences} todayIso={new Date().toISOString().slice(0, 10)} /></div>)}
        </section>
      )}
    </>
  );
}
