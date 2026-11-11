# Simulation: a 21-day India tour booked as a 4-week milestone contract

> **This is a simulation on sandbox data.** Every person, hotel, airline, car company, booking reference and document in this run is fictional or sample data. The money moved on PaySettle's **mock PayPal rail**: no PayPal credentials were set, so no real or PayPal-Sandbox money moved. The screens, the ledger and the money logic are the same ones the app uses on PayPal Sandbox; only the rail adapter differs. Each screenshot has a red "SIMULATION · sandbox data · mock PayPal rail" badge in the corner.

- Branch: `sim-travel-india` (from `feature-rolling-contracts`, which includes change orders F2.13 and continuation contracts F2.14).
- Run date: 11 Nov 2026 (real clock). Contract clock: day 0 to day 22 (11 Nov to 3 Dec 2026, virtual).
- AI: **live**. `AI_API_KEY` was set; the model was `claude-sonnet-5-5` through the app's own AI gateway.
- 124 screenshots in [`shots/`](shots/) (JPEG, quality 80, 1440 px wide). Sample evidence files are in [`sample-evidence/`](sample-evidence/). The Playwright scripts that drove the run are in [`scripts/`](scripts/). The contract PDF exported at the end is [`contract-final-sample.pdf`](contract-final-sample.pdf).

## 1. Summary

Priya Shah (client) books a 21-day private tour of India for two adults through Meera Iyer (provider, acting as the travel agency). The booking work has to be finished within 4 weeks of signing. The contract started from the **Travel and custom tour** blueprint (`UC_TRAVEL_TOUR`). The AI drafter turned Priya's brief into 8 milestones. Both sides then negotiated it through the UI over 14 revisions.

What happened, in brief:

| Step | Result in this run |
|---|---|
| Drafting | AI draft from the brief: 8 milestones in 23 s. The criteria compiler flagged three vague phrases from the brief ("good hotels", "comfortable car", "knowledgeable guides") and proposed measurable rewrites. Priya accepted them by replacing two milestones. |
| Negotiation | 14 revisions. The policy gate went red three times (shares at 88%, 70% and 107%) and green each time it was fixed. Priya's first signature (revision 13) was voided by Meera's later change, and both then signed revision 14 (hash `c37687af…`). Risk score 38, below the Ops review threshold of 75. |
| Funding | $9,600 held in tranche 1. The platform fee is 2.50% per release, taken from the provider's side and never up front. |
| Weeks 1–4 | 9 milestones approved and released or passed, 1 milestone disputed and settled by a mediator. |
| Change orders | CO 1 added a Udaipur suite upgrade (+$480, funded as tranche 2). CO 2 dropped the Udaipur day trip (−$384, returned to Priya). |
| Deadline extension | A 4-day extension on the flights milestone, signed by both sides. It cancelled what would otherwise have been a late-delivery deduction. |
| Conflict | The Jaipur voucher showed a downgraded room. The AI verifier flagged it, Priya asked for a fix, the fix fell short, and Priya disputed **only that milestone** (C02, $2,880 frozen). The car milestone C01 was released during the dispute. |
| Mediation | Tier 1: three sealed rounds, no convergence. Tier 2: sealed vault. Tier 3: the AI proposal advised 93.4% to the provider. Mediator Aiko Tanaka signed **80/20**, co-signed by Sofia Alvarez. Settlement ran as two keyed legs: a $576 refund and a $2,304 release. |
| Finance and Ops | Both tranches of this contract **MATCHED** in three-way reconciliation. The ledger invariants held (✓). The audit chain verified **intact** (554 entries). |

Outcome figures (from the ledger rows of this contract):

| | Amount |
|---|---|
| Held in PayPal by the client (2 tranches) | $10,080.00 |
| Released to the provider, gross | $9,120.00 |
| Platform fees (8 FEE rows) | $228.00 |
| Received by the provider, net | $8,892.00 |
| Returned to the client (2 VOID rows: CO 2 $384 + verdict $576) | $960.00 |
| Still held at the end | $0.00 |

## 2. How the run was done (method and honesty notes)

- **Set-up.** Local Postgres 16, `npm ci`, `npm run db:reset` (schema, guards and the full demo seed), `npx next build --webpack`, then `APP_URL=http://localhost:3100 PAYSETTLE_ENV=sandbox npx next start -p 3100`. `/api/health` returned `{"database":"ok","paypal":"mock","env":"sandbox"}` and `/api/ai/status` returned `{"available":true}`.
- **Driving.** Every state change went through the real UI with Playwright at 1440×900, signed in as each persona through the demo picker. The mediators Jules Moreau, Aiko Tanaka and Sofia Alvarez signed in by email with the demo password. Two things were read through signed-in API routes instead of a page: the criteria compiler (`POST /api/ai/compile`, which has no button in the room; see gaps) and the contract PDF.
- **Restart.** A first attempt reached week 1 and then hit a wall: the deadline-extension panel only appears on contracts that have deadline terms, and terms cannot be added after the contract locks. The database was reset and the run started again from the brief, with a late-delivery term on the flights milestone. Everything in this report comes from the second run. That is why the AI draft (8 milestones) differs from the first attempt's draft (9).
- **Time.** Contracts read a virtual clock (`workspaceNow`, an hour offset kept in `sim_sessions`). The app only supports moving it for Judge Playground sessions: `/api/sandbox/time-travel` takes a `simId`. No supported way exists for a normal contract. So in this sandbox database I inserted **one bridge row**:
  ```sql
  insert into sim_sessions (id, judge_id, scenario, workspace_id, clock_offset_hours, mode, faults)
  values ('sim_travelindia','u_admin','MANUAL travel-india clock bridge','<workspace id>',0,'MOCK','[]');
  insert into sim_progress (sim_id, steps, bag) values ('sim_travelindia','{}','{}');
  ```
  After that the clock was only moved by `POST /api/sandbox/time-travel {simId, hours}`, signed in as Alex Chen (admin). That route also runs the hold watchdog, the review timers and the dispute timers, writes `sandbox.time_travel` to the audit chain, and caps the total at 720 h. I did not add the workspace to `sim_workspaces`, so the contract stays visible on the personas' normal screens. The route answered HTTP 400 `SCENARIO_UNKNOWN` each time: it moves the clock and runs the timers, then fails while building the playground state view for an unknown scenario. I checked the offset in the database after every jump ([`scripts/travel-log.txt`](scripts/travel-log.txt)). Twelve jumps took the contract from day 0 to day 22.
