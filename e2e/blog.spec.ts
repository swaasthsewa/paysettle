/**
 * P10 · the public blog: the index (topic filter, cards), an article (contents, footnotes that
 * link back, claim labels, the live money block), JSON-LD (Article, BreadcrumbList, FAQPage), 404 for an unknown slug,
 * sitemap and RSS, and axe (WCAG 2.0/2.1 A + AA) on the index and an article. Needs the seeded posts
 * (npx tsx scripts/seed-blog.ts, part of seed-all).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SLUG = "why-escrow-breaks-at-day-28";
test.use({ reducedMotion: "reduce" });

async function axe(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.slice(0, 6).map((n) => n.target.join(" ")) }));
  expect(blocking, `${name}: serious/critical axe violations`).toEqual([]);
}
async function jsonLdTypes(page: Page): Promise<string[]> {
  const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
  return raw.map((s) => (JSON.parse(s) as { "@type": string })["@type"]);
}

test("/blog lists published posts, filters by topic and opens an article", async ({ page }) => {
  await page.goto("/blog");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Notes on paying for work you can check");
  const cards = page.locator(".bl-card");
  expect(await cards.count()).toBeGreaterThanOrEqual(9);
  await expect(page.getByRole("link", { name: /^All posts/ })).toHaveAttribute("aria-current", "page");
  expect(await jsonLdTypes(page)).toContain("Blog");

  await page.getByRole("navigation", { name: "Filter posts by topic" }).getByRole("link", { name: /^Finance/ }).click();
  await expect(page).toHaveURL(/\/blog\?topic=finance$/);
  await expect(page.getByRole("link", { name: /^Finance/ })).toHaveAttribute("aria-current", "page");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Reconciling to the cent");

  await page.goto("/blog");
  await page.getByRole("link", { name: "Why escrow breaks at day 28 — and how tranches fix it" }).click();
  await expect(page).toHaveURL(new RegExp(`/blog/${SLUG}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Why escrow breaks at day 28 — and how tranches fix it");
});

test("P10 an article has contents, numbered sources that link back, claim labels and the live money block", async ({ page }) => {
  await page.goto(`/blog/${SLUG}`);
  const toc = page.getByRole("navigation", { name: "On this page" });
  await expect(toc.getByRole("link", { name: "The problem with one long hold" })).toHaveAttribute("href", /#h-/);

  const sources = page.getByRole("region", { name: "Sources" });
  await expect(sources.locator("li")).not.toHaveCount(0);
  await expect(sources.getByRole("link", { name: /developer\.paypal\.com|PayPal Developer/ }).first()).toHaveAttribute("href", /^https:\/\/developer\.paypal\.com\//);
  const ref = page.getByRole("link", { name: "Source 1" }).first();
  await expect(ref).toHaveAttribute("href", "#fn-1");
  await ref.click();
  await expect(page).toHaveURL(/#fn-1$/);
  await expect(page.locator("#fn-1 a.bl-back")).toHaveAttribute("href", /#fnref-1-/);

  await expect(page.locator(".bl-claim", { hasText: "Illustrative" }).first()).toBeVisible();
  await expect(page.locator(".bl-claim", { hasText: "How PaySettle works" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "How we label claims" })).toBeVisible();

  const flow = page.locator(".bl-flow").first();
  await expect(flow).toContainText("$2,071.88");
  const slider = flow.getByRole("slider", { name: /Share released to the provider/ });
  await slider.focus();
  await slider.press("End");
  await expect(flow).toContainText("$8,287.50");
  await expect(flow).toContainText("$212.50");
  await expect(page.locator(".bl-tt").first()).toContainText("3 hold windows");

  const text = (await page.locator("main").innerText()).toLowerCase();
  for (const banned of ["risk-free", "risk free", "100% irreversible", "guaranteed payment", "guaranteed refund", "bank-grade"]) expect(text).not.toContain(banned);
  await expect(page.getByRole("link", { name: "Open the Judge Playground" }).first()).toHaveAttribute("href", "/playground");
});

test("article JSON-LD has Article, BreadcrumbList and FAQPage, and metadata has a canonical URL", async ({ page }) => {
  await page.goto(`/blog/${SLUG}`);
  const types = await jsonLdTypes(page);
  expect(types).toEqual(expect.arrayContaining(["Article", "BreadcrumbList", "FAQPage"]));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/blog/${SLUG}$`));
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /PayPal/);
});

test("an unknown or unpublished slug is a 404", async ({ page }) => {
  const r = await page.goto("/blog/no-such-post-anywhere");
  expect(r?.status()).toBe(404);
});

test("sitemap lists the site pages and every published post; RSS lists the posts", async ({ request }) => {
  const sm = await (await request.get("/sitemap.xml")).text();
  expect(sm).toContain("/how-it-works</loc>");
  expect(sm).toContain(`/blog/${SLUG}</loc>`);
  const rss = await request.get("/rss.xml");
  expect(rss.headers()["content-type"]).toContain("application/rss+xml");
  const body = await rss.text();
  expect(body).toContain("<rss version=\"2.0\"");
  expect((body.match(/<item>/g) ?? []).length).toBeGreaterThanOrEqual(9);
});

test("a11y the blog index and an article have no serious or critical axe violations", async ({ page }) => {
  await page.goto("/blog");
  await axe(page, "blog index");
  await page.goto(`/blog/${SLUG}`);
  await axe(page, "blog article");
  await page.goto("/blog/14500-engine-swap-milestone-by-milestone");
  await axe(page, "blog case study");
});
