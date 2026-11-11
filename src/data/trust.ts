/**
 * A8 · the public /trust page's content: the 24 risks our own red team raised against the PaySettle plan, our answer to
 * each, how far that answer is built, and the screens or pages where a reader can check it. Plus "what we do not do" and the
 * eight further risks we track. Pure data (no server imports) so client components can render it.
 *
 * Accuracy rules (P10):
 *  - a status of "built" means the answer can be seen in this build; "progress" means part of it is still being built; "decided"
 *    is a scope decision with nothing to build.
 *  - numbers that the code defines (risk weights, the Ops threshold) are computed from src/lib/policy, not typed in.
 *  - every link points at a route that exists (src/data/trust.test.ts checks it).
 */
import { RAIL_CAP_DAYS, RISK_OPS_THRESHOLD, riskScore, type PWorkspace } from "@/lib/policy";

export type RiskStatus = "built" | "progress" | "decided";
export type RiskArea = "Execution" | "Market" | "Financial" | "Regulatory" | "Competitive";

/** A place where the answer can be checked. `as` names the demo person who can open an app screen (sign in from /login). */
export interface TrustLink { href: string; label: string; as?: "Hackathon Judge" | "Olivia Grant (Ops)" | "any demo person" }

export interface Risk {
  n: number;
  area: RiskArea;
  /** The red team's rating of the risk, out of 10. */
  rating: number;
  /** The part of the business model the risk is about. */
  block: string;
  /** Plan horizon in months the risk was raised against. */
  horizon: 12 | 24;
  risk: string;
  answer: string;
  /** What is still to do, when anything is. */
  next?: string;
  status: RiskStatus;
  links: TrustLink[];
}

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

/* ── the 24 red-team risks ── */

const ANY = "any demo person" as const;
const JUDGE = "Hackathon Judge" as const;
const OPS = "Olivia Grant (Ops)" as const;

