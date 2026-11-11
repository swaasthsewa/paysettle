// Requirements: F2.01 (20+ verticals at outline depth), F2.04 (3–50 milestones), F2.06 (bps sum 10,000),
// F2.07 (one tranche ≤ 26 days), F2.08 (concrete proof per payment milestone), F2.09 (lock + dispute rule per milestone).
// Outline depth: 5–8 milestones, valid as-is; parties add detail in the negotiation room.
import type { BlueprintDef } from "./digital";

const P = (kind: "IMAGE" | "VIDEO" | "PDF" | "LOG" | "LINK" | "SIGNATURE" | "ORACLE", min: number, note?: string) => ({ kind, min, note });

export const EVENT_PRODUCTION: BlueprintDef = {
  code: "UC_EVENT_PRODUCTION", title: "Event production", vertical: "Events", kind: "HYBRID", depth: "outline", recommendedDays: 24,
  summary: "A conference, launch or private event: venue and suppliers, production design, rehearsal, the event itself and load-out.",
  milestones: [
    { code: "M01", title: "Brief, venue shortlist and run-of-show", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("PDF", 1, "Brief with budget, headcount and date"), P("PDF", 1, "Draft run-of-show")], criteria: ["Headcount, date and budget are fixed in writing"] }, lockRule: "Both parties sign the brief.", disputeRule: "Changes after signing are priced as change requests." },
    { code: "M02", title: "Venue and key suppliers contracted", type: "PAY", day: 5, bps: 2000, dependsOn: ["M01"], proof: { artifacts: [P("PDF", 1, "Signed venue contract"), P("PDF", 2, "Supplier contracts (AV, catering)")], criteria: ["Venue capacity at least the agreed headcount", "Deposits paid as shown on supplier receipts"] }, lockRule: "Client approves.", disputeRule: "Release is pro-rata to the supplier contracts signed." },
    { code: "M03", title: "Production design approved", type: "PAY", day: 12, bps: 1500, dependsOn: ["M02"], proof: { artifacts: [P("PDF", 1, "Stage plot, floor plan and AV specification"), P("IMAGE", 3, "Renders of the room set-up")], criteria: ["Floor plan meets the venue's fire-exit layout", "AV spec lists every cue in the run-of-show"] }, lockRule: "Client signs the design.", disputeRule: "Two revision rounds included; more are change requests." },
    { code: "M04", title: "Load-in and technical rehearsal", type: "PAY", day: 20, bps: 2000, dependsOn: ["M03"], proof: { artifacts: [P("IMAGE", 6, "Set-up on site"), P("VIDEO", 1, "Rehearsal running the cue sheet"), P("PDF", 1, "Rigging safety certificate")], gpsRadiusM: 300, criteria: ["Every cue on the cue sheet runs in rehearsal", "Rigging certificate signed by a qualified rigger"] }, lockRule: "Client approves after rehearsal.", disputeRule: "Failed cues are listed and fixed before doors open." },
    { code: "M05", title: "Event delivered", type: "PAY", day: 22, bps: 3000, dependsOn: ["M04"], proof: { artifacts: [P("LOG", 1, "Attendee check-in scan log"), P("VIDEO", 2, "Opening and closing sessions"), P("PDF", 1, "Show-caller's incident log")], gpsRadiusM: 300, criteria: ["Programme runs within 15 minutes of the run-of-show", "No AV outage longer than 2 minutes"] }, lockRule: "Client approves, or a mediator verdict.", disputeRule: "Logged outages are deducted at the AV line value pro-rata by minutes lost." },
    { code: "M06", title: "Load-out and venue release", type: "PAY", day: 24, bps: 1500, dependsOn: ["M05"], proof: { artifacts: [P("PDF", 1, "Venue release signed with no damage noted"), P("IMAGE", 4, "Empty room after load-out")], gpsRadiusM: 300, criteria: ["Venue signs the release", "All supplier invoices reconciled to the budget"] }, lockRule: "Client approves.", disputeRule: "Venue damage charges caused by the provider are deducted." },
  ],
  clauses: [
    { code: "TPL_CANCEL", category: "BASELINE", title: "Cancellation", body: "If the client cancels, released milestones stay released and unreleased ones are returned, less supplier deposits shown on receipts.", protective: true },
    { code: "TPL_HEADCOUNT", category: "BASELINE", title: "Final headcount", body: "The client confirms the final headcount 7 days before the event; catering is charged on that number.", protective: false },
  ],
};

