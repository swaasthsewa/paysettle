# Simulation: building PaySettle for a client, then maintaining it

> **This is a simulation on sandbox data.** It is not a real client engagement. Dan Okafor and Arjun Rao are the app's seeded
> demo personas; nobody paid anybody. Every screen below is the real PaySettle app (branch `feature-rolling-contracts`,
> production build on a local sandbox), driven through its UI with Playwright. Money moved on the **simulated PayPal rail
> (mock)** because no PayPal credentials were set; the screens, the ledger and the money logic are the same ones that run
> on PayPal Sandbox, only the PayPal calls are answered by the mock. The AI features were **live** (`AI_API_KEY` set; model
> `claude-sonnet-5-5`). Evidence files are generated samples and each one says so on its face.

## 1. Summary

The scenario is modelled on how PaySettle itself was built (the repository's `git log`, README, `docs/architecture.md`,
`RESULTS.md` and the modules in `src/server`: contracts, policy gate, rails and PayPal, ledger, evidence, disputes,
reconciliation, AI agents, MCP server, Judge Playground, role consoles).

* **Client:** Dan Okafor, a fintech founder. **Provider:** Arjun Rao's small team: a tech lead, two engineers, a designer
  and QA (the app has one provider account; the roles are named in the milestone notes).
* **Deal:** a web application plus Android and iOS apps: a 10-week build in three rolling periods (continuation contracts,
  F2.14), then 6 monthly maintenance periods. Nine contract periods in one chain.
* **Moving target, handled without a dispute:** one feature swapped (in-app chat → agent access over MCP with spend
  limits, $3,600 → $6,000), one feature dropped (offline mode, $2,400 returned), content and marketing work added in the
  last week (+$3,000, a new tranche the client funded), one deadline extension (Android build, day 20 → day 23), and two
  carry-overs of unfinished milestones from one period into the next (both by change order, so nothing was paid twice).
* **Outcome measured in the run:** 9 periods, 39 milestones approved with signed approvals (38 payment milestones and 1
  gate), **$109,000 paid for work, $24,000 returned to the client, $2,725 platform fee**,
  0 disputes, 0 mediator cases, every tranche of the chain MATCHED in three-way reconciliation, audit chain intact.
  Exact figures are in §6 and §8.

How time was simulated, and what was changed directly in the database, is in §9. Nothing in a money, ledger, signature,
revision or audit table was written directly.

## 2. The period chain

```
Build P1 (wk 1–3) ──continues in──▶ Build P2 (wk 4–7) ──▶ Build P3 (wk 8–10) ──▶ Maint. month 1 ──▶ month 2 ──▶ … ──▶ month 6
   $30,000 signed                     $40,000 signed         $30,000 signed         $4,000 each
   −$12,000 carried out (CO1)         +$2,400 swap (CO1)     +$3,000 content (CO1)
                                      −$2,400 drop (CO2)
                                      −$6,000 carried out (CO4)
   = $18,000 paid                     = $34,000 paid         = $33,000 paid         = $4,000 paid each
```

| # | Period | Virtual days | Milestones delivered (amount) | Moved out / removed | Signed total → final | Held | Released (gross) | Returned | End state |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Build P1, weeks 1–3 | 1–21 | M01 kickoff gate · M02 clickable design $3,600 · M03 data model and API on staging $4,800 · M04 core features on staging $6,000 · M05 quality pass $3,600 | chat, launch, offline mode, handover carried to P2 (CO1) | $30,000 → $18,000 | $30,000 | $18,000 | $12,000 | Locked, rev 10, tranche CLOSED |
| 2 | Build P2, weeks 4–7 | 1–25 | C01 evidence vault, disputes, mediator console $8,000 · C02 AI agents and reconciliation $8,000 · M01 agent access over MCP $6,000 (swapped in) · C03 Android internal testing $12,000 | offline mode dropped (CO2); launch and handover carried to P3 (CO4) | $40,000 → $34,000 | $46,000 | $34,000 | $12,000 | Locked, rev 16, 2 tranches CLOSED |
| 3 | Build P3, weeks 8–10 | 1–24 | C01 Judge Playground, MCP server, role consoles $9,000 · C02 iOS on TestFlight $9,000 · C03 store listings $6,000 · M01 production launch $3,600 · C04 landing page, blog posts, store screenshots $3,000 · M02 handover $2,400 | none | $30,000 → $33,000 | $33,000 | $33,000 | $0 | Locked, rev 10, 2 tranches CLOSED |
| 4–9 | Maintenance months 1–6 | 1–26 each | security patches $1,000 · bug-fix SLA $1,000 · uptime report ≥ 99.5% $1,000 · release note $1,000 | none | $4,000 each | $4,000 each | $4,000 each | $0 | Locked, tranche CLOSED |
| | **Chain** | | **39 approvals** | | **$109,000 final** | **$133,000** | **$109,000** | **$24,000** | 0 disputes |

Ledger check (from `ledger_entries`): HOLD $133,000 = RELEASE to provider $106,275 + FEE $2,725 + VOID (returned) $24,000.

