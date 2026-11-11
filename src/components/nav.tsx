"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { common } from "@/copy/common";
import { NavIcon } from "./shell/icons";
const isAction = (href: string) => href.startsWith("/api/") || href === "/logout";

export interface NavItem { href: string; label: string }

const current = (path: string, href: string, all: NavItem[]) => {
  if (path !== href && !path.startsWith(href + "/")) return false;
  /* the longest matching link wins, so /train/exercises does not also light up /train */
  return !all.some((o) => o.href.length > href.length && (path === o.href || path.startsWith(o.href + "/")));
};

/**
 * The menu's groups. Opened, each group is its heading and its links. Folded to the rail (components/shell/rail.tsx),
 * each group is one picture; pointing at it, or moving onto it with the keyboard, shows that group's links beside the
 * rail. The group's picture is its own (`icon`, an address whose picture it borrows) or its
 * first link's.
 */
export function NavGroups({ groups }: { groups: { title: string; items: NavItem[]; icon?: string }[] }) {
  const path = usePathname();
  const all = groups.flatMap((g) => g.items);
  /* the links beside the rail start level with the group's picture */
  const place = (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--fly-top", `${Math.max(8, Math.min(r.top, window.innerHeight - 60))}px`);
  };
  return (
    <>
      {groups.map((g) => {
        const here = g.items.some((it) => current(path, it.href, all));
        return (
          <div className="navg" key={g.title} onMouseEnter={place} onFocus={place}>
            <p className="navh">{g.title}</p>
            <Link className="navg-btn" href={g.items[0]?.href ?? "/"} aria-label={g.title} data-here={here || undefined} tabIndex={-1}>
              <NavIcon href={g.icon ?? g.items[0]?.href ?? "/"} />
            </Link>
            <div className="navf">
              <p className="navf-title" aria-hidden="true">{g.title}</p>
              <ul className="navl">
                {g.items.map((it) => (
                  <li key={it.href}>
                    {isAction(it.href) ? (
                      /* an address that does something opens by a full load, never ahead of time */
                      <a href={it.href}><NavIcon href={it.href} /><span className="nav-label">{it.label}</span></a>
                    ) : (
                      <Link href={it.href} aria-current={current(path, it.href, all) ? "page" : undefined}>
                        <NavIcon href={it.href} /><span className="nav-label">{it.label}</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function TabBar({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label={common.nav.tabs}>
      {items.map((it) => (
        <Link key={it.href} href={it.href} aria-current={current(path, it.href, items) ? "page" : undefined}>
          <NavIcon href={it.href} /><span>{it.label}</span>
        </Link>
      ))}
    </nav>
  );
}
