/**
 * Persona sign-in. F1.1 sandbox demo sign-in (P9), F1.10 role-scoped navigation: every seeded persona lands on its
 * role's home, the main menu shows exactly that role's items, and every menu page answers without a server error.
 */
import { expect, test } from "@playwright/test";
import { menuGroups } from "../src/lib/menu";
import { PERSONAS, menuLabels, signIn } from "./helpers";

for (const p of PERSONAS) {
  test(`F1.1 F1.10 ${p.role}: ${p.name} signs in, lands on ${p.home}, menu matches the role`, async ({ page }) => {
    await signIn(page, p.name);
    await expect(page).toHaveURL(new RegExp(`${p.home}$`));
    await expect(page.locator(".sim-banner")).toContainText("Sandbox");
    await expect(page.locator("aside.side .who")).toContainText(p.name);

    const expected = menuGroups(p.role, true).flatMap((g) => g.items.map((i) => i.label));
    expect(await menuLabels(page)).toEqual(expected);

    // every page in the role's menu renders (no 5xx, no "being built" placeholder)
    const pages = menuGroups(p.role, true).flatMap((g) => g.items).filter((i) => !["/logout", "/login"].includes(i.href));
    for (const it of pages) {
      const r = await page.request.get(it.href);
      expect(r.status(), `${it.href} (${it.label}) for ${p.role}`).toBeLessThan(400);
      expect(await r.text(), `${it.href} still a placeholder`).not.toContain("part of the full-scope build");
    }
  });
}

test("F1.10 a client cannot open another role's console", async ({ page }) => {
  await signIn(page, "Priya");
  await page.goto("/finance/ledger");
  await expect(page).toHaveURL(/\/client$/);
});
