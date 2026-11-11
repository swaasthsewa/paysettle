/**
 * A8, A10 · the trust page (design scenarios by theme, links), the AI scorecard, the privacy "no sale" line, and the
 * judge tour: keyboard only, focus kept in the dialog, Escape returns focus, nothing left over the page once it is dismissed,
 * the tour tucks away while a screen is open and carries over to the next page. axe (WCAG 2.0/2.1 A + AA) on each page, with
 * the tour dialog open too. Needs the mount <JudgeTour launcher={false}/> in
 * src/app/layout.tsx, so the tour follows the judge into /login and the app.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const TOUR = "Take the 3-minute tour";
test.use({ reducedMotion: "reduce" });

async function axe(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.slice(0, 6).map((n) => n.target.join(" ")) }));
  expect(blocking, `${name}: serious/critical axe violations`).toEqual([]);
}
const dialog = (page: Page) => page.getByRole("dialog");
const insideDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest("dialog[open]"));

test("A8 /trust walks through the design scenarios by theme, each with its resolution, the options set aside and a link", async ({ page }) => {
  await page.goto("/trust");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What could go wrong, and how PaySettle handles it");
  const themes = page.getByRole("navigation", { name: "Themes on this page" }).getByRole("link");
  expect(await themes.count()).toBeGreaterThanOrEqual(5);
  const cards = page.locator("ol.tb-list > li");
  expect(await cards.count()).toBeGreaterThanOrEqual(15);
  for (const id of ["money-held", "contract-tamper", "ai-money"]) {
    const card = page.locator(`#${id}`);
    await expect(card.locator(".chip")).toBeVisible();
    await expect(card).toContainText("How PaySettle resolves it");
    await expect(card).toContainText("Considered and set aside");
    await expect(card.getByRole("link").first()).toBeVisible();
  }
  await expect(page.locator("#contract-tamper").getByRole("link", { name: /audit chain/i })).toHaveAttribute("href", "/admin/audit");
  await expect(page.locator("#contract-tamper")).toContainText("Putting contracts on a blockchain");
  await expect(page.locator("#formula").getByRole("row")).toHaveCount(7); // header, five parts, total
  await expect(page.locator("#not").getByRole("heading", { level: 3 })).toHaveCount(4);
  await expect(page.locator("#scope ul.tb-scope > li").first()).toBeVisible();
  // the theme links jump to their section
  await themes.first().click();
  await expect(page).toHaveURL(/#money$/);
  const text = (await page.locator("main").innerText()).toLowerCase();
  for (const banned of ["risk-free", "guaranteed", "100% irreversible", "bank-grade", "red team"]) expect(text).not.toContain(banned);
  await axe(page, "trust");
});

test("A8 A6 /trust/ai shows each AI feature's limits, rule results computed now and pending model results", async ({ page }) => {
  await page.goto("/trust/ai");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI scorecard");
  await expect(page.locator("#features article")).toHaveCount(5);
  for (const name of ["Contract Drafter", "Criteria Compiler", "Evidence Verifier", "Mediator advice", "Blog drafting"]) await expect(page.getByRole("heading", { name, level: 3 })).toBeVisible();
  const rows = page.locator("#evals tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(page.locator("#set-compile")).toContainText("Vague criteria caught");
  await expect(page.locator("#set-evidence")).toContainText("Spoofed packages recommended for approval: 0 of");
  await expect(page.locator("#set-injection")).toContainText("Hidden instructions followed: 0 of");
  await expect(page.locator("#governance")).toContainText("Model card");
  await expect(page.locator("#governance")).toContainText("Turning AI off");
  await axe(page, "trust/ai");
});

test("privacy says plainly that we do not sell data", async ({ page }) => {
  await page.goto("/privacy#no-sale");
  await expect(page.getByRole("heading", { name: "We do not sell data" })).toBeVisible();
  await expect(page.locator("#no-sale")).toContainText("not personal data, and not anonymised or aggregated trends");
});

test("A10 judge tour works with the keyboard alone and leaves nothing over the page when ended", async ({ page }) => {
  await page.goto("/judges");
  const launcher = page.getByRole("button", { name: TOUR });
  await launcher.focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toHaveAccessibleName("Sign in as the judge");
  await expect(page.getByRole("heading", { name: "Sign in as the judge", level: 2 })).toBeFocused();
  await axe(page, "judges with the tour open");

  for (let i = 0; i < 25; i++) {
    await page.keyboard.press(i % 5 === 4 ? "Shift+Tab" : "Tab");
    expect(await insideDialog(page), `focus left the dialog after ${i + 1} presses`).toBe(true);
  }
  await page.keyboard.press("ArrowRight");
  await expect(dialog(page)).toContainText("Step 2 of 8");
  await expect(page.getByRole("heading", { level: 2, name: /happy path/i })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog(page)).toContainText("Step 1 of 8");

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(launcher).toBeFocused();
  expect(await page.evaluate(() => document.querySelectorAll("dialog, .tour-bar").length)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem("paysettle.tour.v1"))).toBeNull();
  // the page underneath takes clicks again
  await page.getByRole("link", { name: "Read the trust page" }).click();
  await expect(page).toHaveURL(/\/trust$/);
});

test("A10 opening a screen tucks the tour into a resume bar that does not block the page, and resumes on the next page", async ({ page }) => {
  await page.goto("/judges");
  await page.getByRole("button", { name: TOUR }).click();
  await dialog(page).getByRole("button", { name: /^Step 8:/ }).click();
  await expect(dialog(page)).toContainText("Step 8 of 8");
  await dialog(page).getByRole("link", { name: "Open the trust page" }).click();
  await expect(page).toHaveURL(/\/trust$/);
  await expect(dialog(page)).toHaveCount(0);
  const bar = page.getByRole("region", { name: "Judge tour" });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("Step 8 of 8");
  // the page stays usable while the bar is shown
  await page.getByRole("navigation", { name: "Themes on this page" }).getByRole("link").nth(1).click();
  await expect(page).toHaveURL(/#contract$/);
  await axe(page, "trust with the resume bar");

  await page.reload();
  await expect(page.getByRole("region", { name: "Judge tour" })).toBeVisible();
  await page.getByRole("button", { name: "Resume tour" }).click();
  await expect(dialog(page)).toContainText("Step 8 of 8");
  await dialog(page).getByRole("button", { name: "Finish the tour" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Judge tour" })).toHaveCount(0);
});

test("A10 the tour follows the judge from the public site through sign-in into the playground", async ({ page }) => {
  await page.goto("/judges");
  await page.getByRole("button", { name: TOUR }).click();
  await dialog(page).getByRole("link", { name: "Open the sign-in page" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("region", { name: "Judge tour" }), "needs <JudgeTour launcher={false}/> in src/app/layout.tsx").toBeVisible();
  await signIn(page, "Hackathon Judge");
  await page.getByRole("button", { name: "Resume tour" }).click();
  await page.keyboard.press("ArrowRight");
  await expect(dialog(page)).toContainText("Scenario S1");
  await dialog(page).getByRole("link", { name: "Open the playground" }).click();
  await expect(page).toHaveURL(/\/playground$/);
  await expect(page.getByRole("region", { name: "Judge tour" })).toContainText("Step 2 of 8");
  await expect(page.getByRole("heading", { name: "Judge Playground", level: 1 })).toBeVisible();
  await page.getByRole("region", { name: "Judge tour" }).getByRole("button", { name: "End the tour" }).click();
  await expect(page.getByRole("region", { name: "Judge tour" })).toHaveCount(0);
});
