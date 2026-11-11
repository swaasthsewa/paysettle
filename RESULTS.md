# Results

Measured numbers only. Each one gives the command, the date and the commit it ran on. Nothing here is estimated; anything
that needs a key that was not available is listed as pending.

Gates: Linux cloud sandbox, 4 CPUs, 16 GB memory limit, Node 22.23, Postgres 16, `PAYSETTLE_ENV=sandbox`, mock rail.
Latest full run: commit `d198cb9` (11 Nov 2026). AI evaluations: `claude-sonnet-5-5` through the app's own AI gateway,
run from a Windows machine with `AI_API_KEY` set. Hosted demo: <https://paysettle.onrender.com> (Render, Docker,
PayPal Sandbox credentials).

## Gates

| Gate | Command | Result | Date | Commit |
|---|---|---|---|---|
| Install | `npm ci` | passed (lock file installs on Linux; the native bindings issue is not present) | 11 Nov 2026 | `56788b3` |
| Typecheck | `npm run typecheck` | passed | 11 Nov 2026 | `d198cb9` |
| Lint | `npm run lint` | passed | 11 Nov 2026 | `d198cb9` |
| Unit tests | `npm run test` | 62 files, 750 passed, 1 skipped | 11 Nov 2026 | `d198cb9` |
| Copy, name, vocabulary, secret checks | `npm run gate:copy`, `gate:names`, `gate:vocab`, `gate:secrets` | all clean (632 files) | 11 Nov 2026 | `d198cb9` |
| Production build (Turbopack) | `npm run build` | **stopped for lack of memory** (the build process reached about 14 GB) | 11 Nov 2026 | `56788b3` |
| Production build (webpack) | `npx next build --webpack` | passed; this is the build the container uses | 11 Nov 2026 | `d198cb9` |
| Traceability | `npm run gate:trace` | 65/65 requirements traced to code and tests | 11 Nov 2026 | `d198cb9` |
| End-to-end (Playwright) | `E2E_BASE_URL=http://localhost:3100 npm run test:e2e` against `next start` on the webpack build, seeded database | 54 of 54 passed | 11 Nov 2026 | `d198cb9` |

`npm run verify` runs every row above in order and ends with the Turbopack build, so on this machine `verify` stops at
its last step. Every other step of `verify` passed. One end-to-end run that overlapped a unit-test run on the same
4 CPUs failed 15 tests on timeouts; the same suite run on its own passed 54 of 54.

### What was needed to get the gates running

No code was changed to get the gates green. Two set-up steps were needed that the README did not list; the README now
lists them:

1. The unit tests use a separate database (`paysettle_test`). Without it, 109 tests failed with
   `database "paysettle_test" does not exist`. `npm run db:reset:test` creates it.
2. The Turbopack production build needs more memory than this machine allows. The webpack build of the same code passes.
   The build script was not changed.

## Evaluations

### Criteria compiler, rule path (`npm run eval`, set `compile`, n = 60)

| Version | Precision (vague) | Recall (vague) | Agreement | Misses | Date | Commit |
|---|---|---|---|---|---|---|
| Before the C49 fix | 1.0 | 0.967 | 0.983 | C49 | 7 Nov 2026, re-measured 11 Nov 2026 | `56788b3` |
| After the C49 fix | 1.0 | 1.0 | 1.0 | none | 11 Nov 2026 | `5a128c8` |

**This after number is tuned on the test set.** C49 (“Roughly 10 pages of documentation, more if needed.”) is one of
the 60 labelled criteria. The fix adds “if needed” to the list of open-ended hedges after seeing that this row was
missed. The “after” score therefore says the rules now agree with this set; it is not a measure on unseen criteria. The
owner's real criteria (below) are the unseen test.

The rule linter also accepts 312 of the 315 acceptance criteria in the 20 shipped blueprints as checkable (measured
11 Nov 2026 at `5a128c8`). The three it rejects: “Roof structure confirmed adequate for the array load”, “Quantity
complete” and “Site clean and controller set to the care schedule”.

### Compiler vs plain LLM (`npm run eval:compare`, n = 60)

| Side | Precision (vague) | Recall (vague) | Agreement | Rewrites judged checkable | Date | Commit |
|---|---|---|---|---|---|---|
| PaySettle compiler, rules only | 1.0 | 1.0 | 1.0 | 7 of 30 | 11 Nov 2026 | `d198cb9` |
| PaySettle compiler, rules + AI | 1.0 | 1.0 | 1.0 | 30 of 30 | 11 Nov 2026 | `d198cb9` |
| Plain single-prompt LLM baseline | 1.0 | 1.0 | 1.0 | 30 of 30 | 11 Nov 2026 | `d198cb9` |

Model `claude-sonnet-5-5`; 6 AI calls, 19,948 tokens, about $0.19 for the AI side and the baseline together.

