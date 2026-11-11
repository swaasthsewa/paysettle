import fs from "node:fs";
import { execFileSync } from "node:child_process";
import PDFDocument from "pdfkit";
import { settle, shot, mainText } from "./lib.mjs";
const DIR = "/home/user/paysettle/sim/files";
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
function pdf(file, title, lines) {
  return new Promise((res) => {
    const d = new PDFDocument({ size: "A4", margin: 50 });
    const out = fs.createWriteStream(file); d.pipe(out);
    d.fontSize(10).fillColor("#b00").text("SAMPLE FILE — PaySettle build simulation on sandbox data. Not a real deliverable.");
    d.moveDown().fontSize(18).fillColor("#000").text(title);
    d.moveDown().fontSize(11);
    for (const l of lines) d.text("• " + l).moveDown(0.3);
    d.moveDown().fontSize(9).fillColor("#555").text("Prepared by Arjun Rao's team (tech lead, two engineers, a designer and QA) for Dan Okafor. Generated " + new Date().toISOString());
    d.end(); out.on("finish", res);
  });
}
function mp4(file, label) {
  const t = label.replace(/[^A-Za-z0-9 .,()-]/g, " ").slice(0, 46);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x1f6f5c:s=640x360:d=4", "-vf", `drawtext=text='SAMPLE - ${t}':fontcolor=white:fontsize=20:x=(w-text_w)/2:y=(h-text_h)/2-20,drawtext=text='simulation on sandbox data':fontcolor=white:fontsize=16:x=(w-text_w)/2:y=(h-text_h)/2+20`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file]);
}
async function png(browser, file, title, sub) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(`<body style="margin:0;font-family:sans-serif;background:#f4f7f6"><div style="background:#1f6f5c;color:#fff;padding:18px 16px;font-size:18px">PaySettle</div>
  <div style="padding:16px"><div style="color:#b00;font-size:12px;margin-bottom:8px">SAMPLE screenshot — simulation, sandbox data</div><h2 style="margin:0 0 8px">${title}</h2><p style="color:#444">${sub}</p>
  ${["Contract room", "Fund tranche 1", "Evidence · attempt 1", "Approve and release"].map((x) => `<div style="background:#fff;border-radius:10px;padding:14px;margin:10px 0;box-shadow:0 1px 3px #0002">${x}<div style="height:8px;background:#dfe9e6;margin-top:10px;border-radius:4px"></div></div>`).join("")}</div></body>`);
  await p.screenshot({ path: file, type: "png" }); await ctx.close();
}
function log(file, title, lines) {
  fs.writeFileSync(file, `# SAMPLE LOG — PaySettle build simulation on sandbox data\n# ${title}\n${lines.join("\n")}\n`);
}
/** Parses "Proof to submit" on the milestone page and builds matching sample files. */
export async function buildFiles(page, browser, tag, extra = {}) {
  const t = await mainText(page);
  const m = t.match(/Proof to submit\n([\s\S]*?)\nAcceptance criteria\n([\s\S]*?)\nLock rule/);
  const proof = (m?.[1] ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const criteria = (m?.[2] ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const title = (t.match(/\n(M\d+ · [^\n]+)\n/) ?? [])[1] ?? tag;
  const files = [], links = [];
  let i = 0;
  for (const line of proof) {
    const mm = line.match(/^(\d+) × (\S+)\s*(.*)$/); if (!mm) continue;
    const n = Number(mm[1]), kind = mm[2].toLowerCase(), what = mm[3] || title;
    for (let k = 0; k < Math.max(1, n); k++) {
      const base = `${DIR}/${tag}-${++i}-${slug(what)}`;
      if (kind === "pdf") { await pdf(base + ".pdf", what, [title, ...criteria.map((c) => "Met: " + c)]); files.push(base + ".pdf"); }
      else if (kind === "image" || kind === "photo" || kind === "photos" || kind === "images") { await png(browser, base + ".png", what + " (" + (k + 1) + " of " + n + ")", title); files.push(base + ".png"); }
      else if (kind === "video" || kind === "videos") { mp4(base + ".mp4", what + " " + (k + 1)); files.push(base + ".mp4"); }
      else if (kind === "log" || kind === "logs") {
        log(base + ".txt", what, ["run #" + (1000 + i) + " on main (sample)", "lint ............ ok", "typecheck ....... ok", "unit tests ...... 412 passed, 0 failed", "e2e journeys .... 31 passed, 0 failed", "dependency scan . 0 critical, 0 high", "status: SUCCESS"]); files.push(base + ".txt");
      }
      else if (kind === "link" || kind === "links") links.push(`${what}: https://staging.paysettle.example/${slug(what)} (sample link)`);
    }
  }
  return { files, links, proof, criteria, title };
}
export async function submitEvidence(page, browser, msUrl, tag, { note = "", shotName, extraLinks = [] } = {}) {
  await page.goto(msUrl); await settle(page);
  const { files, links, title } = await buildFiles(page, browser, tag);
  const fileInput = page.locator('input[type=file][id^="ev-files-"]');
  if (files.length) await fileInput.setInputFiles(files);
  const allLinks = [...links, ...extraLinks];
  await page.locator('textarea[id^="ev-note-"]').fill([note || `Delivered ${title}. Sample evidence for a simulation on sandbox data.`, ...allLinks].join("\n"));
  const boxes = page.locator("main form input[type=checkbox]");
  for (let k = 0; k < (await boxes.count()); k++) await boxes.nth(k).check();
  await page.waitForTimeout(500);
  if (shotName) await shot(page, shotName);
  await Promise.all([page.waitForNavigation({ timeout: 60000 }).catch(() => {}), page.getByRole("button", { name: /^Submit evidence for / }).click()]);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
  const txt = await mainText(page);
  return { files, links, title, ok: /submitted|In review|Submitted|waiting for/i.test(txt), txt };
}
import { q, as, toDay } from "./lib.mjs";
export async function msList(ws) { return q("select id, code, title, state, amount_cents, target_day, tranche_idx, active from ws_milestones where workspace_id=$1 order by seq", [ws]); }
export async function msUrl(ws, code) { const r = (await msList(ws)).find((m) => m.code === code && m.active); if (!r) throw new Error("no " + code); return `/contracts/${ws}/m/${r.id}`; }
export async function approve(page, url, { shotName, aiWait = 45000 } = {}) {
  await page.goto(url); await settle(page);
  // wait for the AI verifier panel to settle (live AI)
  const ai = page.locator("section.ev-ai");
  if (await ai.count()) {
    const t0 = Date.now();
    while (Date.now() - t0 < aiWait) { const tx = (await ai.innerText().catch(() => "")); if (!/checking|thinking|loading|running/i.test(tx) || /AI advice/.test(tx) && tx.length > 200) break; await page.waitForTimeout(2000); await page.reload(); }
  }
  const box = page.getByRole("checkbox", { name: /I inspected the evidence/ });
  if (await box.count()) await box.check();
  if (shotName) await shot(page, shotName);
  const btn = page.getByRole("button", { name: /^Approve/ }).first();
  await Promise.all([page.waitForNavigation({ timeout: 60000 }).catch(() => {}), btn.click()]);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await page.reload(); await settle(page);
  return mainText(page);
}
/** One milestone end to end: clock to its day, provider submits, client approves. */
export async function deliver(browser, ws, code, day, { prefix, shots = false, note } = {}) {
  if (day != null) await toDay(ws, day);
  const arjun = await as("arjun"), dan = await as("dan");
  const url = await msUrl(ws, code);
  const s = await submitEvidence(arjun, browser, url, `${ws.slice(-6)}-${code}`, { note, shotName: shots ? `${prefix}-provider-submit-${code.toLowerCase()}` : undefined });
  if (!s.ok) console.log("WARN submit unclear", s.txt.slice(0, 400));
  if (shots) { await dan.goto(url); await settle(dan); }
  const t = await approve(dan, url, { shotName: shots ? `${prefix}-client-review-${code.toLowerCase()}` : undefined });
  if (shots) { await shot(dan, `${prefix}-client-released-${code.toLowerCase()}`, false); await arjun.goto(url); await settle(arjun); await shot(arjun, `${prefix}-provider-sees-release-${code.toLowerCase()}`, false); }
  const head = t.split("\n").slice(0, 6).join(" | ");
  console.log(code, "=>", head);
  return t;
}
