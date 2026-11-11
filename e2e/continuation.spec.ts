/**
 * F2.14 continuation contract, end to end: Dan (client) continues "Monthly marketing retainer" into its next period with
 * the same milestone template; the new period is a draft linked both ways; Dan and Arjun (provider) sign it and it
 * locks. Nothing is charged. Re-runnable: each run follows the chain to the latest period and adds the next one.
 */
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const TITLE = "Monthly marketing retainer";
const chain = (page: Page) => page.getByTestId("period-chain");
const state = (page: Page) => page.locator("div.row > .chip").first(); // the contract state chip (the period chip sits in the header)

async function signCurrent(page: Page) {
  const btn = page.getByRole("button", { name: /^Sign revision \d+$/ });
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(page.getByRole("status")).toContainText(/Your signature on revision \d+ is recorded/);
}

test("F2.14 continuation: create period N+1 → both sign → locked, linked to its parent", async ({ page, browser }) => {
  await signIn(page, "Dan");
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Contracts" }).click();
  await page.getByRole("link", { name: TITLE, exact: true }).first().click();
  await page.waitForURL(/\/contracts\/ws_/);
  // follow the chain to the latest period
  for (let i = 0; i < 50 && (await chain(page).locator("span", { hasText: "continues in" }).count()); i++) {
    const link = chain(page).locator("span", { hasText: "continues in" }).getByRole("link");
    const href = (await link.getAttribute("href"))!;
    await link.click();
    await page.waitForURL((u) => u.pathname === href);
  }
  const parentUrl = page.url();
  const parentTitle = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
  await expect(state(page)).toHaveText("Locked");

  await page.getByTestId("continue-panel").locator("summary").click();
  const next = Number(/Start period (\d+)/.exec((await page.getByTestId("continue-panel").locator("summary").textContent()) ?? "")![1]);
  await expect(page.getByLabel(/Repeat this period's milestones/)).toBeChecked();
  await page.getByRole("button", { name: `Create period ${next} draft` }).click();
  await page.waitForURL((u) => /\/contracts\/ws_/.test(u.pathname) && u.searchParams.get("ok") === "continued");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`period ${next}`);
  await expect(chain(page)).toContainText(`Period ${next}`);
  await expect(chain(page).getByRole("link", { name: parentTitle })).toHaveAttribute("href", new URL(parentUrl).pathname);
  await expect(state(page)).toHaveText("Ready to sign");
  const childUrl = page.url().split("?")[0];
  await signCurrent(page);

  const ctx = await browser.newContext();
  const provider = await ctx.newPage();
  await signIn(provider, "Arjun");
  await provider.goto(childUrl);
  await signCurrent(provider);
  await expect(state(provider)).toHaveText("Locked");
  await expect(provider.locator("section[aria-labelledby=tr-h]")).toContainText(/Planned|Fund/i); // waits for the client to fund it; nothing charged
  await ctx.close();

  // the parent links forward to the new period, and the list shows the period number
  await page.goto(parentUrl);
  await expect(chain(page)).toContainText(`continues in`);
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Contracts" }).click();
  await expect(page.locator("tr", { hasText: `${TITLE} · period ${next}` })).toContainText(`Period ${next}`);
});
