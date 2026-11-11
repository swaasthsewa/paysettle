import { launch, as, shot, shotEl, dump, msIds, sleep, errs, travel, submitEvidence } from "./lib.mjs";
import fs from "node:fs";
const ws = fs.readFileSync("ws.txt", "utf8"); const M = msIds();
const b = await launch();
const me = await as("Meera"), pr = await as("Priya"), al = await as("Alex"), fa = await as("Farah");
// end of week 2 ledger view filtered to this contract
await fa.goto(`/finance/ledger`);
const sel = fa.locator("main select").first();
if (await sel.count()) { await sel.selectOption({ label: "21-day India tour for 2 adults (booking project)" }).catch(() => {}); await fa.waitForLoadState("networkidle"); await sleep(1500); }
await shot(fa, "05-week2-finance-ledger-this-contract");
await travel(al, 120); // day 15
const V = [1, 2, 3, 4, 5, 6, 7].map((i) => fs.readdirSync("/tmp/claude-0/sim/files").find((f) => f.startsWith(`C02-voucher-${i}-`) && f.endsWith(".pdf") && !f.includes("fixed")));
const VT = V.map((f) => f.replace(".pdf", "-text-copy.txt"));
await submitEvidence(me, ws, M.C02, [...V, ...VT], "Week 3: seven hotel vouchers, all paid in full (sample data, fictional hotels). Text copies attached for the reviewer.", { shotName: "07-week3-provider-submit-hotel-vouchers" });
await pr.goto(`/contracts/${ws}/m/${M.C02}`);
const t = await pr.locator("main").innerText(); console.log(t.slice(t.indexOf("Checks"), t.indexOf("Your decision")));
await shot(pr, "07-week3-client-review-vouchers-ai-flags-jaipur");
// Priya requests a fix
await pr.locator("#ev-items").fill("Jaipur voucher (Sample Heritage Haveli) shows STANDARD ROOM, 18 m²; the contract requires the Heritage Deluxe Room of at least 25 m² for all 3 Jaipur nights.\nPlease reissue the Jaipur voucher in the contracted room category.");
await pr.getByRole("button", { name: "Request a fix" }).click();
await pr.waitForLoadState("networkidle"); await sleep(2000); await errs(pr);
await pr.reload(); await shot(pr, "07-week3-client-requested-fix");
await me.goto(`/contracts/${ws}/m/${M.C02}`); await shot(me, "07-week3-provider-sees-fix-request");
await b.close();