export const VIDEO_POST: BlueprintDef = {
  code: "UC_VIDEO_POST", title: "Video post-production", vertical: "Media production", kind: "DIGITAL", depth: "outline", recommendedDays: 21,
  summary: "Edit, grade, mix and deliver a finished film from supplied footage, with measured loudness and delivery specs.",
  milestones: [
    { code: "M01", title: "Footage ingest verified", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("LOG", 1, "Checksum manifest for every card")], criteria: ["Every file matches its source checksum"] }, lockRule: "Both confirm the manifest.", disputeRule: "Missing footage is the client's to resupply; dates move day for day." },
    { code: "M02", title: "Rough cut", type: "PAY", day: 6, bps: 2500, dependsOn: ["M01"], proof: { artifacts: [P("LINK", 1, "Review link with timecode comments")], criteria: ["Runtime within ±10% of the target", "Every scene in the script or outline is present"] }, lockRule: "Client approves.", disputeRule: "One round of notes included; provider applies them within 72 hours." },
    { code: "M03", title: "Picture lock", type: "PAY", day: 11, bps: 2500, dependsOn: ["M02"], proof: { artifacts: [P("LINK", 1, "Locked cut review link"), P("LOG", 1, "Edit decision list")], criteria: ["All rough-cut notes addressed or answered"] }, lockRule: "Client signs picture lock; later edits are change requests.", disputeRule: "Unaddressed notes are listed and fixed within 72 hours." },
    { code: "M04", title: "Colour grade", type: "PAY", day: 15, bps: 2000, dependsOn: ["M03"], proof: { artifacts: [P("LINK", 1, "Graded review link"), P("IMAGE", 4, "Scope captures on key shots")], criteria: ["Levels within the delivery spec's legal range", "Shots in each scene match in exposure and white balance"] }, lockRule: "Client approves.", disputeRule: "Disputed shots are regraded once; a mediator compares against the scopes." },
    { code: "M05", title: "Sound mix", type: "PAY", day: 18, bps: 1500, dependsOn: ["M03"], proof: { artifacts: [P("LOG", 1, "Loudness measurement report"), P("LINK", 1, "Mixed review link")], criteria: ["Integrated loudness within ±1 LU of the delivery target (for example −14 LUFS web, −23 LUFS broadcast)", "True peak at or below −1 dBTP"] }, lockRule: "Client approves the report.", disputeRule: "Out-of-spec mixes are corrected before release." },
    { code: "M06", title: "Masters delivered", type: "PAY", day: 21, bps: 1500, dependsOn: ["M04", "M05"], proof: { artifacts: [P("LINK", 1, "Master files in every format in the spec"), P("PDF", 1, "Technical QC report"), P("LOG", 1, "Caption file")], criteria: ["Each format in the delivery spec is supplied", "Captions within 100 ms of dialogue"] }, lockRule: "Client approves.", disputeRule: "Each failing deliverable is redelivered within 48 hours." },
  ],
  clauses: [
    { code: "TPL_RIGHTS", category: "BASELINE", title: "Rights to the edit", body: "On final release the client owns the edit and masters. The client confirms it holds rights to supplied footage and music.", protective: true },
    { code: "TPL_ARCHIVE", category: "BASELINE", title: "Project archive", body: "The provider keeps the project files for 90 days after delivery.", protective: false },
  ],
};

export const APP_LOCALISATION: BlueprintDef = {
  code: "UC_APP_LOCALISATION", title: "App localisation", vertical: "Software", kind: "DIGITAL", depth: "outline", recommendedDays: 20,
  summary: "Translate and test an app's interface and store listing in new languages, checked in context on real screens.",
  milestones: [
    { code: "M01", title: "String freeze", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("LINK", 1, "Exported source string files"), P("LOG", 1, "Key count per file")], criteria: ["String count is fixed; later strings are a change request"] }, lockRule: "Both confirm the export.", disputeRule: "New strings are priced per word at the agreed rate." },
    { code: "M02", title: "Glossary and style guide", type: "PAY", day: 4, bps: 1000, dependsOn: ["M01"], proof: { artifacts: [P("PDF", 1, "Glossary and style guide per language")], criteria: ["Every product term has an approved translation"] }, lockRule: "Client's reviewer approves.", disputeRule: "Disputed terms are decided by the client's reviewer." },
    { code: "M03", title: "Translation complete", type: "PAY", day: 10, bps: 3500, dependsOn: ["M02"], proof: { artifacts: [P("LINK", 1, "Translated resource files"), P("LOG", 1, "Completeness and placeholder check")], criteria: ["100% of keys translated in every language", "No broken placeholders or format specifiers"] }, lockRule: "Client approves after the automated check.", disputeRule: "Release is pro-rata by language passing the check." },
    { code: "M04", title: "Linguistic review", type: "PAY", day: 14, bps: 2000, dependsOn: ["M03"], proof: { artifacts: [P("PDF", 1, "Reviewer quality report per language")], criteria: ["No critical errors", "Quality score at least 98 on the agreed scoring model"] }, lockRule: "Client approves.", disputeRule: "Failing languages are retranslated at the provider's cost." },
    { code: "M05", title: "In-context QA", type: "PAY", day: 17, bps: 2000, dependsOn: ["M04"], proof: { artifacts: [P("IMAGE", 6, "Screens per language"), P("PDF", 1, "Bug list with fixes")], criteria: ["No truncated or overlapping text", "Right-to-left layouts mirrored where used"] }, lockRule: "Client approves.", disputeRule: "Open bugs are fixed within 72 hours." },
    { code: "M06", title: "Localised build released", type: "PAY", day: 20, bps: 1500, dependsOn: ["M05"], proof: { artifacts: [P("LOG", 1, "CI run on the localised build"), P("LINK", 1, "Store listing per language")], oracle: "GITHUB_CI", criteria: ["CI green on the localised build", "Store listing live in every language"] }, lockRule: "Client approves after the CI oracle reports green.", disputeRule: "Store rejections for translation errors are fixed by the provider." },
  ],
  clauses: [
    { code: "TPL_TM", category: "BASELINE", title: "Translation memory", body: "The client owns the translation memory and glossary built during the project.", protective: true },
    { code: "TPL_SOURCE_CHANGES", category: "BASELINE", title: "Source changes", body: "Strings changed after the freeze are priced per word at the agreed rate.", protective: false },
  ],
};

