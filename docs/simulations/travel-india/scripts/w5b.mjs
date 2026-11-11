import { launch, as, shot, shotEl, dump, sleep, errs } from "./lib.mjs";
import fs from "node:fs";
const ws = fs.readFileSync("ws.txt", "utf8");
const b = await launch();
const fa = await as("Farah"), al = await as("Alex"), ol = await as("Olivia");
await fa.goto("/finance/recon");
const sec = fa.locator("section", { has: fa.getByRole("heading", { name: "All tranches in this run" }) }).first();
await sec.getByPlaceholder("Search rows").fill("21-day"); await sleep(1500);
await shotEl(sec, "13-finance-recon-this-contract-matched");
// ledger filtered
await fa.goto("/finance/ledger");
const lsel = fa.locator("main select").first();
await lsel.selectOption({ label: "21-day India tour for 2 adults (booking project)" }).catch((e) => console.log("sel fail", e.message));
await fa.waitForLoadState("networkidle"); await sleep(2000);
await shot(fa, "13-finance-ledger-this-contract");
console.log((await fa.locator("main").innerText()).slice(0, 2500));
await fa.goto("/finance/fees"); await shot(fa, "13-finance-fees"); console.log("FEES:", (await fa.locator("main").innerText()).slice(0, 1500));
await fa.goto("/finance"); await shot(fa, "13-finance-home");
// admin audit chain
await al.goto("/admin/audit"); await dump(al, "audit");
await b.close();
