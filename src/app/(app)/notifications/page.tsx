/** F1.10 Notifications: the signed-in person's own hold, money and review notices, newest first, read-only. */
import Link from "next/link";
import { requireViewer } from "@/lib/session";
import { noticesForViewer } from "@/server/notifications";
import "@/styles/money.css";

export const metadata = { title: "Notifications" };

export default async function Page() {
  const v = await requireViewer();
  const items = await noticesForViewer(v);
  return (
    <>
      <div className="phead">
        <div><h1>Notifications</h1><p className="sub">Notices about your contracts: holds, releases, refunds, changes and review timers. Newest first.</p></div>
      </div>
      {items.length === 0
        ? <div className="empty"><p>No notifications yet. Notices appear here when something on one of your contracts needs your attention.</p></div>
        : (
          <section className="c" aria-labelledby="nt-h"><h2 id="nt-h">{items.length} {items.length === 1 ? "notice" : "notices"}</h2>
            <ul className="money-notices">{items.map((n) => (
              <li key={`${n.source}:${n.id}`}>
                <b>{n.source === "evidence" ? n.title : n.contractTitle}</b>
                <div>{n.body}</div>
                <Link href={n.href}>{n.source === "evidence" ? `Open the milestone in ${n.contractTitle}` : `Open ${n.contractTitle}`}</Link>
                <time dateTime={n.createdAt.toISOString()}>{n.createdAt.toUTCString().slice(0, 22)}</time>
              </li>
            ))}</ul>
          </section>
        )}
    </>
  );
}