export const DATA_MIGRATION: BlueprintDef = {
  code: "UC_DATA_MIGRATION", title: "Data migration", vertical: "Software and data", kind: "DIGITAL", depth: "outline", recommendedDays: 24,
  summary: "Move data from a legacy system to a new one with two trial loads, reconciled counts and control totals, and a planned cutover.",
  milestones: [
    { code: "M01", title: "Source access and data inventory", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("PDF", 1, "Inventory of objects with record counts")], criteria: ["Every object in scope has a source record count"] }, lockRule: "Both sign the inventory.", disputeRule: "Client access delays extend dates day for day." },
    { code: "M02", title: "Mapping specification", type: "PAY", day: 4, bps: 1500, dependsOn: ["M01"], proof: { artifacts: [P("PDF", 1, "Field-level mapping with transformation rules"), P("SIGNATURE", 1, "Client data owner approval")], criteria: ["Every target field is mapped or marked not migrated"] }, lockRule: "Client data owner signs.", disputeRule: "Mapping changes after signing are change requests." },
    { code: "M03", title: "Trial load 1", type: "PAY", day: 9, bps: 2000, dependsOn: ["M02"], proof: { artifacts: [P("LOG", 1, "Load log"), P("PDF", 1, "Reconciliation report")], criteria: ["Loaded plus rejected records equal the source count", "Rejected records under 0.5%, each with a reason"] }, lockRule: "Client approves.", disputeRule: "Above the reject limit, the load is repeated before release." },
    { code: "M04", title: "Trial load 2 and validation", type: "PAY", day: 14, bps: 2000, dependsOn: ["M03"], proof: { artifacts: [P("PDF", 1, "Reconciliation with control totals"), P("PDF", 1, "Field check of a 200-record sample")], criteria: ["Financial control totals match to the cent", "Sample check shows no field errors"] }, lockRule: "Client approves.", disputeRule: "Mismatches are traced and fixed; release waits for a clean run." },
    { code: "M05", title: "Go / no-go", type: "GATE", day: 17, bps: 0, dependsOn: ["M04"], proof: { artifacts: [P("PDF", 1, "Cutover checklist with backup confirmation"), P("SIGNATURE", 1, "Client go decision")], criteria: ["Full backup of the source taken and restore-tested"] }, lockRule: "Client signs go.", disputeRule: "A no-go moves cutover to the next agreed window." },
    { code: "M06", title: "Production cutover", type: "PAY", day: 19, bps: 3000, dependsOn: ["M05"], proof: { artifacts: [P("LOG", 1, "Production load log"), P("PDF", 1, "Production reconciliation")], criteria: ["Counts and control totals match the source", "Downtime within the agreed window"] }, lockRule: "Client approves.", disputeRule: "A rollback goes to a mediator with the logs." },
    { code: "M07", title: "Hypercare and decommission plan", type: "PAY", day: 24, bps: 1500, dependsOn: ["M06"], proof: { artifacts: [P("PDF", 1, "Hypercare ticket log"), P("PDF", 1, "Legacy decommission plan")], criteria: ["All data defects raised in hypercare closed or handed over"] }, lockRule: "Client signs.", disputeRule: "Open defects are deducted per ticket at the agreed rate." },
  ],
  clauses: [
    { code: "TPL_DATA_PROTECTION", category: "BASELINE", title: "Data protection", body: "Personal data is processed only in client-approved environments and deleted from any staging area after M07.", protective: true },
    { code: "TPL_SOURCE_QUALITY", category: "BASELINE", title: "Source data quality", body: "Cleansing of source data beyond the mapping rules is a change request.", protective: false },
  ],
};

export const LEGAL_REVIEW: BlueprintDef = {
  code: "UC_LEGAL_REVIEW", title: "Legal document review", vertical: "Professional services", kind: "DIGITAL", depth: "outline", recommendedDays: 15,
  summary: "Review and redline a defined set of contracts by a lawyer qualified in the governing jurisdiction, with an issues list and final memo.",
  milestones: [
    { code: "M01", title: "Engagement and conflict check", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("SIGNATURE", 1, "Engagement letter"), P("PDF", 1, "Conflict check confirmation and document list")], criteria: ["Reviewer is admitted in the governing jurisdiction", "Document list fixes the scope"] }, lockRule: "Both sign the engagement letter.", disputeRule: "Documents added later are priced per page at the agreed rate." },
    { code: "M02", title: "Issues list", type: "PAY", day: 4, bps: 2500, dependsOn: ["M01"], proof: { artifacts: [P("PDF", 1, "Issues list ranked by risk, citing clause numbers")], criteria: ["Every document on the list is covered", "Each issue cites the clause and a proposed position"] }, lockRule: "Client approves.", disputeRule: "Uncovered documents are reviewed within 72 hours before release." },
    { code: "M03", title: "Redlines delivered", type: "PAY", day: 8, bps: 3500, dependsOn: ["M02"], proof: { artifacts: [P("PDF", 1, "Tracked-change redline per document"), P("PDF", 1, "Cover note explaining each change")], criteria: ["Every high-risk issue has a redline or a written reason for none"] }, lockRule: "Client approves.", disputeRule: "Missing redlines are delivered within 72 hours." },
    { code: "M04", title: "Second turn", type: "PAY", day: 11, bps: 2000, dependsOn: ["M03"], proof: { artifacts: [P("PDF", 1, "Revised redlines responding to counterparty comments")], criteria: ["Each counterparty comment is accepted, rejected or countered in writing"] }, lockRule: "Client approves.", disputeRule: "Unanswered comments are answered within 48 hours." },
    { code: "M05", title: "Final memo and execution versions", type: "PAY", day: 15, bps: 2000, dependsOn: ["M04"], proof: { artifacts: [P("PDF", 1, "Final memo of residual risks"), P("PDF", 1, "Clean execution versions")], criteria: ["Residual risks listed with their clause numbers"] }, lockRule: "Client signs off.", disputeRule: "A mediator with legal background reviews disputed scope." },
  ],
  clauses: [
    { code: "TPL_PRIVILEGE", category: "BASELINE", title: "Confidentiality and privilege", body: "Documents and advice stay confidential. Evidence uploaded to PaySettle is limited to what is needed to show a milestone is done.", protective: true },
    { code: "TPL_SCOPE", category: "BASELINE", title: "Scope of advice", body: "Advice covers the listed documents under the named governing law only.", protective: false },
  ],
};

