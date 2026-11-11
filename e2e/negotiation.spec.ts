/**
 * Negotiation. F2.04 append-and-prune, F2.05 policy gate (rule violations), F2.06 revisions, F2.10 signatures void
 * on change. Dan opens "Demand planning sprint", prunes a payment milestone (shares drop below 100% → a violation appears and
 * the revision goes up), then restores it (violation clears, revision goes up again). Leaves the contract editable for the next run.
 */
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const revision = async (page: Page) => Number(((await page.locator(".chip", { hasText: /^Revision \d+$/ }).first().textContent()) ?? "").replace(/\D/g, ""));
const policy = (page: Page) => page.locator("section[aria-labelledby=vio-h]");

test("F2.04 F2.05 F2.06 F2.10 client prunes and restores a milestone; violations and revision update", async ({ page }) => {
  await signIn(page, "Dan");
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Contracts" }).click();
  await page.getByRole("link", { name: "Demand planning sprint", exact: true }).first().click();
  await page.waitForURL(/\/contracts\/ws_/);
  await expect(page.getByRole("heading", { level: 1, name: "Demand planning sprint" })).toBeVisible();

  // start from a clean state: if an earlier run left M02 pruned, restore it first
  const restoreM02 = page.getByRole("button", { name: /^Restore M02 / });
  if (await restoreM02.count()) { await restoreM02.click(); await expect(page.getByRole("button", { name: /^Prune M02 / })).toBeVisible(); }

  const rev0 = await revision(page);
  await expect(policy(page)).toContainText("All rules pass");

  await page.getByRole("button", { name: /^Prune M02 / }).click();
  await expect(page.getByRole("button", { name: /^Restore M02 / })).toBeVisible();
  const rev1 = await revision(page);
  expect(rev1).toBeGreaterThan(rev0);
  await expect(policy(page).locator(".chip")).toContainText(/\d+ to fix/);
  await expect(page.locator(".alloc")).toContainText("Shares must add up to exactly 100%");
  await expect(page.getByRole("button", { name: /^Sign revision/ })).toBeDisabled();

  await page.getByRole("button", { name: /^Restore M02 / }).click();
  await expect(page.getByRole("button", { name: /^Prune M02 / })).toBeVisible();
  const rev2 = await revision(page);
  expect(rev2).toBeGreaterThan(rev1);
  await expect(policy(page)).toContainText("All rules pass");
  await expect(page.locator(".alloc-sum")).toHaveText("100% of 100%");
});
