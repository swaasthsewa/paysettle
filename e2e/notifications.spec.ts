/**
 * Notifications. F1.10 role-scoped pages: /notifications lists the signed-in person's own notices (hold and money
 * notices, review-timer notices), newest first, read-only, for a client and for a provider.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

for (const name of ["Priya", "Meera"]) {
  test(`F1.10 ${name} opens Notifications from the menu`, async ({ page }) => {
    await signIn(page, name);
    await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Notifications" }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    // either the list with links to contracts or milestones, or the empty state
    const main = page.locator("main");
    await expect(main.locator(".money-notices, .empty").first()).toBeVisible();
    const links = main.locator(".money-notices a");
    for (const href of await links.evaluateAll((as) => as.slice(0, 5).map((a) => a.getAttribute("href") ?? ""))) expect(href).toMatch(/^\/contracts\/[^/]+(\/m\/[^/]+)?$/);
  });
}
