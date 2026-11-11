/**
 * A8 · the public /trust page's content, "trust by design": the scenarios PaySettle was designed around, grouped by
 * theme, with what we built for each, the options we considered and set aside, how far it is built and where a reader can
 * check it. Plus the lines we hold, what is deliberately out of scope, and the risk score. Pure data (no server imports).
 *
 * Accuracy rules (P10):
 *  - a status of "built" means the answer can be seen in this build; "progress" means part of it is still being built; "decided"
 *    is a scope decision with nothing to build.
 *  - numbers that the code defines (risk weights, the Ops threshold) are computed from src/lib/policy, not typed in.
 *  - every link points at a route that exists (src/app/(site)/trust/trust.test.ts checks it).
 */
import { RAIL_CAP_DAYS, RISK_OPS_THRESHOLD, riskScore, type PWorkspace } from "@/lib/policy";

export type RiskStatus = "built" | "progress" | "decided";

/** A place where the answer can be checked. `as` names the demo person who can open an app screen (sign in from /login). */
export interface TrustLink { href: string; label: string; as?: "Hackathon Judge" | "Olivia Grant (Ops)" | "any demo person" }

export const STATUS_LABEL: Record<RiskStatus, string> = {
  built: "In the product",
  progress: "Partly built",
  decided: "Scope decision",
};
export const STATUS_HINT: Record<RiskStatus, string> = {
  built: "You can check the answer in this build.",
  progress: "Part of the answer is in this build; the rest is listed under “Still to do”.",
  decided: "A decision about what we build. There is nothing to switch on.",
};
/** Chip colours from the global .chip[data-b] set. */
export const STATUS_TONE: Record<RiskStatus, "ok" | "warn" | "plain"> = { built: "ok", progress: "warn", decided: "plain" };

/**
 * Whether the admin switchboard's "AI assistance" flag (ai.enabled) is read by the AI gateway. Today the gateway turns AI off
 * only when no AI key is set or the daily token cap is used up. Set to true once the gateway checks the flag,
 * and the AI pages will say so.
 */
export const AI_SWITCH_WIRED = true;

/* ── the risk score weights, read from the scoring code ── */

const probe = (w: Partial<PWorkspace>, tier: Parameters<typeof riskScore>[1] = "platinum") =>
  riskScore({ totalCents: 0, rail: "A1", milestones: [], clauses: [], providerPayable: true, ...w }, tier).score;

/** Each part's weight, in points out of 100, measured by switching that one part fully on in riskScore(). */
export function riskWeights(): { key: string; label: string; points: number; meaning: string }[] {
  const clause = (category: "BASELINE" | "CUSTOM", active: boolean, protective: boolean) => ({ category, code: "X", body: "x", active, protective });
  const pay = { code: "M1", type: "PAY" as const, day: 1, bps: 10_000, amountCents: 0, active: true, proof: { artifacts: [], criteria: [] }, lockRule: "", disputeRule: "", dependsOn: [] };
  return [
    { key: "valueBand", label: "Contract value", points: probe({ totalCents: 10_000_00 }), meaning: "Bands: under $1,000, under $5,000, under $10,000, and $10,000 or more." },
    { key: "protectivePruned", label: "Protective clauses switched off", points: probe({ clauses: [clause("BASELINE", false, true)] }), meaning: "Share of the blueprint's protective clauses the parties removed." },
    { key: "custom", label: "Custom clauses", points: probe({ clauses: [clause("CUSTOM", true, false)] }), meaning: "Share of active clauses that were written for this contract." },
    { key: "tier", label: "Provider trust tier", points: probe({}, "probation"), meaning: "Platinum adds nothing; standard, new and probation add more, in that order." },
    { key: "frontLoad", label: "Front-loaded payments", points: probe({ milestones: [pay] }), meaning: "Share of the money due in the first fifth of the timeline." },
  ];
}
export const OPS_THRESHOLD = RISK_OPS_THRESHOLD;

