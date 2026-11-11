/**
 * Client journey on seeded data. F3.04 milestone page, F3.06 evidence signals, A3 AI verifier (advisory, P3),
 * F3.07 signed approval (P4) → F2.12/F4.12 release. Priya opens a milestone whose review is due, reads the AI panel and the
 * checks, ticks the confirmation box, approves, and sees the release. If every seeded approval has already been used by an
 * earlier run, the test first prepares one through the Judge Playground (S1 up to "submit M02"), so it can run again.
 */
import { expect, test, type Browser } from "@playwright/test";
import { runUntil, signIn, startScenario } from "./helpers";

async function prepareApproval(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, "Hackathon Judge");
  const st = await startScenario(page.request, "S1");
  const after = await runUntil(page.request, st.sim!.id, "submit-m02");
  await ctx.close();
  return (after as unknown as { sim: { workspaceId: string } }).sim.workspaceId;
}

test("F3.04 F3.06 A3 F3.07 F4.12 client approves a submitted milestone and sees the release", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, "Priya");
  const review = page.getByRole("link", { name: "Review proof" });
  // prefer a milestone whose evidence carries computed checks (signals); seeded packages without files have none
  const hrefs = await review.evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  let picked = false;
  for (const h of hrefs) {
    await page.goto(h);
    if (await page.locator("ul.ev-signals > li").count()) { picked = true; break; }
  }
  if (!picked) {
    const ws = await prepareApproval(browser);
    await page.goto("/client");
    await page.locator(`a[href^="/contracts/${ws}/m/"]`, { hasText: "Review proof" }).first().click();
  }
  await page.waitForURL(/\/contracts\/[^/]+\/m\/[^/]+$/);

  // what the money is doing before the decision
  await expect(page.locator(".phead .sub")).toContainText(/held in PayPal until you approve M\d+/);
  await expect(page.getByRole("heading", { name: "What the contract requires" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Evidence · attempt \d/ })).toBeVisible();
  // checks (signals) and the AI verifier, marked as advice
  await expect(page.getByRole("heading", { name: "Checks" })).toBeVisible();
  await expect(page.locator("ul.ev-signals > li").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI verifier" })).toBeVisible();
  await expect(page.locator("section.ev-ai")).toContainText("AI advice — you decide");

  // the approve button stays off until the confirmation box is ticked (P4: deliberate, signed approval)
  const approve = page.getByRole("button", { name: /^Approve and release \$/ });
  await expect(approve).toBeDisabled();
  await page.getByRole("checkbox", { name: /I inspected the evidence/ }).check();
  await expect(approve).toBeEnabled();
  await approve.click();

  // the page re-renders after the signed approval: either the release is shown at once, or the decision panel keeps a
  // status note (a queued release is rendered as the "Retry the release now" form, so look in the whole panel)
  const released = page.locator(".phead .sub", { hasText: /released to/ });
  const note = page.getByRole("region", { name: "Your decision" }).getByRole("status");
  await expect(released.or(note).first()).toBeVisible({ timeout: 30_000 });
  await expect(note.filter({ hasText: /has not gone through/ }), "the mock-rail release must go through, not stay queued").toHaveCount(0);
  await page.reload();
  await expect(page.locator(".phead .sub")).toContainText(/released to .*PayPal account \(fee \$/);
  await expect(page.locator(".phead .stats .state")).toContainText(/Released|Paid|Approved/i);
  await expect(page.getByRole("table").filter({ hasText: "Outcome" })).toContainText("Approved (signed)");
});
