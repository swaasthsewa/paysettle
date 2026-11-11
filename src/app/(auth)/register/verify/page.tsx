/** F1.1 · the page an e-mail confirmation link opens: shows which address is being confirmed and asks for one press. */
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { common } from "@/copy/common";
import { readVerifyToken } from "@/lib/identity/email-verify";
import { confirmEmailAction } from "./actions";
import "@/styles/register.css";

export const metadata = { title: "Confirm your e-mail" };
export const dynamic = "force-dynamic";

export default async function Verify({ searchParams }: { searchParams: Promise<{ t?: string; problem?: string; already?: string }> }) {
  const sp = await searchParams;
  const claim = sp.t ? readVerifyToken(sp.t) : null;
  return (
    <main className="page reg-page" id="main">
      <Link href="/" className="row reg-brand"><BrandMark height={36} /><b style={{ fontSize: 22 }}>{common.product}</b></Link>
      <div className="phead"><div><h1>Confirm your e-mail address</h1></div></div>
      {sp.problem ? (
        <section className="c">
          <p className="notice" data-b={sp.already ? "ok" : "warn"} role="alert">{sp.problem.slice(0, 300)}</p>
          <div className="row"><Link className="btn" href="/register/welcome">Go to your welcome page</Link><Link className="btn btn-gh" href="/login">Sign in</Link></div>
        </section>
      ) : claim ? (
        <section className="c" aria-labelledby="cf-h">
          <h2 id="cf-h" className="reg-h">Is {claim.e} your address?</h2>
          <p className="small muted">Confirming lets contract invites sent to this address join your account.</p>
          <form action={confirmEmailAction} className="row">
            <input type="hidden" name="t" value={sp.t} />
            <button className="btn btn-g" type="submit">Yes, confirm {claim.e}</button>
          </form>
        </section>
      ) : (
        <section className="c">
          <p className="notice" data-b="warn" role="alert">This confirmation link is not valid or has expired. Sign in and make a new one from your welcome page.</p>
          <div className="row"><Link className="btn" href="/login">Sign in</Link></div>
        </section>
      )}
    </main>
  );
}
