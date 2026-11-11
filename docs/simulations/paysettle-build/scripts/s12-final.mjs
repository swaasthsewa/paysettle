import { launch, as, close, loadState, shot, room, settle, mainText } from "./lib.mjs";
import fs from "node:fs";
await launch(); const st = loadState();
const dan = await as("dan"), arjun = await as("arjun");
const D = "/home/user/paysettle/docs/simulations/paysettle-build/shots";
await dan.goto("/client/contracts"); await settle(dan); await shot(dan, "chain-client-contracts-list");
const lt = await mainText(dan); fs.writeFileSync("/home/user/paysettle/sim/contracts-list.txt", lt);
await arjun.goto("/provider/contracts"); await settle(arjun); await shot(arjun, "chain-provider-contracts-list");
const all = [st.p1, st.p2, st.p3, ...st.maint];
const chains = [];
for (const [i, ws] of all.entries()) {
  await room(dan, ws);
  const c = dan.getByTestId("period-chain");
  if (await c.count()) { chains.push(`${i + 1}: ` + (await c.innerText()).replace(/\n/g, " ")); if ([0, 3, 8].includes(i)) { await c.scrollIntoViewIfNeeded(); await dan.screenshot({ path: `${D}/chain-period-${i + 1}-chain-view.jpg`, type: "jpeg", quality: 80 }); } }
  else chains.push(`${i + 1}: (no chain panel)`);
}
fs.writeFileSync("/home/user/paysettle/sim/chains.txt", chains.join("\n")); console.log(chains.join("\n"));
await dan.goto("/client/receipts"); await settle(dan); await shot(dan, "end-client-receipts", false);
await dan.goto("/client"); await settle(dan); await shot(dan, "end-client-overview", false);
fs.writeFileSync("/home/user/paysettle/sim/client-overview.txt", await mainText(dan));
await arjun.goto("/provider/payouts"); await settle(arjun); await shot(arjun, "end-provider-payouts", false);
await arjun.goto("/provider"); await settle(arjun); await shot(arjun, "end-provider-overview", false);
fs.writeFileSync("/home/user/paysettle/sim/provider-overview.txt", await mainText(arjun));
await dan.goto(`/contracts/${st.p2}/timeline`); await settle(dan); await shot(dan, "w07-client-period-2-timeline", false);
await dan.goto("/client/disputes"); await settle(dan); await shot(dan, "end-client-disputes-none", false);
await close(); process.exit(0);