export const SOLAR_INSTALL: BlueprintDef = {
  code: "UC_SOLAR_INSTALL", title: "Solar installation", vertical: "Energy", kind: "PHYSICAL_SITE", depth: "outline", recommendedDays: 24,
  summary: "Residential or small commercial rooftop solar: design and permit, equipment, mounting, electrical, inspection and commissioning with production data.",
  milestones: [
    { code: "M01", title: "Site assessment", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("IMAGE", 6, "Roof, main panel and meter"), P("PDF", 1, "Shade analysis and structural check")], gpsRadiusM: 150, criteria: ["Roof structure confirmed adequate for the array load"] }, lockRule: "Both sign the assessment.", disputeRule: "Structural work found necessary is a change request." },
    { code: "M02", title: "Design and permit application", type: "PAY", day: 4, bps: 1000, dependsOn: ["M01"], proof: { artifacts: [P("PDF", 1, "Single-line diagram and array layout"), P("PDF", 1, "Permit and interconnection application receipts")], criteria: ["System size and equipment models stated", "Applications submitted"] }, lockRule: "Client approves the design.", disputeRule: "Design changes requested by the authority are made at no extra cost." },
    { code: "M03", title: "Equipment delivered", type: "PAY", day: 9, bps: 3000, dependsOn: ["M02"], proof: { artifacts: [P("PDF", 1, "Supplier invoice"), P("IMAGE", 6, "Module and inverter labels with serial numbers")], gpsRadiusM: 150, criteria: ["Models match the design", "Serial numbers recorded for warranty"] }, lockRule: "Client approves.", disputeRule: "Release is pro-rata to correct equipment delivered." },
    { code: "M04", title: "Racking and modules installed", type: "PAY", day: 14, bps: 2500, dependsOn: ["M03"], proof: { artifacts: [P("IMAGE", 6, "Attachments, flashing and finished array"), P("PDF", 1, "Clamp torque log")], gpsRadiusM: 150, criteria: ["Attachments into rafters and flashed", "Clamps torqued to the manufacturer's value"] }, lockRule: "Client approves.", disputeRule: "Roof leaks traced to attachments are repaired at the provider's cost." },
    { code: "M05", title: "Electrical and inverter", type: "PAY", day: 17, bps: 1500, dependsOn: ["M04"], proof: { artifacts: [P("PDF", 1, "String test report"), P("IMAGE", 6, "Inverter, disconnects and labels")], gpsRadiusM: 150, criteria: ["Open-circuit voltage per string within 5% of calculated", "Insulation resistance at least 1 MΩ"] }, lockRule: "Client approves.", disputeRule: "Failing strings are fixed and retested." },
    { code: "M06", title: "Inspection and permission to operate", type: "GATE", day: 20, bps: 0, dependsOn: ["M05"], proof: { artifacts: [P("PDF", 1, "Passed inspection and utility permission to operate")], criteria: ["Authority inspection passed", "Utility permission received"] }, lockRule: "Documents uploaded.", disputeRule: "Failed items are fixed at the provider's cost; utility delays extend M07." },
    { code: "M07", title: "Commissioning and monitoring handover", type: "PAY", day: 24, bps: 2000, dependsOn: ["M06"], proof: { artifacts: [P("LOG", 1, "At least 48 hours of monitoring data"), P("PDF", 1, "Warranty documents and monitoring login")], criteria: ["Inverter online with no faults", "Output at least 80% of modelled for the measured sunlight"] }, lockRule: "Client approves.", disputeRule: "Underperformance is diagnosed by an independent installer; the party found wrong pays." },
  ],
  clauses: [
    { code: "TPL_ROOF_PEN", category: "BASELINE", title: "Roof penetrations", body: "The provider repairs leaks at array attachments for 10 years.", protective: true },
    { code: "TPL_INCENTIVES", category: "BASELINE", title: "Incentives", body: "Tax credits and rebates depend on the client's eligibility; the provider supplies the documents it holds.", protective: false },
  ],
};

export const KITCHEN_REMODEL: BlueprintDef = {
  code: "UC_KITCHEN_REMODEL", title: "Kitchen remodel", vertical: "Residential construction", kind: "PHYSICAL_SITE", depth: "outline", recommendedDays: 26,
  summary: "Strip-out and rebuild of a kitchen: rough-in inspected before walls close, cabinets, countertops and appliances tested in place.",
  milestones: [
    { code: "M01", title: "Measure and design sign-off", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("PDF", 1, "Dimensioned layout and elevations"), P("IMAGE", 6, "Existing kitchen")], gpsRadiusM: 200, criteria: ["Layout fits measured walls within ±3 mm"] }, lockRule: "Client signs the design.", disputeRule: "Changes after signing are change requests." },
    { code: "M02", title: "Cabinets and appliances ordered", type: "PAY", day: 3, bps: 2000, dependsOn: ["M01"], proof: { artifacts: [P("PDF", 1, "Supplier invoices and order confirmations")], criteria: ["Models and finishes match the design"] }, lockRule: "Client approves.", disputeRule: "Mismatched orders are corrected at the provider's cost." },
    { code: "M03", title: "Demolition and rough-in", type: "PAY", day: 7, bps: 2000, dependsOn: ["M02"], proof: { artifacts: [P("IMAGE", 6, "Open walls showing new plumbing, gas and wiring"), P("VIDEO", 1, "Plumbing pressure test gauge")], gpsRadiusM: 200, criteria: ["Water lines hold test pressure for 15 minutes", "New circuits as on the electrical plan"] }, lockRule: "Client approves.", disputeRule: "Failed tests are repaired and repeated before release." },
    { code: "M04", title: "Rough-in inspection", type: "GATE", day: 9, bps: 0, dependsOn: ["M03"], proof: { artifacts: [P("PDF", 1, "Passed rough-in inspection")], criteria: ["Inspector passes plumbing, gas and electrical rough-in"] }, lockRule: "Walls are not closed before this.", disputeRule: "Failed items are fixed at the provider's cost." },
    { code: "M05", title: "Cabinets installed", type: "PAY", day: 15, bps: 2000, dependsOn: ["M04"], proof: { artifacts: [P("IMAGE", 6, "Installed cabinets with level in view")], gpsRadiusM: 200, criteria: ["Level and plumb within 1 mm per metre", "Doors aligned with even 3 mm gaps"] }, lockRule: "Client approves.", disputeRule: "Failing units are reset within 5 days; deducted at line value if not." },
    { code: "M06", title: "Countertops and backsplash", type: "PAY", day: 19, bps: 1500, dependsOn: ["M05"], proof: { artifacts: [P("IMAGE", 6, "Seams, edges, cut-outs and backsplash")], gpsRadiusM: 200, criteria: ["Seams no wider than 1 mm", "Grout lines even, no cracked tiles"] }, lockRule: "Client approves.", disputeRule: "A cracked or chipped top is replaced, not filled." },
    { code: "M07", title: "Appliances connected and tested", type: "PAY", day: 23, bps: 1000, dependsOn: ["M06"], proof: { artifacts: [P("VIDEO", 1, "Each appliance running"), P("LOG", 1, "Gas leak test reading")], gpsRadiusM: 200, criteria: ["Every appliance runs through one cycle", "No gas leak detected at any joint"] }, lockRule: "Client approves.", disputeRule: "Faulty connections are fixed within 48 hours." },
    { code: "M08", title: "Punch list and handover", type: "PAY", day: 26, bps: 1500, dependsOn: ["M07"], proof: { artifacts: [P("PDF", 1, "Closed punch list with photos"), P("PDF", 1, "Final inspection and warranties"), P("SIGNATURE", 1, "Client handover")], gpsRadiusM: 200, criteria: ["Every punch item closed or dated", "Final inspection passed"] }, lockRule: "Client signs.", disputeRule: "Open items deducted at the value on the punch list." },
  ],
  clauses: [
    { code: "TPL_HIDDEN_CONDITIONS", category: "BASELINE", title: "Hidden conditions", body: "Rot, mould or code problems found behind walls are reported with photos within 24 hours and priced before work on them starts.", protective: true },
    { code: "TPL_WORKMANSHIP_1Y", category: "BASELINE", title: "One-year workmanship warranty", body: "The provider repairs installation defects reported within 12 months of handover.", protective: true },
  ],
};

