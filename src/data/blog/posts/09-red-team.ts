/* Sample post 9 (trust). Source: the business plan's red-team review (the 24 risks, our answers
 * and statuses, and the extra risks we track) — the same text the /trust page publishes. Product facts checked in code:
 * src/server/control/providers.ts (trust tiers: 90 days, < 1% with ≥ 10 releases, ≤ 1.5%, 5 clean in a row, four-eyes),
 * src/lib/policy.ts (risk formula), src/server/ai/index.ts (P3), src/lib/rails/paypal.ts (A2 sandbox only),
 * src/server/control/compliance.ts (non-custodial export). No severity scores or plan percentages are repeated here. */
import { callout, cta, faq, h2, table, text, tldr, type SeedPost } from "../build";

export const POST_RED_TEAM: SeedPost = {
  slug: "our-red-team-asked-24-hard-questions",
  title: "Our own red team asked 24 hard questions",
  dek: "We had our business plan attacked before we built the product. The 24 risks it raised, what we changed because of them, what we chose not to build, and where you can check our answers.",
  topic: "trust",
  blocks: [
    tldr("t1", [
      "We asked a red team to attack our 24-month business plan. It raised 24 risks across execution, market, finance, regulation and competition.",
      "Most answers are design choices you can see in the product: AI that cannot move money, no blockchain, no data sales, a published risk formula.",
      "A few are still open, each with an action. All 24, with their status, are on our trust page.",
    ], { claimStatus: "product" }),

    h2("h1", "Why we published it"),
    text("p1", `Business plans are optimistic by design. Ours had a 24-month arc that ended with AI-driven dispute resolution, parametric insurance and a governance DAO, and an early draft promised specific percentage improvements in resolution time, legal costs and penalties. Read cold, that is a list of things that could go wrong.

So before building we asked for the cold reading. The red team went through the plan block by block and scored each risk. We wrote an answer to every one, and then changed the product where the answer was not good enough. Publishing the list is part of the answer: a trust claim that cannot be checked is just marketing. The full list lives on our [trust page](/trust); this post is the short version.`, { claimStatus: "product" }),

    h2("h2", "What changed because of it"),
    table("tb1", ["Risk raised", "Our answer", "Status"], [
      ["The AI promises in the plan may not hold.", "AI is advisory only and every money move needs a person's signature. We removed the percentages and publish only measured results, labelled as such.", "Open, action listed"],
      ["Selling anonymised data trends risks re-identification.", "We dropped that revenue line. Analytics are aggregates with personal data stripped and small cohorts hidden. We do not sell data.", "Answered in product"],
      ["Competitors will copy the AI.", "The AI is not the moat. Rail orchestration around PayPal's hold windows, blueprints with checkable proof, dispute data and the mediator network are.", "Answered in plan"],
      ["Insurance commissions would bias risk scores.", "The risk score is a published formula with no link to revenue, and there are no commissions.", "Answered in product"],
      ["A claim of better contract outcomes is unproven.", "We will not make it. We measure dispute rate, time to release and on-time delivery instead.", "Open, action listed"],
      ["Blockchain integration is costly and risky.", "No blockchain. Canonical JSON hashes, signed contracts and a hash-chained audit log give tamper evidence without wallets or gas.", "Answered in product"],
      ["DAO gamification attracts the wrong people.", "No DAO and no tokens. Reputation is a trust tier earned from real outcomes.", "Answered in product"],
      ["Regulatory sandboxes invite scrutiny.", "Non-custodial by design: PayPal holds the money, the custodial rail runs in the sandbox only, and a signed export shows the pass-through.", "Answered in product"],
    ], { claimStatus: "product" }),

    h2("h3", "Answers you can check in the app"),
    text("p2", `**The risk score is a formula, not a black box.** It weighs the contract's value band, the share of protective clauses pruned, the share of custom clauses, the provider's trust tier and how front-loaded the payments are, and the weights are published. Nothing in it knows what PaySettle earns.

**Reputation is earned, not bought.** Trust tiers come from the last 90 days of real outcomes. A provider with a dispute ratio under 1% across at least 10 releases is Platinum; up to 1.5% is Standard; above 1.5% is Probation, and new contracts pause. Five clean milestones in a row lift Probation back to Standard, and every tier change needs a second person to approve it.

**AI cannot move money.** The AI module writes only its own call log. Releases need a client's signed approval or a mediator's signed verdict, and an AI agent's "approve" tool only asks a person to approve.

**The money is not ours to hold.** On the production rails the client's money sits in a PayPal hold. The one rail that pays out through a PaySettle account is refused outside the sandbox.`, { claimStatus: "product" }),
    callout("c1", "info", "Status words mean something", "\"Answered in product\" means you can see the answer working in the app today. \"Answered in plan\" means it is a decision about what we will and will not do, not code. \"Open\" means we agree with the risk and have listed the action that closes it.", { claimStatus: "product" }),

    h2("h4", "What we chose not to build"),
    text("p3", `Several risks disappeared the moment we said no to the feature behind them. These are choices, and we made them on purpose:

- **No blockchain, tokens or DAO.** The audit chain, canonical hashes and four-eyes controls give us tamper evidence and shared governance without chain risk or speculation.
- **No insurance products and no commissions.** If insurance ever appears, it will be a referral to a licensed insurer, with no commission that could bend a score.
- **No data sales.** Not anonymised, not aggregated, not trends.
- **No government or consortium segment.** Our first customers are freelancers and small service businesses with projects of a few thousand dollars; procurement-heavy segments are out of scope.
- **No enterprise sales team in year one.** The product is self-serve. People step in only for contracts with a risk score of 75 or more and for disputes that reach a mediator.`, { claimStatus: "product" }),

    h2("h5", "The risks the red team did not list"),
    text("p4", `A review of a business plan sees the plan. Building the product showed us more, and we track those too:

- **PayPal's own limits.** An authorization has an honor period and a validity window, delayed disbursement needs partner approval, and we reauthorize only once. Rail A1 is the default, and the mock rail stays visible as a fallback.
- **Reused or generated photos.** Location data in a photo is easy to fake, and one photo can be reused across contracts. We are adding a duplicate-photo check that compares files across contracts without revealing whose they are.
- **Chargebacks after release.** A buyer can approve a milestone and later dispute the card payment with PayPal. We are wiring the signed approval and the evidence into PayPal's dispute process so the record arrives without anyone retyping it.
- **Collusion.** A client and provider who are the same person could move money in a circle. PayPal's identity checks cover a lot; we are adding a warning when both sides sign from the same network.
- **Mediator bias.** Conflict-of-interest checks exist today. We are adding random second reviews of closed verdicts, party ratings and seniority rules for co-signing.
- **Privacy against write-once storage.** Evidence is kept unchanged, which conflicts with a right to erasure. The plan is to keep hashes and encrypt personal fields with per-person keys that can be destroyed. It is documented and not built yet.`, { claimStatus: "product" }),

    h2("h6", "How to check us"),
    text("p5", `The [trust page](/trust) links each answer to the screen that shows it working. The [security page](/security) explains the audit chain, reconciliation and four-eyes controls. And the Judge Playground lets you try to break things yourself on sandbox money: spoofed photos, a PayPal outage mid-release, a cent of ledger drift, an agent that tries to do too much.

If you find an answer that does not hold up, tell us. A risk list is only useful if it keeps changing.`, { claimStatus: "product" }),

    faq("f1", [
      { q: "Where can I see all 24 risks?", a: "On the trust page, each with our answer, its status and a link to where you can check it." },
      { q: "Why not publish the severity scores?", a: "They are a reviewer's judgement of the plan, not measurements of the product, so this post concentrates on what we did about each risk." },
      { q: "Will the statuses change?", a: "Yes. When an action ships, its risk moves to answered in product, and the page says so." },
    ], { claimStatus: "product" }),
    cta("cta1", "Read every answer", "Open the trust page", "/trust", "All 24 risks from the red team, the extra ones we track, and what we do not do."),
  ],
};
