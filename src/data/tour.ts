/**
 * A10 · the judge tour's steps: eight short stops that walk the Judge Playground scenarios S1–S7 and the key screens,
 * then the trust page. Plain data, rendered by src/components/tour/JudgeTour.tsx and listed in full on /judges (which also
 * works without scripts). Facts match the scenario engine in src/server/playground/scenarios.ts.
 */

export type ScenarioId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";

export interface TourLink { href: string; label: string }
export interface TourStep {
  id: string;
  /** Short tag shown above the title, such as "Scenario S2". */
  tag: string;
  title: string;
  body: string;
  /** Two or three things to watch on the screen. */
  look: readonly string[];
  /** The screen this step is about; the main button opens it and tucks the tour away. */
  go: TourLink;
  /** Another screen that shows the same thing from a different seat. */
  also?: TourLink;
  scenarios: readonly ScenarioId[];
}

export const TOUR_MINUTES = 3;
export const TOUR_LABEL = `Take the ${TOUR_MINUTES}-minute tour`;

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "start", tag: "Start", title: "Sign in as the judge",
    body: "PaySettle holds the money for staged work in PayPal and releases it one milestone at a time, when the evidence matches what both sides agreed. One click signs you in as the Hackathon Judge and opens the Judge Playground. Everything uses sandbox money.",
    look: ["On the sign-in page, choose “Hackathon Judge” under Explore the live demo.", "In the playground, choose Fast mock: each scenario then runs in a few seconds."],
    go: { href: "/login", label: "Open the sign-in page" },
    scenarios: [],
  },
  {
    id: "s1", tag: "Scenario S1", title: "The happy path: a $6,000 web build",
    body: "Start S1 and run its steps. Both sides sign the same revision, the client approves one PayPal authorization, and each approved milestone is released as a partial capture against it.",
    look: ["Q1 and Q2 show the client's and the provider's view of the same money.", "Q3: held plus released always equals the authorization.", "Q4, the wire log, lists every rail call and webhook of the session."],
    go: { href: "/playground", label: "Open the playground" },
    also: { href: "/finance/recon", label: "Reconciliation" },
    scenarios: ["S1"],
  },
  {
    id: "s2", tag: "Scenario S2", title: "A photo taken 85 km away",
    body: "S2 submits a photo whose location data puts it 85 km from the workshop. The signal flags it before anyone approves. The client asks for a photo taken on site, the AI report reads the new proof, and the client still makes the decision.",
    look: ["The failed location signal on the first submission.", "The AI report is labelled as advice.", "Money moves only after the client's signed approval."],
    go: { href: "/playground", label: "Open the playground" },
    scenarios: ["S2"],
  },
  {
    id: "s3", tag: "Scenario S3", title: "Beating PayPal's hold window",
    body: "A PayPal authorization is honoured for a limited time, so PaySettle splits work into holds of at most 26 days. S3 moves the virtual clock forward: the watchdog warns on day 22, offers a rollover on day 25, and the rollover moves the remainder into a new hold.",
    look: ["The time machine and its day marks.", "The new hold after the rollover.", "The hold-expiry radar from the Operations seat."],
    go: { href: "/playground", label: "Open the playground" },
    also: { href: "/ops/radar", label: "Hold-expiry radar" },
    scenarios: ["S3"],
  },
  {
    id: "s4", tag: "Scenario S4", title: "A dispute about one milestone",
    body: "A dispute freezes only the milestone it is about. In S4 the blind bids are too far apart, the evidence vault seals, the AI proposes a split as advice, and a mediator's 75/25 verdict is paid out as two parts: one to the provider, one back to the client.",
    look: ["Other milestones keep running while one is disputed.", "The AI proposal is advice for the mediator.", "The verdict is signed by a person before any money moves."],
    go: { href: "/playground", label: "Open the playground" },
    also: { href: "/mediator/cases", label: "Mediator case queue" },
    scenarios: ["S4"],
  },
  {
    id: "s5", tag: "Scenario S5", title: "Chaos: an outage, a duplicate, a missing cent",
    body: "S5 makes PayPal answer 503, sends the same webhook twice and puts one cent of drift into the ledger. Retries with the same idempotency key pay out once, the duplicate webhook is ignored, and the one-cent drift trips a circuit breaker that stops releases on that hold.",
    look: ["One payout in the wire log, not two.", "The duplicate webhook marked as already seen.", "The breaker on the finance overview."],
    go: { href: "/playground", label: "Open the playground" },
    also: { href: "/admin/audit", label: "Audit chain" },
    scenarios: ["S5"],
  },
  {
    id: "s6-s7", tag: "Scenarios S6 and S7", title: "An AI agent as buyer, and deadline terms",
    body: "In S6 an AI agent drafts a contract, asks for funding and submits evidence over MCP. Funding and release still wait for a person: the PayPal approval and an in-app second factor. In S7 one milestone is delivered two days late and loses a small agreed deduction, another is three days early and earns a bonus, and the ledger still reconciles to the cent.",
    look: ["The approval gate on the agent's release request.", "The on-time badge and the adjustment line on each milestone.", "Zero drift on the reconciliation at the end."],
    go: { href: "/playground", label: "Open the playground" },
    scenarios: ["S6", "S7"],
  },
  {
    id: "trust", tag: "Finally", title: "The hard questions, answered",
    body: "Our own red team asked 24 hard questions about the plan. The trust page lists each answer, how far it is built and where to check it. The AI scorecard shows what each AI feature may and may not do, and its test results.",
    look: ["The status chip on each risk.", "The links to the screen that shows each answer.", "Rule results on the AI scorecard, computed when the page loads."],
    go: { href: "/trust", label: "Open the trust page" },
    also: { href: "/trust/ai", label: "AI scorecard" },
    scenarios: [],
  },
];