- **No money, ledger, signature, revision or audit row was edited by hand.** Only the bridge rows above were inserted. Every other number in this report comes from read-only queries.
- **AI verifier and PDFs.** The verifier reads the text of `.txt` files and the pixels of images; it does not read PDF text. Each sample PDF was therefore uploaded with a plain-text copy, labelled as such. The rule checks count the PDFs; the AI reads the text copies.

## 3. The contract

### As signed (revision 14, hash `c37687af`, both signatures, total $9,600, tranche 1, days 1–25)

| Code | Milestone | Kind | Day | Share | Amount | Proof required (summary) |
|---|---|---|---|---|---|---|
| M01 | Itinerary and traveller details confirmed | Gate | 1 | — | — | 1 PDF day-by-day itinerary; traveller signature on passport names. Criteria: 20 named nights by city, every leg with a date and a supplier, passport numbers and expiry dates. |
| M02 | Domestic flights and train ticketed | Pay | 4 (+4 extension → 8) | 25% | $2,400 | 3 e-ticket PDFs and the train-ticket PDF; 3 booking-reference links; PNR oracle. Criteria: issued, not on hold; names match passports; routes and dates; AC chair class, 2 confirmed seats. Late term: −1%/day after 1 grace day, cap 10%. |
| C02 | Hotel vouchers paid in full (named hotels and room categories) | Pay | 7 | 30% | $2,880 | 7 voucher PDFs. Criteria: all 20 nights; 4-star or heritage with a guest rating of at least 4.2/5; **Jaipur: Heritage Deluxe Room at Sample Heritage Haveli**; rooms of at least 25 m² with breakfast; zero balance due and cancellation terms stated. |
| C01 | Private car with driver and all transfers booked | Pay | 10 | 12% | $1,152 | 1 supplier PDF. Criteria: every road leg; AC sedan or larger (mid-size SUV class) for 2 adults plus 2 large suitcases; up to 10 h/day; driver name and phone 48 h ahead; pick-ups at least 60 min after landing; every airport and station transfer. |
| M05 | Guides and monument entry tickets booked | Pay | 13 | 10% | $960 | Guide confirmations and ticket PDFs. Criteria: English-speaking guides in Delhi, Agra, Jaipur and Varanasi; tickets for each named monument. |
| C03 | Jaipur cooking class booked | Pay | 14 | 3% | $288 | Confirmation PDF. Criteria: a 3-hour vegetarian class for 2 on trip day 7, with the school, time and address. |
| C04 | Udaipur day trip to Kumbhalgarh and Ranakpur booked | Pay | 14 | 4% | $384 | Confirmation PDF with car, guide and entry tickets. |
| M06 | Insurance and e-visa checks | Gate | 15 | — | — | Insurance certificate and e-visa approvals. |
| M07 | Travel pack delivered | Pay | 21 | 10% | $960 | Travel-pack PDF and the traveller's acknowledgement. |
| M08 | Booking close-out | Pay | 25 | 6% | $576 | Final statement with no supplier balances; traveller close-out signature. |

Clauses: the six system clauses (hold, hold window, release-final, evidence and review, scoped disputes, no side payments); the blueprint clauses (supplier changes, services not delivered, traveller duties, costs not included); and three custom clauses:
- **Cancellation and refunds**: a held amount is returned less any non-refundable supplier cost shown on a voucher.
- **Response time**: the agency answers within 24 h on working days; the client reviews within 48 h.
- **Inclusions and exclusions**: 20 nights with breakfast, car and driver, 3 economy flights, the AC chair-car train, tickets, guides and 21-day insurance are included. International flights, visa fees, unlisted meals, tips and personal costs are excluded.

The deadline term is a late deduction of 1% a day after 1 grace day, capped at 10%, on M02 only.

### Final contract after the change orders (revision 16, total $9,696)

| Change | Effect |
|---|---|
| CO 1 (revision 15), proposed by Meera and signed by both | Adds **C05 Udaipur upgrade: lake-view suite voucher (3 nights)**, day 12, **$480**, funded as **tranche 2**. |
| CO 2 (revision 16), proposed by Priya and signed by both | Removes **C04 Udaipur day trip** (**−$384**). The amount went back to Priya's PayPal from tranche 1 (VOID ledger row, refund `ret_ab39…`, COMPLETED). |

Final milestones: M01, M02, C02, C01, M05, C03, M06, M07, M08 (tranche 1, $9,216 after the return) and C05 (tranche 2, $480).

## 4. Timeline and weekly updates

