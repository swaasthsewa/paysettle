/**
 * F3 · every visible string of the public site (landing, marketing pages, waitlist, legal) in one place.
 * Tone: plain, calm, specific. Say where the money is. No guarantee language (P10, tools/copy-lint.mjs).
 * Requirement ids: F3 (site, waitlist), F1.1 (sign-up path), Business Plan v4 §1–§9 (messaging).
 */
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export const site = {
  name: "PaySettle",
  logoLabel: "PaySettle home",
  sandboxLine: "Sandbox build: PayPal Sandbox or simulated money only. Nothing real moves.",

  nav: {
    label: "Site",
    openMenu: "Open the menu",
    closeMenu: "Close the menu",
    signIn: "Sign in",
    demo: "Try the live demo",
    openApp: "Open the app",
    links: [
      { href: "/how-it-works", label: "How it works", text: "From blueprint to release, step by step" },
      { href: "/for-providers", label: "For providers", text: "Get paid on delivery, without chasing" },
      { href: "/for-clients", label: "For clients", text: "Pay only for verified progress" },
      { href: "/security", label: "Security", text: "Audit chain, reconciliation, four-eyes" },
      { href: "/pricing", label: "Pricing", text: "One fee per released milestone" },
      { href: "/blog", label: "Blog", text: "How milestone escrow works, in practice" },
    ],
  },

  footer: {
    about: "Checkable milestone contracts. Money held through PayPal, released milestone by milestone on proof.",
    groups: [
      { title: "Product", links: [{ href: "/how-it-works", label: "How it works" }, { href: "/pricing", label: "Pricing" }, { href: "/security", label: "Security" }, { href: "/trust", label: "Trust by design" }, { href: "/trust/ai", label: "AI scorecard" }, { href: "/judges", label: "For judges" }, { href: "/playground", label: "Judge playground" }] },
      { title: "People", links: [{ href: "/for-providers", label: "For providers" }, { href: "/for-clients", label: "For clients" }, { href: "/register", label: "Create an account" }, { href: "/mediators", label: "Become a mediator" }, { href: "/blog", label: "Blog" }, { href: "/waitlist", label: "Join the waitlist" }, { href: "/login", label: "Live demo" }] },
      { title: "Legal", links: [{ href: "/privacy", label: "Privacy" }, { href: "/terms", label: "Terms" }] },
    ],
    hackathon: "Built for the PayPal AI Hackathon, November 2026.",
    copyright: (y: number) => `© ${y} PaySettle. Draft product; not a licensed payment service.`,
  },

  /* ── the landing page ── */
  landing: {
    hero: {
      line1: "Agree what done means.",
      line2: "Get paid when it is.",
      badge: "A contract compiler for staged work · PayPal Sandbox",
      lead: "A vague statement of work goes in. Checkable milestones come out, signed by both sides. PayPal holds the money, and each milestone's share is released only against the evidence its clause names. For freelancers, small service businesses and the clients who hire them, on projects of about $1,000 to $25,000.",
      demo: "Try the live demo",
      judge: "Judge playground",
      waitlist: "Join the waitlist",
      chips: { client: "Client's money, held in PayPal", provider: "Provider, paid on delivery", both: "Evidence checked per milestone" },
      art: "Key to the animation: money pulses leave the client, wait in a PayPal hold, pass one milestone's evidence check and reach the provider; a failed check freezes only that share.",
    },

    compiler: {
      kicker: "Contract compiler",
      title: "Vague wording goes in. A checkable clause comes out.",
      before: "The website should be fast and modern.",
      rejected: "Rejected",
      rewrite: "Suggested rewrite",
      signed: "Clause in the blueprint both sides sign",
      proof: "Proof it names",
      steps: [
        { head: "Compile", body: "Each acceptance criterion is checked. Taste words and open-ended wording with nothing to measure are rejected, with a measurable rewrite." },
        { head: "Both sides sign", body: "Client and provider edit the rewrite into the clause they want and sign the same revision. The clause names the file that proves it." },
        { head: "Evidence comes in", body: "The provider uploads that file. Rule checks and the AI verifier report what matches; the client reads them and approves." },
        { head: "PayPal releases that share", body: "The approval triggers a partial capture of that milestone's share from the PayPal authorization. The rest stays held." },
      ],
      share: (pct: string, code: string) => `${code} is ${pct} of the contract.`,
      note: "The reason and rewrite are the rule-based compiler's output for this sentence, worked out when this page loads. With an AI key, the AI proposes wording too; a taste word with nothing measurable is still rejected.",
    },

    problem: {
      kicker: "The problem",
      title: "Project work carries risk on both sides.",
      lead: "Today one side always goes first, and “done” is a sentence in an e-mail. When the two sides disagree, nobody can prove what was promised.",
      client: { title: "The client", body: "Pays a deposit and watches progress that is hard to measure. Getting money back means a chargeback or a lawyer, so new providers feel like a gamble." },
      provider: { title: "The provider", body: "Delivers work that cannot be taken back before being paid in full. Late payment, scope creep and chargebacks follow, so deposits grow and deals are lost." },
      both: { title: "Both of them", body: "“Done” is prose, so completion cannot be proven. Disputes are slow, costly and personal, and they freeze the whole relationship." },
      art: "The client's teal line and the provider's amber line run side by side and never meet: there is no shared definition of done.",
    },

    how: {
      kicker: "How it works",
      title: "Six steps from blueprint to release.",
      steps: [
        { head: "Start from a blueprint", body: "A vetted milestone plan for your kind of project. You change it only by removing or adding milestones, never by rewriting the protection." },
        { head: "Make every milestone checkable", body: "The Criteria Compiler turns “make it fast” into “Lighthouse mobile score of 85 or more on the staging address”, and flags what cannot be checked." },
        { head: "Hold the money in PayPal", body: "Both sides sign the same revision. The client approves a PayPal authorization for the tranche; the money stays in PayPal." },
        { head: "Submit evidence, get an AI check", body: "The provider uploads proof against the spec. The Evidence Verifier reports what matches, with confidence and reasons." },
        { head: "The client approves", body: "A person reads the proof and the report, and approves with a second factor, or asks for a specific fix." },
        { head: "PayPal releases that milestone", body: "A partial capture moves that milestone's share to the provider. The ledger, the receipt and the audit chain update together." },
      ],
      example: (title: string, days: number) => `Example: ${title}, ${days} days`,
      total: (cents: number) => `${money(cents)} contract`,
      gate: "Gate: blocks the next step, pays nothing",
      held: "Held in PayPal",
      released: "Released",
      exampleNote: (n: number, count: number) => `${plural(count, "milestone")} from the blueprint as published. The library holds ${plural(n, "blueprint")} today.`,
    },

    disputes: {
      kicker: "Disputes",
      title: "A disagreement freezes one milestone, not the contract.",
      lead: "The rest of the work goes on and stays paid. The disputed milestone moves through three tiers with fixed clocks.",
      strip: { released: "Released", frozen: "Frozen: in dispute", held: "Held, work continues" },
      tiers: [
        { head: "Tier 1 · blind bids, 48 hours", body: "Each side proposes a split in secret. Close offers settle on their own." },
        { head: "Tier 2 · evidence vault, to 96 hours", body: "Both sides add rebuttals and annotations. The vault is sealed and hashed." },
        { head: "Tier 3 · a human mediator", body: "An AI proposal is a starting point only. A mediator signs the verdict; above $5,000 a second mediator co-signs." },
      ],
      split: "The verdict executes as two legs: the refund to the client and the release to the provider, each with its own idempotency key.",
    },

    ai: {
      kicker: "AI",
      title: "AI advises. People decide.",
      lead: "Four AI roles do the reading and the drafting. None of them can move money, edit a signed contract or sign anything.",
      roles: [
        { name: "Drafter", body: "Turns a one-line brief into a first milestone plan from the right blueprint." },
        { name: "Criteria Compiler", body: "Rewrites vague acceptance into measurable proof specs and flags what cannot be checked." },
        { name: "Evidence Verifier", body: "Reads the proof against the spec and reports matches, gaps and confidence, with cited reasons." },
        { name: "Mediator", body: "Proposes a split for a disputed milestone from the sealed vault, for a human mediator to accept or change." },
      ],
      advises: "Advises",
      gate: { title: "The human gate", body: "Release needs the client's signed approval with a second factor, or a mediator's signed verdict. The database gives the AI service no write access to contracts, signatures or the ledger." },
    },

    agents: {
      kicker: "Agents",
      title: "Your agent can contract. A person still holds the pen.",
      lead: "PaySettle exposes MCP tools, so a procurement or assistant agent can draft, negotiate and submit evidence. Every step that moves money stops for a person.",
      calls: [
        { who: "Client agent", tool: "draft_contract", note: "Proposes milestones from a blueprint", gate: false },
        { who: "Provider agent", tool: "propose_changes", note: "Prunes and appends; humans review the diff", gate: false },
        { who: "Client agent", tool: "request_funding", note: "Creates the PayPal order", gate: false },
        { who: "Person", tool: "approve in PayPal", note: "The client approves the hold in PayPal itself", gate: true },
        { who: "Provider agent", tool: "submit_evidence", note: "Uploads proof against the spec", gate: false },
        { who: "Person", tool: "approve_release + MFA", note: "No agent can approve a release", gate: true },
      ],
      gateLabel: "Human gate",
    },

    paypal: {
      kicker: "Built on PayPal",
      title: "One authorization. A partial capture per milestone.",
      lead: "The client approves a PayPal authorization for a tranche of work. Each approved milestone is captured from it, the last capture is final, and whatever is left is voided back to the client.",
      bar: { authorized: "Authorized and held in PayPal", captured: "Captured on approval", voided: "Unused: voided back" },
      facts: [
        { head: "Money stays in PayPal", body: "On the production rails (A1 and B) PaySettle orchestrates the hold and never receives the principal." },
        { head: "Tranches fit the hold window", body: "A PayPal authorization has a limited life, so longer contracts are funded in tranches of up to 26 days, with a watchdog for rollover." },
        { head: "PayPal's own protection still applies", body: "Release-final means final inside PaySettle. PayPal's buyer and seller programmes are not waived." },
      ],
      art: (auth: string) => `A bar for one PayPal authorization of ${auth}: the captured parts, the part still held, and the part voided back.`,
    },

    trust: {
      kicker: "Trust",
      title: "Every cent has a trail.",
      lead: "The ledger is double-entry in integer cents and is reconciled against PayPal and against the contract. Drift stops the contract until two people clear it.",
      items: [
        { head: "Hash-chained audit", body: "Every action is a row whose hash covers the row before it. A change anywhere breaks the chain, and the chain can be re-checked at any time." },
        { head: "Three-way reconciliation", body: "PayPal, the ledger and the contract are compared on every run. Matched, in flight or drift: the answer is shown, not assumed." },
        { head: "Four-eyes control", body: "Clearing a breaker or replaying a webhook needs a second person. The database refuses an approver who is also the initiator." },
        { head: "Sealed revisions", body: "Signatures bind to a revision hash. An edit after one side signs voids that signature, so nobody signs a moving target." },
      ],
      live: { audit: (n: number) => `${plural(n, "row")} in this build's audit chain`, recon: (v: string | null) => ({ CLEAN: "Last reconciliation: clean, zero drift", IN_FLIGHT: "Last reconciliation: matched, some releases still in flight", DRIFT: "Last reconciliation found drift; the affected contracts were stopped for review" } as Record<string, string>)[v ?? ""] ?? "No reconciliation run yet in this build" },
    },

    limits: {
      title: "What this is, and what it is not.",
      not: [
        "Not live money. This is a sandbox build; production needs PayPal approval and legal review.",
        "Not a replacement for PayPal's buyer and seller protection. Those still apply.",
        "Not an AI judge. AI drafts and checks; people approve and sign.",
        "Not a marketplace. Bring your own clients and keep them.",
      ],
      is: "A way to agree what done means, and to release money only when it is.",
    },

    closing: {
      title: "Bring one project. Agree what done means.",
      lead: "Pick a person in the live demo and run a contract from blueprint to release in a few minutes.",
      demo: "Try the live demo",
      judge: "Judge playground",
      waitlist: "Join the waitlist",
      count: (n: number) => (n === 0 ? "Be the first on the waitlist" : `${plural(n, "person", "people")} on the waitlist`),
      more: "Read more",
      links: [
        { href: "/how-it-works", label: "How it works" },
        { href: "/for-providers", label: "For providers" },
        { href: "/for-clients", label: "For clients" },
        { href: "/security", label: "Security" },
        { href: "/pricing", label: "Pricing" },
      ],
    },
  },

  /* ── short pages ── */
  pages: {
    how: {
      kicker: "How it works",
      title: "From blueprint to release",
      lead: "One loop, the same for every kind of project. Each step is a screen in the live demo.",
      loop: [
        { head: "Brief or blueprint", body: "Type a brief such as “booking web app MVP, $6,000, 4 weeks”, or open a blueprint for your vertical. Each blueprint milestone carries a proof spec, a lock rule and a dispute rule." },
        { head: "Negotiate by pruning and appending", body: "Both sides remove milestones they do not need and add their own as structured items. System clauses stay on. Every accepted change is a new revision with its own hash." },
        { head: "Policy gate", body: "Ten deterministic rules check the plan before anyone can sign: shares add up to 100%, every paid milestone has a checkable proof, tranches fit PayPal's hold window, no clause tries to switch protection off." },
        { head: "Both sign the same revision", body: "Signatures bind to the revision hash, with a second factor. High-risk contracts go to Ops for clearance first." },
        { head: "Fund a tranche in PayPal", body: "The client approves a PayPal authorization for the next tranche. Until then the provider sees the tranche as unfunded and nothing starts." },
        { head: "Evidence and the verifier", body: "The provider uploads proof. Files are hashed into one root; the Evidence Verifier reports against the spec. EXIF and GPS are signals, not proof." },
        { head: "Approve or ask for a fix", body: "The client approves with a second factor, or lists what is missing. A review clock runs; a third rejection opens a dispute and preserves the evidence." },
        { head: "Release and receipt", body: "A partial capture moves that milestone's share to the provider, less the release fee. The ledger, receipt and audit chain update together." },
      ],
      states: { title: "Where the money is, at every moment", held: "Held in PayPal for a milestone not yet approved", released: "Released to the provider after approval", disputed: "Frozen while one milestone is in dispute", refunded: "Returned to the client by verdict, refund or void" },
    },
    providers: {
      kicker: "For providers",
      title: "Get paid on delivery, without chasing",
      lead: "Send a client a milestone plan with the protection already in it. They fund in PayPal before you start, and each milestone pays out when its proof is approved.",
      points: [
        { b: "Proof the client can pay.", t: "You start work against money already authorized in PayPal, not a promise." },
        { b: "No moving goalposts.", t: "Acceptance is written as checkable proof before anyone signs. A new request becomes a change, not a surprise." },
        { b: "Disputes stay small.", t: "Only the milestone in question freezes. Everything already released stays yours." },
        { b: "A record that travels with you.", t: "Trust tiers grow with clean releases and shorten clearance on your next contract." },
      ],
      setup: { title: "What you need to start", items: ["An account with an authenticator app (required for providers)", "Business name, category and tax id, kept masked", "A licence or registration document, kept as a fingerprint", "A PayPal business account that can receive payments"] },
    },
    clients: {
      kicker: "For clients",
      title: "Pay only for verified progress",
      lead: "Your money waits in PayPal until you have seen the proof you agreed to. If something is wrong, you ask for a fix or open a dispute on that milestone alone.",
      points: [
        { b: "Know what done means.", t: "Every paid milestone has a proof spec you can read before you sign." },
        { b: "Money stays in PayPal.", t: "You approve an authorization; it is captured milestone by milestone only after you approve." },
        { b: "Read an AI check, then decide.", t: "The verifier highlights gaps against the spec. The decision and the signature are yours." },
        { b: "Get back what was not delivered.", t: "Unused authorization is voided; a verdict can split a disputed milestone." },
      ],
    },
    security: {
      kicker: "Security",
      title: "Controls you can check",
      lead: "PaySettle is built so that the important rules are enforced by code and by the database, not by good intentions.",
      groups: [
        { title: "Accounts", items: ["Passwords stored with scrypt (N = 2¹⁷); at least 12 characters, never containing your e-mail name", "Authenticator-app second factor with replay refusal, and ten single-use recovery codes stored only as hashes", "Sessions in an httpOnly cookie, only the token's hash stored; idle limit 60 minutes, absolute 12 hours; end any session from your account", "Five wrong codes or passwords pause the account and are logged"] },
        { title: "Money", items: ["Money moves only through the PayPal rail interface, with an idempotency key stored before every call", "Integer cents and basis points; the ledger is double-entry and reconciled three ways", "Every release needs a signed client approval or a signed mediator verdict", "PayPal webhooks are signature-verified and deduplicated by transmission id"] },
        { title: "Records", items: ["Signed revisions, verdicts and the audit chain are append-only, enforced by database triggers", "Uploaded files are treated as untrusted data, including inside AI prompts", "Tax ids are kept masked; licence files are kept as SHA-256 fingerprints", "Sandbox-only features (time travel, faults, the demo persona picker) are refused in production builds"] },
      ],
      report: "Found a problem? Write to security@paysettle.example with steps to reproduce. Please do not test against other people's accounts.",
    },
    pricing: {
      kicker: "Pricing",
      title: "One fee, charged when a milestone is released",
      lead: "No subscription to start and no fee to hold money. The release fee comes out of each released milestone. Made for freelancers and small service businesses with staged projects of about $1,000 to $25,000.",
      plans: [
        { name: "Release fee", price: "2.5%", per: "of each released milestone", items: ["Configurable per vertical by Finance", "Rounded half to even, to the cent", "Nothing charged on refunded or voided money"] },
        { name: "Mediation", price: "$25", per: "per Tier 3 case, paid by the party at fault", items: ["Tiers 1 and 2 are automated and free", "Rewards early settlement", "Set by Finance; demo value shown"] },
        { name: "Pro for providers", price: "Later", per: "monthly, after the pilot", items: ["Lower release fee", "Custom blueprints and analytics", "Verified badge"] },
      ],
      example: { title: "Worked example", lines: (total: number, fee: number) => [`Contract ${money(total)}, released in full`, `Release fees at 2.5%: ${money(fee)}`, `Provider receives ${money(total - fee)}, before PayPal's own processing fees`] },
      note: "Illustrative pilot pricing. PayPal's processing fees are separate and depend on the rail and the countries involved.",
    },
  },

  /* ── waitlist ── */
  waitlist: {
    kicker: "Waitlist",
    title: "Join the pilot waitlist",
    lead: "We are lining up 5 to 10 providers and their clients for a first real-money pilot, once PayPal approval and legal review are in place.",
    count: (n: number) => (n === 0 ? "Nobody has joined yet. You would be first." : `${plural(n, "person", "people")} have joined so far.`),
    fields: { email: "Work e-mail", role: "You are a", note: "What would you run through PaySettle?", noteHint: "optional, up to 500 characters" },
    roles: { provider: "Provider: I sell project work", client: "Client: I buy project work", both: "Both", platform: "Agent or platform builder", other: "Something else" },
    trap: "Leave this field empty",
    send: "Join the waitlist",
    sending: "Joining…",
    use: "We use your e-mail only to invite you to the pilot. No newsletter, no sharing.",
    result: {
      joined: "You are on the list. We will write when the pilot opens.",
      already: "That e-mail is already on the list. Nothing more to do.",
      invalid: "Please check the highlighted fields.",
      limit: (s: number) => `Too many tries from this network. Please wait ${Math.ceil(s / 60)} minute${s > 60 ? "s" : ""} and try again.`,
      failed: "Something went wrong on our side and nothing was saved. Please try again.",
    },
    problems: { email: "Give an e-mail address we can reach.", role: "Pick what describes you best.", note: "Keep the note to 500 characters." },
  },

  legal: {
    draft: "Draft for the hackathon build. Not reviewed by counsel; it will change before any real money moves.",
    updated: "Last updated 8 November 2026",
    contents: "On this page",
    related: "Related pages",
    privacy: {
      title: "Privacy",
      lead: "What PaySettle keeps about you, why, and for how long. Plainly.",
      sections: [
        { id: "what", title: "What we keep", body: ["Your name, e-mail, role, and the profile you fill in (currency, time zone, billing country). For providers: business name, category, a masked tax id and fingerprints of licence files.", "Contracts you take part in, their revisions and signatures, evidence fingerprints and files you upload for a milestone, and the money records of each release."] },
        { id: "why", title: "Why", body: ["To run the contracts you agree to, to show both sides where the money is, and to resolve disputes. We do not sell personal data, and we never will."] },
        { id: "ai", title: "AI processing", body: ["Personal data is redacted before text is sent to an AI model. Every AI call is logged with its purpose and cost. AI output is advisory and never changes a contract or moves money."] },
        { id: "paypal", title: "PayPal", body: ["Payments happen in PayPal. PayPal processes your payment details under its own privacy statement; PaySettle stores PayPal references, not card or bank numbers."] },
        { id: "keep", title: "How long", body: ["Contract, ledger and audit records are kept as long as the law requires for financial records. Waitlist e-mails are deleted when the pilot invitations are done, or earlier on request."] },
        { id: "rights", title: "Your choices", body: ["Ask for a copy of your data, a correction or deletion at privacy@paysettle.example. Append-only records (signatures, ledger, audit) are kept but can be detached from your name where the law allows."] },
      ],
    },
    terms: {
      title: "Terms",
      lead: "The short version of how PaySettle works between you, the other party and us.",
      sections: [
        { id: "sandbox", title: "This is a sandbox build", body: ["The hackathon build uses PayPal Sandbox or simulated money. No real money moves, and nothing here is an offer of a payment service."] },
        { id: "role", title: "What PaySettle does", body: ["PaySettle records the contract both of you sign, orchestrates PayPal holds and releases according to it, and runs the dispute process you agreed to. On the production rails it does not receive the money itself."] },
        { id: "final", title: "Release-final", body: ["Once a milestone's release is completed, PaySettle accepts no further dispute on it. PayPal's own buyer and seller programmes are not affected by this and still apply."] },
        { id: "ai", title: "AI is advice", body: ["Drafts, criteria, verifier reports and mediator proposals are suggestions. A person approves every release and signs every verdict."] },
        { id: "fees", title: "Fees", body: ["A release fee is taken from each released milestone at the rate shown when you signed. Mediation fees apply only at Tier 3."] },
        { id: "limits", title: "Before real money", body: ["Production use needs PayPal programme approval and legal review in each market. These terms will be replaced before then."] },
      ],
    },
  },

  notFoundCta: "Back to the home page",
} as const;

export type SiteCopy = typeof site;
export { money as siteMoney, plural as sitePlural };
