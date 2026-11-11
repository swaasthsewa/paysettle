/**
 * Public site. F3 landing (hero, live-demo entry), waitlist form (zod, honeypot, rate limit) with a random e-mail;
 * P10: no guarantee language on the landing page.
 */
import { expect, test } from "@playwright/test";
import { randomEmail } from "./helpers";

test("F3 landing shows the promise, the live demo entry and the waitlist entry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try the live demo" }).first()).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: /waitlist/i }).first()).toBeVisible();
  const text = (await page.locator("body").innerText()).toLowerCase();
  for (const banned of ["risk-free", "risk free", "100% irreversible", "guaranteed payment", "bank-grade"]) expect(text).not.toContain(banned);
  await page.getByRole("link", { name: "Try the live demo" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Explore the live demo" })).toBeVisible();
});

test("F3 waitlist accepts a new e-mail and recognises it the second time", async ({ browser }) => {
  // a fresh client address per run, so the in-memory limit of 5 posts per address per 10 minutes never trips
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` } });
  const page = await ctx.newPage();
  await page.goto("/waitlist");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const email = randomEmail();
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.locator("#wl-role").selectOption({ index: 0 });
  await page.locator("#wl-note").fill("Playwright check — please ignore.");
  await page.getByRole("button", { name: /join|send|add/i }).click();
  await expect(page.locator(".s-answer .notice")).toContainText("You are on the list");
  await page.getByLabel(/e-?mail/i).fill(email);
  await page.getByRole("button", { name: /join|send|add/i }).click();
  await expect(page.locator(".s-answer .notice")).toContainText("already on the list");
  await ctx.close();
});

test("F3 waitlist rejects a malformed e-mail and keeps the form", async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.200.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` } });
  const page = await ctx.newPage();
  await page.goto("/waitlist");
  await page.getByLabel(/e-?mail/i).fill("not-an-email");
  await page.getByRole("button", { name: /join|send|add/i }).click();
  await expect(page.locator(".s-answer .notice")).toBeVisible();
  await expect(page.locator("#wl-email")).toHaveAttribute("aria-invalid", "true");
  await ctx.close();
});