Contract days come from the contract clock; day 0 is 11 Nov 2026.

| Day | What happened |
|---|---|
| 0 | AI draft, compiler, negotiation over r1 to r14, both sign r14, Priya funds $9,600. |
| 1 | M01 itinerary submitted by Meera and approved by Priya (gate). |
| 3 | Meera asks for 4 extra days on M02; Priya signs. |
| 8 | M02 flights and train submitted and approved → $2,340 net to Meera. |
| 9 | CO 1 (Udaipur upgrade +$480) signed by both; tranche 2 funded. |
| 10 | CO 2 (drop the day trip −$384) signed by both; $384 back to Priya. |
| 15 | C02 hotel vouchers submitted; the AI verifier flags the Jaipur downgrade; Priya requests a fix. |
| 16 | Fix attempt 2 is still a downgrade for 2 nights; Priya opens a dispute on C02 only. Out-of-sequence permission signed for C01; C01 released during the dispute. Tier 1: three sealed rounds, no agreement. Tier 2: both sides add to the vault and lock. The case seals and is offered to mediator Jules Moreau. |
| 18 | Jules's 2-hour offer expired during my 48 h time jump. The case went to the Ops lead queue, and Olivia Grant offered it to Aiko Tanaka. Aiko accepted and signed 80/20; Sofia Alvarez co-signed; both settlement legs ran. |
| 19 | C05 upgrade voucher approved (tranche 2) → $468 net. |
| 20 | M05 guides and tickets approved, then C03 cooking class, then M06 insurance and e-visa gate passed. |
| 21 | M07 travel pack approved. |
| 22 | M08 close-out approved. Both tranches closed with $0 held. |

**Week 1 (days 1–7).** *Meera* uploaded the day-by-day itinerary, confirmed the passport-name signature with the checkbox, and later asked for a 4-day extension on the flights because the sample airline released the fare class late. *Priya* saw the rule checks pass, while the AI verifier suggested a fix (it wanted calendar dates, room types and passport numbers in the text). She approved the gate anyway, because the decision is hers, and she signed the extension. *Notified:* evidence-submitted and approved notices (outbox), plus the 48-hour review countdown on the milestone page.

**Week 2 (days 8–14).** *Meera* uploaded 4 ticket PDFs, their text copies and 3 sample booking-reference links. *Priya* saw COUNT_PDF and COUNT_LINK ok, a simulated PNR oracle ("nothing to check in the note"), and AI advice that rated the "issued" status as met at 55%. She approved; $2,340 net (fee $60) reached Meera's payouts page and the ledger at once. The deadline panel recorded "4 days late, 4 excused; no deduction". Then came the two change orders, each with its diff, money impact, policy gate and two signatures, and the funding of tranche 2. *Notified:* 8 CHANGE_ORDER notices for the two parties.

**Week 3 (days 15–21).** *Meera* uploaded the 7 hotel vouchers. The rule checks passed (7 of 7 PDFs, hashes), but the **AI verifier flagged the Jaipur voucher**: "Not met, 95%: Standard Room of 18 m², downgraded from the required Heritage Deluxe Room". *Priya* requested a fix. Meera's second attempt still had 2 Standard nights, so Priya opened a dispute on C02 alone. The rest of the contract kept moving: C01 (car) was released during the dispute after a signed out-of-sequence permission. The tier-by-tier detail is in section 5.8. *Notified:* FIX_REQUESTED, OVERRIDE_REQUESTED and OVERRIDE_GRANTED notices; the dispute-room activity log.

**Week 4 (days 19–22).** These milestones ran slightly ahead of schedule, from late in week 3. The screenshot names say "week4". Approved in order: C05 upgrade (tranche 2), M05 guides and tickets, C03 cooking class, the M06 insurance and e-visa gate, the M07 travel pack, and the M08 close-out. *Notified:* approvals, plus 2 WARN hold notices from the day-22 watchdog on Meera's payouts page.

## 5. Step by step, with screenshots

### 5.1 Drafting (AI drafter A1 and criteria compiler A2)

**Client (Priya).** The brief on the new-contract form, then the room with the AI draft ("AI draft used (8 milestones). Review every step: the drafter only proposes.").

![brief](shots/01-draft-client-brief.jpg)
![ai draft](shots/01-draft-client-ai-draft-room.jpg)

The criteria compiler (A2) was run on phrases from the brief and on the draft's car and hotel criteria. It flagged the three taste phrases as **vague** and proposed measurable rewrites, such as an "air-conditioned sedan or larger with seating for 2 adults plus luggage" and a "guest rating of at least 4.0/5". The draft's own criteria passed. The AI drafter had already written most criteria in measurable form.

![compiler](shots/01-draft-client-criteria-compiler.jpg)

Priya accepted the rewrites by pruning M03 and M04 and appending C02 and C01 with stricter, measurable criteria (see 5.2).

### 5.2 Negotiation (append and prune, policy gate, revisions, signatures)

Revision log for this run ([`scripts/negotiation-log-final.json`](scripts/negotiation-log-final.json)):

