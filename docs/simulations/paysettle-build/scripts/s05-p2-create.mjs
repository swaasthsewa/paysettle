import { launch, as, close, loadState, saveState, shot, room, settle, mainText, clickWait } from "./lib.mjs";
const b = await launch(); const st = loadState();
const dan = await as("dan"), arjun = await as("arjun");
await room(dan, st.p1);
await dan.getByTestId("continue-panel").locator("summary").click();
await dan.fill("#np-title", "PaySettle build · period 2 (weeks 4–7)");
await dan.getByLabel(/Repeat this period's milestones/).uncheck();
for (const c of ["C01", "M06", "C02", "M07"]) await dan.locator(`input[name=carry][value=${c}]`).check();
await dan.fill("#np-note", "Weeks 4–7. Launch and handover move again with the build; chat and offline mode are planned for this period.");
await shot(dan, "w03-client-continue-into-period-2");
await Promise.all([dan.waitForURL(/ok=continued/, { timeout: 60000 }), dan.getByRole("button", { name: /Create period 2 draft/ }).click()]);
st.p2 = dan.url().split(/[?#]/)[0].replace(/^.*\/contracts\//, ""); saveState(st);
await settle(dan); await shot(dan, "w03-client-period-2-draft");
// the carry change order on period 1: both sign it
for (const [who, p] of [["arjun", arjun], ["dan", dan]]) {
  await room(p, st.p1);
  const rv = p.getByTestId("co-review");
  if (who === "arjun") await shot(p, "w03-provider-carry-change-order-review");
  const btn = rv.getByRole("button", { name: /^Sign change order \d+/ });
  await Promise.all([p.waitForNavigation().catch(() => {}), btn.click()]);
  await settle(p);
}
await room(dan, st.p1); await shot(dan, "w03-client-period-1-after-carry-change-order");
console.log((await mainText(dan)).match(/Change orders[\s\S]{0,800}/)?.[0]);
await close(); process.exit(0);