/* ── trust by design: the scenarios PaySettle was designed around ──
 * Each scenario says what could go wrong in plain words, what we built for it, and the options we considered and set
 * aside while designing, and why. Grouped by theme. */

const ANY = "any demo person" as const;
const JUDGE = "Hackathon Judge" as const;
const OPS = "Olivia Grant (Ops)" as const;

/** An option we looked at and did not take, and why. */
export interface SetAside { option: string; why: string }

export interface Scenario {
  /** Anchor on /trust, e.g. "money-held". */
  id: string;
  /** What could go wrong, as the reader would put it. */
  question: string;
  /** What PaySettle does about it. */
  built: string;
  setAside: readonly SetAside[];
  /** What is still to do, when anything is. */
  next?: string;
  status: RiskStatus;
  links: TrustLink[];
}

export interface Theme { id: string; title: string; lead: string; scenarios: readonly Scenario[] }

export const THEMES: readonly Theme[] = [
  {
    id: "money", title: "Where the money is",
    lead: "Staged work goes wrong when one side carries all the risk. The design question was who holds the money, for how long, and what happens when a payment system misbehaves.",
    scenarios: [
      {
        id: "money-held",
        question: "The client pays and the work never arrives, or the work arrives and the money never does.",
        built: "Each stage of the work is funded as a PayPal authorization: the money is held in PayPal, not paid out and not held by PaySettle. When the client approves a milestone's evidence, PaySettle captures that milestone's share and nothing more. Money for work that is not needed is voided back to the client.",
        setAside: [
          { option: "Payment up front, or on completion", why: "Either way one side carries the whole risk, which is the problem we set out to fix." },
          { option: "Holding the money in a PaySettle account", why: "That would make PaySettle a holder of other people's money, which is regulated in most markets. A custodial variant exists only in the sandbox, for comparison." },
          { option: "A marketplace with built-in escrow", why: "It works only inside that marketplace and its fees, not with clients you already have." },
        ],
        status: "built",
        links: [{ href: "/playground", label: "Judge Playground, scenario S1", as: JUDGE }, { href: "/how-it-works", label: "How it works" }],
      },
      {
        id: "money-window",
        question: "A project runs longer than PayPal will hold the money.",
        built: `PayPal honours an authorization for a limited time. PaySettle splits a contract into tranches of at most ${RAIL_CAP_DAYS.A1} days, so no hold outlives its window. A watchdog warns before a hold runs out, offers to reauthorize or roll it over, and settles in time. Operations sees every hold on a radar.`,
        setAside: [
          { option: "One authorization for the whole project", why: "It would expire before a long project ends, and the hold would lapse." },
          { option: "Capture everything first and pay out later", why: "PayPal's delayed disbursement needs partner approval and is offered in a few countries only. It is built behind a switch and off by default." },
        ],
        next: "This build runs on the PayPal Sandbox only. Production access to PayPal has not been requested yet.",
        status: "progress",
        links: [{ href: "/playground", label: "Judge Playground, scenario S3", as: JUDGE }, { href: "/ops/radar", label: "Hold-expiry radar", as: JUDGE }],
      },
      {
        id: "money-faults",
        question: "PayPal times out in the middle of a release, or sends the same notice twice.",
        built: "Every release carries its own idempotency key, so a retry after a timeout makes one capture, not two. Every PayPal webhook is verified and recognised by its transmission id, so a second copy changes nothing. A three-way reconciliation compares the ledger, PayPal and the contract, and one cent of drift stops that tranche until a person looks.",
        setAside: [
          { option: "Retrying a failed call without a key", why: "A timeout does not say whether PayPal acted; a blind retry can pay twice." },
          { option: "Reconciling by hand at month end", why: "Drift would be found weeks after the money moved." },
        ],
        status: "built",
        links: [{ href: "/playground", label: "Judge Playground, scenario S5", as: JUDGE }, { href: "/admin/webhooks", label: "Webhooks and dead-letter queue", as: JUDGE }],
      },
      {
        id: "money-chargeback",
        question: "A client approves a milestone, then files a card chargeback.",
        built: "When PayPal opens a dispute, PaySettle sends PayPal the signed approval, the fingerprints of the evidence and the timeline, so the provider's case is ready without a search.",
        setAside: [
          { option: "Keeping back part of every payout as a reserve", why: "It would cost every honest provider money for the rare bad client." },
        ],
        status: "built",
        links: [{ href: "/admin/webhooks", label: "Webhooks", as: JUDGE }],
      },
      {
        id: "money-collusion",
        question: "The client and the provider are the same person, moving money to themselves.",
        built: "PayPal checks the identity behind both accounts, and Operations can review the identities and signatures on any contract.",
        setAside: [
          { option: "Running our own identity checks", why: "PayPal already does this for every account; a second check would add friction without adding much." },
        ],
        next: "A warning when both parties sign or fund from the same network, and a limit on how much a new pair of parties can move.",
        status: "progress",
        links: [{ href: "/admin/identities", label: "Identity auditor", as: OPS }],
      },
    ],
  },
  {
    id: "contract", title: "Agreeing what “done” means",
    lead: "Most disputes are not about money held. They are about whether the work is done. So the contract itself is checked before anyone signs.",
    scenarios: [
      {
        id: "contract-vague",
        question: "“Done” is a sentence nobody can check, such as “the website should be fast and modern”.",
        built: "The Criteria Compiler flags acceptance criteria that a neutral person could not answer yes or no from evidence, says why, and suggests a measurable rewrite. A policy gate refuses signing while a paying milestone names no proof. Both parties then sign the same revision of the same text.",
        setAside: [
          { option: "Letting an AI write and approve the criteria on its own", why: "A rule check runs over every AI rewrite; wording that only sounds measurable is still rejected." },
          { option: "A free-text contract with a signature", why: "Nothing would tie a payment to the evidence its clause names." },
        ],
        status: "built",
        links: [{ href: "/trust/ai#features", label: "What the Criteria Compiler may and may not do" }, { href: "/blueprints", label: "Blueprints and their proof", as: JUDGE }],
      },
      {
        id: "contract-tamper",
        question: "Someone edits the contract, or the record of what happened, after the fact.",
        built: "The signed contract is reduced to a canonical form and hashed, and each signature is bound to that hash. Every action is written to a hash-chained audit log that a verifier checks every hour, so a later edit shows.",
        setAside: [
          { option: "Putting contracts on a blockchain", why: "Hashes and a chained log give the same tamper evidence without gas fees, wallets, chain risk or scarce specialist skills." },
        ],
        next: "Optional, later: publish the audit chain's root hash once a day.",
        status: "built",
        links: [{ href: "/admin/audit", label: "Audit chain with verification", as: JUDGE }, { href: "/security", label: "Security controls" }],
      },
      {
        id: "contract-change",
        question: "The plan changes halfway: a new step, later dates, a step that is no longer needed.",
        built: "Either party, or their agent, can propose a change order on a signed contract. Nothing changes until both parties sign it with their authenticator. The timeline shows the proposal over the signed plan, and new money is funded as a new tranche.",
        setAside: [
          { option: "Letting either party edit a signed contract", why: "The other party would lose the contract they signed." },
          { option: "Cancelling and signing a new contract", why: "It would break the link between the money already held and the work already done." },
        ],
        status: "built",
        links: [{ href: "/how-it-works", label: "How it works" }],
      },
    ],
  },
  {
    id: "evidence", title: "Evidence and disputes",
    lead: "A release is only as good as the evidence behind it, and a disagreement should not stop work that nobody disputes.",
    scenarios: [
      {
        id: "evidence-photos",
        question: "Photos are faked, made by AI, or reused from another job.",
        built: "Location and date signals flag photos taken in the wrong place or at the wrong time, and a fingerprint check compares each photo with photos from other contracts.",
        setAside: [
          { option: "Trusting photo metadata alone", why: "It is easy to edit, so it is one signal among several and never the only one." },
        ],
        next: "Reading content credentials (C2PA) where a photo carries them.",
        status: "built",
        links: [{ href: "/playground", label: "Judge Playground, scenario S2", as: JUDGE }],
      },
      {
        id: "evidence-dispute",
        question: "The parties disagree about one milestone.",
        built: "Only that milestone's money is frozen; the rest of the contract carries on and stays paid. The dispute moves through three tiers with fixed clocks: blind bids for 48 hours, then a sealed evidence vault, then a human mediator. The verdict executes as two separate payments, each with its own idempotency key.",
        setAside: [
          { option: "Freezing the whole contract", why: "It stops work and payments that nobody disputes." },
          { option: "Verdicts by AI", why: "An AI proposal is a starting point only. A mediator signs every verdict, and above $5,000 a second mediator co-signs." },
        ],
        status: "built",
        links: [{ href: "/playground", label: "Judge Playground, scenario S4", as: JUDGE }, { href: "/mediator/cases", label: "Mediator case queue", as: JUDGE }],
      },
      {
        id: "evidence-mediator",
        question: "A mediator favours one side.",
        built: "Conflict-of-interest checks run before a case is assigned. A random 5% of closed verdicts get a second review, both parties rate the mediator after settlement, and large or early-career verdicts need a senior co-signer from another firm.",
        setAside: [
          { option: "One partner law firm for every dispute", why: "PaySettle would depend on that firm, and its view would shape every outcome. Mediators come from several firms." },
        ],
        status: "built",
        links: [{ href: "/mediators", label: "How mediators are assigned" }],
      },
    ],
  },
  {
    id: "ai", title: "AI that advises",
    lead: "AI is useful for drafting and checking, and wrong often enough that it must never be in charge of money.",
    scenarios: [
      {
        id: "ai-money",
        question: "An AI decides who gets paid, and nobody can see why.",
        built: "AI drafts, checks and proposes. People sign every contract and approve every release, and a mediator signs every verdict. Every AI panel says it is advice and shows its reasons. Every AI call is logged with its purpose, model, tokens and cost, and personal data is masked before anything is sent.",
        setAside: [
          { option: "AI-led negotiation and AI verdicts", why: "A black box that moves money is the opposite of what both parties need." },
        ],
        status: "built",
        links: [{ href: "/trust/ai#governance", label: "AI governance" }, { href: "/playground", label: "Judge Playground, scenario S4", as: JUDGE }],
      },
      {
        id: "ai-claims",
        question: "The promised benefits of the AI turn out not to be true.",
        built: "We publish measured results, not projections, and the misses with them. The blog editor refuses to publish a figure without a source.",
        setAside: [
          { option: "Projected gains such as “30% faster dispute resolution”", why: "They were estimates. We measure dispute rate, time to release and on-time delivery instead." },
        ],
        next: "Running the AI test sets as a required check before each release; today the rule test set runs on every push.",
        status: "progress",
        links: [{ href: "/trust/ai#evals", label: "AI scorecard and test sets" }],
      },
      {
        id: "ai-vendor",
        question: "An AI provider changes its prices, its models or its terms.",
        built: "One gateway talks to any provider through configuration, a daily token cap limits spend, the tests run against a fake model, and the product works with AI switched off: every feature falls back to its rules. The AI reads only the case in front of it.",
        setAside: [
          { option: "Our own model, trained on legal texts", why: "It needs a large legal dataset and a standing AI team, and the case in front of it is what matters." },
          { option: "One provider wired in directly", why: "Switching would mean rewriting every feature." },
        ],
        status: "built",
        links: [{ href: "/trust/ai#features", label: "AI features and their fallbacks" }, { href: "/account/ai", label: "Today's AI use against the cap", as: ANY }],
      },
      {
        id: "ai-injection",
        question: "Someone hides instructions for the AI inside their evidence.",
        built: "Text from either party is marked as untrusted before the AI reads it, and the AI's answer is checked by rules that the hidden text cannot change. A labelled set of hidden instructions is part of the AI test sets.",
        setAside: [
          { option: "Filtering suspicious words out of evidence", why: "Attackers rephrase. Treating all party text as data is sturdier than guessing which text is an attack." },
        ],
        status: "built",
        links: [{ href: "/trust/ai#evals", label: "Prompt-injection test results" }],
      },
    ],
  },
  {
    id: "data", title: "Your data",
    lead: "A record of who paid whom, and for what, is sensitive. The design keeps what the record needs and sells none of it.",
    scenarios: [
      {
        id: "data-sale",
        question: "Data about your contracts is sold, or someone is picked out of “anonymous” statistics.",
        built: "We do not sell data: not personal data, and not anonymised trends. Analytics inside the product are aggregates with personal data removed, and any group smaller than five is hidden.",
        setAside: [
          { option: "Selling anonymised market trends", why: "Small groups can be re-identified, and it would cost the trust the product depends on." },
        ],
        status: "built",
        links: [{ href: "/privacy#no-sale", label: "Privacy: we do not sell data" }, { href: "/marketing", label: "Aggregate analytics", as: JUDGE }],
      },
      {
        id: "data-erasure",
        question: "You ask to be erased, but evidence records cannot be changed.",
        built: "The design: keep the hashes, encrypt personal fields with a key per person, and destroy that key on erasure. The record still proves what happened; the person can no longer be read from it.",
        setAside: [
          { option: "Deleting rows from the record", why: "It would break the audit chain that proves every other contract." },
        ],
        next: "Designed and documented; to be built before any real money moves.",
        status: "decided",
        links: [{ href: "/privacy", label: "Privacy" }],
      },
    ],
  },
];

