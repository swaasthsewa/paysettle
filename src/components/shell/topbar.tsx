/**
 * The top bar of every signed-in page: on a wide screen the button that folds the menu, the search and, at the right,
 * whatever the area adds (the bell) and the person; on a phone the logo, which leads back to the area's home, then the
 * search and the bell. Translucent, and it stays at the top while the page scrolls.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand";
import { common } from "@/copy/common";
import { DrawerToggle } from "./drawer";
import { RailToggle } from "./rail";
import { AppSearch } from "./search";
import { ThemeToggle } from "./theme";

export function TopBar({ home, search = true, person, children }: {
  /** The area's home: the role's own overview page. */
  home: string;
  search?: boolean;
  /** The person's initial and where it leads (their settings), or their menu with the household's profiles. */
  person?: { initial: string; href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <header className="topbar">
      <RailToggle />
      <DrawerToggle />
      <Link href={home} className="tb-home" aria-label={common.shell.home}><BrandMark /><span>{common.product}</span></Link>
      {search && <AppSearch />}
      <div className="tb-end">
        <ThemeToggle />
        {children}
        {person && <Link href={person.href} className="tb-person" aria-label={person.label} title={person.label}>{person.initial}</Link>}
      </div>
    </header>
  );
}

export const initialOf = (name: string) => (name.trim().match(/\p{L}/u)?.[0] ?? "•").toLocaleUpperCase();

/**
 * The page's own text size (the member's eye settings) as a zoom on the page. A zoomed box is drawn wider than its
 * column, so its width is divided by the zoom: the page keeps to its column and never runs off the screen.
 */
export const zoomStyle = (zoom: number) => (zoom > 1 ? { zoom, width: `${(100 / zoom).toFixed(3)}%` } : undefined);
