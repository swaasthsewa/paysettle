/* Sample post 3 (case study, illustrative). Every milestone, proof spec, share and rule quoted here is the
 * UC_CLASSIC_CAR blueprint in src/data/blueprints/physical.ts; amounts for $14,500 are split by src/lib/money
 * (largest remainder) — the caseStudy and moneyFlow blocks compute them live. R04 front-loading from src/lib/policy.ts.
 * The owner, the shop and the price are made up and labelled Illustrative. */
import { callout, caseStudy, cta, faq, flow, h2, text, tldr, type SeedPost } from "../build";

export const POST_ENGINE_SWAP: SeedPost = {
  slug: "14500-engine-swap-milestone-by-milestone",
  title: "A $14,500 engine swap, milestone by milestone",
  dek: "A worked example on the classic-car blueprint: twenty steps, fifteen payments, five checkpoints, and what each one asks for before any money moves.",
  topic: "case-study",
  blocks: [
    callout("c0", "info", "This is a worked example", "The owner, the shop and the $14,500 price are made up. The milestones, proof specs, shares and rules are the classic-car blueprint exactly as the app loads it, and the amounts below are computed from it.", { claimStatus: "illustrative" }),
    tldr("t1", [
      "A $14,500 fuel-injection and drivetrain upgrade on PaySettle's classic-car blueprint: 20 steps over 26 days, inside one Rail A1 hold.",
      "15 steps pay money. 5 are checkpoints that pay nothing but must pass first: intake, compression test, wiring inspection, pre-dyno safety check and the owner's drive.",
      "Each payment names its proof: photos taken at the shop, torque logs, pressure readings, a dyno sheet, a road-test log of at least 50 km.",
      "When the powertrain is in, $6,525.00 (45%) has been released and the rest is still held in PayPal.",
    ], { claimStatus: "illustrative" }),

    h2("h1", "The job"),
    text("p1", `An owner brings a classic car to a specialist shop to make it pleasant to drive every day: fuel injection, a new wiring harness, cooling and brakes, tuned on a dyno and road tested with logged data. The agreed price is $14,500 and the shop plans 26 days.

Jobs like this go wrong in a predictable way. The expensive moments (parts arriving, the engine going in) come early. The proof of quality (a clean idle, a sensible air-fuel ratio, no warning lights at 80 km/h) comes late. An owner who paid half up front has little say left when the car does not idle right, and a shop that waits for payment on collection carries weeks of parts and labour on trust.`, { claimStatus: "illustrative" }),
    caseStudy("cs1", "UC_CLASSIC_CAR", 1_450_000,
      "Half up front by bank transfer, half on collection. The owner sees the car twice. When the idle hunts after handover, the argument is about what was promised.",
      "Fifteen payments, each released on named proof: logs, measured readings and photos taken at the shop. The money for the dyno and the road test stays held until those logs exist.",
      ["M02", "M06", "M11", "M14", "M17", "M18"], { claimStatus: "illustrative" }),

    h2("h2", "Checkpoints before money"),
    text("p2", `Five steps pay nothing. They are there because later money depends on them.

**M01, vehicle intake,** records the car as it arrived: a 360° walk-round video, six photos of the panels, VIN plate and odometer, and a condition sheet both sides sign. Its dispute rule is blunt: damage that is not on the sheet and not in the video is the shop's to repair at its own cost. **M02, the baseline compression test,** flags any cylinder more than 15% below the highest one, and the owner chooses in writing to keep it or rebuild it. A rebuild becomes a priced change request with its own milestone, so the original price never silently absorbs it.

Later checkpoints work the same way. The wiring harness inspection (M09) must pass before the battery is connected. The pre-dyno safety check (M16) must be signed by the shop lead before the car goes on the rollers. The owner's inspection drive (M19) produces the punch list that the final payment is measured against.`, { claimStatus: "product" }),

    h2("h3", "The early money, and why it is capped"),
    text("p3", `Payment starts on day 3 with the signed build specification (5%, $725.00), then the teardown with a tagged parts inventory (8%, $1,160.00) and the frame inspection against factory datum points (7%, $1,015.00). Those three fall in the first fifth of the 26-day timeline and add up to 20%. The policy gate refuses more than 40% in that first fifth unless both parties sign a material-deposit waiver, which keeps a contract from turning into "pay first and hope".

**M06, parts procurement** (10%, $1,450.00), pays against supplier invoices marked paid and photos of the received parts with their part numbers visible. Its dispute rule is pro-rata: if some parts do not match the signed list, the release is proportional to the invoice value of the parts that do. A baseline clause makes the parts bought under M06, and the original parts removed from the car, the owner's property, returned if the contract ends early.`, { claimStatus: "illustrative" }),

    h2("h4", "Proof that can be checked"),
    text("p4", `On most steps the photos must be taken within 200 metres of the shop. PaySettle reads a photo's GPS position when it has one and flags a picture taken somewhere else before the owner reviews it. Scenario S2 in the Judge Playground shows a photo taken 85 km away being caught.

Other milestones rely on numbers rather than pictures:

- **M11, fuel system:** pressure within ±2 psi of the regulator setting, and a drop of no more than 5 psi in the 10 minutes after shut-off.
- **M14, first fire:** oil pressure within 10 seconds of start, and an idle within ±100 rpm of target after warm-up.
- **M17, dyno tuning:** wide-open-throttle air-fuel ratio between 12.5:1 and 13.2:1, and no knock events in the final datalog.
- **M18, road test:** an ECU or OBD log of at least 50 km with no stored fault codes and coolant below 100 °C, traffic included.`, { claimStatus: "product" }),
    callout("c1", "warn", "A failed test does not pay", "The fuel, cooling and first-fire milestones share one rule: a failed test is repeated after the repair, and nothing is released until it passes. A brake defect blocks the brakes payment (M15) and also the dyno and road test until it is fixed.", { claimStatus: "product" }),

    h2("h5", "Where the money is on day 11"),
    text("p5", `Day 11 is the powertrain milestone (M08, 10%). Suppose every payment up to it has been approved: six releases, $6,525.00 in all, or 45% of the price. The 2.5% fee on those releases is $163.12, so the shop has received $6,361.88. The remaining $7,975.00 is still held in PayPal for the nine payment milestones to come, including the dyno and the road test.`, { claimStatus: "illustrative" }),
    flow("mf1", 1_450_000, 4500, 0, "Illustrative: the $14,500 job after the six payment milestones up to M08 are approved. Move the slider to see later points in the job.", { claimStatus: "illustrative" }),

    h2("h6", "The end of the job"),
    text("p6", `The owner's inspection drive (M19) is the last checkpoint: the owner drives the car and signs a punch list, and anything found after that is a warranty item. Handover (M20, 7%, $1,015.00) pays when every punch-list item is fixed or dated on the warranty list, and the documentation pack is handed over: wiring diagram, tune file, receipts and torque logs. Open punch-list items are deducted at the labour rate in the build spec.

Two smaller clauses finish the picture. While the car is at the shop, it is kept indoors and insured, and the policy certificate is shared before intake. And if the car is not collected within 7 days of handover, storage is charged at the daily rate in the build spec.`, { claimStatus: "illustrative" }),

    h2("h7", "What changes for each side"),
    text("p7", `**For the owner,** the money follows the evidence. At no point has more been paid than the work that has been shown and approved, and the payments for the results that matter most (the dyno sheet and the road-test log) stay held until those results exist.

**For the shop,** the money for parts and early labour is reserved in PayPal before the first bolt comes out, released step by step within the 48-hour review, and each release is final once approved. Arguments about "what was promised" are replaced by criteria that were agreed and signed on day 1.`, { claimStatus: "product" }),

    faq("f1", [
      { q: "Why does this job need only one hold?", a: "The blueprint runs 26 days, which fits one Rail A1 window. A longer build would split into two holds, and the policy gate would ask for at least three milestones in the second one." },
      { q: "What if hidden rust turns up at teardown?", a: "A baseline clause covers it: damage found after teardown is reported with photos within 24 hours, and extra work is priced as a change request that starts only after the owner approves it." },
      { q: "Who decides if the dyno sheet is disputed?", a: "First the two parties, with sealed offers. If they do not meet, a mediator decides, and under M17's dispute rule the mediator may ask for a second dyno session." },
    ], { claimStatus: "product" }),
    cta("cta1", "Open the classic-car blueprint yourself", "Try the live demo", "/login", "Start a contract from the blueprint, prune a step or append one, and see the amounts recompute to the cent."),
  ],
};
