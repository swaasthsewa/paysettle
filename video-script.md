# PaySettle — demo video script

Target 2:45, hard limit 2:50. No music. No PayPal logos beyond what appears in the product. Screen recording at
1360 × 900 or larger, browser zoom 100%.

**Before recording**

1. `npm run demo:reset` (clean seeded data, so Priya Shah has a milestone with a **Review proof** button).
2. Set `AI_API_KEY` if you want the AI verifier and AI mediation proposal to show model output. Without a key those
   panels say “AI unavailable” and the rule checks still show; use the alternative voice-over lines marked *(no key)*.
3. Leave PayPal credentials empty for the mock rail, or set Sandbox credentials. The script uses **Fast mock** either way.
4. Open the landing page once and close the judge tour if it opens (the **×** button, “End the tour”).
5. If a persona asks to accept the platform terms on first sign-in, tick the box, press **Accept and continue**, and cut
   it out.

| # | Time | Screen and what to click | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:06 | Landing page `/`. Scroll down past the hero to the **Contract compiler** section. | “‘The website should be fast and modern.’ It is in countless contracts, and nobody can check it.” |
| 2 | 0:06–0:20 | Hold on the dark card: the struck-out sentence, the red **Rejected** chip and its reason, the **Suggested rewrite**, and **Clause in the blueprint both sides sign: Lighthouse mobile performance ≥ 85 on staging**. Slowly point at each line. | “PaySettle is a contract compiler. It rejects that line: taste words, nothing to measure. It suggests a measurable rewrite, and the signed clause names its proof: a Lighthouse report, mobile score 85 or more.” |
| 3 | 0:20–0:27 | Scroll back up, click **Try the live demo**. On the sign-in page click **Dan Okafor**. In the menu click **Contracts**, then **Demand planning sprint**. | “Here is a client, Dan, negotiating a contract.” |
| 4 | 0:27–0:42 | In the contract room, point at **Policy gate: All rules pass**. Click **Prune M02 …**. Show the red “… to fix” chip, “Shares must add up to exactly 100%”, and the greyed **Sign revision** button. Click **Restore M02 …**; the gate returns to **All rules pass**. | “Every change goes through a policy gate. Remove a paying milestone and the shares no longer add to a hundred percent, so nobody can sign. Put it back, and the gate clears.” |
| 5 | 0:42–0:50 | Open the menu, click **Switch person**, then **Hackathon Judge**. The Judge Playground opens. Under **Mode** make sure **Fast mock** is selected. | “Judges get a playground that runs whole contracts on a simulated PayPal rail.” |
| 6 | 0:50–1:12 | On the **S1 · Happy path — Web MVP $6,000** card click **Start**, then **Run all**. Let the steps tick. Scroll down to the four views: **Q1 · Client view**, **Q2 · Provider view**, **Q3 · Ledger and reconciliation**, **Q4 · Wire log**. Point at the capture lines in Q4 and the RELEASE rows in Q3. | “Scenario one: clone the Web MVP blueprint, both sign, the client funds a PayPal authorization, and three milestones are released as three partial captures from one hold. Four views of the same contract: client, provider, the double-entry ledger, and every PayPal call.” |
| 7 | 1:12–1:22 | **Switch person** → **Priya Shah**. On her home, click **Review proof** on a milestone. | “Now the client's side of one release.” |
| 8 | 1:22–1:40 | On the milestone page, point at **What the contract requires**, the **Checks** list, and the **AI verifier** panel with the chip **AI advice — you decide**. Tick **I inspected the evidence …**. Click **Approve and release $…**. Show the header line “released to …”. | “Priya sees what the clause requires, the automatic checks, and the AI verifier's report, which only advises. She confirms she inspected the evidence and approves. That approval, and nothing else, triggers the partial capture.” *(no key: “…the automatic checks; with an AI key, Claude's report appears here as advice.”)* |
| 9 | 1:40–1:46 | **Switch person** → **Hackathon Judge**. On the **S5 · Chaos — 503, duplicate webhook, ledger drift** card click **Start**. | “Payments have to survive failure.” |
| 10 | 1:46–2:12 | Click **Run all**. Point at the steps as they tick: **Inject a PayPal 503 on the next release**, **Approve → release retried, one payout**, **Post the same webhook twice**, **Insert one cent of ledger drift**, **Run reconciliation → breaker**. Show Q4 (the failed call, then the retry) and Q3 (the reconciliation chip and the exception). | “We inject a PayPal 503 on a release. The retry reuses the same idempotency key, so there is one payout. The same webhook arrives twice; the second is ignored. Then one cent of drift goes into the ledger. Three-way reconciliation, ledger against PayPal against the contract, finds it and trips the circuit breaker.” |
| 11 | 2:12–2:32 | On the **S4 · Dispute — about $2,000 milestone** card click **Start**, then **Run all**. Point at **Client opens a dispute**, **Sealed bids: client 30%, provider 85%**, **Seal the vault**, **AI mediation proposal (advisory)**, **Mediator verdict 75/25**, **Two legs execute**. | “A dispute freezes only its milestone. Sealed bids miss, the evidence vault seals, the AI proposes a split, and a human mediator decides: seventy-five, twenty-five, paid out as a refund and a capture.” |
| 12 | 2:32–2:45 | End card (static slide or the landing page **Contract compiler** section, with text over it): “PaySettle — a contract compiler for staged service work. Sandbox only. Also: agent-to-agent contracting over MCP, with a person approving every money move. [public repo URL] · [hosted demo URL]” | “PaySettle: vague wording in, checkable clauses out, and every PayPal capture tied to the evidence its clause names. Agents can contract over MCP too, but a person approves every money move. Sandbox only.” |

Every click above was checked against the components on 11 Nov 2026: landing section `#compiler`
(`src/components/site/landing/chapters.tsx`), sign-in persona buttons (`/login`), the **Switch person** menu item
(`src/lib/menu.ts`), **Prune / Restore M02** and the **Policy gate** section in the contract room, the playground's
**Fast mock**, **Start**, **Run all**, scenario titles, step labels and Q1–Q4 headings
(`src/components/playground/Playground.tsx`, `src/server/playground/scenarios.ts`), and the milestone page's
**AI verifier**, **I inspected the evidence** checkbox and **Approve and release** button
(`src/components/evidence/*`). The same paths run in the end-to-end tests (`e2e/negotiation.spec.ts`,
`e2e/playground.spec.ts`, `e2e/client-journey.spec.ts`).
