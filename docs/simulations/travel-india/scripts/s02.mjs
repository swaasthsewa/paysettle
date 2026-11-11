import { launch, as, shot, shotEl, rev, waitRevAbove, msRow, errs, dump, sleep } from "./lib.mjs";
import fs from "node:fs";
const ws = fs.readFileSync("ws.txt", "utf8");
const b = await launch();
const pr = await as("Priya"), me = await as("Meera");
const open = async (p) => { await p.goto(`/contracts/${ws}`); await p.waitForLoadState("networkidle"); };
const policy = (p) => p.locator("section[aria-labelledby=vio-h]");
async function append(p, m) {
  const r = await rev(p);
  await p.locator("summary", { hasText: "Append a milestone" }).click();
  await p.locator("#am-title").fill(m.title);
  await p.locator("#am-type").selectOption(m.type ?? "PAY");
  await p.locator("#am-day").fill(String(m.day));
  if ((m.type ?? "PAY") === "PAY") await p.locator("#am-share").fill(m.share);
  if (m.after) await p.locator("#am-after").selectOption(m.after);
  await p.locator("#am-art").selectOption(m.art ?? "PDF");
  await p.locator("#am-min").fill(String(m.min ?? 1));
  await p.locator("#am-note").fill(m.note);
  await p.locator("#am-crit").fill(m.criteria.join("\n"));
  await p.locator("#am-lock").fill(m.lock ?? "Traveller approves.");
  await p.locator("#am-disp").fill(m.dispute);
  if (m.shotBefore) await shotEl(p.locator("details.ms", { hasText: "Append a milestone" }), m.shotBefore);
  await p.getByRole("button", { name: "Append milestone" }).click();
  await waitRevAbove(p, r); await errs(p);
}
async function prune(p, code) { const r = await rev(p); await p.getByRole("button", { name: new RegExp(`^Prune ${code} `) }).click(); await waitRevAbove(p, r); await errs(p); }
async function share(p, code, v) { const r = await rev(p); const row = msRow(p, code); await row.getByLabel("Share %").fill(v); await row.getByRole("button", { name: "Save" }).click(); await waitRevAbove(p, r); await errs(p); }
async function setDay(p, code, d) { const r = await rev(p); const row = msRow(p, code); await row.getByLabel("Day").fill(String(d)); await row.getByRole("button", { name: "Save" }).click(); await waitRevAbove(p, r); await errs(p); }
async function clause(p, title, body, link) { const r = await rev(p); const s = p.locator("summary", { hasText: "Add a custom clause" }); if (await s.count()) await s.click(); await p.locator("#ac-title").fill(title); if (link) await p.locator("#ac-link").selectOption(link); await p.locator("#ac-body").fill(body); await p.getByRole("button", { name: "Add clause" }).click(); await waitRevAbove(p, r); await errs(p); }
const log = [];
const note = async (p, what) => { const r = await rev(p); const g = (await policy(p).innerText()).split("\n").slice(0, 3).join(" / "); const a = await p.locator(".alloc-sum").innerText().catch(() => "?"); log.push({ who: what, rev: r, gate: g, alloc: a }); console.log("STATE", what, r, a, g); };

await open(pr); await note(pr, "start");
// 1) Priya replaces M05 with a measurable version (accepting the compiler rewrites)
await prune(pr, "M04"); await note(pr, "Priya prunes M04 (car criteria without hours or vehicle class)");
await shotEl(pr.locator("section", { has: pr.locator(".alloc") }).first(), "02-negotiation-client-prune-m05-gate-red");
await shotEl(policy(pr), "02-negotiation-client-policy-gate-red");
await append(pr, { title: "Private car with driver and all transfers booked", day: 10, share: "12", after: "M03", note: "Supplier confirmation for the private car with driver (sample supplier: Sample Roadways Pvt Ltd) and every transfer",
  criteria: ["Every road leg in the itinerary has a confirmed private car with driver, including Agra–Jaipur and Jaipur–Udaipur by road",
    "The booking confirms an air-conditioned sedan or larger (mid-size SUV class) seating 2 adults plus 2 large suitcases",
    "The driver is on duty up to 10 hours per day; the driver's name and phone number are provided at least 48 hours before each leg",
    "Pick-up times allow at least 60 minutes after scheduled landing",
    "Transfers to and from every airport and railway station on the itinerary, including the Goa departure airport, are included"],
  dispute: "A missing transfer is deducted at its itinerary price until it is booked.", shotBefore: "02-negotiation-client-append-measurable-car" });
