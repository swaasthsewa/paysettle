/* Sample post 1 (explainer). PaySettle facts from src/lib/policy.ts (RAIL_CAP_DAYS, trancheOf, watchdogPlan,
 * R02/R10), src/server/money/index.ts (watchdog actions, day-27 settlement, single reauthorization),
 * src/lib/rails/paypal.ts (rails A1/A2/B), src/server/control/fees.ts (250 bps). PayPal facts cite developer.paypal.com. */
import { callout, cta, faq, flow, h2, steps, table, text, tldr, tranches, type SeedPost } from "../build";
import { PP_AUTH_CAPTURE, PP_DELAYED_DISBURSEMENT, PP_HONOR_PERIOD } from "../sources";

export const POST_DAY_28: SeedPost = {
  slug: "why-escrow-breaks-at-day-28",
  title: "Why escrow breaks at day 28 — and how tranches fix it",
  dek: "PayPal holds money for weeks, not months. What happens to a long job when the hold runs out, and how PaySettle plans work in hold windows that close on time.",
  topic: "explainer",
  blocks: [
    tldr("t1", [
      "A PayPal authorization is valid for 29 days, and delayed disbursement pays the seller automatically after 28 days. A single hold cannot cover a two-month job.",
      "PaySettle plans every contract as tranches: hold windows of at most 26 days on Rail A1 and 25 days on Rail B, each funded just before its work starts.",
      "A watchdog acts on days 3, 22, 25 and 27 of every hold, so money is not left sitting in a hold that is about to lapse.",
      "Amounts are integer cents, and the 2.5% fee is charged only on what is released.",
    ], { sources: [PP_AUTH_CAPTURE, PP_DELAYED_DISBURSEMENT], claimStatus: "product" }),

    h2("h1", "The problem with one long hold"),
    text("p1", `Escrow sounds simple. The client pays in, the money waits, and the provider is paid when the work is done. The waiting is the hard part, because the money has to wait somewhere, and every place money can wait has rules about how long.

With PayPal, a hold is an **authorization**: an amount reserved on the buyer's funding source that the platform captures later, in one go or in parts. PayPal recommends capturing within a three-day honor period, and the authorization itself is valid for 29 days. The other route is to capture at once and pay the seller later with **delayed disbursement**, and that has its own clock: funds are disbursed to the seller automatically after 28 days.`, { sources: [PP_AUTH_CAPTURE, PP_HONOR_PERIOD, PP_DELAYED_DISBURSEMENT], claimStatus: "research" }),
    text("p2", `So a 60-day renovation held in one piece has a cliff in the middle. Either the authorization lapses and the client has to fund again from scratch, mid-project, with half the work done and no money reserved for it. Or the funds move to the provider on day 28 whether or not anyone approved the work. Neither is escrow. The first leaves the provider exposed; the second leaves the client exposed.

Most of the disputes we designed PaySettle around start in exactly this gap: work in progress, money in motion, and nobody sure who holds what.`, { sources: [PP_DELAYED_DISBURSEMENT] }),
    callout("c1", "warn", "Day 28 is a property of the rail", "No amount of careful screen design fixes a hold that expires. The contract has to be planned around the window from the start, which is why PaySettle checks it before anyone signs.", { sources: [PP_DELAYED_DISBURSEMENT] }),

    h2("h2", "Tranches: one hold per window"),
    text("p3", `PaySettle never asks PayPal to hold money for longer than a window it can close. A contract's milestones are laid out by day. The planner walks them in day order and starts a new **tranche** whenever the next milestone would fall outside the current window. Each tranche is funded as its own PayPal hold, just before work on it starts, and holds only the milestones inside it.

The same function plans the tranches on the contract screen and checks them in the policy gate. Rule R02 refuses any milestone that falls outside its tranche's window, and rule R10 asks for between 3 and 50 milestones in every tranche. A contract that cannot be held cannot be signed, so the problem shows up while the two parties are still negotiating, not on day 28.`, { claimStatus: "product" }),
    table("tb1", ["Rail", "How the hold works", "Window PaySettle plans"], [
      ["A1", "PayPal authorization. Each approved milestone is captured from it; the unused remainder is voided.", "Up to 26 days"],
      ["B", "Captured at funding, then paid to the provider with delayed disbursement when a milestone is approved. Behind a switch until the live PayPal test is done.", "Up to 25 days"],
      ["A2", "Authorization, then a payout to the provider. Sandbox only; refused in production.", "Up to 26 days"],
    ], { sources: [PP_AUTH_CAPTURE, PP_DELAYED_DISBURSEMENT], claimStatus: "product" }),
    text("p4", `Why 26 and 25 days rather than 29 and 28? Margin. Settlement runs on day 27 of every hold: before the authorization ends on day 29 on Rail A, and before delayed disbursement would pay out by itself on day 28 on Rail B. The window a contract may plan is shorter than the window PayPal offers, so the last step of a tranche never races the rail.`, { sources: [PP_AUTH_CAPTURE, PP_DELAYED_DISBURSEMENT], claimStatus: "product" }),
    tranches("tl1", 60, "A1", "A 60-day job on Rail A1 splits into three holds. Computed live with the same tranche function the contract room uses.", { claimStatus: "product" }),

    h2("h3", "What the watchdog does inside each hold"),
    steps("s1", "Days counted from the moment a hold begins", [
      { title: "Day 3 — reauthorize if needed (Rail A)", body: "PayPal recommends capturing within the three-day honor period. If money is still held after it, the watchdog reauthorizes the remaining amount once, so later captures keep working. Rail B skips this step because its money was captured at funding." },
      { title: "Day 22 — warn", body: "Both parties get a notice with the amount still held and the date the tranche settles." },
      { title: "Day 25 — offer a rollover", body: "Either party can move the unfinished milestones into a new tranche. The client approves a new hold in PayPal; the old remainder is voided or refunded." },
      { title: "Day 27 — settle", body: "Approvals that are already signed are paid. Milestones that never started go back to the client. Work still under review or in dispute is returned too, and carried into a new tranche for the parties to fund again." },
    ], { sources: [PP_HONOR_PERIOD], claimStatus: "product" }),
    text("p5", `Settlement is deliberately conservative. On day 27 PaySettle starts no new payment on its own initiative: the only money that goes to the provider is money a client has already approved with a signature, or a mediator has already ruled on. Everything else goes back where it came from. The watchdog can return money; it can never decide to pay it.

You can watch this happen without waiting four weeks. In the Judge Playground the clock of a sandbox contract can be moved forward, so day 22 and day 25 arrive in seconds and the rollover runs while you watch.`, { claimStatus: "product" }),

    h2("h4", "Where the money is at each moment"),
    text("p6", `Take an $8,500 tranche with a milestone M2 worth 25% of it. When the client approves M2, $2,125.00 is captured. The 2.5% platform fee on that release is $53.12 (fees are rounded half to even on the cent), so the provider receives $2,071.88. The other $6,375.00 stays held in PayPal for the milestones still to come.`, { claimStatus: "illustrative" }),
    flow("mf1", 850_000, 2500, 0, "Illustrative: an $8,500 tranche after one 25% milestone is approved. Move the slider to see other splits.", { claimStatus: "illustrative" }),
    text("p7", `Three rules keep these numbers honest. Every amount is a whole number of cents, and every share is a whole number of basis points (10,000 is 100%), so nothing is lost to floating-point rounding. The fee is charged only on what is released; a refund or a voided remainder carries no fee. And every movement is written twice in a double-entry ledger, which is reconciled against PayPal's own records.`, { claimStatus: "product" }),

    h2("h5", "What this means for you"),
    text("p8", `**If you are the client**, you fund one window of work at a time, and money leaves the hold for the provider only on your signed approval or a mediator's signed verdict. If a project slips, the rollover offer arrives on day 25 with the exact amount, and you decide whether to fund the next hold.

**If you are the provider**, you can see that the money for the next weeks is reserved before you start them, and you know the date by which each approval has to happen. A window that cannot be held is caught before signing, not after you have bought materials.`, { claimStatus: "product" }),

    faq("f1", [
      { q: "Can a contract run longer than one hold?", a: "Yes. A long job is split into tranches and each is funded just before its work starts. The policy gate checks that every milestone fits its tranche's window and that each tranche has between 3 and 50 milestones." },
      { q: "What if work runs late inside a window?", a: "On day 25 the watchdog offers a rollover: unfinished milestones move to a new tranche that the client funds in PayPal. Milestones already released are not touched." },
      { q: "Does PaySettle hold the money itself?", a: "Not on the production rails. On Rail A1 and Rail B the money sits with PayPal. Rail A2, which pays out through a PaySettle account, runs in the sandbox only." },
      { q: "Why not ask the client to fund everything on day one?", a: "Because it would sit in a hold that expires before the work is done. Funding window by window keeps every held dollar inside a period PayPal can actually hold it." },
    ], { claimStatus: "product" }),
    cta("cta1", "Watch a hold window close in fast-forward", "Open the Judge Playground", "/playground", "Scenario S3 moves a sandbox contract to day 22 and day 25, then rolls the remainder into a new hold."),
  ],
};
