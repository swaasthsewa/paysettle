/**
 * Finance. F5.03 three-way reconciliation (contract, ledger, PayPal), F5.02 ledger (P6 double entry).
 * Farah runs reconciliation and sees a new run with its verdict and the per-tranche planes.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("F5.03 finance runs reconciliation and a new run is shown", async ({ page }) => {
  await signIn(page, "Farah");
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Reconciliation" }).click();
  await expect(page).toHaveURL(/\/finance\/recon/);
  await expect(page.getByRole("heading", { level: 1, name: "Reconciliation" })).toBeVisible();
  const runHeading = page.getByRole("heading", { name: /^Run recon_/ });
  const before = (await runHeading.count()) ? await runHeading.textContent() : null;

  await page.getByRole("button", { name: "Run now" }).click();
  await page.waitForURL(/[?&]run=recon_/);
  await expect(page.locator("main")).toContainText(/Run finished:/);
  const after = await runHeading.textContent();
  expect(after).not.toBe(before);
  await expect(page.locator("main")).toContainText(/tranches checked/);
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  // F5.01 the run's tranches and the history are AG Grid console grids
  await expect(page.locator("main [role=grid]").first()).toBeVisible();
  await expect(page.locator("main .ag-root .ag-cell").first()).toBeVisible();
});

test("F5.02 F3.11 P6 finance ledger lists double-entry rows and the invariant per tranche", async ({ page }) => {
  await signIn(page, "Farah");
  await page.goto("/finance/ledger");
  await expect(page.getByRole("heading", { level: 1, name: "Ledger" })).toBeVisible();
  // the compact filter bar
  const filter = page.getByRole("form", { name: "Filter the ledger" });
  await expect(filter.getByLabel("Contract")).toBeVisible();
  await expect(filter.getByRole("button", { name: "Apply" })).toBeVisible();
  // AG Grid console grids (F5.01): invariant per tranche, totals per account, entries
  await expect(page.getByRole("heading", { name: "Invariant per tranche" })).toBeVisible();
  await expect(page.locator("main [role=grid]")).toHaveCount(3);
  const cells = page.locator("main .ag-root .ag-cell");
  await expect(cells.first()).toBeVisible();
  await expect(page.locator('main .ag-cell[col-id="type"]').filter({ hasText: /^(Hold|Release|Fee)$/i }).first()).toBeVisible();
  await expect(page.locator('main .ag-cell[col-id="account"]').filter({ hasText: /^paypal:hold:/ }).first()).toBeVisible();
});
