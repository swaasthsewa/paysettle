import { launch, as, shot, shotEl, dump, sleep, errs, travel } from "./lib.mjs";
import fs from "node:fs";
const D = fs.readFileSync("dispute.txt", "utf8");
const b = await launch();
const me = await as("Meera"), pr = await as("Priya"), al = await as("Alex");
async function vault(p, note, file, name) {
  await p.goto(D);
  const f = p.locator("form", { has: p.getByRole("button", { name: "Add to the vault" }) });
  await f.locator("textarea").first().fill(note);
  if (file) await f.locator("input[type=file]").setInputFiles(`/tmp/claude-0/sim/files/${file}`);
  if (name) await shot(p, name);
  await f.getByRole("button", { name: "Add to the vault" }).click(); await p.waitForLoadState("networkidle"); await sleep(1500); await errs(p);
}
await vault(pr, "The signed contract names the Heritage Deluxe Room (at least 25 m²) for all 3 Jaipur nights. Nights 1–2 are a Standard Room of 18 m². I ask for 40% of C02 to come back to me.", "C02-client-vault-note.txt", "09-tier2-client-adds-to-vault");
await vault(me, "The hotel had a wedding block on those dates (letter attached, sample). Six of seven stays are exactly as contracted and all 20 nights are paid. The nightly difference is about $95 per night (sample rate card), so $190 for two nights; a larger refund is not proportionate.", "C02-hotel-soldout-letter.txt", "09-tier2-provider-adds-to-vault");
for (const p of [pr, me]) { await p.goto(D); const btn = p.getByRole("button", { name: /lock my side/ }); if (await btn.count()) { await btn.click(); await p.waitForLoadState("networkidle"); await sleep(1500); await errs(p); } }
await pr.goto(D); await shot(pr, "09-tier2-client-vault-locked");
await me.goto(D); await shot(me, "09-tier2-provider-vault-locked");
const t = await pr.locator("main").innerText(); console.log(t.slice(0, 1500));
await b.close();