| Rev | Who | Change | Payout allocation | Gate |
|---|---|---|---|---|
| 1 | — | AI draft | 100% | green |
| 2 | Priya | prune M04 (car) | 88% | **red** R01 |
| 3 | Priya | append C01 car, measurable, 12% | 100% | green |
| 4 | Priya | prune M03 (hotels) | 70% | **red** R01 |
| 5 | Priya | append C02 hotels, measurable, 30% | 100% | green |
| 6–7 | Priya | append C03 cooking class 3% and C04 day trip 4% | 107% | **red** R01 |
| 8–9 | Priya | custom clauses: cancellation and refunds; response time | 107% | red |
| 10 | Priya | deadline term: late deduction on M02 | 107% | red |
| 11 | Meera | move M07 travel pack to day 21 | 107% | red |
| 12 | Meera | change the M08 close-out share from 13% to 6% | 100% | green |
| 13 | Meera | custom clause: inclusions and exclusions | 100% | green; **Priya signs r13** |
| 14 | Meera | move M08 to day 25, which **voids Priya's r13 signature** | 100% | green; **both sign r14** → Locked |

Client view:

![prune red](shots/02-negotiation-client-prune-m04-gate-red.jpg)
![gate red](shots/02-negotiation-client-policy-gate-red.jpg)
![append measurable car](shots/02-negotiation-client-append-measurable-car.jpg)
![gate green](shots/02-negotiation-client-policy-gate-green.jpg)
![over 100](shots/02-negotiation-client-appends-over-100-red.jpg)
![red 107](shots/02-negotiation-client-policy-gate-red-over-100.jpg)
![deadline terms](shots/02-negotiation-client-deadline-terms.jpg)
![signed r13](shots/02-negotiation-client-signed.jpg)
![voided](shots/02-negotiation-client-signature-voided.jpg)
![locked client](shots/02-negotiation-client-both-signed-locked.jpg)

Provider view:

![provider before](shots/02-negotiation-provider-room-before-edits.jpg)
![provider 100](shots/02-negotiation-provider-milestones-100.jpg)
![provider green](shots/02-negotiation-provider-policy-gate-green.jpg)
![provider sees signature](shots/02-negotiation-provider-sees-client-signature.jpg)
![provider locked](shots/02-negotiation-provider-both-signed-locked.jpg)

**Ops review.** The risk score was **38**: contract value 20, provider tier 8, front-loading 6, custom clauses 4, protective clauses switched off 0. That is below 75, so the contract locked at once and did not join Olivia's clearance queue. The queue shows three other seeded contracts with scores of 77–79.

![risk](shots/02-negotiation-client-risk-score-38.jpg)
![ops clearance](shots/02-negotiation-ops-clearance-queue.jpg)

### 5.3 Funding

The fund page says, in plain words: "PayPal authorizes $9,600.00 on your account now — it is reserved, not paid. Each milestone is captured only after you approve it; anything not approved is released back to you." It also explains: "The fee is charged on each release, never up front, and is deducted from the provider's side." The per-milestone table shows the 2.50% fee and the net amount for each milestone.

![tranche planned](shots/03-funding-client-tranche-planned.jpg)
![fund page](shots/03-funding-client-fund-page.jpg)
![held](shots/03-funding-client-held.jpg)
![tranche held](shots/03-funding-client-tranche-held.jpg)
![provider sees held](shots/03-funding-provider-sees-held.jpg)
![provider home](shots/03-funding-provider-home.jpg)
![client home](shots/03-funding-client-home.jpg)

### 5.4 Week 1: itinerary gate and the deadline extension

Provider:

![submit itinerary](shots/04-week1-provider-submit-itinerary.jpg)
![submitted](shots/04-week1-provider-itinerary-submitted.jpg)
![ask extension](shots/04-week1-provider-ask-extension-form.jpg)
![extension signed provider](shots/04-week1-provider-extension-signed.jpg)

Client:

![review itinerary](shots/04-week1-client-review-itinerary.jpg)
![approved gate](shots/04-week1-client-approved-itinerary-gate.jpg)
![extension to sign](shots/04-week1-client-extension-to-sign.jpg)
![extension signed](shots/04-week1-client-extension-signed.jpg)

The extension record reads "Signed by Meera Iyer and Priya Shah … due date now 2026-11-19", with both signature prefixes.

### 5.5 Week 2: flights, checks, AI advice, approval, release, payout and ledger

Provider:

![submit flights](shots/05-week2-provider-submit-flights.jpg)
![in review](shots/05-week2-provider-flights-in-review.jpg)
![released](shots/05-week2-provider-flights-released.jpg)
![payout](shots/05-week2-provider-payout.jpg)

Client:

![home review due](shots/05-week2-client-home-review-due.jpg)
![checks and ai](shots/05-week2-client-review-flights-checks-ai.jpg)
![approve and release](shots/05-week2-client-approve-flights-released.jpg)

Finance (Farah):

![ledger](shots/05-week2-finance-ledger.jpg)
![ledger this contract](shots/05-week2-finance-ledger-this-contract.jpg)

### 5.6 Change orders (F2.13)

CO 1 adds the Udaipur upgrade: the money goes up, and a new tranche is funded.

![propose upgrade](shots/06-change-order-1-provider-propose-upgrade.jpg)
![provider signed waiting](shots/06-change-order-1-provider-signed-waiting.jpg)
![client review money](shots/06-change-order-1-client-review-money-impact.jpg)
![in force](shots/06-change-order-1-client-in-force.jpg)
![fund tranche 2](shots/06-change-order-1-client-fund-tranche-2.jpg)
![tranche 2 held](shots/06-change-order-1-client-tranche-2-held.jpg)

CO 2 drops the day trip: the money goes down, and $384 returns to the client.

![propose drop](shots/06-change-order-2-client-propose-drop-day-trip.jpg)
![provider review money down](shots/06-change-order-2-provider-review-money-down.jpg)
![provider in force](shots/06-change-order-2-provider-in-force.jpg)
![tranches after return](shots/06-change-order-2-client-tranches-after-return.jpg)
![revision history](shots/06-change-orders-client-revision-history.jpg)

