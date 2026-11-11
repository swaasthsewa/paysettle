/* Sample post 4 (explainer). PaySettle facts from src/server/disputes/rules.ts (DISPUTABLE_STATES, MAX_ROUNDS 3,
 * converge ≤ 500 bps → midpoint, sealBid SHA-256 commit, deadlines 48/96/144 h, fast track < 72 h → 24 h per tier,
 * COSIGN_ABOVE_CENTS $5,000, COI 180 days, splitDispute refund rounds half up, feeSplit, mediation fee default $25),
 * src/server/disputes/queries.ts (own bids only until settled), src/server/disputes/index.ts (AI proposal is advice,
 * commits stored with the verdict), src/lib/policy.ts converge(), src/lib/money (fee on release only). */
import { callout, cta, faq, flow, h2, steps, table, text, tldr, type SeedPost } from "../build";

export const POST_BLIND_BIDS: SeedPost = {
  slug: "blind-bids-settling-a-dispute-in-48-hours",
  title: "Blind bids: settling a dispute in 48 hours",
  dek: "When a milestone is disputed, both sides name the share they think is fair without seeing the other's number. Within five points, it settles. How the mechanism works, and why it rewards honest numbers.",
  topic: "explainer",
  blocks: [
    tldr("t1", [
      "A dispute freezes one milestone. The rest of the contract carries on.",
      "For the first 48 hours, each side places a sealed bid: the share of the milestone it thinks the provider should get. There are up to three rounds.",
      "If the provider's ask is no more than 5 points above the client's offer, the dispute settles at the midpoint. No mediator, no mediation fee.",
      "Otherwise an evidence vault stays open to 96 hours, and a mediator's signed verdict follows by 144 hours.",
    ], { claimStatus: "product" }),

    h2("h1", "Most disputes are about a number"),
    text("p1", `Ask the two people in a dispute what they want and the honest answer is usually a number. The work on a milestone was mostly done. The client thinks two features are missing; the provider thinks they are small. Neither is claiming it is all or nothing. They disagree on how much.

Ordinary negotiation makes this harder than it needs to be. Whoever names a figure first anchors the other side. Each side holds back its real number in case the other turns out to be more generous. Two reasonable people can spend a week circling a gap that is smaller than the cost of the week. PaySettle's first tier is designed to close that gap quickly, or to show quickly that it will not close.`),

    h2("h2", "How a blind bid works"),
    steps("s1", undefined, [
      { title: "One milestone freezes", body: "Either party opens a dispute on a milestone whose evidence is submitted, in remediation or escalated, with a reason and a short account. Only that milestone's amount is frozen in the hold." },
      { title: "Both sides bid, sealed", body: "Each party enters the share of the milestone that should go to the provider, in basis points. PaySettle stores each bid with a SHA-256 commitment over the value and a random nonce. Each side only ever sees its own bids." },
      { title: "The round is compared", body: "When both bids are in, the gap is the provider's ask minus the client's offer. If it is 5 points (500 basis points) or less, the dispute settles at the midpoint of the two." },
      { title: "Up to three rounds", body: "If the gap is wider, the next round opens and both sides can move. After three rounds without a meeting, when the 48 hours run out, or when either side chooses to skip ahead, the case moves to the evidence vault." },
    ], { claimStatus: "product" }),
    text("p2", `The midpoint rule is what makes an honest number the sensible one. If you shade your bid far from what you think is fair, you widen the gap and push the case toward a mediator, a fee and a longer wait. If you bid close to your real view and the other side does the same, you are done. And there is nothing to gain by going first, because nobody goes first: both numbers are sealed until both are in, and the other side's bids are shown only if the dispute settles at this tier.`, { claimStatus: "product" }),

    h2("h3", "A worked example"),
    text("p3", `A $3,000 milestone is disputed. In round one the client offers the provider 50% and the provider asks for 70%: a 20-point gap, so nothing settles. In round two the client offers 60% and the provider asks for 64%. The gap is 4 points, inside the limit, so the dispute settles at 62%.

The split is computed in integer cents. The refund to the client rounds half up, in the client's favour, and the release is the rest, so the two always add up to the frozen amount: $1,860.00 is released to the provider and $1,140.00 goes back to the client. The 2.5% platform fee applies only to the release, which makes it $46.50, so the provider receives $1,813.50. A settlement at Tier 1 carries no mediation fee.`, { claimStatus: "illustrative" }),
    flow("mf1", 300_000, 6200, 3800, "Illustrative: a $3,000 milestone settled at 62% for the provider. Move the slider to try other settlements; the refund carries no fee.", { claimStatus: "illustrative" }),
    callout("c1", "ok", "The rest of the contract keeps going", "A dispute on one milestone does not stop the others. Milestones that do not depend on the disputed one can still be delivered, reviewed and released while its amount waits.", { claimStatus: "product" }),

    h2("h4", "When the bids do not meet"),
    table("tb1", ["Tier", "Until", "What happens"], [
      ["1 · Sealed offers", "48 hours", "Up to three rounds of blind bids. Settles at the midpoint when the gap is 5 points or less."],
      ["2 · Evidence vault", "96 hours", "Both sides add rebuttals and files. The vault is then sealed with one hash over every evidence package and rebuttal."],
      ["3 · Mediator verdict", "144 hours", "A mediator who has had no case with either party in the last 180 days issues a signed verdict with findings and a root cause."],
    ], { claimStatus: "product" }),
    text("p4", `If less than 72 hours of the tranche's PayPal hold window remain when a dispute opens, it runs on a fast track: 24 hours per tier instead of 48, so the case can finish before the hold has to settle.

Two more rules apply at Tier 3. A verdict on more than $5,000 needs a second, different mediator to co-sign it before any money moves. And a flat mediation fee applies: the party found at fault pays it, and shared fault splits it in half. The mediator can read an AI proposal with its reasons. It is stored as advice, and the verdict is the mediator's own.`, { claimStatus: "product" }),

    h2("h5", "What makes this fair"),
    text("p5", `- **No anchoring.** Neither side can see the other's number while bidding, so nobody gets to set the frame.
- **A record that can be checked.** The commitments of the settling bids are written into the verdict record, and the verdict carries a hash over its own contents.
- **People decide.** At Tier 1 the two parties agree; at Tier 3 a person rules. AI can suggest a split to the mediator; it cannot place a bid, sign a verdict or move money.
- **Money moves on the record.** The two sealed bids at Tier 1, or the mediator's signed verdict at Tier 3, are what authorises the refund and the release. Nothing else can.`, { claimStatus: "product" }),

    faq("f1", [
      { q: "What is a basis point?", a: "One hundredth of a percent. 10,000 basis points is the whole milestone, so a bid of 6,200 means 62% to the provider." },
      { q: "Can I see the other side's bid?", a: "Not while you are bidding. Each side sees only its own bids. If the dispute settles at Tier 1, both bids are shown with the result." },
      { q: "What does a mediator cost?", a: "A flat fee set by Finance, charged only when a case reaches a verdict. The demo default is $25.00. A Tier 1 settlement has no mediation fee." },
      { q: "Can I skip the bids and go straight to a mediator?", a: "Yes. Either party can move the case to the evidence vault at any time during Tier 1." },
    ], { claimStatus: "product" }),
    cta("cta1", "Run a dispute from start to verdict", "Open the Judge Playground", "/playground", "Scenario S4 disputes a milestone of about $2,000 and takes it through bids, the vault and a verdict, with both money legs shown."),
  ],
};
