/** Slugs for blog posts (pure): readable suffixes first, then a time suffix. */

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;

/** "Why escrow breaks at day 28 — and how tranches fix it" → "why-escrow-breaks-at-day-28-and-how-tranches-fix-it". */
export function slugify(title: string): string {
  const s = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length <= SLUG_MAX) return s || "post";
  const cut = s.slice(0, SLUG_MAX);
  const at = cut.lastIndexOf("-");
  return (at > 20 ? cut.slice(0, at) : cut).replace(/-+$/, "") || "post";
}

/** The Nth slug candidate for a base: 0 → base, 1..46 → base-2 … base-47, beyond → base-<time36>. */
export function nthSlug(base: string, attempt: number, now: number = Date.now()): string {
  const safe = base || "post";
  if (attempt <= 0) return safe;
  const suffix = attempt < 47 ? `-${attempt + 1}` : `-${now.toString(36)}`;
  return `${safe.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
}
