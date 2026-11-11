/**
 * Mediator. F4.05 case queue (conflict-free routing), F4.07 workbench with the sealed dossier and the advisory
 * proposal (P3), F4.06 co-signature above $5,000, F4.09 verdict record (P5 sealed, immutable).
 * Seeded by scripts/seed-disputes.ts: "S/4HANA demand planning sprint" M03 is sealed (Tier 3) and routed to Marcus Bell with
 * no verdict yet; "Field service scheduling app" M04 ($5,500) has Marcus's verdict waiting for Lena Park's co-signature.
 * Nothing here signs or co-signs, so the seeded cases stay as they are for the demo.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("F4.05 F4.07 P3 mediator opens the case queue and the seeded sealed case workbench", async ({ page }) => {
  await signIn(page, "Marcus");
  await expect(page.getByRole("heading", { level: 1, name: "Mediator" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Case queue" }).click();
  await expect(page).toHaveURL(/\/mediator\/cases$/);
  await expect(page.getByRole("heading", { level: 1, name: "Case queue" })).toBeVisible();
  for (const h of ["Your cases", "Waiting for your co-signature", "Open — free of conflicts for you", "Coming up (Tier 1 and 2)"]) {
    await expect(page.getByRole("heading", { name: h })).toBeVisible();
  }

  const mine = page.getByRole("region", { name: "Your cases" });
  const sealed = mine.getByRole("row").filter({ hasText: "S/4HANA demand planning sprint" });
  await expect(sealed, "the seeded sealed case routed to Marcus").toHaveCount(1);
  await expect(sealed).toContainText(/Tier 3|sealed/i);
  await sealed.getByRole("link").click();
  await page.waitForURL(/\/mediator\/cases\/[^/]+$/);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("M03 · ");
  await expect(page.locator(".phead .sub")).toContainText("assigned to Marcus Bell");
  await expect(page.getByRole("region", { name: "Stages" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contract" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dispute room" })).toBeVisible();
  // the sealed vault: opening statement and a rebuttal from each side
  await expect(page.getByRole("heading", { name: "Evidence and rebuttals" })).toBeVisible();
  await expect(page.locator(".dz-reb")).not.toHaveCount(0);
  await expect(page.locator("main")).toContainText("CR-07");
  // the stored proposal is advice only (P3), and the verdict panel is open for the assigned mediator
  await expect(page.locator(".dz-ai")).toContainText("Advice — not a decision");
  await expect(page.locator(".dz-ai")).toContainText(/to the provider would be/);
  await expect(page.getByRole("heading", { name: "Verdict" })).toBeVisible();
});

test("F4.06 a verdict above $5,000 waits for a second mediator's co-signature", async ({ page, browser }) => {
  await signIn(page, "Lena");
  await page.goto("/mediator/cases");
  const lane = page.getByRole("region", { name: "Waiting for your co-signature" });
  const row = lane.getByRole("row").filter({ hasText: "Field service scheduling app" });
  await expect(row, "Marcus's seeded verdict on M04 ($5,500)").toHaveCount(1);
  await expect(row).toContainText(/above \$5,000|two signatures/);
  await row.getByRole("link").click();
  await page.waitForURL(/\/mediator\/cases\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("M04 · ");
  await expect(page.locator("main")).toContainText(/This verdict needs a second mediator because .*above \$5,000/);
  await expect(page.getByRole("button", { name: "Co-sign verdict" })).toBeEnabled();

  // Marcus, who signed it, cannot co-sign his own verdict
  const ctx = await browser.newContext();
  const marcus = await ctx.newPage();
  await signIn(marcus, "Marcus");
  await marcus.goto("/mediator/cases");
  await marcus.getByRole("region", { name: "Your cases" }).getByRole("row").filter({ hasText: "Field service scheduling app" }).getByRole("link").click();
  await marcus.waitForURL(/\/mediator\/cases\/[^/]+$/);
  await expect(marcus.locator("main")).toContainText("Waiting for a second, different mediator to co-sign");
  await expect(marcus.getByRole("button", { name: "Co-sign verdict" })).toHaveCount(0);
  await ctx.close();
});
