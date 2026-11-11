/** F3 · the public site's frame: the site nav (with "Open the app" for someone signed in), the footer, the scroll reveal. */
import type { ReactNode } from "react";
import "@/styles/site.css";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { Reveal } from "@/components/site/reveal";
import { homeFor, viewer } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  let home: string | null = null;
  try { const v = await viewer(); home = v ? homeFor(v.role) : null; } catch { home = null; }
  return (
    <div className="s-site">
      <SiteNav home={home} />
      {children}
      <SiteFooter />
      <Reveal />
    </div>
  );
}