The review panels read "Contract total $9,600.00 → $10,080.00. +$480.00 to fund as tranche 2" and "Contract total $10,080.00 → $9,696.00. $384.00 goes back to the client's PayPal from tranche 1". Each showed "All pre-signature rules pass" and a fresh risk score (48, then 38).

### 5.7 Week 3: the failing milestone, remediation, and work continuing during the dispute

Provider:

![submit vouchers](shots/07-week3-provider-submit-hotel-vouchers.jpg)
![sees fix request](shots/07-week3-provider-sees-fix-request.jpg)
![resubmit](shots/07-week3-provider-resubmit-vouchers.jpg)
![asks out of sequence](shots/07-week3-provider-asks-out-of-sequence-start.jpg)
![submit car](shots/07-week3-provider-submit-car.jpg)
![payout during dispute](shots/07-week3-provider-payout-car-during-dispute.jpg)

Client:

![ai flags jaipur](shots/07-week3-client-review-vouchers-ai-flags-jaipur.jpg)
![requested fix](shots/07-week3-client-requested-fix.jpg)
![attempt 2](shots/07-week3-client-review-attempt-2.jpg)
![oos request](shots/07-week3-client-out-of-sequence-request.jpg)
![oos signed](shots/07-week3-client-out-of-sequence-signed.jpg)
![review car](shots/07-week3-client-review-car-during-dispute.jpg)
![car released](shots/07-week3-client-car-released-during-dispute.jpg)

### 5.8 Dispute and mediation (Tier 1 → Tier 2 → Tier 3 → settlement)

Opening the dispute froze only C02's $2,880. The dispute room's "Where the money is" table shows the other milestones as Paid, Locked or In progress.

![open form](shots/08-dispute-client-open-form.jpg)
![client tier1](shots/08-dispute-client-room-tier1.jpg)
![provider tier1](shots/08-dispute-provider-room-tier1.jpg)
![only c02 frozen](shots/08-dispute-provider-contract-only-c02-frozen.jpg)

**Tier 1, sealed offers** (the share of $2,880 going to the provider). Priya offered 40%, 50% and 55%; Meera offered 90%, 85% and 80%. The offers never came within 5 points of each other, so after three rounds the case moved on.

![client sealing](shots/08-tier1-client-sealing-offer.jpg)
![provider sealing](shots/08-tier1-provider-sealing-offer.jpg)
![client no converge](shots/08-tier1-client-offers-did-not-converge.jpg)
![provider no converge](shots/08-tier1-provider-offers-did-not-converge.jpg)

**Tier 2, sealed evidence vault** (write-once and hashed). Priya added her note on the contracted room; Meera added the hotel's sold-out letter (sample). Both locked their sides.

![client vault](shots/09-tier2-client-adds-to-vault.jpg)
![provider vault](shots/09-tier2-provider-adds-to-vault.jpg)
![client locked](shots/09-tier2-client-vault-locked.jpg)
![provider locked](shots/09-tier2-provider-vault-locked.jpg)

**Tier 3, mediator.** The brief named Marcus Bell. The router **excluded him**: he already has an open case between Priya Shah and Meera Iyer ("Field service scheduling app"), and the conflict rule removes anyone with a case involving either party in the last 180 days. His queue shows that case.

![marcus queue](shots/10-tier3-marcus-case-queue-not-routed.jpg)

The router offered the sealed case to **Jules Moreau** (travel domain). The offer is open for 2 hours, and my 48 h time jump let it expire. The case then went to the **Ops lead queue**, where Olivia Grant offered it to **Aiko Tanaka**, the remaining eligible travel mediator.

![jules queue](shots/10-tier3-mediator-case-queue.jpg)
![workbench](shots/10-tier3-mediator-workbench.jpg)
![ops reassign](shots/10-tier3-ops-lead-queue-reassign.jpg)
![ops offered](shots/10-tier3-ops-offered-again.jpg)

**AI mediation proposal (A4), shown as advice only:** "Advice — not a decision. 93.40% to the provider would be $2,689.92. Confidence 62%." It reasoned from the milestone's dispute rule: the nightly difference (about $190) is refunded when the room is not rebooked.

![ai proposal](shots/10-tier3-mediator-ai-proposal-advisory.jpg)

**Verdict.** Aiko signed **80% to the provider ($2,304) and 20% to the client ($576)**, fault on the provider, contract resumes, root cause "Quality defect in the work". She gave written findings that depart from the AI: the agency did not rebook at another property as the Supplier changes clause asks, and the traveller lost the contracted room size and the specific heritage room. Aiko is on probation (her first 5 verdicts), so a second mediator had to co-sign. Lena Park was refused by the app because she is in the same firm as Aiko. **Sofia Alvarez** (SENIOR, a different firm, no conflicts) co-signed.

![verdict form](shots/10-tier3-mediator-verdict-form-80-20.jpg)
![verdict signed](shots/10-tier3-mediator-verdict-signed-settled.jpg)
![cosigner queue](shots/10-tier3-cosigner-queue.jpg)
![cosigner workbench](shots/10-tier3-cosigner-workbench.jpg)
![after cosign](shots/10-tier3-mediator-after-cosign-settled.jpg)
![resolved queue](shots/10-tier3-mediator-resolved-queue.jpg)