/** Every scenario, in page order. */
export const SCENARIOS: readonly Scenario[] = THEMES.flatMap((t) => t.scenarios);

/* ── lines we hold ── */

export const WE_DO_NOT: readonly { title: string; body: string; scenario?: string }[] = [
  { title: "We do not sell data", body: "Not personal data, and not anonymised trends. Analytics stay inside the product, as aggregates.", scenario: "data-sale" },
  { title: "We do not use a blockchain", body: "No tokens, wallets, gas fees or DAO. Tamper evidence comes from hashes and a hash-chained audit log.", scenario: "contract-tamper" },
  { title: "We do not earn insurance commissions", body: "There is no insurance product, and nothing about a risk score is linked to revenue.", scenario: "formula" },
  { title: "AI never moves money", body: "AI drafts, checks and proposes. People sign, approve and release, and a mediator signs every verdict.", scenario: "ai-money" },
];

/* ── deliberately out of scope: ideas from the first plan that we chose not to build ── */

export const OUT_OF_SCOPE: readonly { title: string; why: string }[] = [
  { title: "Government buyers and their systems", why: "Procurement is slow and system integrations are fragile; a small team would spread too thin." },
  { title: "Consortia, non-profits and universities", why: "Too broad a market to serve well at first." },
  { title: "An enterprise sales team", why: "PaySettle is self-serve, with one fee taken when a milestone is released." },
  { title: "Contract insurance", why: "It needs insurance licences. If it comes later, a licensed insurer sells it and PaySettle takes no commission." },
  { title: "DAO governance, tokens and decentralised insurance", why: "Governance is four-eyes approval and mediator panels; reputation is a trust tier earned from real contract outcomes." },
];