"Virtual days" are the contract's own clock (§9). Period 1 ran 21 days, period 2 ran 25 days and period 3 ran 24 days:
70 days, 10 weeks. Period 2 was rolled into period 3 on its day 25, not day 28, because the PayPal hold window on its
tranche closes at day 26 (rule R02, `RAIL_CAP_DAYS` = 26); the watchdog had already warned on day 23 and offered a
rollover on day 25. The build weeks map to period days like this: weeks 1–3 = P1 days 1–21; weeks 4–6 = P2 days 1–21;
week 7 = P2 days 22–25 and P3 days 1–3; weeks 8–10 = P3 days 4–24.

![The client's contract list: every period of the chain with its period number](shots/chain-client-contracts-list.jpg)

![Chain view on period 4 (maintenance month 1): continues build period 3, continues in month 2](shots/chain-period-4-chain-view.jpg)

The chain panel on each of the nine periods, as the app printed it:

```
1: Period 1 continues in PaySettle build · period 2 (weeks 4–7) (period 2)
2: Period 2 continues PaySettle build: web, Android and iOS (period 1) · continues in PaySettle build · period 3 (weeks 8–10) (period 3)
3: Period 3 continues PaySettle build · period 2 (weeks 4–7) (period 2) · continues in PaySettle maintenance · month 1 (period 4)
4: Period 4 continues PaySettle build · period 3 (weeks 8–10) (period 3) · continues in PaySettle maintenance · month 2 (period 5)
5: Period 5 continues PaySettle maintenance · month 1 (period 4) · continues in PaySettle maintenance · month 3 (period 6)
6: Period 6 continues PaySettle maintenance · month 2 (period 5) · continues in PaySettle maintenance · month 4 (period 7)
7: Period 7 continues PaySettle maintenance · month 3 (period 6) · continues in PaySettle maintenance · month 5 (period 8)
8: Period 8 continues PaySettle maintenance · month 4 (period 7) · continues in PaySettle maintenance · month 6 (period 9)
9: Period 9 continues PaySettle maintenance · month 5 (period 8)
```

The chain view shows one step back and one step forward on each contract; the contract list shows every period with its
number (see §10, item 11).

## 3. Change orders and their money impact

All change orders went through the contract room's change-order form (F2.13): one party proposes, the other reviews a
plain-words diff with the money impact and the policy gate result, both sign the change order's hash, and it becomes the
next contract revision. Change orders are numbered per contract, so each contract starts again at CO1.

| Contract | CO | Week | Proposed by | What changed | Money impact (as the app stated it) | Policy gate / risk |
|---|---|---|---|---|---|---|
| Build P1 | CO1 | 3 | Dan (created by the continuation) | Removes C01 in-app chat, M06 launch, C02 offline mode, M07 handover from P1; they move into P2 | Total $30,000 → $18,000. **$12,000 goes back to the client's PayPal from tranche 1.** | all rules pass |
| Build P2 | CO1 | 5 | Dan | M01 "In-app chat between client and provider" → "Agent access over MCP with spend limits"; new proof (MCP session log + walkthrough) and criteria; $3,600 → $6,000 | Total $40,000 → $42,400. **$3,600 goes back from tranche 1; +$6,000 to fund as tranche 2**: "M01 moves from tranche 1 to tranche 2, because a PayPal hold cannot grow." | all rules pass, risk 30 |
| Build P2 | CO2 | 5 | Dan | Removes M03 "Offline mode for the mobile apps" | Total $42,400 → $40,000. **$2,400 goes back to the client's PayPal from tranche 1.** | all rules pass, risk 30 |
| Build P2 | CO3 | 6 | Arjun | C03 Android build due day 20 → day 23 (Play Console review took longer) | "No money moves: only the terms change." | all rules pass, risk 30 |
| Build P2 | CO4 | 7 | Arjun (created by the continuation) | Removes M02 launch and M04 handover; they move into P3 | Total $40,000 → $34,000. **$6,000 goes back from tranche 1.** | all rules pass |
| Build P3 | CO1 | 10 | Dan | Adds C04 "Landing page, launch blog posts and store screenshots", day 22, $3,000 | Total $30,000 → $33,000. **+$3,000 to fund as tranche 2 (C04)**, which Dan then funded through the normal PayPal approval flow. | all rules pass, risk 30 |

![Week 5: the provider reviews the client's swap (diff, money, policy gate, signatures)](shots/w05-provider-swap-chat-for-mcp-review.jpg)

![Week 5: dropping offline mode returns $2,400](shots/w05-provider-drop-offline-mode-review.jpg)

![Week 6: deadline extension, no money moves](shots/w06-client-android-deadline-extension-review.jpg)

![Week 10: content and marketing added as a new tranche](shots/w10-provider-add-content-marketing-review.jpg)

## 4. Weekly updates (build) and monthly updates (maintenance)

"Held / released / returned to date" are cumulative over the whole build: "held" is the total funded into PayPal holds so
far, not the balance at that moment. They come from the ledger (`HOLD`, `RELEASE` + `FEE`, `VOID` rows). Released amounts are gross (provider net + 2.5% platform fee).

### Week 1 — period 1, days 1–7: contract signed, funded, design delivered

* **Planned:** agree the backlog and access (M01 gate), clickable design for web, Android and iOS (M02, day 6).
* **What happened:** Dan created the contract from the **Web / SaaS MVP sprint** blueprint (UC_WEB_MVP) with a brief; the
  AI drafting agent adapted the blueprint text to the brief (revision 1: "Created from an AI draft"). Arjun appended two
  later features (in-app chat, offline mode) and re-balanced the shares; the policy gate re-ran on every edit (9
  revisions). Both signed revision 9; risk score 33 (below 75, so no Ops clearance: the contract locked at once). Dan
  funded tranche 1 ($30,000) through the PayPal approval flow (mock rail). The tech lead submitted the signed backlog
  (M01); Dan approved the gate. The designer delivered the prototype and screen list (M02); Dan approved and $3,510
  went to Arjun's PayPal ($90 fee).
* **Changed:** nothing after signing.
* **Money to date:** held $30,000 · released $3,600 · returned $0.
* **Who saw what:** Dan was notified of each evidence submission and saw the checks and the AI verifier's advice before
  deciding; Arjun was notified of each approval and saw the release on the milestone page and in payouts.

![Dan's new-contract form with the blueprint and brief](shots/w01-client-new-contract-form.jpg)
![Arjun's negotiation room: appended milestones, shares, policy gate](shots/w01-provider-negotiation-room.jpg)
![Dan reviews revision 9 before signing](shots/w01-client-review-before-signing.jpg)
![Dan funds tranche 1 through PayPal (mock rail)](shots/w01-client-fund-tranche-1.jpg)
![Same moment, two views: tranche held — client](shots/w01-client-contract-room-tranche-held.jpg)
![Same moment, two views: tranche held — provider](shots/w01-provider-contract-room-tranche-held.jpg)
![Arjun submits M02 evidence: files hashed, spec checklist](shots/w01-provider-submit-m02.jpg)
![Dan reviews M02: checks, AI verifier (advice), signed approval](shots/w01-client-review-m02.jpg)
![Released — client view](shots/w01-client-released-m02.jpg)
![Released — provider view](shots/w01-provider-sees-release-m02.jpg)

### Week 2 — period 1, days 8–14: data model and API on staging

* **Planned:** M03 data model and API on staging (day 11), with CI green on main.
* **Delivered:** engineers 1 and 2 and QA submitted a staging API link, a CI run log and the API list (samples). Dan
  approved on day 11; $4,680 to Arjun ($120 fee).
* **Changed:** nothing.
* **Money to date:** held $30,000 · released $8,400 · returned $0. The watchdog re-authorised the PayPal hold on day 6
  (PayPal authorisations are honoured for 3 days; `money.reauthorized` in the audit chain).
* **Who saw what:** same pattern: Dan got the evidence notice, Arjun got the approval notice.

![Arjun submits M03](shots/w02-provider-submit-m03.jpg)
![Dan reviews M03](shots/w02-client-review-m03.jpg)
![Arjun sees the M03 release](shots/w02-provider-sees-release-m03.jpg)

### Week 3 — period 1, days 15–21: core features and quality pass; roll into period 2

* **Planned:** M04 core features on staging (day 17), M05 quality pass (day 21). Launch, handover, chat and offline mode
  were in the contract but not due in this period.
* **Delivered:** M04 (walkthrough video, end-to-end report) approved on day 17, $5,850 net; M05 (Lighthouse,
  accessibility and dependency reports) approved on day 21, $3,510 net.
* **Changed:** on day 21 Dan started **period 2** from the continuation panel and ticked the four unstarted milestones
  to carry. The app created the period-2 draft and, on period 1, **change order 1** removing those four milestones.
  Period 2 could not be signed until both had signed that change order. Both signed; **$12,000 went back to Dan's PayPal
  from tranche 1**, so the carried milestones can be paid only once, in period 2.
* **Money to date:** held $30,000 (now fully settled) · released $18,000 · returned $12,000.
* **Who saw what:** Arjun was notified that period 1 continues into period 2 and of the change order to sign; both saw
  the carry-over change order's diff and its money line.

![Dan continues into period 2 and ticks what to carry](shots/w03-client-continue-into-period-2.jpg)
![The period-2 draft, linked to period 1](shots/w03-client-period-2-draft.jpg)
![Arjun reviews the carry-over change order on period 1](shots/w03-provider-carry-change-order-review.jpg)
![Period 1 after the carry: $12,000 returned, history entry](shots/w03-client-period-1-after-carry-change-order.jpg)
![Arjun's payouts after period 1](shots/w03-provider-payouts-period-1.jpg)

### Week 4 — period 2, days 1–7: negotiate, sign, fund; evidence vault and disputes module

* **Planned:** the carried milestones plus three new ones: evidence vault, scoped disputes and mediator console (day 7),
  AI agents and three-way reconciliation (day 12), Android build on the internal testing track (day 20).
* **What happened:** Arjun raised the total to $40,000, appended the three milestones and re-dated the carried ones
  (chat day 14, offline day 18, launch day 25, handover day 26). Both signed revision 12 (risk 30) and Dan funded
  $40,000. Engineer 1 and QA delivered the evidence vault and disputes module (C01); approved on day 7, $7,800 net.
* **Money to date:** held $70,000 · released $26,000 · returned $12,000.

![Arjun negotiates period 2](shots/w04-provider-period-2-negotiation.jpg)
![Dan reviews period 2 before signing](shots/w04-client-period-2-review.jpg)
![Period 2 funded](shots/w04-client-period-2-funded.jpg)
![Dan reviews C01](shots/w04-client-review-c01.jpg)
![Arjun sees the C01 release](shots/w04-provider-sees-release-c01.jpg)

### Week 5 — period 2, days 8–14: feature swapped, feature dropped

* **Planned:** AI agents and reconciliation (C02, day 12); in-app chat (day 14).
* **Changed (day 8):** Dan proposed **change order 1** on period 2: in-app chat is replaced by **agent access over MCP
  with spend limits**, $3,600 → $6,000, with new proof and criteria. Chat had not started, so it could change. The app
  explained the money: a PayPal hold cannot grow, so $3,600 went back from tranche 1 and the milestone moved to a new
  **tranche 2 of $6,000**, which Dan funded through PayPal.
* **Changed (day 13):** Dan proposed **change order 2**: drop offline mode (not started). Both signed; **$2,400 went back
  to Dan's PayPal**.
* **Delivered:** C02 approved on day 12 ($7,800 net); the new M01 "agent access over MCP" approved on day 14 ($5,850 net).
* **Money to date:** held $76,000 · released $40,000 · returned $18,000.
* **Who saw what:** Arjun was notified of each change order and reviewed the same diff and money lines Dan proposed;
  Dan saw the new tranche appear under Tranches with a "Fund tranche" link.

![Dan proposes the swap](shots/w05-client-swap-chat-for-mcp-proposed.jpg)
![Arjun reviews the swap](shots/w05-provider-swap-chat-for-mcp-review.jpg)
![Dan funds the new tranche 2](shots/w05-client-fund-tranche-2.jpg)
![Arjun reviews the drop: $2,400 back to the client](shots/w05-provider-drop-offline-mode-review.jpg)
![Dan reviews the MCP milestone](shots/w05-client-review-m01.jpg)
![Arjun sees the MCP milestone released](shots/w05-provider-sees-release-m01.jpg)

### Week 6 — period 2, days 15–21: deadline extension signed by both

* **Planned:** Android build on internal testing (day 20).
* **Changed (day 16):** Play Console review of the internal testing track took longer than planned. Arjun proposed
  **change order 3**: C03 due day 20 → day 23, amount unchanged. Dan signed. "No money moves: only the terms change."
* **Delivered:** nothing due this week after the extension.
* **Money to date:** held $76,000 · released $40,000 · returned $18,000.

![Arjun proposes the extension](shots/w06-provider-android-deadline-extension-proposed.jpg)
![Dan reviews the extension](shots/w06-client-android-deadline-extension-review.jpg)

### Week 7 — period 2 days 22–25, period 3 days 1–3: Android delivered; roll into period 3

* **Delivered:** QA confirmed the Android journeys on a Pixel test device; C03 approved on day 23 (the extended date),
  $11,700 net. On day 23 the watchdog warned that the hold window was closing ($18,000 still held for launch and
  handover); on day 25 it offered a rollover.
* **Changed:** instead of a rollover, Arjun continued into **period 3** on day 25, carrying launch and handover. **Change
  order 4** on period 2 removed them; **$6,000 went back to Dan**. Arjun appended the period-3 work (Judge Playground, MCP
  server and role consoles; iOS on TestFlight; store listings), re-dated launch (day 20) and handover (day 24), and both
  signed (risk 30). Dan funded $30,000.
* **Money to date:** held $106,000 · released $52,000 · returned $24,000.

![Arjun submits the Android evidence](shots/w07-provider-submit-c03.jpg)
![Dan reviews C03](shots/w07-client-review-c03.jpg)
![Period 2 after the carry to period 3](shots/w07-client-period-2-after-carry.jpg)
![Arjun negotiates period 3](shots/w07-provider-period-3-negotiation.jpg)
![Period 2 timeline](shots/w07-client-period-2-timeline.jpg)

### Week 8 — period 3, days 4–10: Judge Playground, MCP server, consoles; iOS on TestFlight

* **Delivered:** C01 (playground, MCP, consoles) approved on day 8, $8,775 net; C02 iOS on TestFlight approved on day
  10, $8,775 net.
* **Money to date:** held $106,000 · released $70,000 · returned $24,000.

![Arjun submits the iOS build evidence](shots/w08-provider-submit-c02.jpg)
![Dan reviews the iOS evidence](shots/w08-client-review-c02.jpg)
![Arjun sees the iOS release](shots/w08-provider-sees-release-c02.jpg)

### Week 9 — period 3, days 11–17: store listings submitted by the provider's agent over MCP

* **Delivered:** Arjun minted an agent token (spend limit $0) and his agent called the MCP server at `/api/mcp`:
  `initialize`, `tools/list`, `get_contract_status`, then `submit_evidence` with the two store-listing links. The first
  attempt was refused (SPEC_FAILED, see §10 item 1); the agent resent with the links also written in the note, and the
  evidence package was accepted (COUNT_LINK ok). The provider agent's `approve_release` call was refused
  (PERMISSION_DENIED); Dan's own agent then recorded a pending release request (`released: false`, "No money moves").
  Dan approved C03 in the app himself on day 15: $5,850 net. Raw requests and responses: [`data/mcp-log.json`](data/mcp-log.json) (the first, refused attempt is in
  [`data/mcp-first-attempt.txt`](data/mcp-first-attempt.txt)).
* **Money to date:** held $106,000 · released $76,000 · returned $24,000.

![Arjun's AI & agents page with the token](shots/w09-provider-ai-agents-token.jpg)
![Dan reviews the evidence the agent submitted](shots/w09-client-review-c03-agent-evidence.jpg)

### Week 10 — period 3, days 18–24: content and marketing added; launch and handover

* **Changed (day 18):** Dan proposed **change order 1** on period 3: add "Landing page, launch blog posts and store
  screenshots", day 22, $3,000. Arjun signed. The app made it **tranche 2 ($3,000)**. Dan's purchasing agent (token spend
  limit $1,000) asked to fund it over MCP and was refused (SPEND_LIMIT: "Funding $3,000.00 would pass this agent token's
  spend limit"); Dan funded it himself in the app.
* **Delivered:** M01 production launch (day 20, $3,510 net), C04 content and marketing (day 22, $2,925 net, the
  designer), M02 handover with runbook and knowledge-transfer recording (day 24, $2,340 net).
* **Money to date (end of build):** held $109,000 · released $85,000 · returned $24,000 · still held $0.

![Dan proposes the content and marketing tranche](shots/w10-client-add-content-marketing-proposed.jpg)
![Arjun reviews it](shots/w10-provider-add-content-marketing-review.jpg)
![Dan funds tranche 2](shots/w10-client-fund-tranche-2.jpg)
![Dan reviews the content and marketing evidence](shots/w10-client-review-c04.jpg)
![Arjun sees the release](shots/w10-provider-sees-release-c04.jpg)
![Period 3 complete — client](shots/w10-client-period-3-complete.jpg)
![Period 3 complete — provider](shots/w10-provider-period-3-complete.jpg)

### Platform view at the end of the build

Farah Ali (Finance) ran reconciliation: every tranche of the three build periods was **MATCHED** across the three planes
(signed contract, ledger, simulated PayPal). Alex Chen (Admin) verified the audit chain: **intact**. Olivia Grant's (Ops)
clearance queue held other seeded contracts with risk 77–78, none of ours (our scores were 30–33). Marcus Bell's
mediator console had no case for these contracts.

![Finance: reconciliation run](shots/build-finance-recon-run.jpg)
![Finance: ledger](shots/build-finance-ledger.jpg)
![Admin: audit chain verified](shots/build-admin-audit-chain-verified.jpg)
![Ops: clearance queue (seeded contracts only)](shots/build-ops-clearance-queue.jpg)
![Mediator console: no case for this contract](shots/build-mediator-console-no-case-for-this-contract.jpg)

### Maintenance month 1 — period 4

* **Planned and set up:** Arjun continued period 3 into month 1 with "repeat" on, then turned the repeated build template
  into the monthly template: total $4,000; appended security patches (day 10), bug-fix SLA (day 20), uptime report
  ≥ 99.5% (day 25) and release note (day 26), $1,000 each; pruned the six build milestones (12 revisions). Both signed
  (risk 10), Dan funded $4,000.
* **Delivered:** all four, each approved on its day: $3,900 net to Arjun, $100 fee.
* **Changed:** nothing. The watchdog re-authorised the hold on day 10, warned on day 25 and offered a rollover for the
  $2,000 still held then; the last two milestones were released on days 25 and 26, so no rollover was needed.
* **Money (maintenance to date):** held $4,000 · released $4,000 · returned $0.

![Arjun continues into month 1](shots/m01-provider-continue-into-month-1.jpg)
![Month 1 draft: template turned into the maintenance template](shots/m01-provider-month-1-draft.jpg)
![Dan funds month 1](shots/m01-client-fund-tranche-1.jpg)
![Arjun submits the security-patch log](shots/m01-provider-submit-c01.jpg)
![Dan reviews it](shots/m01-client-review-c01.jpg)
![Month 1 released](shots/m01-client-month-1-released.jpg)

### Maintenance month 2 — period 5

* Dan continued month 1 into month 2 with the same template (repeat on, nothing to carry). Both signed revision 1
  (no edits), Dan funded $4,000; patches, SLA, uptime report and release note approved on days 10, 20, 25 and 26:
  $3,900 net, $100 fee. Same watchdog pattern as month 1.
* **Money (maintenance to date):** held $8,000 · released $8,000 · returned $0.

![Dan continues into month 2](shots/m02-client-continue-into-month-2.jpg)
![Month 2 locked](shots/m02-client-month-2-locked.jpg)
![Arjun submits month 2 patches](shots/m02-provider-submit-m01.jpg)
![Dan reviews](shots/m02-client-review-m01.jpg)
![Arjun sees the release](shots/m02-provider-sees-release-m01.jpg)
![Month 2 released](shots/m02-client-month-2-released.jpg)

### Maintenance months 3–6 — periods 6–9 (brief)

Each month: continued from the previous one (alternately by Arjun and Dan), signed by both on revision 1, funded $4,000
by Dan, four milestones approved on days 10, 20, 25 and 26, $3,900 net to Arjun and $100 fee each month. No changes, no
disputes.

| Month | Created by | Signed | Funded | Released | Fee | Returned |
|---|---|---|---|---|---|---|
| 3 | Arjun | both, rev 1 | $4,000 | $4,000 | $100 | $0 |
| 4 | Dan | both, rev 1 | $4,000 | $4,000 | $100 | $0 |
| 5 | Arjun | both, rev 1 | $4,000 | $4,000 | $100 | $0 |
| 6 | Dan | both, rev 1 | $4,000 | $4,000 | $100 | $0 |

**Maintenance totals:** held $24,000 · released $24,000 · fee $600 · returned $0.

![Month 3 released](shots/m03-client-month-3-released.jpg)
![Month 6 released](shots/m06-client-month-6-released.jpg)

### Platform view at the end of maintenance

Farah's final reconciliation run checked all **11 tranches of the chain: 11 MATCHED, 0 drift**. The run's overall verdict
reads "Drift" because of one seeded demo tranche (`ws_ctl_w9_t1`, the Finance demo's drift exception, present in the
first run at 07:51 UTC before this simulation started); see §10 item 8. The audit chain verified **intact (748 entries)**.
No dispute was opened on any of the nine contracts and the mediator console never showed them.

![Finance: final reconciliation](shots/final-finance-recon-run.jpg)
![Finance: fees](shots/final-finance-fees.jpg)
![Admin: audit chain intact, 748 entries](shots/final-admin-audit-chain-verified.jpg)
![Mediator console at the end](shots/final-mediator-console-no-case-for-this-contract.jpg)
![Client receipts](shots/end-client-receipts.jpg)
![Provider payouts](shots/end-provider-payouts.jpg)
![Client disputes: none](shots/end-client-disputes-none.jpg)


## 5. Feature coverage

| Feature (trace id) | Shown | Where |
|---|---|---|
| Contract from a blueprint with a brief; AI drafting (A1) | yes | week 1 (UC_WEB_MVP; revision 1 "Created from an AI draft") |
| Append, re-date, re-share, prune milestones; change total (F2.04) | yes | weeks 1, 4, 7; maintenance month 1 |
| Policy gate, ten rules, risk score (F2.05) | yes | every revision; risk 33 → 30 (build), 10 (maintenance) |
| Revisions and signatures on the same hash (F2.06, F2.10) | yes | 18 contract signatures, 12 change-order signatures |
| Ops clearance at risk ≥ 75 | queue shown; **not triggered** | no contract or change order in this chain scored ≥ 75 (§6) |
| Funding a tranche through the PayPal approval flow (F3.02) | yes, mock rail | 11 holds |
| Hold watchdog: re-authorise, warn, offer rollover | yes | audit: 11 `money.reauthorized`, 8 warnings, 7 rollover offers |
| Evidence upload, SHA-256 root hash, spec checklist, signals (F3.04, F3.06) | yes | 39 packages |
| AI verifier, advisory (A3) | yes, live | 39 reports; §7 and §10 item 4 |
| Signed client approval → release, provider payout, fee (F3.07, F4.12) | yes | 39 approvals, 38 releases with money |
| Ledger (F3.11) | yes | Finance ledger; totals in §2 |
| Change orders: edit, remove, add, re-date (F2.13) | yes | 6 change orders, all four kinds |
| Continuation contracts, repeat and carry-over (F2.14) | yes | 8 continuations, 2 with carry-over |
| Three-way reconciliation | yes | 11 of 11 chain tranches MATCHED (final run) |
| Audit chain verification | yes | intact, 748 entries |
| MCP server with scoped agent tokens and spend limits (A5) | yes | week 9 and week 10 |
| Notifications to each party | yes (data) | §6; the overviews show them |
| Deadline terms (late deduction, early bonus) | not used | off on this contract by choice |
| Disputes, sealed offers, mediator verdict | not used | no conflict; mediator console shows no case (by design of the scenario) |
| Out-of-sequence start permission | not used | delivery followed the signed order |
| PayPal Sandbox (real PayPal API) | **no** | no credentials in this sandbox; mock rail used |

## 6. How the app handled the randomness

| Change | What the contract allowed | What was frozen | How the money moved | How it was proven clean |
|---|---|---|---|---|
| Carry-over P1 → P2 (week 3) | Continuation of a locked contract; only active, not-started milestones without evidence can be carried (`carryable`) | M01–M05 (released) could not be touched; P2 could not be signed until both signed the carry change order on P1 | $12,000 returned from P1 tranche 1 (`VOID` rows); the same work funded again in P2 | P1 tranche CLOSED and MATCHED; P1 total $18,000 = released $18,000 |
| Feature swap (week 5) | Edit of a milestone that had not started (`UNSTARTED` = LOCKED/OPEN, no evidence) | C01 (released) and anything with evidence | $3,600 returned from tranche 1; new tranche 2 of $6,000, funded by Dan through PayPal ("a PayPal hold cannot grow") | P2 tranche 1 and tranche 2 both MATCHED |
| Feature dropped (week 5) | Remove of a not-started milestone | as above | $2,400 returned from tranche 1 | as above; ledger VOID rows match |
| Deadline extension (week 6) | Edit of the due day of a not-started milestone; both sign | — | none | new revision; the milestone was approved on its new day 23 |
| Carry-over P2 → P3 (week 7) | as the first carry-over | released milestones | $6,000 returned; funded again in P3 | P2 total $34,000 = released $34,000 |
| Content added in the last week (week 10) | Add a milestone after lock | — | new tranche 2 of $3,000, funded by Dan | P3 tranche 2 MATCHED; the client's agent could not fund it past its $1,000 limit |

In every case the old terms applied until both had signed; each change order became the next contract revision with
its own hash; the policy gate re-ran on the amended contract (all rules passed; risk 30); and the audit chain recorded
`contract.change_order_proposed`, `_signed`, `_applied` and `money.change_order_settled` (6 each where money moved).
No milestone was paid twice: every carried milestone was removed from the old period (and its money returned) before the
new period could be signed.

## 7. Benefits, using numbers measured in the run

**For the client (Dan):**
* At most **$40,000** was ever held at once (period 2 at funding; period 1 was fully settled before it), never the
  whole $133,000 that passed through holds over the chain.
* **$24,000** came back without a dispute: $12,000 and $6,000 on the two carry-overs (paid again only in the next
  period) and $3,600 + $2,400 on the swap and the drop.
* Every one of the 39 payments followed his signed approval over a hashed evidence package; 39 evidence notifications
  reached him, each with checks and an AI report.
* Scope changes cost one change order each (6 in total), signed in the same session; nothing was renegotiated from
  scratch.

**For the provider (Arjun):**
* **38 payouts, $106,275 net**, each sent at the moment of approval (the milestone page showed "released to Arjun Rao's
  PayPal account" right after the client's decision); no invoices, no chasing.
* Money for each period was held **before** work started (11 holds), so the team never worked on unfunded scope.
* Changes were priced, not absorbed: the swap added $2,400 and the content work $3,000.
* 39 approval notifications; 14 change-order notices and 4 continuation notices told him what to sign.

**For the platform:**
* **$2,725 fee income** (ledger FEE rows: $450 + $850 + $825 build, $600 maintenance), 2.5% of $109,000 released.
* **0 Ops interventions, 0 mediator cases, 0 disputes**; reconciliation 11/11 MATCHED; audit chain intact.
* Measured AI cost for the whole chain: **$0.43** (§8).

## 8. Platform costs

**MEASURED in this run** (from `ai_calls` and `ledger_entries`, rows created after the run started at 07:55 UTC):

| Item | Calls | Tokens in | Tokens out | Cost |
|---|---|---|---|---|
| A1 contract draft (`A1.draft@v1`, claude-sonnet-5-5) | 1 | 5,545 | 3,403 | $0.0677 |
| A3 evidence verifier (`A3.verify@v1`, claude-sonnet-5-5) | 39 | 46,180 | 14,810 | $0.3607 |
| **Total AI** | **40** | **51,725** | **18,213** | **$0.4284** |

Cost is the app's own figure (`cost_micros`, priced at $3 per million input tokens and $15 per million output tokens,
`AI_PRICE_*` settings). Average verifier latency 3.1 s; 0 failed calls. The verifier recommended "request a fix" 15 times
and "unclear" 24 times; see §10 item 4.

| Fee income (ledger FEE rows) | Amount |
|---|---|
| Build P1 / P2 / P3 | $450 / $850 / $825 |
| Maintenance months 1–6 | $100 each, $600 |
| **Total** | **$2,725** |

**ASSUMED (not measured here):**
* **PayPal fees.** PayPal's US fee page could not be reached from this sandbox (no network access to paypal.com), so this
  is an assumption to check against PayPal's published US merchant fees: about **3.49% + $0.49** per PayPal Checkout
  transaction. On the $109,000 actually captured in 39 releases that is about **$3,823**; on Rail A1 (payee routing) it
  is charged to the payee, not to the platform. Voided authorisations ($24,000) are assumed to carry no fee.
* **Hosting (Render).** Assumed about $7 a month for a starter web service plus about $7 a month for a small Postgres,
  ~$14 a month (check render.com/pricing). The chain spans about 8.5 months; if the platform served 50 contract periods
  a month, hosting per contract period is about **$0.28**.

**Unit economics per contract period (average over the 9 periods):** fee income $302.78 − AI $0.05 − hosting $0.28
(assumed) ≈ **$302.45** before PayPal fees (borne by the payee on Rail A1, assumed). A maintenance month alone: fee
$100 − AI ≈ $0.04 (4 verifier calls at the measured $0.0092 average) − hosting $0.28 ≈ **$99.68**.

## 9. How time was simulated, and what was touched directly

Contracts run on a per-workspace virtual clock (`workspaceNow`; `virtualClock` in `src/server/money/deadline.ts`). The
app's supported way to move it is the Judge Playground time machine, `POST /api/sandbox/time-travel {simId, toDay}`,
which exists only for playground sessions (`sim_sessions` rows). There is no supported way to advance the clock of a
normal contract.

What was done, in the sandbox database only: for each of the nine contracts, **one row was inserted into `sim_sessions`**
(`scenario = 'SIMCLOCK'`, `workspace_id` = the contract, `judge_id = 'u_admin'`, offset 0). No `sim_workspaces` row was
added, so the contracts stay in every normal view (lists, recon, consoles). Every clock move then went through the
**app's time machine endpoint**, signed in as Alex Chen (admin), which writes the offset, records
`sandbox.time_travel` in the audit chain (46 moves) and runs the hold watchdog, review timers and dispute timers for that
contract. The endpoint returned HTTP 400 `SCENARIO_UNKNOWN` after applying each move, because it tries to render a
playground state for a scenario it does not know; the script read the new offset back from `sim_sessions` (§10 item 7).

Nothing else was written to the database by hand: no money, ledger, signature, revision, change-order or audit row.
Every state change went through the UI (Playwright) or, for the MCP step, through `/api/mcp` with a token the person
minted in the app.

## 10. Gaps and bugs found (not fixed in this run)

1. **MCP `submit_evidence` link check (bug).** The tool turns `urls` into `.url` files, but the link check counts only
   links written in the note (or confirmed in the UI), so a link-only milestone is refused: `SPEC_FAILED … Links: no
   link in the note and not confirmed (2 required)`. *Workaround:* also write the URLs in the note.
2. **MCP `approve_release` is client-only, but reads as the provider's tool.** Its title is "Ask the client to approve a
   release", yet a provider token gets `PERMISSION_DENIED: Your role (provider) may not release approve.` (the message
   also reads oddly). *Workaround:* the client's own agent records the request; the client approves in the app.
3. **Duplicate files: checklist and server disagree.** Two byte-identical screenshots showed "2 photos of 2 required —
   OK" in the pre-submit checklist, but the server de-duplicated them and refused: "1 photo of 2 required".
   *Workaround:* upload distinct files.
4. **The AI verifier cannot read PDFs or video.** It gets PDF names and metadata, not text ("I was given only the file
   name and its metadata, not its contents"). With the sample files it never advised approval (15 "request a fix", 24
   "unclear"), and it correctly noticed that the files were labelled as samples. The client approved all 39 anyway, which
   is his decision by design (the AI is advisory). An idea for the owner: ask for a short reason when a client approves
   against the AI's advice.
5. **"Signed with MFA" without a code.** Change-order signatures show "signed with MFA" (`change_order_signatures.mfa =
   true`) although no authenticator code was entered in the demo session, while evidence approvals in the same session
   record `mfa = sandbox-skip`. The two modules label the same demo sign-in differently.
6. **Mixed clocks on one card.** A change order's "proposed … Nov 19, 2026" uses the contract's virtual clock, while the
   signature line under it shows the real time ("Nov 11, 2026").
7. **No supported time machine for normal contracts.** See §9. The playground endpoint also applies the move and then
   answers 400 for a session it cannot render, so a caller cannot tell success from failure by the status code.
8. **Reconciliation verdict is global.** One seeded drift exception (`ws_ctl_w9_t1`) makes every run's verdict "Drift",
   and there is no per-contract or per-period verdict, so "CLEAN at the end of each period" cannot be shown as a run
   verdict. Shown instead: every tranche of the chain is MATCHED (recon lines). Reconciliation was run after the build
   and after maintenance (four runs in total), not after each of the nine periods.
9. **The hold window caps a period at 26 days per tranche (R02).** A 30-day month's uptime report had to be due on day
   25 and the release note on day 26; build period 2 rolled into period 3 on day 25, not 28. Not a bug, a constraint
   worth saying on the continuation panel.
10. **Codes change across periods.** Carried milestones are renumbered (P1 M06 "Production launch" became M02 in P2 and
    M01 in P3). The link back (`carried_from`) is kept in the data but not shown next to the code.
11. **The chain view shows one step each way.** Each contract shows its parent and its next period; the full nine-period
    chain is visible only in the contract list (by period number).
12. **Turning a build into a retainer means pruning.** "Repeat" copies the build template; month 1 needed six prunes and
    four appends (12 revisions). A "start with no milestones" option would save that.
13. **Ops clearance was not exercised.** The risk scores (30–33 build, 10 maintenance; platinum provider) never reached
    75, so nothing went to Olivia's queue. This is the policy working as specified; the queue is shown with other seeded
    contracts.
14. **AI wording carried into later periods.** The AI-adapted backlog proof in P1 says "26-day MVP", a phrase from the
    blueprint, although P1 was planned as the first of three periods.
15. **Contract list details.** The first period of a chain has no "Period 1" chip (later periods do); the "Updated"
    column mixes virtual-clock dates (Dec 2–6 for the build periods) with real dates (Nov 11 for the maintenance months),
    so the list order does not follow the chain; and the "Total" and "Updated" column headers run together
    ("TotalUpdated") at 1440 px.

## 11. Reproducing the run

The scripts that drove the UI are in [`scripts/`](scripts/) (Playwright, Node; they were run from a `sim/` folder at the repository root, so paths inside them point there). Order: `s01-create` → `s02-p1-negotiate`
→ `s03-fund p1 1 w01` → `s04-p1-deliver` → `s05-p2-create` → `s06-p2-negotiate` → `s03-fund p2 1 w04` → `s07-p2-run`
(and `s07b`, see §10) → `s08-p3-create` → `s09-p3-run` (and `s09b`, see §10) → `s10-maint` → `s11-platform` → `s12-final`,
then `metrics.mjs`. They expect a freshly reset database (`npm run db:reset`) and the app on `http://localhost:3100`.
Raw outputs: [`data/metrics.json`](data/metrics.json), [`data/mcp-log.json`](data/mcp-log.json),
[`data/recon-final.json`](data/recon-final.json).
