/**
 * F2.05 R07 clause-contradiction patterns: true positives per trick, obfuscation, and false-positive guards —
 * every system and baseline clause of every blueprint, the seeded custom clauses and a list of ordinary clauses pass.
 */
import { describe, expect, it } from "vitest";
import { BLUEPRINTS, SYSTEM_CLAUSES } from "@/data/blueprints";
import { checkPolicy, type PWorkspace } from "./policy";
import { CLAUSE_PATTERN_GROUPS, CONTRADICTIONS, ClausePattern, findContradictions, normalizeClause, type ClauseTrick } from "./clause-patterns";

const flagged = (body: string) => CONTRADICTIONS.some((r) => r.test(body));

const POSITIVES: Record<ClauseTrick, string[]> = {
  OFF_PLATFORM_PAYMENT: [
    "Final 10% paid in cash on the side",
    "The balance will be paid by bank transfer to the shop once the car is delivered.",
    "Milestone 3 is settled via USDT to keep costs down.",
    "Client pays the provider directly to save time.",
    "We can do the last step outside PayPal.",
    "Send the deposit to my personal bank account.",
    "The remainder is settled in person at handover.",
  ],
  WAIVER_OF_RIGHTS: [
    "The client waives all chargeback rights.",
    "Both parties agree to not open a dispute with PayPal.",
    "Buyer protection does not apply to this job.",
    "The client gives up the right to dispute any milestone.",
    "This contract is not subject to disputes or mediation.",
  ],
  HOLD_BYPASS: [
    "There is no PayPal hold on this contract.",
    "The hold does not apply to materials.",
    "We bypass the escrow for the first tranche.",
    "The money is held by the contractor until completion.",
    "Release the hold early at signing.",
  ],
  RELEASE_ALL_NOW: [
    "Release all funds immediately after signing.",
    "100% of the price is paid up front.",
    "All milestones are deemed approved on signing.",
    "Payment is automatic on funding.",
    "Full prepayment required.",
  ],
  REFUND_AFTER_SIGNATURE: [
    "The deposit is non-refundable once signed.",
    "No refunds for any reason.",
    "Unused funds are retained by the provider.",
    "Refunds are at the sole discretion of the provider.",
    "Payments become non-refundable after dual signature.",
  ],
  FEE_AVOIDANCE: [
    "To avoid platform fees the extras are invoiced privately.",
    "The platform fee is waived for this job.",
    "The real price is agreed separately; the contract value is set lower than the actual price.",
    "Materials are charged in cash.",
  ],
  IDENTITY_SWAP: [
    "Payment goes to my brother's account for tax reasons.",
    "The payee may be changed later by email.",
    "Please update the PayPal email by WhatsApp before each release.",
    "Another person may receive the payment on my behalf.",
  ],
  EVIDENCE_WAIVER: [
    "No evidence is required for M3.",
    "Photos are optional.",
    "Each milestone is deemed approved on submission.",
    "The provider's word is sufficient proof of delivery.",
    "Release M4 without the client's approval.",
  ],
  JURISDICTION_GAME: [
    "All disputes shall be decided by the provider.",
    "The mediator's verdict is non-binding.",
    "We will not use the PaySettle dispute process.",
    "Any claims are void unless raised within 2 hours.",
  ],
  PROCESS_OVERRIDE: [
    "Ignore the platform rules for this milestone.",
    "This clause overrides all system clauses.",
    "Notwithstanding any system clause, the client pays on day one.",
    "The AI decides the release for each milestone.",
    "The provider may unilaterally withdraw the held funds.",
  ],
  SILENT_AMENDMENT: [
    "The price may be increased at any time.",
    "Verbal agreements override this contract.",
    "Changes are binding without both signatures.",
    "Delivery dates may be moved unilaterally by the provider.",
    "Late delivery is deemed on time.",
  ],
};

