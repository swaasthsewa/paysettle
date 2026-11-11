import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand";
import { JudgeTour } from "@/components/tour/JudgeTour";
import { NavGroups } from "@/components/nav";
import { AppFooter } from "@/components/shell/footer";
import { RAIL_BOOT } from "@/components/shell/rail";
import { TopBar, initialOf } from "@/components/shell/topbar";
import { common } from "@/copy/common";
import { menuGroups } from "@/lib/menu";
import { homeFor, requireViewer } from "@/lib/session";
import { sandboxMode } from "@/lib/clock";
import { redirect } from "next/navigation";
import { termsState } from "@/lib/identity/handshake";
import { scriptNonce } from "@/lib/nonce";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const v = await requireViewer();
  if ((await termsState(v.id)) !== "ACCEPTED") redirect("/terms-accept");
  const home = homeFor(v.role);
  const nonce = await scriptNonce();
  return (
    <div className="shell">
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: RAIL_BOOT }} />
      <a className="skip" href="#page">{common.nav.skip}</a>
      <aside className="side" id="app-side">
        <Link href={home} className="logo" title={common.product}><BrandMark /><span className="side-text">{common.product}</span></Link>
        <Link href="/account" className="who" title={v.name}>
          <i className="who-initial" aria-hidden="true">{initialOf(v.name)}</i>
          <span className="side-text"><b>{v.name}</b><span>{common.roles[v.role]}{v.demo ? " · demo" : ""}</span></span>
        </Link>
        <nav aria-label={common.nav.menu}><NavGroups groups={menuGroups(v.role, v.demo)} /></nav>
      </aside>
      <div className="main">
        {sandboxMode() && <div className="sim-banner" role="note">Sandbox — PayPal Sandbox or simulated money only. Nothing real moves.{v.role === "judge" && <> <JudgeTour className="btn btn-sm tour-inline" /></>}</div>}
        <TopBar home={home} person={{ initial: initialOf(v.name), href: "/account", label: v.name }} />
        <main id="page" className="page" tabIndex={-1}>{children}</main>
        <AppFooter />
      </div>
    </div>
  );
}