export const RISKS: readonly Risk[] = [
  {
    n: 1, area: "Execution", rating: 7, block: "Value proposition", horizon: 12,
    risk: "The plan promised AI results such as 30% faster dispute resolution, 20% lower legal costs and 40% fewer penalties. Those numbers may not hold.",
    answer: "We removed those percentages and do not publish them. AI only advises: every release still needs a person's signed approval or a mediator's signed verdict. Each AI feature has a rule-based fallback and a labelled test set.",
    next: "Model results on the AI scorecard appear once the test sets run with an AI key. Until then the scorecard shows the rule results and says the model results are pending. The blog editor already refuses to publish a figure without a source.",
    status: "progress",
    links: [{ href: "/trust/ai", label: "AI scorecard" }, { href: "/account/ai", label: "AI & agents settings", as: ANY }],
  },
  {
    n: 2, area: "Market", rating: 6, block: "Customer segments", horizon: 12,
    risk: "Going after enterprises, governments and international buyers at the same time would spread a small team too thin.",
    answer: "We start with freelancers and small service businesses running projects of about $1,000 to $25,000. Government buyers are not in the 24-month plan.",
    status: "decided",
    links: [{ href: "/trust#for-whom", label: "Who PaySettle is for" }, { href: "/pricing", label: "Pricing" }],
  },
  {
    n: 3, area: "Execution", rating: 5, block: "Channels", horizon: 12,
    risk: "Relying on law firms and regulators to lend credibility makes the business depend on them.",
    answer: "The core product needs only PayPal. Disputes that need a person go to our own mediator network, drawn from several firms, so no single firm is critical.",
    status: "built",
    links: [{ href: "/mediators", label: "The mediator network" }, { href: "/mediator/cases", label: "Mediator case queue", as: JUDGE }],
  },
  {
    n: 4, area: "Financial", rating: 4, block: "Customer relationships", horizon: 12,
    risk: "Account managers and manual risk reviews would make each customer expensive to win.",
    answer: `PaySettle is self-serve. A person from Operations looks only at contracts with a risk score of ${RISK_OPS_THRESHOLD} or more, and a mediator only at disputes that reach Tier 3.`,
    status: "built",
    links: [{ href: "/ops/clearance", label: "Contract clearance queue", as: OPS }, { href: "/marketing", label: "Growth funnel with the share of contracts that needed a person", as: JUDGE }],
  },
  {
    n: 5, area: "Market", rating: 6, block: "Revenue streams", horizon: 12,
    risk: "Selling anonymised data trends could let people be re-identified and would cost trust.",
    answer: "We dropped that revenue stream. We do not sell data. Analytics inside the product are aggregates only, with personal data removed, and any group smaller than five is hidden.",
    status: "built",
    links: [{ href: "/privacy#no-sale", label: "Privacy: we do not sell data" }, { href: "/marketing", label: "Aggregate analytics", as: JUDGE }],
  },
  {
    n: 6, area: "Execution", rating: 8, block: "Key activities", horizon: 12,
    risk: "The AI would need a large legal training dataset.",
    answer: "We do not train models on legal texts. The AI reads only the case in front of it: the signed clauses, the evidence and the parties' replies, with personal data masked and party text marked as untrusted. The root-cause tags mediators add to each verdict build our own outcome data.",
    status: "built",
    links: [{ href: "/trust/ai#data", label: "What the AI reads" }],
  },
  {
    n: 7, area: "Execution", rating: 7, block: "Key resources", horizon: 12,
    risk: "An in-house AI team is a large fixed cost.",
    answer: "One gateway talks to any provider through configuration, a daily token cap limits spend, and every AI feature has a rule-based fallback. A small team can run it.",
    status: "built",
    links: [{ href: "/trust/ai#features", label: "AI features and their fallbacks" }, { href: "/account/ai", label: "Today's AI use against the cap", as: ANY }],
  },
  {
    n: 8, area: "Regulatory", rating: 5, block: "Key partners", horizon: 12,
    risk: "Offering contract insurance needs insurance licences.",
    answer: "There is no insurance in this build or in the 12-month plan. If it is added later, it will be a referral only: a licensed insurer sells it and PaySettle takes no commission.",
    status: "decided",
    links: [{ href: "/trust#not", label: "What we do not do" }],
  },
  {
    n: 9, area: "Market", rating: 4, block: "Customer segments", horizon: 12,
    risk: "Government procurement is slow and uncertain.",
    answer: "Government buyers are not a target segment.",
    status: "decided",
    links: [{ href: "/trust#for-whom", label: "Who PaySettle is for" }],
  },
  {
    n: 10, area: "Competitive", rating: 3, block: "Value proposition", horizon: 12,
    risk: "Competitors could copy the AI features.",
    answer: "The AI is not what is hard to copy. That is the PayPal orchestration that splits work into holds that fit PayPal's authorization window, the blueprints with machine-checkable proof for each milestone, the outcome data from disputes, and the mediator network.",
    status: "decided",
    links: [{ href: "/blueprints", label: "Blueprints", as: JUDGE }, { href: "/playground", label: "Judge Playground, scenario S3", as: JUDGE }],
  },
  {
    n: 11, area: "Execution", rating: 4, block: "Key partners", horizon: 12,
    risk: "Depending on AI vendors.",
    answer: "The gateway switches providers by configuration, the tests run against a fake model, and the product works with AI switched off: each feature falls back to its rules.",
    status: "built",
    links: [{ href: "/trust/ai#governance", label: "Switching AI off" }, { href: "/account/ai", label: "AI availability", as: ANY }],
  },
  {
    n: 12, area: "Financial", rating: 6, block: "Cost structure", horizon: 12,
    risk: "Spending on enterprise sales may not pay back.",
    answer: "There is no enterprise sales team in the first year. The product is self-serve, with one fee taken when a milestone is released.",
    status: "decided",
    links: [{ href: "/pricing", label: "Pricing" }],
  },
  {
    n: 13, area: "Execution", rating: 7, block: "Value proposition", horizon: 24,
    risk: "The claim of 20% or better contract outcomes is unproven.",
    answer: "We do not make that claim. We measure dispute rate, time to release and on-time delivery instead.",
    next: "On-time delivery becomes measurable per milestone with the optional deadline terms (a deduction for late delivery, a bonus for early delivery), which ship in this release.",
    status: "progress",
    links: [{ href: "/marketing", label: "Growth funnel", as: JUDGE }, { href: "/playground", label: "Judge Playground, scenario S7", as: JUDGE }],
  },
  {
    n: 14, area: "Market", rating: 6, block: "Customer segments", horizon: 24,
    risk: "Consortia, non-profits and universities are too broad a market.",
    answer: "They are out of scope. A grant-in-stages blueprint may be the only bridge to them, and only later.",
    status: "decided",
    links: [{ href: "/trust#for-whom", label: "Who PaySettle is for" }],
  },
  {
    n: 15, area: "Regulatory", rating: 8, block: "Channels", horizon: 24,
    risk: "Integrations with government systems are fragile.",
    answer: "We do not plan any.",
    status: "decided",
    links: [{ href: "/trust#for-whom", label: "Who PaySettle is for" }],
  },
  {
    n: 16, area: "Execution", rating: 5, block: "Customer relationships", horizon: 24,
    risk: "AI-led negotiation can feel impersonal, like a black box.",
    answer: "People sign every contract and every release. AI drafts and checks only, and verdicts are given by people. Every AI panel says it is advice and shows its reasons.",
    status: "built",
    links: [{ href: "/how-it-works", label: "How it works" }, { href: "/playground", label: "Judge Playground, scenario S4", as: JUDGE }],
  },
  {
    n: 17, area: "Financial", rating: 7, block: "Revenue streams", horizon: 24,
    risk: "Insurance commissions could bias the risk scores.",
    answer: "The risk score is a published, fixed formula of five parts: contract value, protective clauses switched off, custom clauses, provider tier and front-loaded payments. None of it is linked to revenue, and we take no commissions.",
    status: "built",
    links: [{ href: "/trust#formula", label: "The risk formula" }, { href: "/ops/clearance", label: "Score parts in the clearance queue", as: OPS }],
  },
  {
    n: 18, area: "Execution", rating: 8, block: "Key activities", horizon: 24,
    risk: "Integrating several blockchains is costly and risky.",
    answer: "There is no blockchain, by design. Hashes of the canonical contract, signatures bound to that hash and a hash-chained audit log show tampering without gas fees, wallets or chain risk.",
    next: "Optional, later: publish the audit chain's root hash once a day.",
    status: "built",
    links: [{ href: "/admin/audit", label: "Audit chain with verification", as: JUDGE }, { href: "/security", label: "Security controls" }],
  },
  {
    n: 19, area: "Execution", rating: 6, block: "Key resources", horizon: 24,
    risk: "An AI ethics board can be weak, or just for show.",
    answer: "AI cannot move money. A person decides every outcome, and a mediator signs every verdict. Every AI call is logged with its purpose, model, token count and cost, and personal data is masked before anything is sent. The governance note names the model card, the test gates and who can turn AI off.",
    next: "Run the model test sets as a required check before each release; today the rule test set runs on every push.",
    status: "built",
    links: [{ href: "/trust/ai#governance", label: "AI governance note" }],
  },
  {
    n: 20, area: "Competitive", rating: 5, block: "Key partners", horizon: 24,
    risk: "Decentralised insurance protocols are immature.",
    answer: "We do not use them.",
    status: "decided",
    links: [{ href: "/trust#not", label: "What we do not do" }],
  },
  {
    n: 21, area: "Financial", rating: 6, block: "Cost structure", horizon: 24,
    risk: "The cost of AI ethics compliance grows over time.",
    answer: "Automated checks keep that cost small. The rule test set for the Criteria Compiler runs with the unit tests on every push. The model test sets run with one command when an AI key is set.",
    next: "Make the model test sets a required check before release.",
    status: "progress",
    links: [{ href: "/trust/ai#evals", label: "Test sets and results" }],
  },
  {
    n: 22, area: "Market", rating: 4, block: "Value proposition", horizon: 24,
    risk: "Game-like DAO rewards attract the wrong people.",
    answer: "There is no DAO and there are no tokens. Reputation is a provider trust tier earned from real contract outcomes, and governance is four-eyes approval plus mediator panels.",
    status: "built",
    links: [{ href: "/ops/providers", label: "Provider health and trust tiers", as: JUDGE }, { href: "/admin/dual-control", label: "Four-eyes queue", as: JUDGE }],
  },
  {
    n: 23, area: "Execution", rating: 5, block: "Key resources", horizon: 24,
    risk: "Blockchain engineers are hard to hire.",
    answer: "We do not need them: there is no blockchain (see risk 18).",
    status: "built",
    links: [{ href: "/trust#risk-18", label: "Risk 18" }],
  },
  {
    n: 24, area: "Execution", rating: 4, block: "Key partners", horizon: 24,
    risk: "Joining a regulatory sandbox invites scrutiny.",
    answer: "The design is non-custodial: the money is held in PayPal, not by PaySettle. The custodial rail is limited to the sandbox, and the compliance export shows that money passes straight through.",
    status: "built",
    links: [{ href: "/finance", label: "Finance overview with the compliance export", as: JUDGE }, { href: "/security", label: "Security controls" }],
  },
];

