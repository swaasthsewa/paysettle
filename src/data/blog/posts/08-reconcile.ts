/* Sample post 8 (finance). PaySettle facts from src/server/control/recon.ts (planes A/B/C, ledger identity,
 * grouping by PayPal reference, IN_FLIGHT_MS 15 min, REPORTING_LAG_MS 3 h, DEFAULT_WINDOW_MS 31 days, statuses
 * MATCHED/IN_FLIGHT/DRIFT/UNAVAILABLE, breaker + audit), src/server/money/index.ts (RELEASE_BLOCKED on BREAKER),
 * src/server/control/dual.ts (CLEAR_BREAKER four-eyes), src/db/sql/guards.sql (ledger append-only),
 * src/server/control/compliance.ts (signed non-custodial export), src/server/playground/scenarios.ts (S5).
 * The 31-day range limit cites PayPal's Transaction Search guide. */
import { callout, cta, faq, flow, h2, h3, image, steps, table, text, tldr, type SeedPost } from "../build";
import { PP_IDEMPOTENCY, PP_TXN_SEARCH } from "../sources";

export const POST_RECONCILE: SeedPost = {
  slug: "reconciling-to-the-cent",
  title: "Reconciling to the cent: three-way recon for finance teams",
  dek: "Every tranche is checked three ways: against the signed contract, against our double-entry ledger, and against PayPal's own records. What each plane holds, what counts as drift, and what happens when a cent goes missing.",
  topic: "finance",
  blocks: [
    tldr("t1", [
      "Three planes for every tranche: A, the signed contract; B, PaySettle's double-entry ledger; C, PayPal's transaction records.",
      "The ledger identity: everything held equals what was released to the provider, plus fees, plus what went back to the client, plus what is still held.",
      "A difference younger than 15 minutes is in flight. Older than that, it is drift: the tranche's circuit breaker trips, releases pause, and the finding is written to the audit chain.",
      "All amounts are integer cents, fees round half to even, and ledger entries can never be edited.",
    ], { claimStatus: "product" }),

    h2("h1", "Why two columns are not enough"),
    text("p1", `Most marketplaces reconcile two things: what their database says and what the payment processor says. That catches a payment that went missing. It does not catch a payment that went exactly as recorded, for the wrong amount, because the internal record was wrong as well.

For escrow, that is the case that matters. If the ledger and PayPal both say $2,125.00 was released for a milestone, but the signed contract put $2,000.00 on it, a two-way check is perfectly content. So PaySettle adds the contract itself as a third plane, and reconciles every tranche against all three.`, { claimStatus: "illustrative" }),
    image("i1", "/blog/three-way-recon.svg", "Three planes side by side: A, the signed contract's milestones; B, the ledger's hold, release, fee, refund and void entries; C, PayPal's transactions. A is checked against B, and B against C.", "A is checked against B (did we hold and pay what was signed?), and B against C (did PayPal move what we wrote?)."),

    h2("h2", "The three planes"),
    table("tb1", ["Plane", "Source", "Question it answers"], [
      ["A · Contract", "The payment milestones the signed revision puts in this tranche", "How much should be held, and how much is still unpaid?"],
      ["B · Ledger", "PaySettle's double-entry ledger: hold, release, fee, refund and void entries", "Where did every held cent go?"],
      ["C · PayPal", "PayPal's transaction records for the window; the mock rail's own records in the playground", "Did the money really move, in the amounts we wrote down?"],
    ], { sources: [PP_TXN_SEARCH], claimStatus: "product" }),

    h3("h2a", "Contract against ledger"),
    text("p2", `The holds the ledger records for a tranche must equal the payment milestones the contract puts in it, and what the ledger shows as still held must equal the milestones not yet paid or returned. The tranche's own planned amount must match its milestones too, so a tranche that was planned wrong is caught even before anyone has moved money on it.`, { claimStatus: "product" }),
    h3("h2b", "Inside the ledger"),
    text("p3", `The ledger must balance by itself: **held = released to the provider + fees + returned to the client (refunds and voids) + still held.** If more has left a hold than went into it, that is reported as its own problem. Ledger entries are append-only, enforced by a database trigger that refuses any update or delete, so a correction is always a new entry and never a rewrite of an old one.`, { claimStatus: "product" }),
    h3("h2c", "Ledger against PayPal"),
    text("p4", `Ledger entries are grouped by their PayPal reference. A capture's gross amount at PayPal must equal the release plus the fee recorded under the same reference; refunds and voids are matched the same way. The check also runs backwards: a PayPal transaction linked to the tranche that has no ledger entry is a finding, because money moved that we did not record.

Duplicates are kept out before reconciliation ever runs. Every money call carries an idempotency key that is stored before the call, and PayPal returns the earlier result when it sees the same request ID again instead of moving the money twice.`, { sources: [PP_IDEMPOTENCY], claimStatus: "product" }),

    h2("h3", "Timing: in flight or drift"),
    text("p5", `Payment systems are never perfectly simultaneous. A capture can complete at PayPal seconds before our webhook arrives, and PayPal's reporting can list a transaction some time after it happens. Reconciliation treats timing explicitly instead of hoping:

- A difference younger than **15 minutes** is reported as in flight.
- A hold that PayPal's reporting has not listed yet is not drift until **3 hours** have passed.
- Anything older is **drift**.
- When PayPal's records cannot be fetched at all, the line says **unavailable**, never matched.

Each run looks back over a 31-day window, which is also the widest date range PayPal's transaction search accepts in one request.`, { sources: [PP_TXN_SEARCH], claimStatus: "product" }),
    callout("c1", "warn", "What drift does", "Drift trips the tranche's circuit breaker. Releases on that tranche pause until the difference is explained, and clearing the breaker needs two people: one proposes, a different one approves. The finding is written to the hash-chained audit log. One cent is enough to trip it.", { claimStatus: "product" }),

    h2("h4", "A worked example"),
    text("p6", `A $6,000 tranche holds seven milestones. The client approves M02, worth 15%. PayPal shows a capture of $900.00. Under the same reference the ledger shows a release of $877.50 to the provider and a 2.5% fee of $22.50, which together make $900.00, so the ledger and PayPal agree. The ledger still holds $5,100.00, and the contract's unpaid milestones add up to $5,100.00, so the contract and the ledger agree too.`, { claimStatus: "illustrative" }),
    flow("mf1", 600_000, 1500, 0, "Illustrative: a $6,000 tranche after M02 (15%) is released. Every number in the reconciliation comes from these four amounts.", { claimStatus: "illustrative" }),
    steps("s1", "Now suppose one cent goes wrong", [
      { title: "The ledger records a fee of $22.51", body: "Release plus fee under that reference is now $900.01, against a PayPal capture of $900.00." },
      { title: "The next run reports it in flight", body: "Inside the first 15 minutes, a late webhook or a capture still settling could explain it, so the line is marked in flight and nothing trips." },
      { title: "After 15 minutes it is drift", body: "The tranche moves to the breaker state, releases on it pause, and the finding is written to the audit chain with both amounts." },
      { title: "Two people clear it", body: "Finance explains the difference and adds a correcting entry. One person proposes clearing the breaker; a different person approves, and releases resume." },
    ], { claimStatus: "illustrative" }),

    h2("h5", "What finance gets"),
    text("p7", `Every run is stored with a line per tranche: the three planes' numbers side by side, the status (matched, in flight, drift or unavailable), and the notes that explain anything unusual, such as a remainder returned without naming milestones at a termination.

For reviews and audits there is a signed compliance export of the money flows, showing that client funds passed through PayPal holds rather than through a PaySettle account. It is an evidence pack for a reviewer, not a legal determination. And the Judge Playground's scenario S5 runs the failure drills on purpose: a PayPal 503 during a release (one payout at the end, not two), a duplicate webhook (deduplicated), and one cent of ledger drift (breaker tripped).`, { claimStatus: "product" }),

    faq("f1", [
      { q: "When does reconciliation run?", a: "Whenever Finance starts a run from the reconciliation page, and inside the playground scenarios. Each run covers the last 31 days by default and is stored with its result." },
      { q: "Why integer cents everywhere?", a: "Floating-point arithmetic cannot represent most decimal amounts exactly, and small errors add up over thousands of releases. Cents and basis points are whole numbers, so sums are exact." },
      { q: "What if PayPal is slow to report?", a: "A hold that PayPal's reporting has not listed yet is in flight for up to 3 hours before it can count as drift. If PayPal cannot be reached, the line is marked unavailable rather than matched." },
    ], { claimStatus: "product" }),
    cta("cta1", "Break a tranche on purpose", "Open the Judge Playground", "/playground", "Scenario S5: a PayPal 503, a duplicate webhook and one cent of drift, with the breaker and the audit rows shown."),
  ],
};