**Settlement as two keyed legs.** Leg 1 refunded $576 to Priya (refund `ret_52f8…`, idem key `341d24f4-…`). Leg 2 released $2,304 to Meera (release `MOCKCAP-A6C7…`, idem key `69d0f4ee-…`; fee $57.60, net $2,246.40). The mediation fee of $25 was charged to the provider; it is recorded for Finance and not taken from the held amount. The mediator fees ($40 for the probation verdict, $25 for the co-signature) are paid by PaySettle from its own fee income.

![client settlement](shots/10-settlement-client-view.jpg)
![provider settlement](shots/10-settlement-provider-view.jpg)
![client c02](shots/10-settlement-client-milestone-c02.jpg)
![provider payouts](shots/10-settlement-provider-payouts.jpg)

### 5.9 Week 4: the remaining milestones

![submit upgrade](shots/11-week4-provider-submit-udaipur-upgrade.jpg)
![approve upgrade](shots/11-week4-client-approve-udaipur-upgrade-tranche2.jpg)
![submit guides](shots/11-week4-provider-submit-guides-monuments.jpg)
![guides ai](shots/11-week4-client-review-guides-ai.jpg)
![approve guides](shots/11-week4-client-approve-guides-monuments.jpg)
![approve cooking](shots/11-week4-client-approve-cooking-class.jpg)
![submit insurance](shots/11-week4-provider-submit-insurance-evisa.jpg)
![insurance gate](shots/11-week4-client-approve-insurance-gate.jpg)
![submit pack](shots/11-week4-provider-submit-travel-pack.jpg)
![approve pack](shots/11-week4-client-approve-travel-pack.jpg)
![submit close-out](shots/11-week4-provider-submit-close-out.jpg)
![approve close-out](shots/11-week4-client-approve-close-out.jpg)

End state:

![final client](shots/12-final-client-contract.jpg)
![final provider](shots/12-final-provider-contract.jpg)
![final payouts](shots/12-final-provider-payouts.jpg)
![receipts](shots/12-final-client-receipts.jpg)
![timeline](shots/12-final-client-contract-timeline.jpg)

### 5.10 Finance, Admin and Ops

**Farah Ali, reconciliation.** Both tranches of this contract show **Matched** across the signed contract, the ledger and the simulated PayPal rail, with a $0.00 difference. The run as a whole reports "Drift" because of one seeded demo fixture ("Inventory dashboard", `ws_ctl_w9_t1`). That fixture is in the demo data on purpose to show the circuit breaker, and it is not part of this contract.

![recon matched](shots/13-finance-recon-this-contract-matched.jpg)
![recon run](shots/13-finance-recon-run.jpg)
![recon tranche 2](shots/13-finance-recon-this-contract-tranche-2.jpg)
![ledger](shots/13-finance-ledger-this-contract.jpg)
![fees](shots/13-finance-fees.jpg)
![finance home](shots/13-finance-home.jpg)

The ledger filtered to this contract shows 20 entries and "✓ 2 tranche invariants": tranche 1 held $9,600 = released $8,640 + returned $960; tranche 2 held $480 = released $480.

**Alex Chen, audit chain.** "Verify chain" returned **Intact (554 entries)**. 227 of those entries were written during this run.

![audit](shots/14-admin-audit-chain-verified.jpg)

**Olivia Grant, Ops home, hold radar and provider health.**

![ops home](shots/14-ops-home.jpg)
![radar](shots/14-ops-radar.jpg)
![provider health](shots/14-ops-provider-health.jpg)

**Trust-tier effect (visible).** Provider health lists Meera Iyer as *Standard*: 38 releases and 2 disputes in 90 days, a dispute ratio of 5.13%. "Rule says: Probation (dispute ratio 5.13% is over 1.5%)" appears under *Suggested tier changes*. A person still has to propose and confirm the change; nothing changed automatically. This run's dispute is one of those two disputes. The tier also feeds the risk score: "provider trust tier: standard 0.5" was worth 8 of the 38 points.

![provider home tier](shots/14-provider-home-trust-tier.jpg)
![client home](shots/14-client-home-final.jpg)

### 5.11 Notifications and receipts

The app wrote these notices during the run (counted from the outbox tables `evidence_notifications` and `money_notices`, read-only):

| Kind | Count |
|---|---|
| EVIDENCE_SUBMITTED | 11 |
| APPROVED | 9 |
| CHANGE_ORDER | 8 |
| FIX_REQUESTED | 1 |
| OVERRIDE_REQUESTED / OVERRIDE_GRANTED | 1 / 1 |
| MILESTONE_OPEN | 1 |
| WARN (hold watchdog, day 22) | 2 |

Money notices appear on the provider's payouts page under "Hold notices" (see `12-final-provider-payouts`). Evidence notices have no inbox page in this build; see the gaps. Priya's receipts page is in `12-final-client-receipts`.

## 6. Feature coverage

