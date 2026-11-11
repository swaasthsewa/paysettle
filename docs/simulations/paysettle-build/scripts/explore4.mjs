import { launch, as, close, dumpForms, settle } from "./lib.mjs";
await launch();
for (const [who, url] of [["fin", "/finance/recon"], ["admin", "/admin/audit"], ["ops", "/ops/clearance"], ["med", "/mediator"]]) {
  const p = await as(who); await p.goto(url); await settle(p);
  console.log("=====", who, url); console.log((await p.locator("main").innerText()).slice(0, 1800)); console.log(await dumpForms(p));
}
await close(); process.exit(0);
