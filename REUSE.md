# Reused components

PaySettle is a new project, built for the PayPal AI Hackathon (submission period from 1 Oct 2026). To build faster, it reuses
generic components from the author's own earlier projects. Each item below was copied or ported, renamed, and adapted;
no data, content, branding or client material from those projects is included.

| Source project (author's own) | What was reused | How | Where in PaySettle |
|---|---|---|---|
| Eyes Opener (open-source eye-care app) | App shell: collapsible rail with no-flash boot, top bar, menu groups, trail, search, theme toggle, line icons; design tokens and shell CSS; security headers; Dockerfile; name-leak check | Copied, renamed, re-themed | `src/components/shell/*`, `src/components/nav.tsx`, `src/app/globals.css`, `next.config.ts`, `Dockerfile`, `tools/no-old-name.mjs` |
| Eyes Opener | Landing-page structure (hero, chapters, flow, closing, motion) | Structure only; all copy and art new | `src/app/(site)/*` |
| SangamIQ (planning product) | TOTP second factor with recovery codes (RFC 6238), scrypt password hashing | Copied (pure functions) | `src/lib/identity/totp.ts`, `src/lib/identity/password.ts` |
| SangamIQ | Session design (hashed token, idle and absolute limits), lockout, traceability gate | Ported pattern | `src/lib/session.ts`, `src/app/(auth)/login/actions.ts`, `tools/traceability.ts` |
| HEARTBEAT (delivery platform) | RBAC matrix as data, state-machine framework, audit writer, webhook dispatcher, job scheduler, Playwright + axe set-up | Ported pattern | `src/lib/rbac.ts`, `src/lib/fsm.ts`, `src/lib/audit.ts`, `src/lib/webhooks/*`, `src/lib/jobs/*`, `e2e/*` |
| SCMTIPS / ARO (supply-chain intelligence) | AI gateway design (provider-agnostic, daily token cap, redaction, untrusted-text marking, status endpoint, fake-LLM tests); contrast checks | Ported from Python to TypeScript | `src/lib/ai/*` |
| ClapJar (author's own project) | Typed content blocks for long-form posts, readable slug rules | Ported pattern; PaySettle's own block set | `src/lib/blog/blocks.ts`, `src/server/blog/slug.ts`, `src/components/blog/*` |
| PayPal (public) | Sandbox and AG Grid boilerplates as reference | Reference only | `src/lib/rails/paypal.ts` |

Everything else — contracts, policy engine, rails, ledger, evidence, disputes, reconciliation, AI agents, MCP server,
Judge Playground and all content — was written for PaySettle during the hackathon.
