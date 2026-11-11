/** F3 · the site footer: the page groups, the sandbox line and the copyright line. */
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { site as t } from "@/copy/site";

export function SiteFooter() {
  return (
    <footer className="s-foot">
      <div className="s-wrap">
        <div className="s-foot-cols">
          <div className="s-foot-brand">
            <Link className="s-logo" href="/" aria-label={t.logoLabel}><BrandMark />{t.name}</Link>
            <p>{t.footer.about}</p>
          </div>
          {t.footer.groups.map((g, i) => (
            <nav key={g.title} aria-labelledby={`s-foot-${i}`}>
              <h2 id={`s-foot-${i}`}>{g.title}</h2>
              <ul>{g.links.map((l) => <li key={l.href}><Link href={l.href}>{l.label}</Link></li>)}</ul>
            </nav>
          ))}
        </div>
        <div className="s-foot-bar">
          <p className="s-sandbox" role="note">{t.sandboxLine}</p>
          <p>{t.footer.hackathon}</p>
          <p className="s-copy">{t.footer.copyright(new Date().getFullYear())}</p>
        </div>
      </div>
    </footer>
  );
}
