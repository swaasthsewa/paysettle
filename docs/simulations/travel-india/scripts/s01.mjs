import { launch, as, dump, shot } from "./lib.mjs";
import fs from "node:fs";
const b = await launch();
const p = await as("Priya");
await p.goto("/client/new?blueprint=UC_TRAVEL_TOUR");
await p.locator("#n-title").fill("21-day India tour for 2 adults (booking project)");
await p.locator("#n-total").fill("9,600");
await p.locator("#n-prov").selectOption({ label: "Meera Iyer · standard" });
await p.locator("#n-brief").fill(`Book a 21-day private tour of India for 2 adults. Route: Delhi (3 nights) → Agra (2) → Jaipur (3) → Udaipur (3) → Varanasi (2) → Kochi and the Kerala backwaters (4, one night on a houseboat) → Goa (3) → departure from Goa. All booking work must be finished within 4 weeks of signing.
Hotels: good hotels, 4-star or heritage. Private comfortable car with driver for road legs. Domestic flights Jaipur–Udaipur? no: Udaipur–Varanasi, Varanasi–Kochi, Kochi–Goa in economy; train Delhi–Agra in AC chair car. Entry tickets for the main monuments and English-speaking guides in Delhi, Agra, Jaipur, Varanasi.
Payments by milestone: flights ticketed, hotel vouchers, transfers and excursions, travel pack. Itinerary and traveller details confirmed first. Travel insurance and e-visa checks included. Exclusions: international flights, meals not listed, tips.`);
await shot(p, "01-draft-client-brief", true);
await p.getByRole("button", { name: "Create the contract" }).click();
await p.waitForURL(/\/contracts\/ws_/, { timeout: 120000 });
fs.writeFileSync("ws.txt", new URL(p.url()).pathname.split("/")[2]);
await dump(p, "room");
await shot(p, "01-draft-client-ai-draft-room", true);
await b.close();