/* ── what we do not do ── */

export const WE_DO_NOT: readonly { title: string; body: string; risk?: number }[] = [
  { title: "We do not sell data", body: "Not personal data, and not anonymised trends. Analytics stay inside the product, as aggregates.", risk: 5 },
  { title: "We do not use a blockchain", body: "No tokens, wallets, gas fees or DAO. Tamper evidence comes from hashes and a hash-chained audit log.", risk: 18 },
  { title: "We do not earn insurance commissions", body: "There is no insurance product. Nothing about a risk score is linked to revenue.", risk: 17 },
  { title: "AI never moves money", body: "AI drafts, checks and proposes. People sign, approve and release, and a mediator signs every verdict.", risk: 16 },
];

/* ── who it is for (risks 2, 9, 14, 15) ── */

export const FOR_WHOM = {
  who: "Freelancers and small service businesses, and the clients who hire them, for staged projects of about $1,000 to $25,000.",
  examples: ["A web or app build delivered in milestones", "A workshop rebuilding a classic car engine", "An interior fit-out paid room by room", "A consulting sprint with a sign-off at each stage"],
  notFor: "Government procurement, consortia, non-profits and universities are not target segments in the 24-month plan.",
} as const;

/* ── eight further risks we track (not raised by the red team) ── */

export interface TrackedRisk { title: string; risk: string; answer: string; status: RiskStatus; links: TrustLink[] }

