/**
 * A10 · test helper (node only, never imported by app code): the app's routes, read from the page.tsx files under
 * src/app with route groups removed, and a check that a link such as "/trust#formula" or "/contracts/x" has a page.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "../../app");

export function appRoutes(dir = APP, base = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...appRoutes(p, base + (/^\(.*\)$/.test(name) ? "" : `/${name}`)));
    else if (name === "page.tsx") out.push(base || "/");
  }
  return out;
}

const pattern = (r: string) => new RegExp("^" + r.replace(/\[[^\]]+\]/g, "[^/]+") + "$");

export function routeExists(href: string, all: string[] = appRoutes()): boolean {
  const p = href.split(/[?#]/)[0] || "/";
  return all.some((r) => pattern(r).test(p));
}
