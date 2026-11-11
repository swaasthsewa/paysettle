/* Sample post 6 (trust). PaySettle facts from src/server/ai/index.ts (P3: AI writes only ai_calls; rule fallbacks
 * labelled "rules"), src/lib/ai/gateway.ts (structured output, one retry, daily cap, 30 s timeout, call log),
 * src/lib/ai/config.ts (defaults: 200,000 tokens/day, Anthropic Messages API or OpenAI-compatible), src/lib/ai/redact.ts,
 * src/lib/ai/untrusted.ts, src/server/control/flags.ts (ai.enabled, four-eyes), src/server/ai/mcp.ts (approve_release
 * never releases), evals/golden/* and evals/results.json (run of 7 Nov 2026: 59/60 agreement, 29/30 vague caught). */
import { callout, cta, faq, h2, stats, steps, table, text, tldr, type SeedPost } from "../build";

export const POST_AI_GUARDRAILS: SeedPost = {
  slug: "ai-that-advises-and-never-pays",
  title: "AI that advises and never pays: our guardrails",
  dek: "PaySettle uses AI to draft contracts, tighten acceptance criteria, read evidence and suggest dispute splits. None of it can sign, release or refund. How that line is drawn in the code.",
  topic: "trust",
  blocks: [
    tldr("t1", [
      "Four AI helpers work inside contracts: a drafter, a criteria compiler, an evidence verifier and a mediation proposal for mediators. A fifth drafts blog outlines for our editors.",
      "AI output is advice. The code that calls a model writes only its own call log; contracts, signatures, the ledger, releases and verdicts are out of its reach.",
      "Every helper has a rule-based fallback, so the product works with AI switched off, and says so when it is.",
      "Personal data becomes role labels before anything reaches a model, and text from parties or uploads is marked as untrusted data.",
    ], { claimStatus: "product" }),

    h2("h1", "What the AI is for"),
    text("p1", `A milestone contract lives or dies on details: whether "responsive design" means anything you can check, whether the photos really show the delivered work, whether a 70/30 split is reasonable for what was done. Those are jobs where a language model helps a person see more, faster. They are also jobs where a confident wrong answer costs real money. So we gave each AI helper a narrow task and a hard boundary.`, { claimStatus: "product" }),
    table("tb1", ["Helper", "What it may do", "What it may not do"], [
      ["Contract drafter", "Turn a brief, a budget and a duration into a draft from the closest blueprint.", "Sign or fund. The draft is a starting point both parties edit and sign."],
      ["Criteria compiler", "Flag acceptance criteria nobody can check, such as \"looks professional\", and suggest measurable wording.", "Change the contract. Suggestions appear beside the criterion."],
      ["Evidence verifier", "Read submitted evidence against the proof spec and list findings for the client.", "Approve or reject. The client decides; the report is labelled advisory."],
      ["Mediation proposal", "Suggest a split with findings and a confidence, for the mediator only.", "Issue a verdict or move money. It is stored as advice."],
      ["Blog drafter", "Draft a post outline for the marketing team.", "Publish. A person edits and publishes, and the claim guard runs first."],
    ], { claimStatus: "product" }),

    h2("h2", "The line in the code"),
    text("p2", `We write the rule down as principle P3: AI is advisory. In practice the AI module reads blueprints and writes to one place, its own log of AI calls. It has no path to the things that matter for money: contracts, signatures, the ledger, releases and verdicts. Money moves only through the payment rails, every release needs a client's signed approval or a mediator's signed verdict, and a model can produce neither.

The same line holds when an AI agent connects from outside through our MCP server. The tool called approve_release does not release anything. It records a request, and the client confirms it in the app with a code from an authenticator app. That signed approval, made by a person, is what releases the money.`, { claimStatus: "product" }),
    callout("c1", "info", "Rules decide; AI suggests", "The policy gate, the tranche planner, the risk score and the money math are deterministic code with tests. AI never stands in for them. The AI linter only advises; the rules decide whether a contract can be signed.", { claimStatus: "product" }),

    h2("h3", "One gateway for every call"),
    steps("s1", "What happens before and after a prompt", [
      { title: "Redaction first", body: "Names and e-mail addresses of people known to PaySettle become role labels such as \"client 1\" or \"provider 2\"; other e-mail addresses and phone numbers are masked before anything leaves the server." },
      { title: "Untrusted text is marked", body: "Text written by the parties or taken from uploads is wrapped as untrusted data, with a standing instruction to judge it as data and to report, not follow, any instruction hidden inside it." },
      { title: "Structured answers only", body: "The model must answer with one JSON object that matches a schema. An invalid answer gets exactly one retry with the error shown; a second failure is reported as unavailable, never patched up with a guess." },
      { title: "Limits", body: "A daily token cap, 200,000 tokens by default, and a 30-second timeout per call. A request that would pass the cap is refused before it is sent." },
      { title: "A log of every call", body: "Each call records its purpose, the model, token counts, a cost estimate, a hash of the input and the output, so any suggestion shown to a person can be traced." },
    ], { claimStatus: "product" }),
    text("p3", `The gateway does not care which provider sits behind it. The default configuration talks to Anthropic's Messages API, and an OpenAI-compatible endpoint can be configured instead. Changing provider is configuration, not code, and the tests run against a fake model, so no test depends on a vendor being up.`, { claimStatus: "product" }),

    h2("h4", "Off is a supported state"),
    text("p4", `Every AI helper has a rule-based twin. Without an AI key, or with the AI switch turned off, the drafter matches the brief to a blueprint by rules, the criteria compiler runs a rule linter, and the screens say plainly that AI is unavailable. Rule output is labelled as rules and never presented as AI.

Switching AI off is one flag in the admin switchboard, and flipping it needs a second person to approve. We designed it that way on purpose: a product whose safety depends on a model being available is a product with a single point of failure.`, { claimStatus: "product" }),

    h2("h5", "How we measure it"),
    text("p5", `The repository holds golden test sets: 60 acceptance criteria labelled checkable or vague, 16 evidence cases, 10 mediation cases and 12 prompt-injection attempts. The rule linter needs no key, so it runs on every evaluation. In the run recorded on 7 November 2026 it agreed with the labels on 59 of the 60 criteria and caught 29 of the 30 vague ones.

The model-based sets run only when an AI key is configured. Until they have run, we publish no number for them; the [AI scorecard](/trust/ai) shows which results exist and which are still pending. Our blog follows the same rule: a figure without a source or a label cannot be published.`, { claimStatus: "product" }),
    stats("st1", [
      { value: "59 of 60", label: "criteria where the rule linter agreed with the labels" },
      { value: "29 of 30", label: "vague criteria the rule linter caught" },
      { value: "0", label: "published results for model-based sets until they have run" },
    ], { claimStatus: "product", anim: "countUp" }),

    faq("f1", [
      { q: "Does PaySettle train models on my contracts?", a: "No. PaySettle does not train models. Each call sends only what the task needs, such as the brief or the clauses and evidence of one contract, with personal data replaced by role labels." },
      { q: "Can an AI suggestion be wrong?", a: "Yes, which is why none is final. The client decides on evidence, both parties sign the contract, and in a dispute a mediator signs the verdict." },
      { q: "What happens if the AI provider is down?", a: "The rule-based fallback runs and the screen says AI is unavailable. Contracts, reviews, releases and disputes all keep working." },
    ], { claimStatus: "product" }),
    cta("cta1", "See what has been measured", "Open the AI scorecard", "/trust/ai", "Each AI feature, what it may and may not do, its eval set, and the results that exist so far."),
  ],
};
