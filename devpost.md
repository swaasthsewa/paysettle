# PaySettle — Devpost draft

Track: Best Use of PayPal + AI. Sandbox only: no real money moves.

## Tagline

A contract compiler for staged service work: vague wording goes in, checkable clauses come out, and each PayPal partial
capture is tied to the evidence its clause names.

## Inspiration

Most payment fights on project work start with one sentence written before any work began: “the website should be fast
and modern”, “make changes as needed”, “high quality code”. Nobody can check those sentences, so nobody can agree when
the work is done, and the money waits on whoever is more stubborn.

Many tools now let an AI look at the delivered work and decide whether to pay. We think the problem sits earlier. If the
clause cannot be checked, no reviewer, human or AI, can check the work against it. So PaySettle starts at the contract:
it treats a statement of work like source code, rejects the lines that cannot be checked, proposes measurable wording,
and only then connects each clause to the PayPal money that depends on it.

## What it does

PaySettle compiles a vague statement of work into a milestone contract, then holds and releases the money through PayPal,
one clause at a time.

Example, run by the real rule-based compiler (`npm run eval:compare -- --text "The website should be fast and modern."`):

- **In:** “The website should be fast and modern.”
- **Rejected:** “Uses taste words (fast, modern) with no number, threshold or measurable target to check them against.”
- **Rewrite:** “The website should be fast and modern — measured as: pages load in ≤ 2 s on a mid-range phone
  (Lighthouse report attached); matches the approved design file screen by screen / room by room (dated photos or
  screenshots of each attached)”
- **Signed clause** (Web / SaaS MVP blueprint, milestone M05, 15% of the contract): “Lighthouse mobile performance ≥ 85
  on staging”, proved by a Lighthouse report, an accessibility scan and a dependency scan.

The six stages:

- **Agree.** Start from one of 20 blueprints. The Criteria Compiler flags acceptance criteria nobody could check and
  proposes measurable wording. Parties negotiate by pruning and appending milestones; a policy gate of deterministic
  rules (shares add to 100%, hold windows, no front-loading, every paying milestone names its proof, no clause that
  contradicts a system rule) must pass before both sign the same revision and hash.
- **Hold.** The client approves a PayPal order with intent AUTHORIZE for each tranche. The money stays in PayPal.
- **Prove.** The provider submits the files the clause names. PaySettle hashes them and computes signals (file types,
  counts, GPS distance, EXIF time, duplicates). The AI Evidence Verifier reads the files against the criteria and reports
  per criterion, with citations. It advises; it cannot approve.
- **Release.** The client ticks that they inspected the evidence and approves. PaySettle makes a partial capture of that
  milestone's share against the authorization. Fee and net are split in integer cents and written to a double-entry ledger.
- **Resolve.** A dispute freezes only its milestone: sealed bids first, then a sealed evidence vault, then a human
  mediator's signed verdict (a second mediator co-signs above $5,000). The AI mediator proposes a split with cited
  findings; a person decides. The verdict executes as two legs: refund the client's share, capture the provider's.
- **Reconcile.** Three-way reconciliation compares the ledger, PayPal transaction search and the contract. Any drift
  trips that tranche's circuit breaker.

Payments that survive failure (Judge Playground S5): a PayPal 503 on a release is retried with the same idempotency key
and gives one payout; the same webhook posted twice is recognised and ignored; one cent of ledger drift is caught by
reconciliation and trips the breaker.

Also: agent-to-agent contracting over PaySettle's own MCP server (`/api/mcp`). A client's agent and a provider's agent
can draft, negotiate, request funding and submit evidence; a person approves the hold in PayPal and confirms every
release in the app.

## How we built it

Next.js 16 (App Router, server actions), TypeScript, Postgres 16 with Drizzle, Playwright and axe for end-to-end and
accessibility tests, Vitest for unit and integration tests.

**Technological Implementation.** One PayPal rail interface with three sandbox rails (A1 payee routing, A2 platform
merchant with Payouts, B delayed disbursement) and a deterministic mock rail for the playground. Every money call
stores an idempotency key before the call and sends it as `PayPal-Request-Id`. Webhooks are signature-verified and
de-duplicated. The ledger is double-entry and append-only; the audit log is hash-chained. The AI gateway is
provider-agnostic, enforces a daily token cap, masks names and e-mail addresses, marks party-written text as untrusted,
validates every answer against a schema, retries once and then falls back to rules. Measured on 11 Nov 2026: 719 unit
and integration tests pass, 49 of 49 end-to-end tests pass, and 63 of 63 requirement ids trace to code and tests.

**Design.** A public landing page, role homes for eight roles, and a Judge Playground that shows the same contract in
four views at once: client, provider, ledger and reconciliation, and the PayPal wire log. Every scenario can be run step
by step or all at once, with a time machine for hold windows and a chaos injector for faults. The axe scan finds no
serious or critical issues on the six pages it covers.

**Potential Impact.** Built for freelancers and small service businesses, and the clients who hire them, on staged
projects of about $1,000 to $25,000: web builds, consulting sprints, interior work, car restoration, travel, roofing,
telecom site work. Each has a blueprint. A shared, checkable definition of done lets a client pay for verified progress
and a provider get paid on delivery without a large deposit.

**Innovation.** The AI is pointed at the contract, not only at the delivered work. The Criteria Compiler treats each
acceptance criterion like a line of code: it compiles, or it is rejected with a reason and a suggested rewrite. Rules
and AI work together: the AI proposes wording, and a rule that a taste word or hedge with nothing measurable never
passes has the last word. Because each signed clause names its proof and each PayPal partial capture belongs to one
clause, every release can be traced back to the sentence both parties signed.

**Presentation.** A two-minute-forty-five video, a judges' quick path in the README, a public AI scorecard at
`/trust/ai`, and `RESULTS.md` with every measured number, its command, date and commit.

