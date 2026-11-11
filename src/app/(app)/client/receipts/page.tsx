/** F3.11 Client receipts: every release (gross, fee, net to the provider) and every return to you, per contract. */
import Link from "next/link";
import { requireViewer } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { TrancheCard } from "@/components/money/TrancheCard";
import { MoneyTable } from "@/components/money/MoneyTable";
import { noticesFor, receiptsFor, virtualNow } from "@/server/money/queries";
import "@/styles/money.css";

export const metadata = { title: "Receipts" };

export default async function Page() {
  const v = await requireViewer(["client", "judge"]);
  const list = await receiptsFor(v.id);
  const notices = await noticesFor(v.id);
  const paid = list.flatMap((c) => c.lines).filter((l) => l.kind !== "RETURN" && ["COMPLETED", "IN_FLIGHT"].includes(l.status)).reduce((s, l) => s + l.grossCents, 0);
  const returns = list.flatMap((c) => c.lines).filter((l) => l.kind === "RETURN");
  const back = returns.filter((l) => ["COMPLETED", "IN_FLIGHT"].includes(l.status)).reduce((s, l) => s + l.grossCents, 0);
  /* Rail A: a return inside an open authorization is never captured; PayPal releases it from the hold when the tranche closes */
  const kept = returns.filter((l) => l.status === "RECORDED").reduce((s, l) => s + l.grossCents, 0);
  const held = list.flatMap((c) => c.tranches).reduce((s, t) => s + t.balance.remaining, 0);
  return (
    <>
      <div className="phead">
        <div><h1>Receipts</h1><p className="sub">What you have paid, what came back to you, and what is still held in PayPal — per contract.</p></div>
        <div className="stats">
          <div className="hstat"><div className="v money">{formatCents(held)}</div><div className="l">still held in PayPal</div></div>
          <div className="hstat"><div className="v money">{formatCents(paid)}</div><div className="l">released to providers</div></div>
          <div className="hstat"><div className="v money">{formatCents(back)}</div><div className="l">returned to you</div></div>
          {kept > 0 && <div className="hstat"><div className="v money">{formatCents(kept)}</div><div className="l">never captured · PayPal releases it to you when the hold closes</div></div>}
        </div>
      </div>
      {notices.length > 0 && (
        <section className="c" aria-labelledby="n-h"><h2 id="n-h">Hold notices</h2>
          <ul className="money-notices">{notices.map((n) => <li key={n.id}>{n.message}<time dateTime={n.createdAt.toISOString()}>{n.createdAt.toUTCString().slice(0, 22)}</time></li>)}</ul>
        </section>
      )}
      {list.length === 0 && <div className="empty"><p>No money has moved yet. Receipts appear here once you fund a tranche.</p><Link className="btn btn-sm" href="/client/contracts">Your contracts</Link></div>}
      {await Promise.all(list.map(async (c) => {
        const now = await virtualNow(c.workspace.id);
        return (
          <section key={c.workspace.id} className="c" aria-labelledby={`w-${c.workspace.id}`}>
            <div className="c-head"><h2 id={`w-${c.workspace.id}`}><Link href={`/contracts/${c.workspace.id}`}>{c.workspace.title}</Link></h2><span className="r small muted">{formatCents(c.workspace.totalCents, c.workspace.currency)} contract</span></div>
            <div className="grid-cards">{c.tranches.map((t) => <TrancheCard key={t.id} t={t} now={now} compact fundHref={`/contracts/${c.workspace.id}/fund/${t.id}`} />)}</div>
            <MoneyTable lines={c.lines} currency={c.workspace.currency} who="client" />
          </section>
        );
      }))}
    </>
  );
}

