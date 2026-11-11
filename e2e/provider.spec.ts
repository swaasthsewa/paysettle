/**
 * Provider journey. F1.4 provider onboarding (licences, tax id masked), F1.6 PayPal business account for payouts,
 * F2.03 contracts list → negotiation room. Meera opens onboarding and her contracts.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("F1.4 F1.6 provider sees onboarding status, PayPal payout account and licences", async ({ page }) => {
  await signIn(page, "Meera");
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Onboarding & PayPal" }).click();
  await expect(page).toHaveURL(/\/provider\/onboarding$/);
  await expect(page.getByRole("heading", { level: 1, name: "Onboarding & PayPal" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Validated by Ops");
  await expect(page.getByRole("heading", { name: "PayPal business account" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Licences and registration/ })).toBeVisible();
  // the tax id is only ever shown masked (last four characters)
  await expect(page.locator("main")).toContainText(/•{4,}\w{4}/);
});

test("F2.03 provider opens the contracts list and a contract room", async ({ page }) => {
  await signIn(page, "Meera");
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Contracts" }).click();
  await expect(page).toHaveURL(/\/provider\/contracts$/);
  await expect(page.getByRole("heading", { level: 1, name: "Contracts" })).toBeVisible();
  const row = page.getByRole("link", { name: "Booking web app MVP" }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/contracts\/ws_/);
  await expect(page.getByRole("heading", { level: 1, name: "Booking web app MVP" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Milestones" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Signatures" })).toBeVisible();
  await expect(page.locator("main")).toContainText(/held in PayPal/);
});
