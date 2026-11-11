import { launch, as, shot, shotEl, dump, msIds, sleep, errs, travel, submitEvidence, approve } from "./lib.mjs";
import fs from "node:fs";
const ws = fs.readFileSync("ws.txt", "utf8"); const M = msIds(); const D = fs.readFileSync("dispute.txt", "utf8");
const b = await launch();
const me = await as("Meera"), pr = await as("Priya"), al = await as("Alex");
// C01 is sequenced after C02: Meera asks for a one-off out-of-sequence start, Priya signs it
await pr.goto(`/contracts/${ws}/m/${M.C01}`);
{ const t = await pr.locator("main").innerText(); const k = t.indexOf("Out-of-sequence"); console.log("OOS client:", t.slice(k, k + 700)); }
await pr.getByRole("checkbox", { name: /I let C01 start before C02/ }).check();
await shot(pr, "07-week3-client-out-of-sequence-request");
await pr.getByRole("button", { name: /^(Allow|Sign)/ }).first().click(); await pr.waitForLoadState("networkidle"); await sleep(1500); await errs(pr);
await pr.reload(); await shot(pr, "07-week3-client-out-of-sequence-signed");
// C01 car + transfers released while C02 is in dispute
await submitEvidence(me, ws, M.C01, ["C01-car-transfers.pdf", "C01-car-transfers-text-copy.txt"], "Private car with driver and all transfers confirmed with Sample Roadways Pvt Ltd (sample data).", { shotName: "07-week3-provider-submit-car" });
await approve(pr, ws, M.C01, "C01", "07-week3-client-review-car-during-dispute", "07-week3-client-car-released-during-dispute");
await me.goto(`/provider/payouts`); await shot(me, "07-week3-provider-payout-car-during-dispute");
// Tier 1 sealed offers
async function seal(p, pct, name) {
  await p.goto(D);
  const r = p.locator("#dz-share");
  await r.evaluate((el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(el, String(v)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, pct);
  await sleep(300);
  if (name) await shot(p, name);
  await p.getByRole("button", { name: "Seal my offer" }).click();
  await p.waitForLoadState("networkidle"); await sleep(1500); await errs(p);
}
const rounds = [[40, 90], [50, 85], [55, 80]];
for (const [i, [c, pv]] of rounds.entries()) {
  await seal(pr, c, i === 0 ? "08-tier1-client-sealing-offer" : null);
  await seal(me, pv, i === 0 ? "08-tier1-provider-sealing-offer" : null);
  await pr.goto(D); const t = await pr.locator("main").innerText();
  console.log(`ROUND ${i + 1}:`, t.slice(t.indexOf("Stage"), t.indexOf("Stage") + 300).replace(/\n/g, " | "));
  const k = t.indexOf("Round"); console.log(t.slice(k, k + 600).replace(/\n/g, " | "));
}
await pr.goto(D); await shot(pr, "08-tier1-client-offers-did-not-converge");
await me.goto(D); await shot(me, "08-tier1-provider-offers-did-not-converge");
await dump(pr, "after tier1");
await b.close();
