import { launch, as, close, loadState, saveState, shot, room, settle, mainText, appendMs, pruneMs, signRev, clickWait, toDay, q } from "./lib.mjs";
import { deliver } from "./evidence.mjs";
import { fund } from "./s03-fund.mjs";
const b = await launch(); const st = loadState();
const dan = await as("dan"), arjun = await as("arjun");
st.maint ??= [];
const PLAN = [["Security patches applied", 10], ["Bug-fix SLA met", 20], ["Monthly uptime report ≥ 99.5%", 25], ["Monthly release note", 26]];
async function startMonth(n, parent) {
  const pre = `m${String(n).padStart(2, "0")}`, full = n <= 2;
  const me = n % 2 ? arjun : dan;
  await room(me, parent);
  await me.getByTestId("continue-panel").locator("summary").click();
  await me.fill("#np-title", `PaySettle maintenance · month ${n}`);
  await me.getByLabel(/Repeat this period's milestones/).check();
  await me.fill("#np-note", `Maintenance month ${n}: same monthly template.`);
  if (full) await shot(me, `${pre}-${me === dan ? "client" : "provider"}-continue-into-month-${n}`, false);
  await Promise.all([me.waitForURL(/ok=continued/, { timeout: 60000 }), me.getByRole("button", { name: /Create period \d+ draft/ }).click()]);
  const ws = me.url().split(/[?#]/)[0].replace(/^.*\/contracts\//, "");
  st.maint[n - 1] = ws; saveState(st);
  if (n === 1) {
    // turn the repeated build template into the maintenance template
    await room(arjun, ws);
    await arjun.fill("#total", "4,000"); await clickWait(arjun, arjun.getByRole("button", { name: "Change total" }));
    const old = await q("select code from ws_milestones where workspace_id=$1 and active order by seq", [ws]);
    await appendMs(arjun, ws, { title: PLAN[0][0], day: 10, share: 25, artifact: "LOG", note: "Dependency scan before and after patching (sample)", criteria: ["All critical and high advisories patched within 7 days", "Dependency scan shows no known critical vulnerabilities"] });
    await appendMs(arjun, ws, { title: PLAN[1][0], day: 20, share: 25, artifact: "PDF", note: "Bug-fix SLA report (sample)", criteria: ["Severity-1 bugs fixed within 24 hours", "Severity-2 bugs fixed within 5 working days"] });
    await appendMs(arjun, ws, { title: PLAN[2][0], day: 25, share: 25, artifact: "PDF", note: "Uptime report from monitoring (sample)", criteria: ["Measured uptime for web and API is at least 99.5% for the month"] });
    await appendMs(arjun, ws, { title: PLAN[3][0], day: 26, share: 25, artifact: "PDF", note: "Release note (sample)", criteria: ["Release note lists every change shipped this month"] });
    for (const o of old) await pruneMs(arjun, ws, o.code);
  }
  await room(arjun, ws);
  if (full) await shot(arjun, `${pre}-provider-month-${n}-draft`);
  await signRev(arjun, ws); await signRev(dan, ws);
  await room(dan, ws);
  if (full) await shot(dan, `${pre}-client-month-${n}-locked`, false);
  await fund(ws, 1, pre);
  const ms = await q("select code, title, target_day from ws_milestones where workspace_id=$1 and active order by target_day, seq", [ws]);
  let first = true;
  for (const m of ms) {
    await deliver(b, ws, m.code, m.target_day, { prefix: pre, shots: full && first, note: `${m.title}, month ${n} (tech lead, QA). Sample report.` });
    first = false;
  }
  await room(dan, ws);
  await shot(dan, `${pre}-client-month-${n}-released`, !full ? false : true);
  return ws;
}
let parent = st.maint.length ? st.maint[st.maint.length - 1] : st.p3;
const startN = st.maint.filter(Boolean).length + 1;
for (let n = startN; n <= 6; n++) { parent = await startMonth(n, parent); console.log("month", n, "done", parent); }
await close(); process.exit(0);