export const FURNITURE_MFG: BlueprintDef = {
  code: "UC_FURNITURE_MFG", title: "Furniture manufacturing", vertical: "Manufacturing", kind: "PHYSICAL_SHOP", depth: "outline", recommendedDays: 25,
  summary: "A batch of custom furniture: approved first article, production run with sampled QC, packing and tracked delivery.",
  milestones: [
    { code: "M01", title: "Drawings and finish sample approved", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("PDF", 1, "Dimensioned drawings"), P("IMAGE", 2, "Finish sample")], criteria: ["Quantities, dimensions and finish fixed in writing"] }, lockRule: "Client signs drawings and sample.", disputeRule: "Changes after signing are change requests." },
    { code: "M02", title: "Materials purchased", type: "PAY", day: 5, bps: 2000, dependsOn: ["M01"], proof: { artifacts: [P("PDF", 1, "Supplier invoices"), P("IMAGE", 4, "Materials at the workshop")], gpsRadiusM: 200, criteria: ["Material grade and quantity match the bill of materials"] }, lockRule: "Client approves.", disputeRule: "Release is pro-rata to matching invoice value." },
    { code: "M03", title: "First article approved", type: "PAY", day: 10, bps: 2000, dependsOn: ["M02"], proof: { artifacts: [P("IMAGE", 6, "First piece from all sides"), P("PDF", 1, "Dimension report"), P("VIDEO", 1, "Static load test")], gpsRadiusM: 200, criteria: ["Dimensions within ±2 mm of drawings", "Holds 1.5× rated load for 10 minutes with no permanent deformation"] }, lockRule: "Client approves; production does not start before this.", disputeRule: "A failing first article is remade before release." },
    { code: "M04", title: "Production run complete", type: "PAY", day: 18, bps: 3000, dependsOn: ["M03"], proof: { artifacts: [P("IMAGE", 6, "Finished pieces with serial labels"), P("PDF", 1, "QC sheet with sampled inspection")], gpsRadiusM: 200, criteria: ["Quantity complete", "Sampled pieces pass the first-article checks"] }, lockRule: "Client approves, or an inspector it names.", disputeRule: "Failing pieces are remade; release is pro-rata by passing pieces." },
    { code: "M05", title: "Finished and packed", type: "PAY", day: 21, bps: 1000, dependsOn: ["M04"], proof: { artifacts: [P("IMAGE", 6, "Packed pieces with corner protection and labels"), P("PDF", 1, "Packing list")], gpsRadiusM: 200, criteria: ["Packing list matches the order", "Each piece wrapped and corner-protected"] }, lockRule: "Client approves.", disputeRule: "Re-pack within 48 hours if packing is short of spec." },
    { code: "M06", title: "Delivered", type: "PAY", day: 25, bps: 2000, dependsOn: ["M05"], proof: { artifacts: [P("PDF", 1, "Signed proof of delivery"), P("IMAGE", 4, "Pieces on receipt")], oracle: "CARRIER_TRACKING", criteria: ["Carrier tracking shows delivered", "Count matches the packing list with no transit damage noted"] }, lockRule: "Client approves after the tracking oracle reports delivered.", disputeRule: "Damaged pieces are replaced or deducted at unit price." },
  ],
  clauses: [
    { code: "TPL_DESIGN_OWNERSHIP", category: "BASELINE", title: "Design ownership", body: "Custom designs supplied by the client are not reused for other customers.", protective: true },
    { code: "TPL_TRANSIT", category: "BASELINE", title: "Transit risk", body: "The provider insures the goods until the client signs the proof of delivery.", protective: true },
  ],
};

