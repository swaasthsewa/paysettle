/**
 * F1.1 · after registration: where the account stands and what comes next. Real data: the person's profile (e-mail
 * confirmation, time zone), their contracts (linked invites) and the open invites still waiting for a confirmed e-mail,
 * the provider onboarding checklist (F1.4/F1.6) and the authenticator state (F1.2).
 */
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { BrandMark } from "@/components/brand";
import { ActionForm } from "@/components/identity/action-form";
import { db } from "@/db/client";
import { paypalLinks, users, workspaces } from "@/db/schema";
import { common } from "@/copy/common";
import { sandboxMode } from "@/lib/clock";
import { homeFor, requireViewer } from "@/lib/session";
import { countryName } from "@/lib/identity/countries";
import { missingCredentials, type ProviderProfile } from "@/lib/identity/provider";
import { profileGaps, type StoredProfile } from "@/lib/identity/profile";
import { readOutbox } from "@/lib/identity/register-session";
import { openInvites } from "@/server/identity/invites";
import { resendConfirmation } from "./actions";
import "@/styles/register.css";

export const metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function Welcome({ searchParams }: { searchParams: Promise<{ confirmed?: string }> }) {
  const { confirmed } = await searchParams;
  const v = await requireViewer();
  const [u] = await db.select().from(users).where(eq(users.id, v.id)).limit(1);
  const p = (u?.profile ?? {}) as StoredProfile & { country?: string; emailVerifiedAt?: string; emailVerifiedBy?: string; registeredVia?: string; provider?: Partial<ProviderProfile> };
  const isParty = v.role === "client" || v.role === "provider";
  const mine = await db.select({ id: workspaces.id, title: workspaces.title, state: workspaces.state, revision: workspaces.revision })
    .from(workspaces).where(v.role === "provider" ? eq(workspaces.providerId, v.id) : eq(workspaces.clientId, v.id)).limit(20);
  const waiting = v.role === "provider" && !p.emailVerifiedAt ? await openInvites(v.email) : [];
  const [merchant] = v.role === "provider" ? await db.select({ receivable: paypalLinks.receivable }).from(paypalLinks).where(and(eq(paypalLinks.userId, v.id), eq(paypalLinks.kind, "merchant"))).limit(1) : [];
  const missing = v.role === "provider" ? missingCredentials(p.provider, Boolean(merchant?.receivable)) : [];
  const gaps = v.role === "client" ? profileGaps(p) : [];
  const outbox = p.emailVerifiedAt ? null : await readOutbox(v.id);
  const sandbox = sandboxMode();

  return (
    <main className="page reg-page" id="main">
      <Link href="/" className="row reg-brand"><BrandMark height={36} /><b style={{ fontSize: 22 }}>{common.product}</b></Link>
      <div className="phead"><div><h1>Welcome, {v.name.split(" ")[0]}</h1><p className="sub">Your {common.roles[v.role].toLowerCase()} account is open{p.country ? ` · ${countryName(p.country)}` : ""}{p.timezone ? ` · times in ${p.timezone.replace(/_/g, " ")}` : ""}.</p></div></div>
      {confirmed === "1" && <p className="notice" data-b="ok" role="status">E-mail address confirmed.</p>}

      <section className="c" aria-labelledby="em-h">
        <h2 id="em-h" className="reg-h">E-mail address</h2>
        {p.emailVerifiedAt ? (
          <p>{v.email} <span className="chip" data-b="ok">Confirmed{p.emailVerifiedBy === "demo-idp" ? " by the demo identity provider" : ""}</span></p>
        ) : (
          <>
            <p>{v.email} <span className="chip" data-b="warn">Not confirmed yet</span></p>
            <p className="small muted">Confirming proves the address is yours. Contract invites sent to it join your account only after that.{waiting.length ? ` ${waiting.length} invite${waiting.length === 1 ? " is" : "s are"} waiting for it.` : ""}</p>
            {sandbox ? (
              outbox ? (
                <div className="reg-outbox" role="note" aria-label="Sandbox outbox">
                  <b className="small">Sandbox outbox: the e-mail we would send</b>
                  <p className="small">Subject: Confirm your PaySettle e-mail address. The link works once, for 24 hours.</p>
                  <a href={outbox}>{outbox}</a>
                </div>
              ) : <p className="small muted">Sandbox: no link is waiting in this browser. Make a new one.</p>
            ) : <p className="small muted">This deployment has no e-mail sender configured, so confirmation links are not sent yet.</p>}
            <ActionForm action={resendConfirmation} submit="Make a new confirmation link" variant="btn btn-sm" />
          </>
        )}
      </section>

      {isParty && (
        <section className="c" aria-labelledby="ct-h">
          <h2 id="ct-h" className="reg-h">Contracts</h2>
          {mine.length > 0 ? (
            <ul className="reg-list">{mine.map((w) => (
              <li key={w.id}><b>{w.title}</b><span className="chip" data-b="plain">{w.state.replace(/_/g, " ").toLowerCase()}</span><span className="small muted">revision {w.revision}</span><span className="sp" /><Link className="btn btn-sm btn-g" href={`/contracts/${w.id}`}>Open the negotiation room</Link></li>
            ))}</ul>
          ) : v.role === "client" ? (
            <p className="small muted">No contracts yet. Start one from a blueprint and invite your provider by e-mail. <Link href="/client/new">New contract</Link></p>
          ) : (
            <p className="small muted">No contracts yet. When a client invites you by e-mail, the contract appears here{p.emailVerifiedAt ? "" : " once your e-mail is confirmed"}.</p>
          )}
        </section>
      )}

      <section className="c" aria-labelledby="nx-h">
        <h2 id="nx-h" className="reg-h">Next steps</h2>
        <ol className="reg-steps">
          {v.role === "provider" && (
            <li>
              <b>Provider onboarding.</b> {missing.length ? `Still needed before your first payout: ${missing.join("; ")}.` : "Everything is in; Ops reviews it before the first payout."} You can negotiate and sign contracts meanwhile.{" "}
              <Link href="/provider/onboarding">Open onboarding &amp; PayPal</Link>
            </li>
          )}
          {v.role === "client" && (
            <li><b>Profile.</b> {gaps.length ? `Before you fund a milestone, add your ${gaps.join(", ")}.` : "Your profile has what funding needs."} <Link href="/account">Account &amp; security</Link></li>
          )}
          <li><b>Authenticator app.</b> {v.mfa ? "On for this session." : v.role === "provider" ? "Providers need it outside the sandbox." : "Optional for clients; it protects signatures."} <Link href="/account">Account &amp; security</Link></li>
          <li><Link href={homeFor(v.role)}>Go to your overview</Link></li>
        </ol>
      </section>
    </main>
  );
}
