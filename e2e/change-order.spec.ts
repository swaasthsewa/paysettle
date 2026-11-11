/**
 * F2.13 change order on a locked contract, end to end on the mock rail. Meera (provider) proposes adding content and
 * marketing pages to "Clinic website build" (tranche 1 already held); Priya (client) reviews the diff and the money
 * impact in plain words, both sign, the change order becomes the next revision, and Priya funds the new tranche through
 * the normal PayPal approval flow. Re-runnable: each run adds one more milestone and tranche; an open change order left
 * by an earlier run is closed first.
 */
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const TITLE = "Clinic website build";
const coSection = (page: Page) => page.locator("section#co");
const review = (page: Page) => page.getByTestId("co-review");

async function openContract(page: Page) {
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Contracts" }).click();
  await page.getByRole("link", { name: TITLE, exact: true }).first().click();
  await page.waitForURL(/\/contracts\/ws_/);
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
}

test("F2.13 change order: propose → review → both sign → new tranche funded on the mock rail", async ({ page, browser }) => {
  test.setTimeout(120_000); // two people, two signatures and a funding round trip
  await signIn(page, "Meera");
  await openContract(page);
  // clean start: close a change order an earlier run left open
  if (await review(page).count()) {
    const withdraw = review(page).getByRole("button", { name: "Withdraw change order" });
    if (await withdraw.count()) await withdraw.click();
    else { await review(page).getByLabel("Why you decline").fill("Closing an earlier test run."); await review(page).getByRole("button", { name: "Decline change order" }).click(); }
    await expect(review(page)).toHaveCount(0);
  }

  // Meera proposes: content and marketing pages added in the last week, $1,200
  await page.getByTestId("co-propose").locator("summary").first().click();
  await page.getByLabel("Why the contract changes").fill("Content and marketing pages added in the last week.");
  await page.getByTestId("co-propose").locator("details", { hasText: "New milestone 1" }).locator("summary").click();
  await page.locator("#co-n1-title").fill("Content and marketing pages");
  await page.locator("#co-n1-day").fill("25");
  await page.locator("#co-n1-amount").fill("1,200");
  await page.locator("#co-n1-crit").fill("Five content pages are live\nLinked from the main menu");
  await page.getByTestId("co-propose").getByRole("button", { name: "Propose change order" }).click();
  await expect(page.getByRole("status")).toContainText("Change order proposed");
  await expect(review(page)).toBeVisible();
  const money = review(page).getByTestId("co-money");
  await expect(money).toContainText(/\+\$1,200\.00 to fund as tranche \d+/);
  const trancheNo = Number(/tranche (\d+)/.exec((await money.textContent()) ?? "")![1]);
  const coNo = Number(/Change order (\d+)/.exec((await review(page).locator("b").first().textContent()) ?? "")![1]);
  await review(page).getByRole("button", { name: `Sign change order ${coNo}` }).click();
  await expect(review(page)).toContainText("You signed. Waiting for the other party.");

  // Priya reviews the diff and the money impact, then signs
  const ctx = await browser.newContext();
  const client = await ctx.newPage();
  await signIn(client, "Priya");
  await openContract(client);
  await expect(review(client)).toContainText(`Change order ${coNo}`);
  await expect(review(client).getByTestId("co-diff")).toContainText("Content and marketing pages");
  await expect(review(client).getByTestId("co-diff")).toContainText("$1,200.00");
  await expect(review(client).getByTestId("co-money")).toContainText(`+$1,200.00 to fund as tranche ${trancheNo}`);
  await expect(review(client)).toContainText("All pre-signature rules pass");
  await review(client).getByRole("button", { name: `Sign change order ${coNo}` }).click();
  await expect(client.getByRole("status")).toContainText("Both parties signed");
  await expect(review(client)).toHaveCount(0);
  await expect(coSection(client)).toContainText(/Signed and in force/);
  await expect(client.locator("section[aria-labelledby=rev-h]")).toContainText(`Change order ${coNo} signed by both parties`);

  // the new tranche is funded through the existing fund → PayPal approval flow (mock rail)
  const contractUrl = client.url().split(/[?#]/)[0];
  const row = client.locator("section[aria-labelledby=tr-h] li", { hasText: `Tranche ${trancheNo}` });
  await expect(row).toContainText("$1,200.00");
  await row.getByRole("link", { name: "Fund tranche" }).click();
  await client.waitForURL(/\/fund\//);
  await client.getByRole("button", { name: /Fund with PayPal|Continue to PayPal/ }).click();
  // the mock approval link lands on the PayPal return handler, which confirms the hold and redirects to the contract
  await expect(client).toHaveURL(/\/api\/paypal\/return\?|\/contracts\/ws_[a-z0-9]+(\?|#|$)/, { timeout: 30_000 });
  await expect(client.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await client.goto(contractUrl);
  await expect(client.locator("section[aria-labelledby=tr-h] li", { hasText: `Tranche ${trancheNo}` })).toContainText(/Held/i);
  await ctx.close();
});