export const LANDSCAPING: BlueprintDef = {
  code: "UC_LANDSCAPING", title: "Landscaping", vertical: "Outdoor construction", kind: "PHYSICAL_SITE", depth: "outline", recommendedDays: 21,
  summary: "Garden build: grading and drainage, hardscape, irrigation and planting, checked on site against the plan and plant list.",
  milestones: [
    { code: "M01", title: "Site plan and utility locate", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("PDF", 1, "Utility locate ticket"), P("IMAGE", 6, "Site with marked utilities")], gpsRadiusM: 150, criteria: ["Buried utilities marked before digging"] }, lockRule: "Both confirm.", disputeRule: "Damage to marked utilities is the provider's to repair." },
    { code: "M02", title: "Design and plant list approved", type: "PAY", day: 4, bps: 1000, dependsOn: ["M01"], proof: { artifacts: [P("PDF", 1, "Planting plan and plant list with sizes")], criteria: ["Every bed has species, count and pot size"] }, lockRule: "Client signs.", disputeRule: "Two revision rounds included." },
    { code: "M03", title: "Grading and drainage", type: "PAY", day: 8, bps: 2000, dependsOn: ["M02"], proof: { artifacts: [P("IMAGE", 6, "Graded areas with level readings"), P("VIDEO", 1, "Water test on drains")], gpsRadiusM: 150, criteria: ["Ground falls at least 2% away from the building for the first 3 m", "Drains carry test water away with no pooling"] }, lockRule: "Client approves.", disputeRule: "Pooling areas are regraded before release." },
    { code: "M04", title: "Hardscape", type: "PAY", day: 12, bps: 2500, dependsOn: ["M03"], proof: { artifacts: [P("IMAGE", 4, "Base depth with tape before paving"), P("IMAGE", 6, "Finished paths, patio and walls")], gpsRadiusM: 150, criteria: ["Compacted base at least 100 mm", "Paving level within 5 mm under a 3 m straightedge"] }, lockRule: "Client approves.", disputeRule: "Failing areas are relaid at the provider's cost." },
    { code: "M05", title: "Irrigation", type: "PAY", day: 15, bps: 1500, dependsOn: ["M03"], proof: { artifacts: [P("VIDEO", 1, "Each zone running"), P("PDF", 1, "Zone map and controller schedule")], gpsRadiusM: 150, criteria: ["Head-to-head coverage in every lawn zone", "No leaks at any fitting"] }, lockRule: "Client approves.", disputeRule: "Dry spots or leaks fixed within 48 hours." },
    { code: "M06", title: "Planting", type: "PAY", day: 19, bps: 2000, dependsOn: ["M04", "M05"], proof: { artifacts: [P("IMAGE", 6, "Each bed with plant tags visible"), P("PDF", 1, "Nursery invoice")], gpsRadiusM: 150, criteria: ["Species, counts and sizes match the plant list"] }, lockRule: "Client approves.", disputeRule: "Missing or undersized plants are replaced or deducted at list price." },
    { code: "M07", title: "Final walkthrough", type: "PAY", day: 21, bps: 1000, dependsOn: ["M06"], proof: { artifacts: [P("PDF", 1, "Care guide"), P("SIGNATURE", 1, "Client walkthrough sign-off")], gpsRadiusM: 150, criteria: ["Site clean and controller set to the care schedule"] }, lockRule: "Client signs.", disputeRule: "Open items deducted at agreed value." },
  ],
  clauses: [
    { code: "TPL_PLANT_REPLACE", category: "BASELINE", title: "Plant replacement", body: "Plants that die within 90 days despite watering as in the care guide are replaced once at no charge.", protective: true },
    { code: "TPL_WATER", category: "BASELINE", title: "Water and access", body: "The client provides water and site access during working hours.", protective: false },
  ],
};

export const MARKETING_CAMPAIGN: BlueprintDef = {
  code: "UC_MARKETING_CAMPAIGN", title: "Marketing campaign", vertical: "Marketing", kind: "HYBRID", depth: "outline", recommendedDays: 26,
  summary: "Plan, produce and run a paid campaign. Payment follows delivered work and verified delivery; business results are reported, not promised.",
  milestones: [
    { code: "M01", title: "Brief, KPIs and tracking plan", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("PDF", 1, "Brief with budget, channels and KPIs"), P("PDF", 1, "Tracking plan")], criteria: ["Each KPI has a definition and a data source"] }, lockRule: "Both sign.", disputeRule: "KPI changes after signing are change requests." },
    { code: "M02", title: "Creative concepts approved", type: "PAY", day: 5, bps: 1500, dependsOn: ["M01"], proof: { artifacts: [P("PDF", 1, "Two or more concepts with sample copy and visuals")], criteria: ["Each concept covers every channel in the brief"] }, lockRule: "Client picks and approves a concept.", disputeRule: "One revision round included." },
    { code: "M03", title: "Assets produced", type: "PAY", day: 10, bps: 2500, dependsOn: ["M02"], proof: { artifacts: [P("LINK", 1, "Asset folder"), P("PDF", 1, "Asset list against channel specs")], criteria: ["Every asset meets its channel's size and length spec"] }, lockRule: "Client approves.", disputeRule: "Release is pro-rata by assets approved." },
    { code: "M04", title: "Tracking verified and launch", type: "PAY", day: 12, bps: 2000, dependsOn: ["M03"], proof: { artifacts: [P("LOG", 1, "Test conversion events received in analytics"), P("LINK", 2, "Live ads")], criteria: ["Every tracked event fires in a test", "Campaigns live on the agreed date"] }, lockRule: "Client approves.", disputeRule: "Broken tracking is fixed within 24 hours; spend is paused meanwhile." },
    { code: "M05", title: "Mid-flight report", type: "PAY", day: 19, bps: 1500, dependsOn: ["M04"], proof: { artifacts: [P("PDF", 1, "Report with platform exports")], criteria: ["Spend pacing within ±10% of plan", "Optimisations made are listed"] }, lockRule: "Client approves.", disputeRule: "Pacing outside range is corrected within 48 hours." },
    { code: "M06", title: "Final report", type: "PAY", day: 26, bps: 2500, dependsOn: ["M05"], proof: { artifacts: [P("PDF", 1, "Final report with each KPI against target"), P("LOG", 1, "Raw platform exports")], criteria: ["At least 95% of planned impressions delivered for the budget spent", "Every KPI reported with its source data"] }, lockRule: "Client approves.", disputeRule: "Under-delivery below 95% is deducted pro-rata." },
  ],
  clauses: [
    { code: "TPL_AD_SPEND", category: "BASELINE", title: "Media spend", body: "Media spend is billed by the ad platforms to the client's own ad accounts and is not part of this contract's milestones.", protective: true },
    { code: "TPL_ASSET_RIGHTS", category: "BASELINE", title: "Asset rights", body: "On release the client owns the produced assets; licensed stock is used under its licence terms.", protective: true },
  ],
};