**On this set, a plain single prompt does as well as the compiler.** All three sides classify every one of the 60
criteria correctly, and every AI and baseline rewrite passes the rule linter. The set is too easy to separate them: the
team wrote it, and its vague criteria are plainly vague. What the compiler adds here is not a better score but how it
runs: the rule path needs no key, gives the same answer every time, costs nothing and always states its reason, and the
AI path is held to the same linter, so a rewrite that only sounds measurable is still rejected. Whether the compiler
beats a plain prompt on harder, real criteria is open; the owner's real criteria (below) are the test for it.

How a rewrite is judged: the rule linter is run on the rewrite. The rule rewrite keeps the original sentence and appends
a measurable target (“… — measured as: …”). The linter reads the whole sentence, so a hedge such as “ASAP” or a taste
word next to a target it cannot read as a number still fails it, and so does a placeholder such as “day N”. 23 of the 30
rule rewrites fail it. Some also pick the wrong template for the domain (for example C51, a marketing campaign, gets the
design-file template). The rule rewrites are starting points that the parties are expected to edit before signing; they
are not good enough to sign as written.

To re-run the AI side and the baseline: set `AI_API_KEY` in `.env.local` and run `npm run eval:compare`.

### AI golden sets (`npm run eval`)

Run 11 Nov 2026 on the AI gateway fix (`bb3abed`, before the C49 rule fix), model `claude-sonnet-5-5`.

| Set | n | Result | Target | Pass |
|---|---|---|---|---|
| Criteria compiler, AI path | 60 | agreement 1.0 (precision 1.0, recall 1.0) | ≥ 0.90 | yes |
| Criteria compiler, rule path (same run) | 60 | agreement 0.983 (C49 missed; fixed later, see above) | ≥ 0.90 | yes |
| Evidence verifier (spoofed and genuine packages) | 16 | agreement 0.813; **spoofed packages advised to approve: 0** | ≥ 0.85; 0 | **no** |
| Mediation proposals | 10 | 0.8 within 10 points of the labelled split | ≥ 0.8 | yes |
| Prompt injection (instructions hidden in evidence) | 12 | instructions followed: 0 | 0 | yes |

All four sets: 43 AI calls, 74,724 tokens, about $0.52 (about $0.012 a call).

**The evidence verifier misses its target.** All three misses (E01, E10, E13) are genuine packages that the verifier
called “unclear” rather than “approve”; it never advised approving a spoofed package. It leans towards asking a person,
the safer side for money, but that means more manual reviews than the target allows. It reads text and images, not
PDFs. The AI only advises: the client approves every release.

### Hosted demo and PayPal Sandbox

| Check | Result | Date |
|---|---|---|
| Health (`/api/health`) on <https://paysettle.onrender.com> | ok: database ok, PayPal Sandbox credentials present | 11 Nov 2026 |
| Fund a tranche on the hosted demo (client Priya Shah, “Marketing site refresh”, $4,800) | PayPal Sandbox order created (intent AUTHORIZE); the browser is handed to `www.sandbox.paypal.com/checkoutnow`; the tranche shows “Waiting for PayPal approval” with a resume button | 11 Nov 2026 |
| Buyer approves in PayPal, authorization held, partial capture on release, webhook received | pending: run by hand with the sandbox buyer account | |

### Simulations

Two scripted, UI-driven simulations ran on the mock rail with live AI, each seen from the client's, the provider's and
the mediator's side: a 21-day India tour (fixed scope; conflict, mediation, settlement) and a 10-week app build with six
months of upkeep (nine rolling periods, change orders, no dispute). They found a missing notifications page (fixed), a
seeded reconciliation example that read as drift (now labelled), an MCP link count bug (fixed) and an extension panel
hidden without deadline terms (fixed). Still open: PDF evidence for the AI verifier, and simulated and real clocks
shown side by side.

### Real criteria

Pending: the owner's 20–40 anonymised acceptance criteria from past projects. Format and steps:
[`evals/README.md`](evals/README.md) and `evals/golden/real-criteria.template.json`.

## Known misses and limits

- The compiler is not called from the negotiation screen. It runs at `POST /api/ai/compile` (signed in), in the eval
  harness, on the landing page and on `/trust/ai`. The policy gate checks that each paying milestone names its proof;
  it does not check the wording of each criterion.
- The rule rewrites fail the rule linter in 23 of 30 cases (above); the AI rewrites pass it.
- The rule score on the golden set is 1.0 only after a fix made on that set.
- On the golden set a plain LLM prompt scores the same as the compiler (above).
- The evidence verifier is below its agreement target (0.813 against 0.85) and does not read PDFs.
- Sandbox only. The test suites and simulations use the mock rail; the hosted demo uses the PayPal Sandbox.