/* ── who it is for ── */

export const FOR_WHOM = {
  who: "Freelancers and small service businesses, and the clients who hire them, for staged projects of about $1,000 to $25,000.",
  examples: ["A web or app build delivered in milestones", "A workshop rebuilding a classic car engine", "An interior fit-out paid room by room", "A consulting sprint with a sign-off at each stage"],
  notFor: "Government procurement, consortia, non-profits and universities are not target segments in the 24-month plan.",
} as const;

/** Count of scenarios per status, in display order. */
export function statusCounts(list: readonly { status: RiskStatus }[] = SCENARIOS): { status: RiskStatus; label: string; n: number }[] {
  return (["built", "progress", "decided"] as const).map((s) => ({ status: s, label: STATUS_LABEL[s], n: list.filter((r) => r.status === s).length }));
}

/* ── the AI features, for the scorecard at /trust/ai (P3: AI advises; people decide) ── */

export interface AiFeature {
  id: "drafter" | "compiler" | "verifier" | "mediator" | "blog";
  name: string;
  does: string;
  may: readonly string[];
  mayNot: readonly string[];
  /** What runs when AI is off, unavailable or answers badly. */
  fallback: string;
  /** The labelled test set in evals/golden, when there is one. */
  evalSet: "compile" | "evidence" | "mediate" | null;
  evalNote?: string;
}