| Feature | Where shown | Screenshot(s) |
|---|---|---|
| Blueprint start (UC_TRAVEL_TOUR) | 5.1 | `01-draft-client-brief` |
| A1 AI drafter from a brief | 5.1 | `01-draft-client-ai-draft-room` |
| A2 criteria compiler (vague → measurable) | 5.1 (through the API; no UI button) | `01-draft-client-criteria-compiler` |
| F2.04 append and prune | 5.2 | `02-negotiation-client-prune-m04-gate-red`, `…append-measurable-car` |
| F2.05 policy gate red → green | 5.2 | `…policy-gate-red`, `…policy-gate-green`, `…red-over-100` |
| F2.06 revisions | 5.2, 5.6 | `06-change-orders-client-revision-history` |
| F2.10 signatures void on change; both sign the same hash | 5.2 | `…client-signed`, `…signature-voided`, `…both-signed-locked` |
| Risk score and Ops clearance threshold (75) | 5.2 | `…risk-score-38`, `…ops-clearance-queue` |
| Deadline terms (late deduction) | 5.2 | `02-negotiation-client-deadline-terms` |
| Funding, hold explained in plain words, fee | 5.3 | `03-funding-client-fund-page` |
| Evidence upload, hashing, spec checklist | 5.4–5.9 | `04-week1-provider-submit-itinerary` |
| Rule checks (signals) and PNR oracle | 5.5 | `05-week2-client-review-flights-checks-ai` |
| A3 AI verifier (advice only) | 5.4, 5.5, 5.7, 5.9 | `07-week3-client-review-vouchers-ai-flags-jaipur` |
| Signed approval → partial release | 5.5 | `05-week2-client-approve-flights-released` |
| Provider payouts and ledger | 5.5, 5.10 | `05-week2-provider-payout`, `13-finance-ledger-this-contract` |
| Deadline extension signed by both | 5.4 | `04-week1-client-extension-signed` |
| F2.13 change order, money up (new tranche) | 5.6 | `06-change-order-1-*` |
| F2.13 change order, money down (return) | 5.6 | `06-change-order-2-*` |
| Remediation (request a fix) | 5.7 | `07-week3-client-requested-fix` |
| Out-of-sequence start (signed permission) | 5.7 | `07-week3-client-out-of-sequence-*` |
| Release during a dispute on another milestone | 5.7 | `07-week3-client-car-released-during-dispute` |
| Scoped dispute (one milestone frozen) | 5.8 | `08-dispute-provider-contract-only-c02-frozen` |
| Tier 1 sealed offers | 5.8 | `08-tier1-*` |
| Tier 2 sealed vault | 5.8 | `09-tier2-*` |
| Mediator routing, conflict exclusion, offer expiry, Ops lead queue | 5.8 | `10-tier3-marcus-case-queue-not-routed`, `10-tier3-ops-*` |
| A4 AI mediation proposal (advice only) | 5.8 | `10-tier3-mediator-ai-proposal-advisory` |
| Signed verdict and co-signature (probation rule, firm rule) | 5.8 | `10-tier3-mediator-verdict-*`, `10-tier3-cosigner-*` |
| Two-leg settlement with idempotency keys | 5.8 | `10-settlement-client-view` |
| Three-way reconciliation | 5.10 | `13-finance-recon-this-contract-matched` |
| Fee schedule | 5.10 | `13-finance-fees` |
| Audit chain verification | 5.10 | `14-admin-audit-chain-verified` |
| Ops hold radar and provider health | 5.10 | `14-ops-radar`, `14-ops-provider-health` |
| Trust tier effect | 5.10 | `14-ops-provider-health` |
| Notifications | 5.11 | counts only; `12-final-provider-payouts` (hold notices) |
| Receipts, timeline, contract PDF | 5.9 | `12-final-client-receipts`, `12-final-client-contract-timeline`, `contract-final-sample.pdf` |
| F2.14 continuation contracts | not exercised: a one-off booking project has no next period | — |

## 7. Benefits seen in this run

**For the client (Priya).**
- Money sat in her own PayPal authorization and moved one milestone at a time, only after her signed approval or a signed verdict.
- The dispute froze **one** milestone ($2,880, 29.7% of the contract). Every other milestone carried on. The car milestone was released during the dispute.
- Outcome: of $10,080 authorized, $9,120 was captured and **$960 came back** ($384 from the dropped day trip and $576 from the verdict). She paid no mediation fee.
- She saw the AI's reading of each evidence package next to the rule checks, and made each decision herself.

**For the provider (Meera).**
- Paid per milestone: 8 releases, $8,892 net.
- Measured payout time on the mock rail, from the client's signed approval to the release marked completed: **19–59 ms** across 9 approvals. On PayPal Sandbox the capture is an HTTP round trip, so expect seconds rather than milliseconds; that was not measured here.
- No chasing: every request, extension, change order and permission went through the app with signatures, and the 48-hour review clock was shown on each milestone.
- The mediator awarded her 80% of the disputed milestone. The AI had proposed 93.4%; the outcome was decided by people.

**For the platform.**
- Fee income measured from the ledger FEE rows: **8 rows, $228.00** (2.50% of $9,120 released). Returned money carries no fee.

## 8. Platform costs and unit economics

### Measured (from this run's database)

| Item | Value |
|---|---|
| AI calls (`ai_calls`, created since the run started) | **15 calls**, 51,935 input and 20,608 output tokens, **$0.4649** at the configured $3 / $15 per million tokens |
| — A1 draft | 2 calls (1 returned not-ok, 1 used), 24,724 in / 7,740 out, $0.1903, about 23 s each |
| — A2 compile | 1 call, 1,245 in / 769 out, $0.0153 |
| — A3 verify | 11 calls, 22,346 in / 10,558 out, $0.2254 |
| — A4 mediate | 1 call, 3,620 in / 1,541 out, $0.0340 |
| PayPal webhooks received | **0** (the mock rail sends none) |
| Rail transactions (reconciliation plane C) | **11** (9 on tranche 1, 2 on tranche 2), plus 2 funding approvals through the mock PayPal return link |
| Releases / refunds | 10 release rows (8 with money, 2 gates at $0) and 2 refund rows, each with a unique idempotency key |
| Mediator fees owed by the platform (`mediator_fees`) | **$65.00** ($40 probation verdict + $25 co-signature) |
| Mediation fee charged to the provider (`dispute_fees`) | $25.00, recorded for Finance and not in the ledger |
| Audit entries written | 227 |

