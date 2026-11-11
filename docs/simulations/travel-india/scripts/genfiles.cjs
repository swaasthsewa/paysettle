const PDFDocument = require("/home/user/paysettle/node_modules/pdfkit/js/pdfkit.js");
const fs = require("fs");
const OUT = "/tmp/claude-0/sim/files";
function pdf(name, title, lines) {
  return new Promise((res) => {
    const d = new PDFDocument({ size: "A4", margin: 50, info: { Title: title, Author: "Sample data (simulation)", CreationDate: new Date() } });
    const s = fs.createWriteStream(`${OUT}/${name}`); d.pipe(s); fs.writeFileSync(`${OUT}/${name.replace(/\.pdf$/, "")}-text-copy.txt`, ["SAMPLE DATA — SIMULATION ONLY (plain-text copy of " + name + ")", title, ...lines].join("\n"));
    d.fillColor("#a00").fontSize(10).text("SAMPLE DATA — SIMULATION ONLY — fictional suppliers, not a real booking", { align: "center" });
    d.moveDown().fillColor("#000").fontSize(18).text(title).moveDown(0.5).fontSize(11);
    for (const l of lines) d.text(l).moveDown(0.25);
    d.moveDown().fillColor("#a00").fontSize(9).text("Generated for the PaySettle travel simulation on sandbox data. Names, numbers and references are invented.");
    d.end(); s.on("finish", res);
  });
}
const T = "Travellers: Ms Priya SHAH, Mr Rahul SHAH (sample names as in passports)";
(async () => {
  await pdf("M01-itinerary.pdf", "Day-by-day itinerary — 21-day India tour (sample)", [T,
    "Day 1–3 Delhi: Sample Capital Courtyard Hotel, New Delhi — Deluxe Double, breakfast. Guide: Sample Heritage Guides Collective (English).",
    "Day 4 Delhi→Agra: Sample Rail Express 12050, AC chair car, 06:00–07:40. Days 4–5 Agra: Sample Yamuna View Hotel — Premier Room.",
    "Day 6 Agra→Jaipur by private car (Sample Roadways, AC mid-size SUV). Days 6–8 Jaipur: Sample Heritage Haveli, Jaipur — Heritage Deluxe Room.",
    "Day 7 Jaipur cooking class 15:00 (Sample Spice Kitchen School). Day 9 Jaipur→Udaipur by road.",
    "Days 9–11 Udaipur: Sample Lakeside Palace Hotel — Deluxe Lake-facing. Day 11 day trip Kumbhalgarh + Ranakpur.",
    "Day 12 Udaipur→Varanasi: Sample Skyways SX 412 (via hub), economy. Days 12–13 Varanasi: Sample Ghat Heritage House — Heritage Room.",
    "Day 14 Varanasi→Kochi: Sample Skyways SX 518, economy. Days 14–17 Kochi: Sample Fort Kochi Bungalow (3 nights) + Sample Backwater Houseboat Co. (1 night).",
    "Day 18 Kochi→Goa: Sample Skyways SX 233, economy. Days 18–20 Goa: Sample Palm Beach Resort — Garden Villa Room.",
    "Day 21 departure from Goa: private transfer to the airport 3 h before the international flight (international flights excluded).",
    "Exclusions: international flights, visa fees, meals not listed, tips, personal expenses."]);
  for (const [i, f] of [["SX 412", "UDR→VNS", "Day 12"], ["SX 518", "VNS→COK", "Day 14"], ["SX 233", "COK→GOI", "Day 18"]].entries())
    await pdf(`M02-eticket-${i + 1}.pdf`, `E-ticket receipt — Sample Skyways ${f[0]} (sample)`, [T, `Route ${f[1]} · ${f[2]} of the trip · Class: Economy (Y)`, `Ticket numbers: 999-71234567${i}0 and 999-71234567${i}1 (13 digits)`, `Booking reference (PNR): SMP${i}Q7`, "Ticket status: ISSUED (not on hold)", "Baggage: 15 kg checked per traveller"]);
  await pdf("M02-train-tickets.pdf", "Train tickets — Sample Rail Express 12050 (sample)", [T, "Delhi → Agra · Day 4 of the trip · 06:00 departure", "Class: AC chair car (CC) · Coach C3, seats 41 and 42", "Status: CONFIRMED"]);
  const hotels = [["Delhi", "Sample Capital Courtyard Hotel, New Delhi", "Deluxe Double, 28 m²", 3, "4.4/5"], ["Agra", "Sample Yamuna View Hotel, Agra", "Premier Room, 30 m²", 2, "4.3/5"], ["Jaipur", "Sample Heritage Haveli, Jaipur", "STANDARD ROOM, 18 m² (downgraded from Heritage Deluxe Room)", 3, "4.5/5"], ["Udaipur", "Sample Lakeside Palace Hotel, Udaipur", "Deluxe Lake-facing, 32 m²", 3, "4.6/5"], ["Varanasi", "Sample Ghat Heritage House, Varanasi", "Heritage Room, 26 m²", 2, "4.3/5"], ["Kochi", "Sample Fort Kochi Bungalow + Sample Backwater Houseboat Co.", "Colonial Double 27 m² (3 nights) + Houseboat Deluxe cabin (1 night)", 4, "4.4/5"], ["Goa", "Sample Palm Beach Resort, Goa", "Garden Villa Room, 35 m²", 3, "4.3/5"]];
  for (const [i, h] of hotels.entries()) await pdf(`C02-voucher-${i + 1}-${h[0].toLowerCase()}.pdf`, `Hotel voucher — ${h[1]} (sample)`, [T, `Room category: ${h[2]}`, `Nights: ${h[3]} · Board: breakfast included · Guest rating at booking: ${h[4]}`, `Supplier confirmation no.: SMPH-${4100 + i}`, "Balance due: 0.00 (paid in full by the agency)", "Cancellation terms: free cancellation until 14 days before arrival; 1 night charged after that."]);
  // fixed Jaipur voucher (used later only if needed)
  await pdf("C02-voucher-3-jaipur-fixed.pdf", "Hotel voucher — Sample Heritage Haveli, Jaipur (sample, reissued)", [T, "Room category: STANDARD ROOM, 18 m² — hotel states Heritage Deluxe Room sold out for nights 1–2; Heritage Deluxe Room for night 3 only", "Nights: 3 · Board: breakfast included · Guest rating at booking: 4.5/5", "Supplier confirmation no.: SMPH-4102-R1", "Balance due: 0.00", "Cancellation terms: free cancellation until 14 days before arrival."]);
  await pdf("C01-car-transfers.pdf", "Private car and transfers — Sample Roadways Pvt Ltd (sample)", [T, "Vehicle: air-conditioned mid-size SUV class, seats 2 adults + 2 large suitcases", "Driver: Mr Sample Driver, phone +91 00000 00000 (sample), on duty up to 10 h/day", "Road legs: Agra→Jaipur (day 6), Jaipur→Udaipur (day 9); city use Delhi, Jaipur, Udaipur", "Transfers: every airport and railway station on the itinerary incl. Goa departure (day 21, 3 h before departure)", "Pick-ups set 75 minutes after scheduled landing", "Confirmation no.: SRW-88213"]);
  await pdf("C03-cooking-class.pdf", "Cooking class confirmation — Sample Spice Kitchen School, Jaipur (sample)", [T, "3-hour vegetarian cooking class for 2 adults · day 7 of the trip · 15:00", "Meeting address: 12 Sample Lane, Jaipur (sample)", "Confirmation: SSK-301"]);
  await pdf("C05-udaipur-upgrade.pdf", "Upgrade voucher — Sample Lakeside Palace Hotel, Udaipur (sample)", [T, "Room category upgraded to: Lake-view Suite, 48 m², private balcony", "Nights: 3 · Board: breakfast included", "Supplier confirmation no.: SMPH-4103-UP", "Balance due: 0.00 · Upgrade paid in full"]);
  await pdf("M04-insurance.pdf", "Travel insurance certificate — Sample Travel Assurance Co. (sample)", [T, "Cover: day 1 to day 21 of the trip plus 2 days", "Medical, cancellation and baggage cover · Policy SMP-TI-55120"]);
  await pdf("M04-evisa.pdf", "E-visa approval confirmations (sample)", [T, "E-visa status: GRANTED for both travellers (sample reference EV-SMP-1 and EV-SMP-2)", "Passports valid until 2032 (more than 6 months after return)"]);
  await pdf("M06-monument-tickets.pdf", "Monument entry tickets (sample)", [T, "Delhi: two monuments; Agra: the main mausoleum and the fort; Jaipur: the hill fort and the city palace; Varanasi: evening river ceremony seats", "All tickets dated as in the itinerary · sample references MT-1 to MT-7"]);
  for (const c of ["Delhi", "Agra", "Jaipur", "Varanasi"]) await pdf(`M06-guide-${c.toLowerCase()}.pdf`, `Guide confirmation — ${c} (sample)`, [T, `Guide language: English · Sample Heritage Guides Collective, licensed guide no. SG-${c.slice(0, 3).toUpperCase()}-01`, `Date and start time as in the itinerary · meeting point: hotel lobby, 09:00`]);
  await pdf("M08-travel-pack.pdf", "Travel pack (sample)", [T, "Contents: itinerary, 3 e-tickets, train tickets, 7 hotel vouchers + upgrade voucher, car and transfer confirmation, cooking class, monument tickets, 4 guide confirmations, insurance, e-visas", "24-hour contact: +91 00000 11111 (sample)", "Supplier list with names, phones and addresses for every service"]);
  await pdf("M09-final-statement.pdf", "Final statement — no supplier balances outstanding (sample)", [T, "Every supplier on the itinerary shown as paid in full (sample)", "Jaipur room category: under mediation; see dispute record"]);
  console.log(fs.readdirSync(OUT).join("\n"));
})();