export const AI_FEATURES: readonly AiFeature[] = [
  {
    id: "drafter", name: "Contract Drafter",
    does: "Suggests a blueprint, a milestone plan and a split of the budget from a short project brief.",
    may: ["Pick one of the published blueprints and fit it to the days and budget asked for", "Propose milestones, proof and shares as a draft both parties then edit"],
    mayNot: ["Sign or send a contract", "Change a contract once anyone has signed it", "Get past the policy gate: the same rules check every draft before signing"],
    fallback: "Picks the closest blueprint by keyword match and scales it to the days and budget asked for.",
    evalSet: null, evalNote: "No labelled set yet. Every draft goes through the policy gate before anyone can sign.",
  },
  {
    id: "compiler", name: "Criteria Compiler",
    does: "Checks each acceptance criterion: could a neutral person answer yes or no from the evidence alone? When not, it suggests a measurable rewrite.",
    may: ["Flag vague criteria and say why", "Suggest a measurable rewrite that keeps the intent", "Point out risky clauses such as deemed acceptance or unlimited revisions"],
    mayNot: ["Let a criterion with taste words and nothing measurable through: the rule check overrides the model", "Change a criterion: its rewrites are suggestions"],
    fallback: "A word and pattern check for taste words, open-ended wording, numbers, links and named artifacts.",
    evalSet: "compile",
  },
  {
    id: "verifier", name: "Evidence Verifier",
    does: "Reads the submitted evidence against the milestone's proof spec and reports which criteria look met, with confidence and the files it relied on.",
    may: ["Recommend approving, asking for a fix, or say it is unclear", "Cite the files behind each finding"],
    mayNot: ["Approve a milestone or release money: the client decides", "Recommend approval when a metadata signal failed or a required file is missing", "Mark a criterion as met without citing a file it was given"],
    fallback: "Counts the required file types and reads the metadata signals. It never recommends approval.",
    evalSet: "evidence",
  },
  {
    id: "mediator", name: "Mediator advice",
    does: "Proposes how to split a disputed milestone, with findings tied to the dispute rule, the clauses, the evidence and both sides' rebuttals.",
    may: ["Propose the provider's share with reasons and a confidence", "List what is missing for a fair decision"],
    mayNot: ["Give a verdict or move money: a mediator signs every verdict", "Keep a finding without a citation: uncited findings are marked and lower the confidence"],
    fallback: "Pro-rata when the dispute rule says so and the evidence states a count; otherwise the midpoint of the last blind bids; otherwise 50/50, marked as a placeholder.",
    evalSet: "mediate",
  },
  {
    id: "blog", name: "Blog drafting",
    does: "Drafts a blog post from a brief for the marketing team.",
    may: ["Save a draft for a person to edit"],
    mayNot: ["Publish: a person with publishing rights does", "Get a figure published without a source: the claim guard blocks it"],
    fallback: "A rule-based outline of headings and placeholders, marked as illustrative.",
    evalSet: null, evalNote: "No labelled set. Every post must pass the claim guard and the copy check before it can be published.",
  },
];
