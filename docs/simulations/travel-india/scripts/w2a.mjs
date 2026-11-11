import { launch, as, shot, shotEl, dump, msIds, sleep, errs, travel, submitEvidence, approve } from "./lib.mjs";
import fs from "node:fs";
const ws = fs.readFileSync("ws.txt", "utf8"); const M = msIds();
const b = await launch();
const me = await as("Meera"), pr = await as("Priya"), al = await as("Alex"), fa = await as("Farah");
await travel(al, 120); // day 8
await submitEvidence(me, ws, M.M02, ["M02-eticket-1.pdf", "M02-eticket-2.pdf", "M02-eticket-3.pdf", "M02-train-tickets.pdf", "M02-eticket-1-text-copy.txt", "M02-eticket-2-text-copy.txt", "M02-eticket-3-text-copy.txt", "M02-train-tickets-text-copy.txt"],
  "Week 2: all three domestic flights ticketed together after the fare release, plus the Delhi–Agra AC chair-car train. Sample booking-reference lookups (sample data, not real sites): https://pnr.example.com/SMP0Q7 https://pnr.example.com/SMP1Q7 https://pnr.example.com/SMP2Q7",
  { shotName: "05-week2-provider-submit-flights" });
await me.goto(`/contracts/${ws}/m/${M.M02}`); await shot(me, "05-week2-provider-flights-in-review");
await pr.goto(`/client`); await shot(pr, "05-week2-client-home-review-due");
await pr.goto(`/contracts/${ws}/m/${M.M02}`);
const t = await pr.locator("main").innerText(); console.log(t.slice(t.indexOf("Checks"), t.indexOf("Your decision")));
await approve(pr, ws, M.M02, "M02", "05-week2-client-review-flights-checks-ai", "05-week2-client-approve-flights-released");
await me.goto(`/contracts/${ws}/m/${M.M02}`); await shot(me, "05-week2-provider-flights-released");
await me.goto(`/provider/payouts`); await shot(me, "05-week2-provider-payout");
console.log((await me.locator("main").innerText()).slice(0, 1500));
await fa.goto(`/finance/ledger`); await shot(fa, "05-week2-finance-ledger");
console.log((await fa.locator("main").innerText()).slice(0, 1200));
await b.close();
