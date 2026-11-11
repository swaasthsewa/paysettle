import { chromium } from "playwright";
import fs from "node:fs";
export const BASE = "http://localhost:3100";
export const SHOTS = "/home/user/paysettle/docs/simulations/paysettle-build/shots";
fs.mkdirSync(SHOTS, { recursive: true });
const NAMES = { dan: "Dan Okafor", arjun: "Arjun Rao", ops: "Olivia Grant", fin: "Farah Ali", admin: "Alex Chen", med: "Marcus Bell", med2: "Lena Park", priya: "Priya Shah" };
let browser;
const ctxs = {};
export async function launch() { browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }); return browser; }
export async function as(who) {
  if (ctxs[who]) return ctxs[who];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: BASE });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(`^${NAMES[who]}\\b`) }).click();
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 30000 });
  if (new URL(page.url()).pathname === "/terms-accept") {
    await page.getByRole("checkbox", { name: /accept the platform terms/i }).check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
    await page.waitForURL((u) => u.pathname !== "/terms-accept");
  }
  ctxs[who] = page; return page;
}
export async function shot(page, name, full = true) {
  const f = `${SHOTS}/${name}.jpg`;
  await page.waitForTimeout(300);
  if (full) await page.evaluate(() => { window.scrollTo(0, 0); for (const el of document.querySelectorAll("aside.side, header.topbar")) el.style.position = "static"; });
  await page.screenshot({ path: f, fullPage: full, type: "jpeg", quality: 80 });
  console.log("shot", name);
  return f;
}
export async function dumpForms(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll("main form, main details > summary, main button, main a[href]").forEach((el) => {
      if (el.tagName === "FORM") {
        const f = [...el.querySelectorAll("input,select,textarea,button")].map((i) => {
          const lab = i.id ? document.querySelector(`label[for="${i.id}"]`)?.textContent?.trim() : i.closest("label")?.textContent?.trim();
          return `${i.tagName.toLowerCase()}[${i.type || ""}] name=${i.name} id=${i.id} label=${(lab || i.getAttribute("aria-label") || i.textContent || "").slice(0, 60).replace(/\s+/g, " ")} val=${(i.value || "").slice(0, 30)}`;
        });
        out.push("FORM " + (el.getAttribute("data-testid") || "") + "\n   " + f.join("\n   "));
      } else if (el.tagName === "SUMMARY") out.push("SUMMARY " + el.textContent.trim().slice(0, 80));
      else if (el.tagName === "A") out.push("A " + el.textContent.trim().slice(0, 50) + " -> " + el.getAttribute("href"));
    });
    return out.join("\n");
  });
}
export async function close() { await browser.close(); }
export const STATE_F = "/home/user/paysettle/sim/state.json";
export const loadState = () => (fs.existsSync(STATE_F) ? JSON.parse(fs.readFileSync(STATE_F, "utf8")) : {});
export const saveState = (s) => fs.writeFileSync(STATE_F, JSON.stringify(s, null, 2));
export async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const u = new URL(page.url());
  const err = u.searchParams.get("err");
  if (err) throw new Error("APP ERROR: " + err);
}
export async function clickWait(page, locator) {
  const before = page.url();
  await Promise.all([page.waitForNavigation({ timeout: 30000 }).catch(() => {}), locator.click()]);
  await settle(page);
}
export const msForm = (page, code, field) => page.locator(`form:has(input[name=code][value="${code}"]):has(input[name=${field}])`).first();
export async function room(page, ws) { await page.goto(`/contracts/${ws}`); await settle(page); }
export async function appendMs(page, ws, m) {
  await room(page, ws);
  await page.locator("summary", { hasText: "Append a milestone" }).click();
  await page.fill("#am-title", m.title);
  await page.selectOption("#am-type", m.type ?? "PAY");
  await page.fill("#am-day", String(m.day));
  if ((m.type ?? "PAY") === "PAY") await page.fill("#am-share", String(m.share ?? 0));
  if (m.after) await page.selectOption("#am-after", m.after);
  await page.selectOption("#am-art", m.artifact ?? "PDF");
  await page.fill("#am-min", String(m.min ?? 1));
  await page.fill("#am-note", m.note ?? "");
  await page.fill("#am-crit", (m.criteria ?? []).join("\n"));
  await page.fill("#am-lock", m.lock ?? "Client approves the evidence.");
  await page.fill("#am-disp", m.dispute ?? "Missing items are listed; the provider fixes them within 72 hours.");
  await clickWait(page, page.getByRole("button", { name: "Append milestone" }));
}
export async function editMs(page, ws, code, { day, share }) {
  await room(page, ws);
  const f = msForm(page, code, "day");
  if (day !== undefined) await f.locator("input[name=day]").fill(String(day));
  if (share !== undefined) await f.locator("input[name=share]").fill(String(share));
  await clickWait(page, f.getByRole("button", { name: "Save" }));
}
export async function pruneMs(page, ws, code) {
  await room(page, ws);
  await clickWait(page, page.getByRole("button", { name: new RegExp(`^Prune ${code} `) }));
}
export async function signRev(page, ws) {
  await room(page, ws);
  const btn = page.getByRole("button", { name: /^Sign revision \d+$/ });
  await clickWait(page, btn);
  const t = await page.locator("main").innerText();
  if (!/Your signature on revision \d+ is recorded|Both parties signed|Locked/.test(t)) console.log("WARN sign status unclear");
}
export async function mainText(page) { return page.locator("main").innerText(); }
export async function fundTranche(page, ws, n) {
  await room(page, ws);
  const row = page.locator("section[aria-labelledby=tr-h] li", { hasText: `Tranche ${n}` });
  await row.getByRole("link", { name: "Fund tranche" }).click();
  await page.waitForURL(/\/fund\//);
  return row;
}
import pg from "pg";
export const pool = new pg.Pool({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/paysettle" });
export async function q(sql, args = []) { return (await pool.query(sql, args)).rows; }
/** Binds a virtual clock to a normal (non-playground) workspace: ONE sim_sessions row, no sim_workspaces row. */
export async function bindClock(ws) {
  const r = await q("select id from sim_sessions where workspace_id=$1 and scenario='SIMCLOCK'", [ws]);
  if (r.length) return r[0].id;
  const id = "sim_clk" + Math.random().toString(36).slice(2, 12);
  await q("insert into sim_sessions (id, judge_id, scenario, workspace_id, clock_offset_hours, mode) values ($1,'u_admin','SIMCLOCK',$2,0,'MOCK')", [id, ws]);
  return id;
}
/** Advances the workspace clock through the app's time machine (POST /api/sandbox/time-travel), as Alex Chen (admin). */
export async function toDay(ws, day) {
  const simId = await bindClock(ws);
  const admin = await as("admin");
  const r = await admin.request.post("/api/sandbox/time-travel", { data: { simId, toDay: day } });
  const j = await r.json();
  if (!r.ok() && j.error === "SCENARIO_UNKNOWN") { const [o] = await q("select clock_offset_hours h from sim_sessions where id=$1", [simId]); console.log(`clock ${ws} -> offset ${o.h} h (day ${o.h / 24})`); return { day: o.h / 24 }; }
  if (!r.ok()) { if (j.message && /forward|already/i.test(j.message)) return j; throw new Error("time travel: " + JSON.stringify(j)); }
  console.log(`clock ${ws} -> day ${j.result.day}`, JSON.stringify({ w: j.result.watchdog, r: j.result.reviewTimers, wait: j.result.waiting }));
  return j.result;
}
