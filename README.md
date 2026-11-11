# PaySettle

**Agree what “done” means. Get paid when it is.** PaySettle turns staged service work into checkable milestone contracts:
the client's money is held through PayPal, the provider submits the evidence the contract names, AI checks it, the client
approves, and the milestone is released. If they disagree, only that milestone is frozen and a structured process proposes
a fair split.

Built for the PayPal AI Hackathon. **Sandbox only: no real money moves.**

## For judges

1. Open the hosted demo (link in the Devpost submission) or run it locally (below), then press **Try the live demo**.
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
npm run verify      # typecheck · lint · unit tests · copy lint · name, vocabulary and secret checks · production build
npm run hooks       # once per clone: turn on the pre-commit secret check
npm run gate:trace  # every requirement id appears in code and in a test
```

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