export const TRADESHOW_LOGISTICS: BlueprintDef = {
  code: "UC_TRADESHOW_LOGISTICS", title: "Trade-show logistics", vertical: "Events and logistics", kind: "HYBRID", depth: "outline", recommendedDays: 24,
  summary: "Booth build, freight to the show, installation, dismantle and return, each proved by shipping documents and on-site photos.",
  milestones: [
    { code: "M01", title: "Booth spec and shipping plan", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("PDF", 1, "Booth drawing and exhibitor manual deadlines"), P("PDF", 1, "Shipping plan")], criteria: ["Every show deadline is listed with an owner"] }, lockRule: "Both sign.", disputeRule: "Missed deadlines owned by the client extend dates." },
    { code: "M02", title: "Booth build and graphics ordered", type: "PAY", day: 4, bps: 2000, dependsOn: ["M01"], proof: { artifacts: [P("PDF", 1, "Supplier orders and graphic proofs")], criteria: ["Graphic proofs approved at print size"] }, lockRule: "Client approves.", disputeRule: "Misprints caused by the provider are reprinted at its cost." },
    { code: "M03", title: "Freight picked up", type: "PAY", day: 10, bps: 1500, dependsOn: ["M02"], proof: { artifacts: [P("PDF", 1, "Bill of lading with piece count"), P("IMAGE", 4, "Crates labelled for the show")], oracle: "CARRIER_TRACKING", criteria: ["Piece count matches the packing list"] }, lockRule: "Client approves after tracking shows pickup.", disputeRule: "Missing pieces are traced; release waits." },
    { code: "M04", title: "Delivered to the show warehouse", type: "PAY", day: 15, bps: 1500, dependsOn: ["M03"], proof: { artifacts: [P("PDF", 1, "Warehouse receipt")], oracle: "CARRIER_TRACKING", criteria: ["Received before the warehouse deadline"] }, lockRule: "Released when the tracking oracle reports delivered.", disputeRule: "Late-arrival surcharges caused by the provider are deducted." },
    { code: "M05", title: "Booth installed", type: "PAY", day: 18, bps: 2500, dependsOn: ["M04"], proof: { artifacts: [P("IMAGE", 6, "Booth from each aisle"), P("VIDEO", 1, "Lights and screens working")], gpsRadiusM: 300, criteria: ["Booth matches the drawing", "Power, lighting and screens work"] }, lockRule: "Client approves on the show floor.", disputeRule: "Defects fixed before doors open; unfixed items deducted at line value." },
    { code: "M06", title: "Dismantle and return freight", type: "PAY", day: 22, bps: 1500, dependsOn: ["M05"], proof: { artifacts: [P("IMAGE", 2, "Empty booth space"), P("PDF", 1, "Return bill of lading")], gpsRadiusM: 300, criteria: ["Space cleared by the show's deadline"] }, lockRule: "Client approves.", disputeRule: "Show clean-up charges caused by the provider are deducted." },
    { code: "M07", title: "Return delivered and reconciled", type: "PAY", day: 24, bps: 1000, dependsOn: ["M06"], proof: { artifacts: [P("PDF", 1, "Proof of delivery"), P("PDF", 1, "Charges reconciled against the quote")], criteria: ["All pieces returned", "No charges outside the quote without approval"] }, lockRule: "Client approves.", disputeRule: "Unapproved charges are removed." },
  ],
  clauses: [
    { code: "TPL_CARGO_INSURANCE", category: "BASELINE", title: "Cargo insurance", body: "The provider insures the freight door to door at declared value.", protective: true },
    { code: "TPL_SHOW_FEES", category: "BASELINE", title: "Show services", body: "Venue electrics, rigging and material handling ordered from the show are paid by the client.", protective: false },
  ],
};

