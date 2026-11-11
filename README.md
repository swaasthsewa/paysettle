# PaySettle

[![ci](https://github.com/swaasthsewa/paysettle/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/swaasthsewa/paysettle/actions/workflows/ci.yml) [![licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

**A contract compiler for staged service work.** A vague statement of work goes in. Out comes a milestone contract in
which every criterion either names a check a third person could make, or is flagged with a measurable rewrite, and every
PayPal partial capture is tied to the evidence its clause names.

Built for the PayPal AI Hackathon. **Sandbox only: no real money moves.**

**Live demo: <https://paysettle.onrender.com>** → **Try the live demo** → **Hackathon Judge** (no password). It runs on
Render against the PayPal Sandbox; the Judge Playground's **Fast mock** mode needs no PayPal account at all.

Measured on 11 Nov 2026 ([`RESULTS.md`](RESULTS.md)): 763 unit tests pass in the public CI run, 54 end-to-end
journeys pass, 65 of 65 requirements traced to code and tests; the AI evaluation sets with their targets and their one miss (the evidence
verifier: 0.813 against 0.85, with no spoofed package advised to approve).

### One criterion, end to end

| Step | What happens |
|---|---|
| **In** | “The website should be fast and modern.” |
| **Rejected** | “Uses taste words (fast, modern) with no number, threshold or measurable target to check them against.” |
| **Rewrite** | “The website should be fast and modern — measured as: pages load in ≤ 2 s on a mid-range phone (Lighthouse report attached); matches the approved design file screen by screen / room by room (dated photos or screenshots of each attached)” |
| **Both sign** | The parties edit the suggestion into the clause they want. In the Web / SaaS MVP blueprint it reads “Lighthouse mobile performance ≥ 85 on staging”, and milestone M05 names its proof: a Lighthouse report (mobile ≥ 85), an accessibility scan and a dependency scan. Client and provider sign the same revision and hash. |
| **Evidence** | The provider uploads those files. Rule checks and the AI verifier report what matches; the AI only advises. |
| **Release** | The client confirms they inspected the evidence and approves (an authenticator code field is there; it is optional in the sandbox), and PaySettle makes a PayPal partial capture of that milestone's share (15%) against the authorization that holds the money. The rest stays held. |

The rejection and rewrite above are the rule-based compiler's real output for that sentence (try it:
`npm run eval:compare -- --text "The website should be fast and modern."`). With `AI_API_KEY` set, the AI proposes the
wording; a taste word or hedge with nothing measurable is still rejected. The Judge Playground's **S1** runs the sign,
evidence and partial-capture steps for milestones M02–M04 of the same blueprint. Where the compiler runs today: the
signed-in endpoint `POST /api/ai/compile`, the eval harness, the landing page and the public AI scorecard at `/trust/ai`;
the negotiation screen does not call it yet, and the policy gate checks that each paying milestone names its proof, not
the wording of each criterion. Measured numbers and known misses: [`RESULTS.md`](RESULTS.md).

### Payments that survive failure (Judge Playground S5)

- **A PayPal 503 on a release** is retried with the same idempotency key (`PayPal-Request-Id`): one capture, one payout.
- **The same webhook posted twice** is recognised by its transmission id; the second copy changes nothing.
- **One cent of ledger drift** is found by three-way reconciliation (ledger, PayPal, contract), which trips the
  tranche's circuit breaker.

**Also:** agent-to-agent contracting over the MCP server at `/api/mcp`. Agents can draft, negotiate, request funding,
submit evidence and propose a change order on a signed contract (`propose_change_order`); a person approves the hold in
PayPal, confirms every release in the app, and both parties sign a change order (with MFA) before the schedule changes.
The contract timeline (Bryntum Gantt) shows a pending change order against the signed plan as baselines, and a
continuation chain as one calendar.

## For judges

1. Open the hosted demo at <https://paysettle.onrender.com> or run it locally (below), then press **Try the live demo**.
2. Pick **Hackathon Judge** — no password in the sandbox. You land on the **Judge Playground**.
3. Choose **Fast mock**, press **Start** on **S1 Happy path**, then **Run all**. Every step should show ✓; the four views
   below show the client, the provider, the ledger and the PayPal wire log for the same contract.
4. Try **S2** (spoofed GPS evidence), **S4** (dispute and verdict) and **S5** (503 retry, duplicate webhook, ledger drift).
5. Use **Switch person** in the menu to see any role: Priya Shah / Dan Okafor (client), Meera Iyer / Arjun Rao (provider),
   Olivia Grant (Operations), Marcus Bell / Lena Park (mediator), Farah Ali (Finance), Alex Chen (admin), Maya Lopez (Growth).

Manuals per role, with screenshots: [`docs/manuals/index.html`](docs/manuals/index.html).

## Run it locally

```bash
# 1 · Postgres 16 (Docker or a local install)
docker compose up -d db            # or use your own Postgres; set DATABASE_URL
# 2 · install and configure
npm install
cp .env.example .env.local         # add PayPal Sandbox and AI keys if you have them (optional)
# 3 · database and demo data
npm run db:push && npm run db:guards && npm run db:seed
# 4 · start
npm run dev                        # http://localhost:3000 → “Try the live demo”
# or a production build
npm run build && npm start         # also on port 3000
```

Without PayPal credentials the app uses the deterministic mock rail; without an AI key, AI panels say “AI unavailable”
and the rule-based checks still run. Keep `PAYSETTLE_ENV=sandbox` for the demo sign-in and the Judge Playground.

## Verify

```bash
npm run db:reset:test  # once: the unit tests use their own database, paysettle_test (or TEST_DATABASE_URL)
npm run verify         # typecheck · lint · unit tests · copy lint · name, vocabulary and secret checks · production build
npm run hooks          # once per clone: turn on the pre-commit secret check
npm run gate:trace     # every requirement id appears in code and in a test
npm run eval           # golden sets; the AI sets are skipped without AI_API_KEY
npm run eval:compare   # criteria compiler vs a plain LLM baseline (see evals/README.md)
```

The production build uses Turbopack and needs a lot of memory: on a machine with a 16 GB limit it was stopped for lack
of memory. `npx next build --webpack` builds the same app with far less. Results with dates: [`RESULTS.md`](RESULTS.md).

After changing dependencies, rebuild the lock file in a folder with no `node_modules` (copy `package.json` there, run
`npm install --package-lock-only`, copy `package-lock.json` back). An install over an existing `node_modules` can drop
other platforms' native packages from the lock file, and `npm ci` on Linux then cannot start the tests.

### End-to-end tests (Playwright)

The journeys run against an already running, seeded server; they never start one.

```bash
# server from "Run it locally" on :3000, or any URL
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
# options: CHROME_PATH=/usr/bin/google-chrome (defaults to it when present) · E2E_WORKERS=1 (default)
npx playwright show-report e2e/.report   # HTML report
```

| Spec | Covers |
|---|---|
| `e2e/personas.spec.ts` | every persona signs in, lands on its home; the menu matches the role; every menu page renders |
| `e2e/playground.spec.ts` | S1, S2, S4, S5 in Fast mock: Run all, every step ✓ |
| `e2e/client-journey.spec.ts` | client reviews evidence, checks and AI advice, approves with the confirmation box, sees the release |
| `e2e/provider.spec.ts` | provider onboarding, PayPal account, contracts and a contract room |
| `e2e/negotiation.spec.ts` | prune and restore a milestone; policy gate and revision update |
| `e2e/mediator.spec.ts` | case queue and the case workbench |
| `e2e/finance.spec.ts` | run reconciliation; ledger |
| `e2e/site.spec.ts` | landing page and the waitlist form (random e-mail) |
| `e2e/a11y.spec.ts` | axe (WCAG 2.1 A/AA) on landing, sign-in, client overview, contract room, milestone page, playground; fails on serious or critical findings; writes `e2e/a11y-report.json` |

The tests change demo data (they approve milestones, start playground sessions and run reconciliation). They prepare what
they need, so they can run repeatedly, but run them against a disposable database — or re-seed — before a demo.

### Screenshots

```bash
node tools/screens.mjs                 # all roles → docs/screens/*.png (≈40 images)
node tools/screens.mjs client judge    # only some groups
```

Uses `SCREENS_BASE_URL` (or `E2E_BASE_URL`, default `http://localhost:3100`) and `CHROME_PATH`. The judge group starts fresh
playground sessions.

## Documents

- [`docs/architecture.md`](docs/architecture.md) — modules, rails and data flow (Mermaid), and where each rule of the
  constitution (P1–P12) is enforced.
- [`docs/manuals/`](docs/manuals/index.html) — one manual per role (client, provider, Operations, mediator, Finance, admin,
  Growth, judge).
- [`REUSE.md`](REUSE.md) — components reused from the author's own earlier projects.

## Licence

MIT — see [`LICENSE`](LICENSE).