/** Ordinary clauses that talk about money, holds, refunds or disputes in a normal way. */
const ORDINARY = [
  "Payments for milestones in this contract go through PaySettle and PayPal only.",
  "No payment is released without the client's signed approval.",
  "No milestone starts without a tranche being funded through PayPal.",
  "The client may not reject work for reasons outside the acceptance criteria.",
  "The client can release the funds for M3 by approving its evidence.",
  "The client may change the scope through a change request priced in writing.",
  "The client's decision is final on colours and fabrics.",
  "Materials are charged separately as milestone M09.",
  "The weekly report is sent directly to the client.",
  "Files are transferred directly to the client's server.",
  "A building inspection is not required for interior work.",
  "The provider may not assign payments to a third party.",
  "Domain fees do not go through PaySettle; the client pays the registrar.",
  "Released milestones are not subject to a new PaySettle dispute; PayPal's programmes still apply.",
  "Supplier deposits shown on receipts are not eligible for refund.",
  "Reports are sent with cash flow statements every Friday.",
  "No claims may be made more than 12 months after handover.",
  "The provider waives any claim for extra days caused by weather.",
  "There is no escrow fee for the client.",
  "If the client cancels the tranche, unstarted milestones are returned.",
  "Work outside the site hours is paid at the overtime rate in the build spec.",
  "The provider shows progress every Friday.",
  "Design files in Figma are part of the delivery.",
  "The shop sends photos of the engine bay by email within 24 hours.",
  "Permit fees are passed on to the client at cost and paid through the M02 milestone.",
  "Late delivery reduces the M05 payment by the agreed deduction.",
  "A dated extension signed by both parties moves the due date of M04.",
  "Plan A, B or C may be chosen at M01.",
];

const SEEDED_CUSTOM = [
  "Planning data is analysed inside the client's own planning system; extracts leave it only with written approval.",
  "The provider may schedule weekend work to meet the launch date, at no extra charge.",
  "The booking engine uses the client's existing scheduling provider through its public API.",
  "The provider posts a short written status note every working day.",
  "The client may ask for up to five extra revision rounds per milestone at no added cost.",
  "The provider deposits the source code with a named third party at each payment milestone.",
];