## PayPal APIs used

All calls go to the PayPal Sandbox. Without sandbox credentials, the app uses the deterministic mock rail.

| API | Used for |
|---|---|
| OAuth 2.0 token (`/v1/oauth2/token`) | Access token for every call |
| Orders v2 (`/v2/checkout/orders`), intent AUTHORIZE | Funding a tranche on rails A1 and A2; buyer approval in PayPal; authorize after approval |
| Orders v2, intent CAPTURE with delayed disbursement | Funding on rail B (sandbox only) |
| Authorizations: capture (`/v2/payments/authorizations/{id}/capture`) | Partial capture per approved milestone; final capture on the last |
| Authorizations: void, reauthorize | Voiding a remainder; reauthorizing after the three-day honour period |
| Captures: refund (`/v2/payments/captures/{id}/refund`) | The client's leg of a dispute verdict; rollovers |
| Payouts (`/v1/payments/payouts`) | Rail A2 (platform merchant, sandbox only): paying the provider after capture |
| Referenced Payouts (`/v1/payments/referenced-payouts-items`) | Rail B (delayed disbursement, sandbox only): releasing a held capture to the provider |
| Webhook signature verification (`/v1/notifications/verify-webhook-signature`) | Verifying every incoming webhook before it is processed |
| Transaction Search (`/v1/reporting/transactions`) | The PayPal side of three-way reconciliation |
| Disputes (`/v1/customer/disputes/{id}`, provide-evidence) | Sending the sealed evidence dossier when a buyer opens a PayPal dispute |

## AI tools used

- **Claude, inside the app**, through PaySettle's own gateway (`src/lib/ai/gateway.ts`): Contract Drafter, Criteria
  Compiler, Evidence Verifier and Mediator proposals, plus blog outline drafts. Every feature has a rule-based fallback.
- **Claude Code**, to build the project.
- **PaySettle's own MCP server** (`/api/mcp`, JSON-RPC over Streamable HTTP) for agent-to-agent contracting.
- **PayPal Agent Toolkit:** not used. The MCP tools call PaySettle's own modules, which call PayPal.

## Reused components

PaySettle is a new project. To build faster it reuses generic components from the author's own earlier projects, each
copied or ported, renamed and adapted, with no data, content, branding or client material: the app shell and design
tokens, the landing-page structure (all copy and art new), TOTP second factor and password hashing, session and lockout
patterns, the traceability gate, an RBAC matrix, state-machine framework, audit writer, webhook dispatcher and job
scheduler, the Playwright and axe set-up, the AI gateway design (ported from Python), and typed content blocks for blog
posts. PayPal's public sandbox samples were used as reference. Contracts, the policy engine, rails, ledger, evidence,
disputes, reconciliation, the AI features, the MCP server and the Judge Playground were written for PaySettle during the
hackathon. Full list with file paths: `REUSE.md`.

## Challenges we ran into

- **PayPal's hold window.** PayPal honours an authorization for three days, and the hold itself lasts a limited
  window (PaySettle's watchdog plans for 28 days). Longer contracts are split into tranches of at most 26 days, with a watchdog that warns, offers a rollover and reauthorizes.
- **Exactly one payout.** Retries after a timeout or a 503 must not pay twice. Every money call stores its idempotency key
  before the call; S5 checks it under an injected 503.
- **Telling vague from measurable.** Taste words next to a real number (“fast checkout: payment completes in under 3
  seconds in 95% of test runs”) are fine; a number next to a hedge (“about 10 pages, more if needed”) is not. The rule
  set is tuned on a 60-criterion golden set; the one miss there was fixed on that set and is reported as such.
- **Keeping the AI advisory.** No AI path can write contracts, signatures, the ledger or releases; MCP's
  `approve_release` only records a request that a person confirms in the app.

## Honest limits

- **Sandbox only.** No real money moves. Production needs PayPal approval and legal review.
- **Mock rail unless sandbox credentials are set.** The hosted demo runs [mock rail / PayPal Sandbox — owner to fill in].
- **AI is advisory.** It drafts and checks; people approve and sign. Without an AI key, AI panels say “AI unavailable”
  and the rule-based checks run.
- **AI evaluations need a key.** Measured so far without a key: the rule compiler scores precision 1.0 and recall 1.0
  on vague criteria (n = 60), after a fix made on that same set (before: recall 0.967). The AI compiler, the plain-LLM
  baseline, the evidence, mediation and injection sets are pending. Of 30 rule rewrites, 7 pass the rule linter; the
  rest are starting points that need editing.
- **The compiler is not yet called from the negotiation screen.** It runs at `POST /api/ai/compile`, in the eval
  harness, on the landing page and on `/trust/ai`. The policy gate checks that each paying milestone names its proof,
  not the wording of each criterion.
- **Shared demo personas.** Everyone signing in to the hosted demo uses the same seeded people, so data can change while
  you look. The playground starts a fresh session per run.
- **Accessibility.** The automated axe scan covers six pages and finds no serious or critical issues there; other pages
  and manual checks (screen reader, keyboard-only on every flow) are not covered by it.

## What's next

- Call the Criteria Compiler from the negotiation screen, and let the policy gate warn on criteria it rejects.
- Run the AI evaluations and the compiler-vs-LLM comparison with a key, then on 20–40 real, anonymised criteria from
  past projects.
- Better rule rewrites: drop the vague words they replace, and pick the template by domain.
- PayPal approval for a limited production pilot.

## Try it

- Hosted demo: [hosted demo URL]
- Public repository: [public repo URL]
- Judges' quick path: open the demo, press **Try the live demo**, pick **Hackathon Judge**, choose **Fast mock**, press
  **Start** on S1, then **Run all**.
