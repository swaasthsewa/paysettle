import { launch, as, shot, shotEl, rev, waitRevAbove, msRow, errs, sleep } from "./lib.mjs";
import fs from "node:fs";
const ws = fs.readFileSync("ws.txt", "utf8");
const b = await launch();
const pr = await as("Priya"), me = await as("Meera");
const open = async (p) => { await p.goto(`/contracts/${ws}`); await p.waitForLoadState("networkidle"); };
const sigs = (p) => p.locator("section", { has: p.getByRole("heading", { name: "Signatures" }) }).first();
async function signNow(p) { const btn = p.getByRole("button", { name: /^Sign revision \d+$/ }); await btn.click(); await p.waitForURL(/ok=signed|err=/); await errs(p); }
await open(pr);
await signNow(pr);
await shotEl(sigs(pr), "02-negotiation-client-signed");
// Meera moves the close-out day: the change voids Priya's signature
await open(me);
await shotEl(sigs(me), "02-negotiation-provider-sees-client-signature");
const r = await rev(me); const row = msRow(me, "M08"); await row.getByLabel("Day").fill("25"); await row.getByRole("button", { name: "Save" }).click(); await waitRevAbove(me, r); await errs(me);
await open(pr);
await shotEl(sigs(pr), "02-negotiation-client-signature-voided");
console.log((await sigs(pr).innerText()).slice(0, 800));
await signNow(pr);
await open(me); await signNow(me);
await open(me);
console.log((await me.locator("main").innerText()).slice(0, 1500));
await shot(me, "02-negotiation-provider-both-signed-locked");
await open(pr);
await shot(pr, "02-negotiation-client-both-signed-locked");
await b.close();
