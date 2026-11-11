/**
 * Judge Playground through the UI. F5.06 scenario runner (four quadrants), F5.07 simulated time, F5.08 chaos.
 * S1 happy path, S2 spoofed GPS (F3.06), S4 dispute (F4.01–F4.09), S5 chaos (P2 idempotency, P7 webhook dedupe, F5.03 recon).
 * Each run starts a fresh scenario in Fast mock, so the tests do not depend on each other or on order.
 */
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const SCENARIOS: { id: string; reqs: string }[] = [
  { id: "S1", reqs: "F5.06 F2.04 F2.10 F3.07 F4.12" },
  { id: "S2", reqs: "F5.06 F3.06 F3.09 A3" },
  { id: "S4", reqs: "F5.06 F4.01 F4.05 F4.07 F4.09 A4" },
  { id: "S5", reqs: "F5.06 F5.08 F5.03 P2 P7" },
];

for (const s of SCENARIOS) {
  test(`${s.reqs} playground ${s.id}: Fast mock, Run all, every step done`, async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "Hackathon Judge");
    await expect(page.getByRole("heading", { level: 1, name: "Judge Playground" })).toBeVisible();
    await page.getByRole("radio", { name: "Fast mock" }).click();
    await expect(page.getByRole("radio", { name: "Fast mock" })).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: new RegExp(`scenario ${s.id}:.*fast mock mode$`) }).click();
    await expect(page.locator(".pg-live .notice")).toContainText(`Scenario ${s.id} started`);
    await expect(page.getByRole("region", { name: "Session controls" })).toContainText("Fast mock rail");

    const steps = page.locator("ol.pg-steps > li.pg-step");
    const total = await steps.count();
    expect(total).toBeGreaterThan(3);
    await page.getByRole("button", { name: "Run all" }).click();
    await expect(page.getByRole("button", { name: "Run all" })).toBeDisabled({ timeout: 5_000 }).catch(() => {});
    await expect(page.getByRole("button", { name: /Running all/ })).toHaveCount(0, { timeout: 90_000 });

    // every step shows ✓ (done or "not needed"); print the detail of any that is not
    const rows = await steps.evaluateAll((els) => els.map((e) => ({ s: e.getAttribute("data-s"), icon: e.querySelector(".pg-ic")?.textContent, text: (e.textContent ?? "").slice(0, 240) })));
    const bad = rows.filter((r) => r.icon !== "✓");
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
    await expect(page.locator(".pg-stats, .stats").first()).toContainText(`${total}/${total}`);

    // the four views are filled
    await expect(page.getByRole("heading", { name: "Q1 · Client view" })).toBeVisible();
    await expect(page.locator("section[aria-labelledby=pg-q1] table.ptable tbody tr").first()).toBeVisible();
    await expect(page.locator("ol.pg-wire > li").first()).toBeVisible();
    if (s.id === "S5") await expect(page.locator("section[aria-labelledby=pg-q3]")).toContainText(/Recon (DRIFT|BREAKER|EXCEPTION)/i);
  });
}