export const FREIGHT_FORWARDING: BlueprintDef = {
  code: "UC_FREIGHT_FORWARDING", title: "Freight forwarding", vertical: "Logistics", kind: "HYBRID", depth: "outline", recommendedDays: 26,
  summary: "Door-to-door ocean or air shipment: pickup, export clearance, transit, import clearance and delivery with seal and tracking checks.",
  milestones: [
    { code: "M01", title: "Booking confirmed", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("PDF", 1, "Carrier booking confirmation"), P("PDF", 1, "Commercial invoice and packing list")], criteria: ["Incoterm, routing and cut-off dates stated"] }, lockRule: "Both confirm.", disputeRule: "Missing shipper documents delay dates day for day." },
    { code: "M02", title: "Cargo picked up and loaded", type: "PAY", day: 3, bps: 1500, dependsOn: ["M01"], proof: { artifacts: [P("IMAGE", 4, "Loading and the container seal number"), P("PDF", 1, "Verified gross mass declaration")], criteria: ["Seal number recorded", "Piece count matches the packing list"] }, lockRule: "Shipper approves.", disputeRule: "Count differences are recorded and traced before release." },
    { code: "M03", title: "Export clearance and on board", type: "PAY", day: 6, bps: 2000, dependsOn: ["M02"], proof: { artifacts: [P("PDF", 1, "Export declaration"), P("PDF", 1, "Bill of lading with on-board date")], oracle: "CARRIER_TRACKING", criteria: ["Cargo on board the booked sailing or flight"] }, lockRule: "Released when the tracking oracle shows departure.", disputeRule: "A rolled shipment goes to the next sailing; storage costs caused by the forwarder are its own." },
    { code: "M04", title: "Arrival and import clearance", type: "PAY", day: 20, bps: 2500, dependsOn: ["M03"], proof: { artifacts: [P("PDF", 1, "Arrival notice"), P("PDF", 1, "Customs release")], oracle: "CARRIER_TRACKING", criteria: ["Customs release issued"] }, lockRule: "Consignee approves.", disputeRule: "Demurrage caused by the forwarder is deducted." },
    { code: "M05", title: "Delivered", type: "PAY", day: 24, bps: 3000, dependsOn: ["M04"], proof: { artifacts: [P("PDF", 1, "Signed proof of delivery"), P("IMAGE", 2, "Seal intact on arrival")], criteria: ["Seal number matches M02", "No damage noted on the proof of delivery"] }, lockRule: "Consignee approves.", disputeRule: "Damage claims go to a mediator with the seal and loading photos." },
    { code: "M06", title: "Charges reconciled", type: "PAY", day: 26, bps: 1000, dependsOn: ["M05"], proof: { artifacts: [P("PDF", 1, "Final invoice against the quote with receipts")], criteria: ["No charges outside the quote without written approval"] }, lockRule: "Shipper approves.", disputeRule: "Unapproved charges are removed." },
  ],
  clauses: [
    { code: "TPL_CARGO_CLAIMS", category: "BASELINE", title: "Cargo claims", body: "The forwarder files carrier claims for loss or damage within the carrier's deadline and passes any recovery to the shipper.", protective: true },
    { code: "TPL_DUTIES", category: "BASELINE", title: "Duties and taxes", body: "Import duties and taxes are paid by the party named in the Incoterm.", protective: false },
  ],
};

export const EQUIPMENT_RENTAL: BlueprintDef = {
  code: "UC_EQUIPMENT_RENTAL", title: "Equipment rental", vertical: "Construction and industrial", kind: "HYBRID", depth: "outline", recommendedDays: 26,
  summary: "Heavy or specialist equipment on hire: delivery and commissioning, weekly uptime from telematics logs, off-hire inspection.",
  milestones: [
    { code: "M01", title: "Pre-delivery inspection", type: "GATE", day: 1, bps: 0, proof: { artifacts: [P("IMAGE", 6, "Machine from all sides and the hour meter"), P("PDF", 1, "Service record")], criteria: ["Hour meter and existing damage recorded"] }, lockRule: "Both sign the inspection.", disputeRule: "Damage not recorded here is presumed to occur on hire." },
    { code: "M02", title: "Delivered and commissioned", type: "PAY", day: 2, bps: 2000, dependsOn: ["M01"], proof: { artifacts: [P("IMAGE", 4, "Machine on site"), P("PDF", 1, "Signed delivery ticket and operator briefing")], gpsRadiusM: 300, criteria: ["Machine runs through its function check on site"] }, lockRule: "Hirer approves.", disputeRule: "A machine that fails the check is swapped within 24 hours." },
    { code: "M03", title: "Week 1 availability", type: "PAY", day: 9, bps: 2000, dependsOn: ["M02"], proof: { artifacts: [P("LOG", 1, "Telematics hours and fault log")], criteria: ["Available at least 95% of scheduled hours", "Breakdowns answered within 4 hours"] }, lockRule: "Hirer approves.", disputeRule: "Downtime caused by the machine is deducted pro-rata by hours." },
    { code: "M04", title: "Week 2 availability", type: "PAY", day: 16, bps: 2000, dependsOn: ["M03"], proof: { artifacts: [P("LOG", 1, "Telematics hours and fault log")], criteria: ["Available at least 95% of scheduled hours"] }, lockRule: "Hirer approves.", disputeRule: "Downtime caused by the machine is deducted pro-rata by hours." },
    { code: "M05", title: "Week 3 availability", type: "PAY", day: 23, bps: 2000, dependsOn: ["M04"], proof: { artifacts: [P("LOG", 1, "Telematics hours and fault log")], criteria: ["Available at least 95% of scheduled hours"] }, lockRule: "Hirer approves.", disputeRule: "Downtime caused by the machine is deducted pro-rata by hours." },
    { code: "M06", title: "Off-hire inspection and collection", type: "PAY", day: 26, bps: 2000, dependsOn: ["M05"], proof: { artifacts: [P("IMAGE", 6, "Machine from the same angles as M01"), P("PDF", 1, "Off-hire inspection sheet")], gpsRadiusM: 300, criteria: ["Damage beyond fair wear is listed against M01", "Fuel level and hours recorded"] }, lockRule: "Both sign the off-hire sheet.", disputeRule: "Disputed damage goes to a mediator with the M01 and M06 photos." },
  ],
  clauses: [
    { code: "TPL_BREAKDOWN", category: "BASELINE", title: "Breakdowns", body: "The owner repairs or replaces a broken-down machine within 24 hours; hire is not charged for the downtime.", protective: true },
    { code: "TPL_OPERATOR", category: "BASELINE", title: "Operators", body: "The hirer uses trained operators and keeps the machine within its rated loads.", protective: false },
  ],
};

export const OUTLINE_BLUEPRINTS: BlueprintDef[] = [
  EVENT_PRODUCTION, VIDEO_POST, APP_LOCALISATION, DATA_MIGRATION, LEGAL_REVIEW,
  SOLAR_INSTALL, KITCHEN_REMODEL, FURNITURE_MFG, LANDSCAPING,
  MARKETING_CAMPAIGN, TRADESHOW_LOGISTICS, FREIGHT_FORWARDING, EQUIPMENT_RENTAL,
];
