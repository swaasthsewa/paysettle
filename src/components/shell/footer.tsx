import Link from "next/link";
import { common } from "@/copy/common";

export function AppFooter() {
  const f = common.shell.footer;
  return (
    <footer className="appfoot">
      <nav aria-label="Legal" className="appfoot-links"><Link href="/privacy">{f.privacy}</Link><Link href="/terms">{f.terms}</Link></nav>
      <p className="appfoot-note">{f.rights}</p>
    </footer>
  );
}
