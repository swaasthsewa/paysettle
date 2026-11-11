/* Sample post 5 (product, illustrative numbers). Mechanism from src/lib/deadline.ts (both terms off by default,
 * part of the canonical hash; due = hold start + milestone day; measured at the first accepted submission; review time
 * excluded, remediation counted, excused days; whole days to the nearest day; deduction/bonus formulas; fee on the
 * released amount; pool never negative, unused pool returned) and src/lib/policy.ts R11/R12. Example amounts were
 * computed with adjustmentFor() and releaseSplit() from that library. Rates are the default rates and
 * are labelled Illustrative: the parties choose their own. */
import { callout, cta, faq, flow, h2, stats, steps, table, text, tldr, type SeedPost } from "../build";

export const POST_DEADLINES: SeedPost = {
  slug: "late-by-two-days-deadline-deductions-and-early-bonuses",
  title: "Late by two days: how deadline deductions and early bonuses work",
  dek: "Two optional contract terms put a price on time: a small deduction for each day a milestone is late, and a bonus from a pool the client funds for finishing early. Both stay off unless both parties switch them on.",
  topic: "product",
  blocks: [
    tldr("t1", [
      "Both terms are off by default. They join a contract only when both parties sign a revision that includes them.",
      "Lateness is measured at the provider's accepted submission. Time the client spends reviewing never counts against the provider.",
      "A late deduction goes back to the client. An early bonus is paid from a pool the client funds with the tranche, so the money for it is already held.",
      "Both are capped, both are computed in integer cents, and the platform fee applies only to what is actually released.",
    ], { claimStatus: "product" }),

    h2("h1", "Why put a price on time"),
    text("p1", `Deadlines in service contracts tend to be either toothless or nuclear. Either they are ignored, or a late delivery becomes a reason to withhold everything and start an argument. Neither helps the people involved. The client needed the work on a date; the provider needed a reason to prioritise this job over the next one.

A small, predictable, capped adjustment works differently. It is agreed before work starts, it is computed rather than argued about, and it can never take more than the cap. For a provider who is reliably early, it is also a way to be paid for it.`),
    stats("st1", [
      { value: "0.5%", label: "of the milestone per counted day late, after 1 grace day" },
      { value: "10%", label: "cap on a late deduction" },
      { value: "0.25%", label: "bonus per day early, from 2 days early" },
      { value: "1%", label: "cap on an early bonus" },
    ], { claimStatus: "illustrative", anim: "countUp" }),
    text("p2", `These are the example defaults the deadline form starts with. The parties can choose their own numbers within the policy limits described below.`, { claimStatus: "illustrative" }),

    h2("h2", "Two terms, both optional"),
    table("tb1", ["Term", "Late deduction", "Early bonus"], [
      ["Who gains", "The client, when a milestone is late", "The provider, when a milestone is early"],
      ["Paid from", "The milestone's own amount; the deduction goes back to the client", "A bonus pool the client funds with the tranche hold"],
      ["Starts after", "The grace days", "A minimum number of days early"],
      ["Capped at", "A share of the milestone, at most 20%", "A share of the milestone; the pool may be at most 15% of the contract"],
      ["Scope", "Every payment milestone, or the ones the parties name", "Every payment milestone, or the ones the parties name"],
    ], { claimStatus: "product" }),
    text("p3", `Switching a term on is an ordinary contract change. The terms become part of the canonical document both signatures bind to, so turning one on or off, or changing any of its numbers, voids the earlier signatures, and both parties sign the new revision. The terms are set with a form, not free text, and the contract room shows a live preview of what a delay would cost, such as "2 days late → −$10.00 on M5", before anyone signs.`, { claimStatus: "product" }),

    h2("h3", "When is a milestone late?"),
    steps("s1", "The rule both parties sign", [
      { title: "The due time", body: "A milestone's day is counted within its tranche, from the moment that tranche was held in PayPal. In the first tranche, a milestone on day 6 is due six days after the hold began." },
      { title: "The delivery time", body: "What counts is when the provider submitted the evidence the client went on to accept: the first accepted submission, not the moment the client got round to approving it." },
      { title: "Review time is excluded", body: "Any time the client had evidence in review, for earlier attempts at this milestone or for the milestones it depends on, is taken out. A slow review never costs the provider." },
      { title: "Fix time counts", body: "Days spent fixing evidence the client rejected do count. Putting it right is part of delivering." },
      { title: "Excused days come off first", body: "Days excused by a dated extension both parties signed, or by a mediator's ruling, are subtracted before the grace days." },
      { title: "Whole days", body: "Lateness is rounded to the nearest whole day, so 12 hours or more counts as a day." },
    ], { claimStatus: "product" }),

    h2("h4", "A worked example: two days late"),
    text("p4", `M5 is worth $2,000.00. Its accepted evidence arrives two days after the due time, with no review time in between and no extension. With the example terms the first day is grace and the second costs 0.5%: a deduction of $10.00. M5 releases $1,990.00. The 2.5% platform fee on that is $49.75, so the provider receives $1,940.25, and the $10.00 goes back to the client.

Three days late would cost 1%, or $20.00. The deduction grows by 0.5% a day until it reaches the 10% cap after 21 days late, $200.00 on this milestone, and stops there.`, { claimStatus: "illustrative" }),
    flow("mf1", 200_000, 9950, 50, "Illustrative: a $2,000 milestone delivered two days late under the example terms. The deduction goes back to the client; the fee applies only to the release.", { claimStatus: "illustrative" }),
    text("p5", `Where the deduction goes depends on the rail. On Rail A1 it is simply never captured: it stays in the PayPal authorization and is voided with the remainder. On Rail B, where the money was captured at funding, the deduction is refunded to the client. Either way the fee is charged only on what is released, so a late milestone earns PaySettle slightly less, not more.`, { claimStatus: "product" }),

    h2("h5", "A worked example: finishing early"),
    text("p6", `Take M6, also $2,000.00, in a $10,000 contract whose client funded a $100.00 bonus pool with the tranche. Its accepted evidence arrives three days early. Three days at 0.25% is 0.75%, under the 1% cap, so the bonus is $15.00, paid from the pool. M6 releases $2,015.00; the fee on that is $50.38, and the provider receives $1,964.62.

One day early would earn nothing, because the minimum is two days. Five days early reaches the cap: a bonus of $20.00. Whatever the pool has not paid out goes back to the client when the tranche closes, and the pool can never go below zero.`, { claimStatus: "illustrative" }),
    callout("c1", "info", "Why the client funds the pool up front", "A bonus that was promised but not funded is a bonus somebody has to chase. Funding the pool with the tranche means the money for every possible bonus is already held in PayPal, released under the same rules as the rest of the milestone.", { claimStatus: "product" }),

    h2("h6", "Guardrails in the policy gate"),
    text("p7", `Two rules check the terms before anyone can sign. **Rule R11** limits the late deduction: the cap may be at most 20% of a milestone, there must be at least one grace day, and the cap must be reached by day 27 of the hold, the day the tranche settles, so the deduction is known before then. **Rule R12** limits the bonus: the pool may be at most 15% of the contract, it must be large enough to pay the largest bonus the terms could produce, and it is funded with the tranche.

Both rules show up in the contract room like the other policy rules, with a plain message saying what to change. A provider who thinks a deduction is wrong can dispute that milestone like any other, and the sealed-bid and mediator process applies.`, { claimStatus: "product" }),

    faq("f1", [
      { q: "Can a client switch these terms on alone?", a: "No. A term is part of the contract only when both parties sign the revision that contains it. Changing it later voids the signatures again." },
      { q: "Does a slow client review make the provider late?", a: "No. Review time is taken out of the count. Only the time the provider had the work, including any time spent fixing rejected evidence, counts." },
      { q: "What if the deadline slipped for a good reason?", a: "Both parties can sign a dated extension, and a mediator can rule days excused. Excused days come off before the grace days." },
      { q: "Is the bonus taxed or reported differently?", a: "PaySettle treats it as part of the milestone release, shown as its own line on the receipt. How it is treated for tax depends on where you are; we do not give tax advice." },
    ], { claimStatus: "product" }),
    cta("cta1", "Try the deadline terms on a sandbox contract", "Open the Judge Playground", "/playground", "Scenario S7 funds a contract with a bonus pool, delivers one milestone two days late and another three days early, and reconciles to zero drift."),
  ],
};
