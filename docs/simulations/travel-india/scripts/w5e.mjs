import { launch, as, shot, shotEl, dump, sleep, errs } from "./lib.mjs";
import fs from "node:fs";
const ws = fs.readFileSync("ws.txt", "utf8");
const b = await launch();
const al = await as("Alex"), ol = await as("Olivia"), me = await as("Meera"), pr = await as("Priya");
await al.goto("/admin/audit");
await al.getByRole("button", { name: "Verify chain" }).click(); await al.waitForLoadState("networkidle"); await sleep(3000); await errs(al);
const a = await al.locator("main").innerText(); const k = a.indexOf("Integrity"); console.log("INTEGRITY:", a.slice(k, k + 500));
await al.getByLabel(/Target contains/).fill(ws).catch(() => {});
await al.getByRole("button", { name: "Apply" }).click().catch(() => {}); await al.waitForLoadState("networkidle"); await sleep(1500);
await shot(al, "14-admin-audit-chain-verified");
const a2 = await al.locator("main").innerText(); const m = a2.match(/(\d+)\s+rows/); console.log("audit rows for ws:", m?.[0]);
// ops
for (const [path, name] of [["/ops", "14-ops-home"], ["/ops/radar", "14-ops-radar"], ["/ops/providers", "14-ops-provider-health"]]) {
  await ol.goto(path); await shot(ol, name);
  const t = await ol.locator("main").innerText(); console.log(`== ${path}`, t.slice(0, 1200).replace(/\n/g, " | "));
  const i = t.indexOf("Meera"); if (i >= 0) console.log("  MEERA:", t.slice(i, i + 500).replace(/\n/g, " | "));
}
await me.goto("/provider"); await shot(me, "14-provider-home-trust-tier"); const tp = await me.locator("main").innerText(); console.log("PROVIDER HOME:", tp.slice(0, 1200).replace(/\n/g, " | "));
await me.goto("/provider/onboarding"); const to = await me.locator("main").innerText(); const ti = to.search(/tier/i); console.log("ONBOARD tier:", to.slice(Math.max(0, ti - 200), ti + 600).replace(/\n/g, " | "));
await pr.goto("/client"); await shot(pr, "14-client-home-final");
await b.close();