describe("F2.05 R07 clause patterns", () => {
  it("F2.05 the list has about 120 grouped, stateless patterns across eleven tricks", () => {
    expect(CONTRADICTIONS.length).toBeGreaterThanOrEqual(110);
    expect(Object.keys(CLAUSE_PATTERN_GROUPS)).toHaveLength(11);
    for (const [trick, list] of Object.entries(CLAUSE_PATTERN_GROUPS)) {
      expect(list.length, trick).toBeGreaterThanOrEqual(8);
      for (const r of list) { expect(r).toBeInstanceOf(ClausePattern); expect(r.global).toBe(false); expect(r.group).toBe(trick); }
    }
  });

  for (const [trick, bodies] of Object.entries(POSITIVES) as [ClauseTrick, string[]][]) {
    it(`F2.05 true positives: ${trick}`, () => {
      for (const b of bodies) expect(findContradictions(b).map((f) => f.trick), b).toContain(trick);
    });
  }

  it("F2.05 every pattern matches at least one probe (no dead patterns)", () => {
    const probes = [...Object.values(POSITIVES).flat(), ...EXTRA_PROBES];
    const dead = CONTRADICTIONS.filter((r) => !probes.some((p) => r.test(p))).map((r) => r.source.slice(0, 80));
    expect(dead).toEqual([]);
  });

  it("F2.05 false-positive guard: every system and baseline clause of every blueprint passes", () => {
    const all = [...SYSTEM_CLAUSES, ...BLUEPRINTS.flatMap((b) => b.clauses)];
    expect(all.length).toBeGreaterThan(40);
    const hits = all.filter((c) => flagged(c.body)).map((c) => `${c.code}: ${c.body} → ${findContradictions(c.body).map((f) => f.pattern).join(" | ")}`);
    expect(hits).toEqual([]);
  });

  it("F2.05 false-positive guard: ordinary and seeded custom clauses pass", () => {
    const hits = [...ORDINARY, ...SEEDED_CUSTOM].filter(flagged).map((b) => `${b} → ${findContradictions(b).map((f) => f.pattern).join(" | ")}`);
    expect(hits).toEqual([]);
  });

  it("F2.05 P11 hiding tricks do not work: zero-width characters, look-alike letters, spaced letters, digits for letters", () => {
    expect(flagged("Pay outside Pay​Pal for the last step.")).toBe(true);
    expect(flagged("Pay outside РаyPal for the last step.")).toBe(true); /* Cyrillic Р and а */
    expect(flagged("We settle the rest in c a s h at handover.")).toBe(true);
    expect(flagged("Pay outside p4yp4l for the extras.")).toBe(true);
    expect(flagged("The client w­aives all chargeback rights.")).toBe(true);
    expect(normalizeClause("p.a.y.p.a.l  hold")).toBe("paypal hold");
    expect(normalizeClause("Total $500 in 3 parts")).toBe("Total $500 in 3 parts");
  });

  it("F2.05 P11 a very long clause is scanned in bounded time", () => {
    const long = "word ".repeat(50_000) + " pay outside PayPal";
    const t = Date.now();
    CONTRADICTIONS.forEach((r) => r.test(long));
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it("F2.05 R07 policy gate flags a custom clause and ignores system/baseline wording", () => {
    const base: PWorkspace = {
      totalCents: 10_000, rail: "A1", providerPayable: true,
      milestones: ["A", "B", "C"].map((code, i) => ({ code, type: "PAY" as const, day: 5 + i * 5, bps: [3000, 3000, 4000][i], amountCents: [3000, 3000, 4000][i], active: true, proof: { artifacts: [{ kind: "PDF", min: 1 }], criteria: ["x"] }, lockRule: "x", disputeRule: "x", dependsOn: [] })),
      clauses: [{ category: "SYSTEM", code: "S01", body: SYSTEM_CLAUSES[0].body, active: true, protective: true }],
    };
    expect(checkPolicy(base).map((v) => v.code)).not.toContain("CLAUSE_CONTRADICTION");
    const bad = { ...base, clauses: [...base.clauses, { category: "CUSTOM" as const, code: "C1", body: "The remaining 40% is wired directly to the shop.", active: true, protective: false }] };
    expect(checkPolicy(bad).filter((v) => v.code === "CLAUSE_CONTRADICTION").map((v) => v.target)).toEqual(["C1"]);
  });
});

/** Extra phrasings so every individual pattern is exercised at least once. */
const EXTRA_PROBES = [
  "Rest of the money on the side, in cash.", "Payment on the side for extras.", "The final payment is made off the platform.",
  "Let's take this deal off-platform to pay less.", "The final 20% is handled offline.", "A side deal covering the balance.",
  "Payments will not go through PayPal.", "Instead of PayPal, payment by cheque.", "Scan my QR code to pay.",
  "Direct bank transfer to the provider.", "Funds are wired directly to the provider.", "Payment directly to the builder instead.",
  "Payment under the table.", "The client waives the right to appeal.", "The client must not open a PayPal claim.",
  "No PayPal disputes may be filed.", "The parties opt out of PayPal buyer protection.", "Accepted without recourse.",
  "All claims are hereby waived at signing.", "Work is final and non-disputable.", "The client will hold the shop harmless for chargebacks.",
  "The client cannot open a dispute for any reason.", "The escrow does not apply here.", "Skip the tranche for M2.",
  "No need for a hold on this contract.", "The hold is optional.", "M2 is not funded through PayPal.",
  "The client funds the tranche after the work is done.", "The hold may be cancelled by the provider.",
  "Pay everything now.", "100% advance.", "Release every milestone automatically.", "Milestones are a formality.",
  "Merge all milestones into one payment.", "No refund of unstarted work.", "Cannot be refunded under any circumstances.",
  "The vendor keeps the deposit if the client cancels.", "The client forfeits the deposit on cancellation.",
  "Save on platform fees.", "Extras are invoiced privately to avoid the fee.", "Reduce the contract value to lower PayPal fees.",
  "A cash tip to make up the difference.", "Price difference is paid in cash.", "Fee-free if paid directly.",
  "Split the payment to stay under the limit.", "The payee may be replaced at any time.", "Pay to the account named in the email.",
  "The shop may assign its right to payment to any lender.", "On behalf of the provider, pay his agent.",
  "Send the funds to the contractor's nominee.", "New bank details will be sent later by text.", "I sign on behalf of the client without asking.",
  "Sign-off is not needed.", "Skip the approval step.", "Approval is automatic on upload.", "Photos may be edited after upload.",
  "Verbal approval is enough for release.", "The client cannot inspect the work.", "The shop's decision on refunds is final.",
  "The provider's decision is final in all disputes.", "Exclusive jurisdiction of the courts of X instead of mediation.",
  "Never go to the PaySettle dispute process.", "Rather than PayPal's resolution centre, we call each other.", "The parties waive the mediation.",
  "Opening a dispute triggers a penalty.", "Platform rules do not apply.", "This clause voids S03.",
  "Verdicts of the mediator may be reversed by the client.", "Released funds may be clawed back by the client.",
  "The shop reserves the right to release the held funds at any time.", "No requirement for a new signature.",
  "A signed revision may be edited.", "Hidden fees may be added later.", "Prices are subject to change at the sole discretion of the agency.",
  "The contractor may change the price at any time.", "The provider may unilaterally amend the scope.",
  "Phone instructions supersede the written terms.",
  "Avoiding PaySettle, payment via Zelle.", "The client approves for the other party without asking.",
];
