import { createRequire } from "node:module"; const { chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright");
import fs0 from "node:fs";
import fs from "node:fs";
export const BASE = "http://localhost:3100";
export const SHOTS = "/home/user/paysettle/docs/simulations/travel-india/shots";
fs.mkdirSync(SHOTS, { recursive: true });
let browser;
export async function launch() { browser = await chromium.launch(); return browser; }
const NAMES = { Priya: "Priya Shah", Dan: "Dan Okafor", Meera: "Meera Iyer", Arjun: "Arjun Rao", Marcus: "Marcus Bell", Lena: "Lena Park", Olivia: "Olivia Grant", Farah: "Farah Ali", Alex: "Alex Chen", Judge: "Hackathon Judge" };
const STATE = "/tmp/claude-0/sim/state";
fs.mkdirSync(STATE, { recursive: true });
export async function as(who) {
  const sf = `${STATE}/${who}.json`;
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, ...(fs.existsSync(sf) ? { storageState: sf } : {}) });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.goto("/login");
  if (new URL(page.url()).pathname === "/login") {
    await page.getByRole("button", { name: new RegExp(`^${NAMES[who]}\\b`) }).click();
    await page.waitForURL((u) => u.pathname !== "/login", { timeout: 30000 });
    if (new URL(page.url()).pathname === "/terms-accept") {
      await page.getByRole("checkbox", { name: /accept the platform terms/i }).check();
      await page.getByRole("button", { name: "Accept and continue" }).click();
      await page.waitForURL((u) => u.pathname !== "/terms-accept");
    }
    await ctx.storageState({ path: sf });
  }
  return page;
}
export async function shot(page, name, full = true) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => { if (!document.getElementById("simbadge")) { const d = document.createElement("div"); d.id = "simbadge"; d.textContent = "SIMULATION · sandbox data · mock PayPal rail"; d.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:99999;background:#7a1f1f;color:#fff;font:600 12px system-ui;padding:4px 8px;border-radius:4px;opacity:.85"; document.body.appendChild(d); } });
  const p = `${SHOTS}/${name}.png`;
  if (full) { const h = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 7000)); await page.setViewportSize({ width: 1440, height: Math.max(900, h) }); await sleep(300); await page.screenshot({ path: p }); await page.setViewportSize({ width: 1440, height: 900 }); }
  else await page.screenshot({ path: p });
  console.log("SHOT", name);
}
export async function dump(page, label = "") {
  const t = await page.locator("main").innerText().catch(() => "");
  console.log(`---- ${label} ${page.url()}\n${t.slice(0, 6000)}`);
  const ctl = await page.evaluate(() => [...document.querySelectorAll("main button, main input, main select, main textarea, main summary")].map((e) => `${e.tagName}${e.id ? "#" + e.id : ""}${e.name ? "[" + e.name + "]" : ""}${e.type ? "(" + e.type + ")" : ""} ${(e.innerText || e.value || e.getAttribute("aria-label") || "").slice(0, 60).replace(/\s+/g, " ")}`));
  console.log("CTL:", ctl.join(" | ").slice(0, 4000));
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rev = async (page) => Number(((await page.locator(".chip", { hasText: /^Revision \d+$/ }).first().textContent()) ?? "").replace(/\D/g, ""));
export async function waitRevAbove(page, r) { for (let i = 0; i < 60; i++) { await sleep(500); try { if ((await rev(page)) > r) return; } catch {} } throw new Error("revision did not increase; url=" + page.url() + " err=" + (await page.locator("[role=alert]").allInnerTexts().catch(() => []))); }
export async function shotEl(loc, name) {
  await loc.scrollIntoViewIfNeeded();
  await loc.page().evaluate(() => { if (!document.getElementById("simbadge")) { const d = document.createElement("div"); d.id = "simbadge"; d.textContent = "SIMULATION · sandbox data · mock PayPal rail"; d.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:99999;background:#7a1f1f;color:#fff;font:600 12px system-ui;padding:4px 8px;border-radius:4px;opacity:.85"; document.body.appendChild(d); } });
  await loc.screenshot({ path: `${SHOTS}/${name}.png` }); console.log("SHOT", name);
}
export const msRow = (page, code) => page.locator("li", { has: page.getByRole("button", { name: new RegExp(`^(Prune|Restore) ${code} `) }) });
export async function errs(page) { const a = await page.locator("[role=alert]").allInnerTexts().catch(() => []); if (a.length) console.log("ALERT:", a.join(" | ")); return a; }
export const FILES = "/tmp/claude-0/sim/files";
export function msIds() { return JSON.parse(fs.readFileSync("/tmp/claude-0/sim/ms.json", "utf8")); }
export async function travel(alex, hours) {
  const r = await alex.request.post("/api/sandbox/time-travel", { data: { simId: "sim_travelindia", hours } });
  const j = await r.json().catch(() => ({}));
  const { execSync } = await import("node:child_process");
  const off = execSync(`PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres paysettle -tAc "select clock_offset_hours from sim_sessions where id='sim_travelindia'"`).toString().trim();
  console.log("TRAVEL +" + hours + "h → offset " + off + "h (day " + (Number(off) / 24).toFixed(1) + ")", r.status(), j.error === "SCENARIO_UNKNOWN" ? "(state view n/a for the manual bridge; timers ran)" : JSON.stringify(j.result ?? j).slice(0, 400));
  fs.appendFileSync("/tmp/claude-0/sim/travel-log.txt", `${new Date().toISOString()} +${hours}h -> ${off}h\n`); return j;
}
export async function submitEvidence(p, ws, msId, files, note, { confirm = true, shotName } = {}) {
  await p.goto(`/contracts/${ws}/m/${msId}`);
  await p.locator(`#ev-files-${msId}`).setInputFiles(files.map((f) => `${FILES}/${f}`));
  await p.locator(`#ev-note-${msId}`).fill(note);
  if (confirm) for (const c of await p.locator("main input[type=checkbox]").all()) if (!(await c.isChecked())) await c.check();
  await sleep(800);
  if (shotName) await shot(p, shotName);
  await p.getByRole("button", { name: /^Submit evidence for / }).click();
  for (let i = 0; i < 120; i++) { await sleep(500); if (!(await p.getByText("Uploading", { exact: false }).count()) && !(await p.getByRole("button", { name: /^Submit evidence for / }).count())) break; }
  await p.waitForLoadState("networkidle"); await sleep(1000); await errs(p);
}
export async function approve(p, ws, msId, code, shotPre, shotPost) {
  await p.goto(`/contracts/${ws}/m/${msId}`);
  if (shotPre) await shot(p, shotPre);
  await p.getByRole("checkbox", { name: /I inspected the evidence/ }).check();
  const btn = p.getByRole("button", { name: /^Approve (and release|gate)/ });
  await btn.click();
  await p.waitForLoadState("networkidle"); await sleep(3000); await errs(p);
  await p.reload();
  if (shotPost) await shot(p, shotPost);
  console.log("APPROVED", code, (await p.locator(".phead .sub").innerText().catch(() => "")));
}
export async function asEmail(who, email) {
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  await page.goto("/login");
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill("demo-password-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 30000 });
  if (new URL(page.url()).pathname === "/terms-accept") {
    await page.getByRole("checkbox", { name: /accept the platform terms/i }).check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
    await page.waitForURL((u) => u.pathname !== "/terms-accept");
  }
  console.log("signed in", who, page.url());
  return page;
}