### Assumed

- **PayPal processing fees.** PayPal's US fee page could not be reached from this sandbox (`www.paypal.com` is outside the network allow-list), so this is an **assumption**: 3.49% + $0.49 per commercial transaction for PayPal Checkout in the US. On the $9,120 captured in 8 captures, that is 3.49% × $9,120 + 8 × $0.49 = **$322.21**. With rail A1 (payee routing), the provider is the payee, so this cost normally falls on the provider's PayPal account rather than on PaySettle. Both cases are shown below.
- **Hosting.** Render Starter web service at $7/month plus Render Postgres Basic-256mb at $6/month, so **$13/month** (assumed list prices). Pro-rated at an assumed 100 contracts a month, that is **$0.13 per contract**; at 10 contracts a month it is $1.30.
- **Mediator time.** The app models it as the flat fees above, which are measured.

### Per-contract unit economics (this contract)

| | PayPal fee borne by the provider (A1) | If PaySettle absorbed the PayPal fee |
|---|---|---|
| Fee income (ledger FEE rows) | +$228.00 | +$228.00 |
| AI (measured) | −$0.46 | −$0.46 |
| Mediator fees (measured) | −$65.00 | −$65.00 |
| Hosting (assumed, 100/month) | −$0.13 | −$0.13 |
| PayPal processing (assumed) | $0.00 | −$322.21 |
| **Net per contract** | **+$162.41** | **−$159.80** |

The $25 mediation fee recorded against the provider is not counted as income above, because it is not in the ledger. A contract with no dispute would avoid the $65 in mediator fees and most of the AI cost, for a net of about +$227.

## 9. Gaps and bugs found (not fixed in this run)

1. **No time machine for normal contracts.** `/api/sandbox/time-travel` only takes a playground `simId`. *Workaround:* the single bridge row described in section 2. Even then the route answers HTTP 400 `SCENARIO_UNKNOWN` after it has moved the clock and run the timers, because it then builds a playground state view.
2. **Criteria compiler has no UI in the negotiation room.** `/api/ai/compile` is documented as "lint milestone criteria live from the contract editor", but no page calls it; only the landing-page demo uses the rules. *Workaround:* called the API while signed in and rendered the result (`01-draft-client-criteria-compiler`).
3. **A milestone's criteria cannot be edited in the room.** Accepting a rewrite means prune and append, which renames the milestone (M04 → C01) and counts it as custom.
4. **The deadline-extension panel only exists on contracts with deadline terms**, and terms cannot be added after the contract locks. The server function `requestExtension` does not need terms; only the page hides the panel. *Workaround:* restarted the run with a late term on M02.
5. **The AI verifier cannot read PDFs.** It only reads plain text and images. *Workaround:* uploaded labelled text copies of each sample PDF.
6. **The AI verifier contradicts the spec checklist on non-file proof.** When the provider confirms a signature or link with the checkbox, the checklist says OK, but the AI summary says "Missing: SIGNATURE × 1 … 0 attached" (M01) and "Missing: LINK × 3" (M02).
7. **Duplicate AI criterion row.** The AI verifier sometimes adds an extra row with a reworded criterion, marked "Unclear 0% none" (M01 and C02 attempt 2).
8. **The PNR oracle ignores links.** It only reads "PNR: XXXX" in the note; three booking-reference links gave "nothing to check".
9. **Misleading late-delivery copy.** For milestones that the late term does not cover (C03, M05, C05), the payouts page says "N days late; inside the grace days, so nothing is deducted". The real reason is that the term does not apply to them.
10. **Mixed clocks on one screen.** Stage deadlines and due dates use the contract clock (for example 27 Nov), while signatures, the dispute activity log, ledger dates and release dates use the real clock (11 Nov).
11. **Mediator offer window and time jumps.** A 2-hour offer expired inside a 48-hour jump. The Ops lead queue then said "No mediator is eligible (10 considered and excluded)" while also offering Aiko Tanaka in the assign list, and Jules Moreau saw the case in his "Open — free of conflicts" lane. These messages disagree. Jules was also the router's first choice even though his profile says "on leave this fortnight".
12. **Marcus Bell could not take the case.** This is by design: the 180-day conflict rule excluded him because of his open case with the same two parties. Lena Park could not co-sign either, also by design: she is in the same firm as Aiko.
13. **No notifications inbox.** The sidebar icon map points to `/notifications`, which returns 404. Evidence notices are written to `evidence_notifications` but no page shows them; money notices do show on the payouts page.
14. **The mediator workbench lists a removed milestone as appended.** "Changes from the blueprint" shows C04 as "appended (0.00%, day 14)", although change order 2 removed it.
15. **Seeded drift in the demo data.** The ledger page shows "1 ✗" and reconciliation reports "Drift", both from the "Inventory dashboard" fixture. A judge may read this as a problem with this contract; it is not.
16. **The mock rail keeps its records in memory.** A server restart after funding would leave reconciliation without plane-C data for older tranches; several seeded tranches show "Unavailable" for this reason. This run did not restart the server after funding.
17. **One of the two drafting AI calls returned not-ok.** The app recorded both calls and used the successful draft.

No app code was changed in this run.
