/** F3.08 F3.11 Provider payouts: released to me (net of the platform fee), still held for me in PayPal, and fees. */
import Link from "next/link";
import { requireViewer } from "@/lib/session";
import { formatCents } from "@/lib/money";
import { TrancheCard } from "@/components/money/TrancheCard";
import { MoneyTable } from "@/components/money/MoneyTable";
import { noticesFor, payoutsFor, virtualNow } from "@/server/money/queries";
import "@/styles/money.css";

export const metadata = { title: "Payouts" };

export default async function Page() {
  const v = await requireViewer(["provider", "judge"]);
  const list = await payoutsFor(v.id);
  const notices = await noticesFor(v.id);
  const lines = list.flatMap((c) => c.lines).filter((l) => l.kind !== "RETURN");
  const done = lines.filter((l) => ["COMPLETED", "IN_FLIGHT"].includes(l.status));
  const net = done.reduce((s, l) => s + l.netCents, 0), fees = done.reduce((s, l) => s + l.feeCents, 0);
  const stuck = lines.filter((l) => ["PENDING", "FAILED"].includes(l.status)).reduce((s, l) => s + l.grossCents, 0);
  const held = list.flatMap((c) => c.tranches).reduce((s, t) => s + t.balance.remaining, 0);
  return (
    <>
      <div className="phead">
        <div><h1>Payouts</h1><p className="sub">Each approved milestone is paid to your PayPal business account. Money still held is reserved in the client&apos;s PayPal account until the client approves your evidence.</p></div>
        <div className="stats">
          <div className="hstat"><div className="v money">{formatCents(net)}</div><div className="l">released to you</div></div>
          <div className="hstat"><div className="v money">{formatCents(held)}</div><div className="l">held for your milestones</div></div>
          <div className="hstat"><div className="v money">{formatCents(fees)}</div><div className="l">platform fees</div></div>
        </div>
      </div>
      {stuck > 0 && <p className="notice" data-b="warn">{formatCents(stuck)} is approved and being paid; PayPal did not confirm yet. PaySettle retries with the same PayPal request id, which PayPal uses to avoid paying twice.</p>}
      {notices.length > 0 && (
        <section className="c" aria-labelledby="n-h"><h2 id="n-h">Hold notices</h2>
          <ul className="money-notices">{notices.map((n) => <li key={n.id}>{n.message}<time dateTime={n.createdAt.toISOString()}>{n.createdAt.toUTCString().slice(0, 22)}</time></li>)}</ul>
        </section>
      )}
      {list.length === 0 && <div className="empty"><p>No payouts yet. They appear here once a client funds a tranche on one of your contracts.</p><Link className="btn btn-sm" href="/provider/contracts">Your contracts</Link></div>}
      {await Promise.all(list.map(async (c) => {
        const now = await virtualNow(c.workspace.id);
        return (
          <section key={c.workspace.id} className="c" aria-labelledby={`w-${c.workspace.id}`}>
            <div className="c-head"><h2 id={`w-${c.workspace.id}`}><Link href={`/contracts/${c.workspace.id}`}>{c.workspace.title}</Link></h2><span className="r small muted">{formatCents(c.workspace.totalCents, c.workspace.currency)} contract</span></div>
            <div className="grid-cards">{c.tranches.map((t) => <TrancheCard key={t.id} t={t} now={now} compact />)}</div>
            <MoneyTable lines={c.lines} currency={c.workspace.currency} who="provider" />
          </section>
        );
      }))}
    </>
  );
}
