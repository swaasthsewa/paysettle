/**
 * F1.8 baseline handshake page: the versioned platform terms, accepted once per version before any workspace opens.
 * Reached from every sign-in path while the current version is not accepted (no session exists yet).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { BrandMark } from "@/components/brand";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { common } from "@/copy/common";
import { homeFor, viewer } from "@/lib/session";
import { TERMS_POINTS, TERMS_VERSION, termsState } from "@/lib/identity/handshake";
import { pendingHandshake } from "@/lib/identity/handshake-session";
import { acceptTerms, declineTerms } from "./actions";

export const metadata = { title: "Platform terms" };
export const dynamic = "force-dynamic";

export default async function TermsAccept({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const p = await pendingHandshake();
  const v = p ? null : await viewer();
  const userId = p?.u ?? v?.id;
  if (!userId) redirect("/login");
  const [u] = await db.select({ name: users.name, role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) redirect("/login");
  if (!p && (await termsState(userId)) === "ACCEPTED") redirect(homeFor(u.role));
  return (
    <main className="page" style={{ maxWidth: 760, paddingTop: 48 }}>
      <Link href="/" className="row" style={{ textDecoration: "none", gap: 10 }}><BrandMark height={36} /><b style={{ fontSize: 22 }}>{common.product}</b></Link>
      <div className="phead"><div><h1>Before you start, {u.name.split(" ")[0]}</h1><p className="sub">Accept the platform terms once. Version {TERMS_VERSION}.</p></div></div>
      {error && <p className="notice" role="alert">{error}</p>}
      <section className="c stack" aria-labelledby="terms-h">
        <h2 id="terms-h" style={{ fontSize: 20 }}>What you are agreeing to</h2>
        <ul className="stack">{TERMS_POINTS.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="small muted">Full text: <Link href="/terms" target="_blank">platform terms</Link>. Your decision is recorded with the time, your IP address, your browser and the terms version, and signed so it cannot be changed later.</p>
        <form action={acceptTerms} className="stack">
          <input type="hidden" name="version" value={TERMS_VERSION} />
          <label className="row" style={{ gap: 8 }}><input type="checkbox" name="agree" required /> I have read and accept the platform terms, version {TERMS_VERSION}.</label>
          <div className="row">
            <button className="btn btn-g" type="submit">Accept and continue</button>
            <button className="btn btn-gh" type="submit" formAction={declineTerms} formNoValidate>Decline and sign out</button>
          </div>
        </form>
        <p className="small muted">If you decline, no workspace opens: contracts, funding and payouts stay closed until you accept.</p>
      </section>
    </main>
  );
}
