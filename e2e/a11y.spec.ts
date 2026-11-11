/**
 * Accessibility. axe-core (WCAG 2.0/2.1 A and AA rules) on the landing page, sign-in, the client overview, a
 * contract room, a milestone page and the Judge Playground. Fails on serious or critical violations; every finding (any impact)
 * is written to e2e/a11y-report.json for the manuals and the fix list.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

interface Entry { page: string; url: string; violations: { id: string; impact: string | null; help: string; nodes: number; targets: string[]; summary: string }[] }
const FILE = "e2e/a11y-report.json";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** One report per run (E2E_RUN_ID is set once by playwright.config.ts), merged page by page: a failed test restarts the worker. */
function record(e: Entry) {
  const run = process.env.E2E_RUN_ID ?? "local";
  let doc: { run: string; generatedAt: string; tags: string[]; reducedMotion: boolean; pages: Entry[] } = { run, generatedAt: new Date().toISOString(), tags: TAGS, reducedMotion: true, pages: [] };
  if (existsSync(FILE)) { try { const old = JSON.parse(readFileSync(FILE, "utf8")); if (old.run === run) doc = old; } catch { /* start fresh */ } }
  doc.pages = [...doc.pages.filter((p) => p.page !== e.page), e];
  doc.generatedAt = new Date().toISOString();
  writeFileSync(FILE, JSON.stringify(doc, null, 2) + "\n");
}
// Scan with reduced motion so scroll-reveal animations are finished and every element is checked at its final colours.
test.use({ reducedMotion: "reduce" });

async function scan(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const v = r.violations.map((x) => ({
    id: x.id, impact: x.impact ?? null, help: x.help, nodes: x.nodes.length,
    targets: x.nodes.slice(0, 8).map((n) => n.target.join(" ")),
    summary: [...new Set(x.nodes.map((n) => (n.failureSummary ?? "").split("\n").slice(1).join(" ").trim().replace(/\s+/g, " ").slice(0, 200)))].slice(0, 5).join(" | "),
  }));
  record({ page: name, url: new URL(page.url()).pathname, violations: v });
  const blocking = v.filter((x) => x.impact === "serious" || x.impact === "critical").map(({ id, impact, nodes, targets, summary }) => ({ id, impact, nodes, targets, summary }));
  expect.soft(blocking, `${name}: serious/critical axe violations`).toEqual([]);
}

test("A11y landing page has no serious or critical axe violations", async ({ page }) => { await page.goto("/"); await scan(page, "landing"); });
test("A11y sign-in page has no serious or critical axe violations", async ({ page }) => { await page.goto("/login"); await scan(page, "login"); });
test("A11y F2.03 client overview, contract room and F3.04 milestone page", async ({ page }) => {
  await signIn(page, "Priya");
  await scan(page, "client overview");
  await page.goto("/contracts/ws_demo_mvp");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await scan(page, "contract room");
  await page.goto("/contracts/ws_demo_mvp/m/ws_demo_mvp_m03");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await scan(page, "milestone page");
});
test("A11y F5.06 Judge Playground (with a scenario loaded)", async ({ page }) => {
  await signIn(page, "Hackathon Judge");
  await page.getByRole("radio", { name: "Fast mock" }).click();
  await page.getByRole("button", { name: /scenario S1:/ }).click();
  await expect(page.locator(".pg-live .notice")).toContainText("started");
  await scan(page, "playground");
});