await note(pr, "Priya appends measurable car milestone");
// 2) Priya replaces M03 with measurable hotel criteria
await prune(pr, "M03"); await note(pr, "Priya prunes M03 (hotel criteria without rating or room size)");
await append(pr, { title: "Hotel vouchers paid in full (named hotels and room categories)", day: 7, share: "30", after: "M02", min: 7, note: "One voucher per stay showing zero balance due, the room category and the guest rating",
  criteria: ["Vouchers cover all 20 nights: Delhi 3, Agra 2, Jaipur 3, Udaipur 3, Varanasi 2, Kochi and backwaters 4 (one houseboat night), Goa 3",
    "Each hotel is 4-star or a listed heritage property with a guest rating of at least 4.2 out of 5 on a named review platform at booking",
    "Room category per city as in the itinerary; Jaipur: Heritage Deluxe Room at Sample Heritage Haveli, Jaipur",
    "Every room is a double or twin of at least 25 m² for 2 adults with breakfast included",
    "Each voucher shows zero balance due and states the hotel's cancellation terms"],
  dispute: "A voucher with a lower room category is rebooked at the agency's cost before release; otherwise the nightly difference is refunded.", shotBefore: null });
await note(pr, "Priya appends measurable hotel milestone");
await shotEl(policy(pr), "02-negotiation-client-policy-gate-green");
// 3) Priya appends a cooking class and a day trip (shares now exceed 100%)
await append(pr, { title: "Jaipur cooking class booked", day: 14, share: "3", note: "Booking confirmation from the cooking school (sample supplier)",
  criteria: ["A 3-hour vegetarian cooking class in Jaipur for 2 adults is confirmed on day 7 of the trip", "The confirmation names the school, start time and meeting address"], dispute: "If the class cannot be booked, its amount is returned to the traveller." });
await append(pr, { title: "Udaipur day trip to Kumbhalgarh and Ranakpur booked", day: 14, share: "4", note: "Day-trip confirmation with car, guide and entry tickets",
  criteria: ["A full-day private trip from Udaipur to Kumbhalgarh Fort and Ranakpur temple is confirmed for day 11 of the trip", "Car with driver, English-speaking guide and both entry tickets are included"], dispute: "If the trip is dropped before it is booked, its amount is returned to the traveller." });
await note(pr, "Priya appends cooking class + day trip");
await shotEl(pr.locator("section", { has: pr.locator(".alloc") }).first(), "02-negotiation-client-appends-over-100-red");
await shotEl(policy(pr), "02-negotiation-client-policy-gate-red-over-100");
// 4) Priya adds clauses: cancellation/refunds, response time
await clause(pr, "Cancellation and refunds", "If the traveller cancels before a milestone is approved, that milestone's held amount is returned less any non-refundable supplier cost shown on a voucher. Approved milestones are not refunded by PaySettle; supplier refunds follow each supplier's written terms.");
await clause(pr, "Response time", "The agency answers traveller messages within 24 hours on working days. The traveller reviews submitted evidence within 48 hours, as the platform's review clause sets out.");
await note(pr, "Priya adds 2 clauses");
// Priya adds a late-delivery deduction for the flights milestone only
{ const r0 = await rev(pr);
  const f = pr.locator("form", { has: pr.getByRole("button", { name: "Save deadline terms" }) });
  await f.locator("input[name=lateOn]").check();
  await f.locator("input[name=lateRate]").fill("1");
  await f.locator("input[name=lateGrace]").fill("1");
  await f.locator("input[name=lateCap]").fill("10");
  await f.locator("input[name=lateScope][value=SOME]").check();
  await f.locator("input[name=lateCodes][value=M02]").check();
  await sleep(500);
  await shotEl(pr.locator("section", { has: pr.getByRole("button", { name: "Save deadline terms" }) }).last(), "02-negotiation-client-deadline-terms");
  await f.getByRole("button", { name: "Save deadline terms" }).click(); await waitRevAbove(pr, r0); await errs(pr); }
await note(pr, "Priya sets late deduction on M02 (1%/day after 1 grace day, cap 10%)");
// Meera's turn
await open(me); await note(me, "Meera opens");
await shot(me, "02-negotiation-provider-room-before-edits");
await setDay(me, "M07", 21); await note(me, "Meera moves the travel pack M07 to day 21");
await share(me, "M08", "6"); await note(me, "Meera M08 close-out 13%→6%");
await clause(me, "Inclusions and exclusions", "Included: 20 hotel nights with breakfast, private car with driver for road legs and transfers, 3 domestic economy flights, the Delhi–Agra AC chair-car train, entry tickets for listed monuments, English-speaking guides in Delhi, Agra, Jaipur and Varanasi, travel insurance for 21 days. Excluded: international flights, visa fees, meals not listed, tips and personal expenses.");
await note(me, "Meera adds inclusions clause");
await shotEl(policy(me), "02-negotiation-provider-policy-gate-green");
await shotEl(me.locator("section", { has: me.locator(".alloc") }).first(), "02-negotiation-provider-milestones-100");
fs.writeFileSync("negotiation-log.json", JSON.stringify(log, null, 2));
await dump(me, "after meera");
await b.close();
