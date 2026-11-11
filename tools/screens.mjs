#!/usr/bin/env node
/**
 * Screenshot tour for the manuals and the Devpost gallery (docs/screens/*.png).
 * Signs in as each demo persona through the sandbox picker (F1.1, P9) and saves a full-page PNG of every main screen.
 * Needs a running, seeded PaySettle (default http://localhost:3100) and Chrome/Chromium.
 *   node tools/screens.mjs                         all screens
 *   node tools/screens.mjs client mediator         only these groups
 *   SCREENS_BASE_URL=… CHROME_PATH=… SCREENS_WIDTH=1440 node tools/screens.mjs
 * Read-only except for the Judge Playground group, which starts fresh simulated sessions (S1 and S4, fast mock).
 */
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.SCREENS_BASE_URL ?? process.env.E2E_BASE_URL ?? "http://localhost:3100";
const CHROME = process.env.CHROME_PATH ?? (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
const WIDTH = Number(process.env.SCREENS_WIDTH ?? 1440);
const MAX_H = Number(process.env.SCREENS_MAX_HEIGHT ?? 3600); // very long pages (ledger, audit chain) are cut here
const OUT = "docs/screens";
mkdirSync(OUT, { recursive: true });

/** Persona button text on /login, by group. */
const WHO = { client: "Priya Shah", negotiation: "Dan Okafor", provider: "Meera Iyer", ops: "Olivia Grant", mediator: "Marcus Bell", finance: "Farah Ali", admin: "Alex Chen", marketing: "Maya Lopez", judge: "Hackathon Judge" };

/** Each group: who signs in (null = public), and the screens: [file, path or async fn(page) that navigates]. */
const GROUPS = {
  site: { who: null, shots: [
    ["01-landing", "/"], ["02-how-it-works", "/how-it-works"], ["03-waitlist", "/waitlist"], ["04-login", "/login"],
  ] },
  client: { who: WHO.client, shots: [
    ["10-client-overview", "/client"],
    ["11-client-contracts", "/client/contracts"],
    ["12-client-new-contract", "/client/new"],
    ["13-contract-room-locked", "/contracts/ws_demo_mvp"],
    ["14-milestone-review", async (p) => { await p.goto("/client"); const l = p.getByRole("link", { name: "Review proof" }); await ((await l.count()) ? l.first().click() : p.goto("/contracts/ws_demo_mvp/m/ws_demo_mvp_m03")); await p.waitForURL(/\/m\//); }],
    ["15-fund-tranche", async (p) => { await p.goto("/client"); const l = p.getByRole("link", { name: "Fund in PayPal" }); if (await l.count()) { await l.first().click(); await p.waitForURL(/\/fund\//); } else await p.goto("/client/contracts"); }],
    ["16-client-receipts", "/client/receipts"],
    ["17-client-disputes", "/client/disputes"],
    ["18-blueprints", "/blueprints"],
  ] },
  negotiation: { who: WHO.negotiation, shots: [
    ["19-negotiation-room", async (p) => { await p.goto("/client/contracts"); await p.getByRole("link", { name: "Demand planning sprint", exact: true }).first().click(); await p.waitForURL(/\/contracts\/ws_/); }],
  ] },
  provider: { who: WHO.provider, shots: [
    ["20-provider-overview", "/provider"], ["21-provider-onboarding", "/provider/onboarding"], ["22-provider-contracts", "/provider/contracts"], ["23-provider-payouts", "/provider/payouts"],
  ] },
  ops: { who: WHO.ops, shots: [
    ["30-ops-overview", "/ops"], ["31-ops-clearance", "/ops/clearance"], ["32-ops-hold-radar", "/ops/radar"], ["33-ops-provider-health", "/ops/providers"],
  ] },
  mediator: { who: WHO.mediator, shots: [
    ["40-mediator-overview", "/mediator"],
    ["41-mediator-case-queue", "/mediator/cases"],
    ["42-mediator-workbench", async (p) => { await p.goto("/mediator/cases"); await p.locator('main a[href^="/mediator/cases/"]').first().click(); await p.waitForURL(/\/mediator\/cases\/.+/); }],
    ["43-dispute-room", async (p) => { await p.goto("/mediator/cases"); await p.locator('main a[href^="/disputes/"]').first().click(); await p.waitForURL(/\/disputes\/.+/); }],
  ] },
  finance: { who: WHO.finance, shots: [
    ["50-finance-overview", "/finance"], ["51-finance-ledger", "/finance/ledger"], ["52-finance-reconciliation", "/finance/recon"], ["53-finance-fees", "/finance/fees"],
  ] },
  admin: { who: WHO.admin, shots: [
    ["60-admin-health", "/admin"], ["61-admin-webhooks", "/admin/webhooks"], ["62-admin-audit-chain", "/admin/audit"], ["63-admin-switchboard", "/admin/flags"], ["64-four-eyes-queue", "/admin/dual-control"],
  ] },
  marketing: { who: WHO.marketing, shots: [
    ["70-marketing-funnel", "/marketing"], ["71-blueprint-studio", "/marketing/blueprints"],
  ] },
  judge: { who: WHO.judge, shots: [
    ["80-playground-start", "/playground"],
    ["81-playground-s1-done", (p) => runScenario(p, "S1")],
    ["82-playground-s4-dispute", (p) => runScenario(p, "S4")],
    ["83-account-ai-agents", "/account/ai"],
    ["84-account-security", "/account"],
  ] },
};

async function runScenario(page, id) {
  await page.goto("/playground");
  await page.getByRole("radio", { name: "Fast mock" }).click();
  await page.getByRole("button", { name: new RegExp(`scenario ${id}:`) }).click();
  await page.locator(".pg-live .notice").filter({ hasText: "started" }).waitFor();
  await page.getByRole("button", { name: "Run all" }).click();
  await page.getByRole("button", { name: /Running all/ }).waitFor({ state: "detached", timeout: 90_000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll("li.pg-step[data-s=pending]").length === 0, null, { timeout: 90_000 });
}

async function signIn(page, name) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  if (new URL(page.url()).pathname === "/terms-accept") { // first sign-in after a terms change (F1.8)
    await page.getByRole("checkbox", { name: /accept the platform terms/i }).check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
    await page.waitForURL((u) => u.pathname !== "/terms-accept", { timeout: 30_000 });
  }
}

const only = process.argv.slice(2);
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const saved = [], failed = [];
for (const [group, g] of Object.entries(GROUPS)) {
  if (only.length && !only.includes(group)) continue;
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: WIDTH, height: 900 }, reducedMotion: "reduce", colorScheme: "light", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  try { if (g.who) await signIn(page, g.who); } catch (e) { failed.push(`${group}: sign-in failed — ${e.message}`); await ctx.close(); continue; }
  for (const [file, target] of g.shots) {
    try {
      if (typeof target === "string") await page.goto(target); else await target(page);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(250);
      // grow the window to the page height instead of stitching (keeps the sticky menu and top bar where they belong)
      const h = Math.min(MAX_H, await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)));
      await page.setViewportSize({ width: WIDTH, height: Math.max(900, h) });
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll("main, .main").forEach((e) => e.scrollTo?.(0, 0)); });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${file}.png` });
      await page.setViewportSize({ width: WIDTH, height: 900 });
      saved.push(file);
      console.log(`✓ ${file}  ${new URL(page.url()).pathname}`);
    } catch (e) {
      failed.push(`${file}: ${e.message.split("\n")[0]}`);
      console.error(`✗ ${file}: ${e.message.split("\n")[0]}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${saved.length} screenshot(s) in ${OUT}/${failed.length ? `, ${failed.length} failed` : ""}`);
if (failed.length) process.exit(1);
