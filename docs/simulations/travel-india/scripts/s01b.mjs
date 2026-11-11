import { launch, as, shot } from "./lib.mjs";
import fs from "node:fs";
const b = await launch();
const p = await as("Priya");
const items = [
  { code: "BRIEF", title: "Phrases from Priya's brief", criteria: ["Good hotels in every city", "A private comfortable car with driver", "Guides should be knowledgeable"] },
  { code: "M03", title: "Hotel vouchers paid in full", criteria: ["Each hotel is a 4-star or heritage property as named in the itinerary", "Room type and board basis match the itinerary"] },
  { code: "M04", title: "Private car and driver transfers booked", criteria: ["Vehicle is a private air-conditioned car for 2 adults with luggage", "Pick-up times allow at least 60 minutes after scheduled landing at airports"] },
];
const t0 = Date.now();
const r = await p.request.post("/api/ai/compile", { data: { items } });
const j = await r.json();
fs.writeFileSync("compile.json", JSON.stringify(j, null, 2));
console.log(JSON.stringify(j, null, 1).slice(0, 5000), Date.now() - t0, "ms");
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const src = Object.fromEntries(items.flatMap((it) => it.criteria.map((c, i) => [`${it.code}#${i + 1}`, c])));
const rows = j.data.map((d) => `<tr style="background:${d.verifiable ? "#eef8ee" : "#fdeeee"}"><td>${d.code}</td><td>${esc(src[d.code])}</td><td><b>${d.verifiable ? "checkable" : "VAGUE"}</b></td><td>${esc(d.reason)}</td><td>${esc(d.rewrite ?? "—")}</td></tr>`).join("");
await p.setContent(`<html><body style="font:14px system-ui;margin:24px"><h2>Criteria compiler (A2) — response of POST /api/ai/compile, signed in as Priya Shah</h2>
<p>Simulation on sandbox data. The compiler has no button in the negotiation room in this build, so it was called through its signed-in API with the draft's criteria and two phrases from Priya's brief. Model: <b>${esc(j.model)}</b> · AI available: <b>${j.available}</b>. Advice only: nothing is changed by this call.</p>
<table border=1 cellpadding=6 style="border-collapse:collapse;width:100%"><tr><th>Id</th><th>Criterion</th><th>Verdict</th><th>Reason</th><th>Measurable rewrite</th></tr>${rows}</table></body></html>`);
await shot(p, "01-draft-client-criteria-compiler");
await b.close();
