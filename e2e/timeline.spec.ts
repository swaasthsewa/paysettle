/**
 * F2.04 F2.13 F2.14 contract timeline (Bryntum Gantt), read-only. Priya (client) opens "Patient portal build", which the
 * seed leaves with change order 1 waiting for signatures; the timeline switches to "Proposed change order #1", says
 * nothing changes until both parties sign, marks the re-dated rows (Gantt and table), and links to the change order in
 * the contract room. When the "Monthly marketing retainer" chain has more than one period (continuation.spec.ts adds
 * one), Dan's "Contract chain" view lists every period. Changes nothing, so it is re-runnable.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

async function openContract(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Contracts" }).click();
  await page.getByRole("link", { name: title, exact: true }).first().click();
  await page.waitForURL(/\/contracts\/ws_[a-z0-9]+$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test("F2.13 F2.04 proposed change order on the timeline: signed plan as baselines, re-dated rows, link to the change order", async ({ page }) => {
  await signIn(page, "Priya");
  await openContract(page, "Patient portal build");
  const contractPath = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "Timeline", exact: true }).click();
  await page.waitForURL(/\/timeline/);
  const views = page.getByRole("navigation", { name: "Timeline views" });
  await expect(views.getByRole("link", { name: "Signed plan" })).toHaveAttribute("aria-current", "page");
  await views.getByRole("link", { name: /^Proposed change order #\d+$/ }).click();
  await page.waitForURL((u) => u.searchParams.get("view") === "proposed");
  await expect(views.getByRole("link", { name: /^Proposed change order #\d+$/ })).toHaveAttribute("aria-current", "page");

  const note = page.getByTestId("co-timeline-note");
  await expect(note).toContainText("Nothing changes until both parties sign the change order.");
  await expect(note).toContainText(/Re-dated: [1-9]/);
  // the Gantt (Bryntum) and the table under it both say which rows moved
  await expect(page.locator(".tl-gantt .ps-co-tag-redated").first()).toHaveText("Re-dated", { timeout: 30_000 });
  await expect(page.locator(".tl-gantt .b-task-baseline").first()).toBeAttached();
  const table = page.locator("section[aria-labelledby=tl-t]");
  await expect(table.getByRole("heading", { level: 2 })).toHaveText(/^Change order #\d+ as a table$/);
  await expect(table).toContainText("Re-dated");
  await expect(table).toContainText("Signed date");

  await note.getByRole("link", { name: /^Review change order #\d+ in the contract room$/ }).click();
  await page.waitForURL((u) => u.pathname === contractPath && u.hash === "#co");
  const review = page.getByTestId("co-review");
  await expect(review).toContainText(/Change order \d+/);
  await expect(review.getByTestId("co-diff")).toContainText(/M05/);
  // and back: the room links to the same change order on the timeline
  await review.getByRole("link", { name: /^See change order \d+ on the timeline$/ }).click();
  await page.waitForURL((u) => u.pathname.endsWith("/timeline") && /^co_/.test(u.searchParams.get("co") ?? ""));
  await expect(page.getByTestId("co-timeline-note")).toBeVisible();
});

test("F2.14 contract chain on the timeline lists every period when the retainer has continued", async ({ page }) => {
  await signIn(page, "Dan");
  await openContract(page, "Monthly marketing retainer");
  await page.getByRole("link", { name: "Timeline", exact: true }).click();
  await page.waitForURL(/\/timeline/);
  const chainLink = page.getByRole("navigation", { name: "Timeline views" }).getByRole("link", { name: /^Contract chain \(\d+ periods\)$/ });
  test.skip((await chainLink.count()) === 0, "The retainer has not continued yet (continuation.spec.ts adds period 2).");
  await chainLink.click();
  await page.waitForURL((u) => u.searchParams.get("view") === "chain");
  const periods = page.getByTestId("chain-periods").getByRole("listitem");
  expect(await periods.count()).toBeGreaterThanOrEqual(2);
  await expect(periods.first()).toContainText("Period 1 · Monthly marketing retainer");
  await expect(page.locator(".tl-gantt").getByText(/^Period 2 · /).first()).toBeVisible({ timeout: 30_000 });
  await periods.nth(1).getByRole("link").click();
  await page.waitForURL(/\/contracts\/ws_[a-z0-9]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("period 2");
});
