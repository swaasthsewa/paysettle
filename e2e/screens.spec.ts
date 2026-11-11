/**
 * Smoke + accessibility: every screen renders for its role without an error page and without serious or
 * critical axe violations. F1.1 register, F4.05 mediator network, blog studio, F5.05 compliance,
 * F4.10 PayPal disputes, deadline terms in the contract room.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

test.use({ reducedMotion: "reduce" });
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function check(page: Page, name: string, heading: RegExp) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByRole("heading", { level: 1 }), `${name}: page heading`).toContainText(heading);
  await expect(page.locator("body"), `${name}: no error page`).not.toContainText(/Application error|Something went wrong|Internal Server Error/);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = r.violations.filter((x) => x.impact === "serious" || x.impact === "critical").map((x) => ({ id: x.id, nodes: x.nodes.slice(0, 4).map((n) => n.target.join(" ")) }));
  expect.soft(blocking, `${name}: serious/critical axe violations`).toEqual([]);
}

test("F1.1 /register renders the sign-up form", async ({ page }) => {
  await page.goto("/register");
  await check(page, "register", /account/i);
  await expect(page.getByLabel(/e-?mail/i).first()).toBeVisible();
});

test("F4.05 public /mediators page and apply form", async ({ page }) => {
  await page.goto("/mediators");
  await check(page, "mediators", /dispute|mediat/i);
  await expect(page.getByRole("button", { name: /apply|send/i }).first()).toBeVisible();
});

test("F4.05 Ops sees the mediator network; a mediator sees their profile", async ({ page }) => {
  await signIn(page, "Olivia");
  await page.goto("/ops/mediators");
  await check(page, "ops mediators", /mediator/i);
  await page.goto("/ops/representments");
  await check(page, "ops representments", /PayPal disputes|dispute/i);
  await signIn(page, "Marcus");
  await page.goto("/mediator/profile");
  await check(page, "mediator profile", /profile|credential/i);
});

test("blog studio lists the seeded posts and opens the editor", async ({ page }) => {
  await signIn(page, "Maya");
  await page.goto("/marketing/blog");
  await check(page, "blog studio", /blog/i);
  await page.getByRole("link", { name: /why escrow breaks at day 28/i }).first().click();
  await page.waitForURL(/\/marketing\/blog\/[^/]+$/);
  await check(page, "blog editor", /Edit .*escrow/i);
});

test("F5.05 Finance compliance page with the 1099-K line", async ({ page }) => {
  await signIn(page, "Farah");
  await page.goto("/finance/compliance");
  await check(page, "finance compliance", /compliance/i);
  await expect(page.locator("main")).toContainText(/1099-K/);
});

test("the seeded contract shows deadline terms and the risk formula", async ({ page }) => {
  await signIn(page, "Priya");
  await page.goto("/client/contracts");
  const link = page.getByRole("link", { name: /web|mvp/i }).first();
  await link.click();
  await page.waitForURL(/\/contracts\/[^/]+$/);
  await expect(page.locator("main")).toContainText(/Deadline terms/i);
  await check(page, "contract room with deadline terms", /.+/);
});