export const TRACKED: readonly TrackedRisk[] = [
  {
    title: "PayPal rail limits",
    risk: "A PayPal authorization is honoured for a limited time, can be reauthorized once, and delayed disbursement needs partner approval.",
    answer: `Rail A (authorize, then capture) is the default. Work is split into holds of at most ${RAIL_CAP_DAYS.A1} days, a watchdog acts before a hold runs out, and the mock rail stays available as a visible fallback. A live test against PayPal runs as soon as live keys arrive.`,
    status: "progress",
    links: [{ href: "/playground", label: "Judge Playground, scenario S3", as: JUDGE }, { href: "/ops/radar", label: "Hold-expiry radar", as: JUDGE }],
  },
  {
    title: "AI-made or reused photos",
    risk: "Photo metadata is easy to fake, and one photo can be reused across contracts.",
    answer: "Location and date signals flag photos taken in the wrong place, and a fingerprint check compares each photo with photos from other contracts. Checking content credentials (C2PA), where a photo carries them, comes later.",
    status: "built",
    links: [{ href: "/playground", label: "Judge Playground, scenario S2", as: JUDGE }],
  },
  {
    title: "Chargebacks after release",
    risk: "A buyer approves a milestone, then files a card chargeback.",
    answer: "When PayPal opens a dispute, PaySettle sends the signed approval, the evidence fingerprints and the timeline to PayPal as evidence.",
    status: "built",
    links: [{ href: "/admin/webhooks", label: "Webhooks", as: JUDGE }],
  },
  {
    title: "Collusion and money laundering",
    risk: "The client and the provider are the same person, moving money to themselves.",
    answer: "PayPal checks identity. PaySettle is adding a warning when both parties sign or fund from the same network. A limit on how much money a new pair of parties can move comes later.",
    status: "progress",
    links: [{ href: "/admin/identities", label: "Identity auditor", as: OPS }],
  },
  {
    title: "Mediator bias or bribery",
    risk: "A mediator favours one side.",
    answer: "Conflict-of-interest checks run before assignment. A random 5% of closed verdicts get a second review, both parties rate the mediator after settlement, and large or early-career verdicts need a senior co-signer from another firm.",
    status: "built",
    links: [{ href: "/mediators", label: "How mediators are assigned" }],
  },
  {
    title: "Privacy and write-once records",
    risk: "The right to erasure conflicts with evidence records that cannot be changed.",
    answer: "Our plan: keep the hashes, encrypt personal fields with a key per person, and destroy that key on erasure. This is documented now and built later.",
    status: "decided",
    links: [{ href: "/privacy", label: "Privacy" }],
  },
  {
    title: "A rough first visit for judges",
    risk: "A cold start, sign-in friction or a slow PayPal Sandbox can spoil a short review.",
    answer: "A one-click judge sign-in, a fast mock mode in the playground and a guided three-minute tour. A warm-up request before each judging session is still to do.",
    status: "progress",
    links: [{ href: "/judges", label: "Start here, judges" }],
  },
  {
    title: "Hackathon rules",
    risk: "The project must be new or significantly updated, and the video may not use third-party trademarks or music.",
    answer: "A reuse list in the repository names every reused part. The video is planned with only our own screens and no music.",
    status: "progress",
    links: [{ href: "/judges", label: "Start here, judges" }],
  },
];

/** Count of risks per status, in display order. */
export function statusCounts(list: readonly { status: RiskStatus }[] = RISKS): { status: RiskStatus; label: string; n: number }[] {
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
