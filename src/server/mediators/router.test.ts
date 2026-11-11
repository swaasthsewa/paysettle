/**
 * F4.05 F4.06 — pure tests: the mediator router (eligibility, scoring, ties, COI, firm, determinism), domain mapping,
 * co-sign rules, status moves, calibration grading, the application form and the second-review draw. No database.
 */
import { describe, expect, it } from "vitest";
import { BLUEPRINTS } from "@/data/blueprints";
import { DAY } from "@/lib/clock";
import { domainFit, domainOf, cleanDomains } from "./domains";
import { breakdownFor, conflicted, exclusions, legacyCandidate, normFirm, rankMediators, score, workingOverlap, WEIGHTS, type Candidate, type CaseInput } from "./router";
import { CALIBRATION_CASES, cosignReasons, cosignerProblem, gradeCalibration, maskNumber, moveProblem, readApplication, secondReviewPicked } from "./rules";
import { pickMediator } from "../disputes/rules";

const NOW = new Date("2026-11-08T12:00:00Z");
const cand = (id: string, o: Partial<Candidate> = {}): Candidate => ({
  id, status: "ACTIVE", domains: ["digital"], languages: ["en"], timezone: "UTC", maxOpen: 4, firm: null, declaredConflicts: [], paused: false, leave: null,
  credentials: [{ status: "VERIFIED", expiresOn: "2027-12-31" }], openCases: 0, sla: { onTime: 0, total: 0 }, ratings: { sum: 0, count: 0 }, secondReview: { agree: 0, disagree: 0 }, lastAssignedAt: null, ...o,
});
const K = (o: Partial<CaseInput> = {}): CaseInput => ({ blueprintCode: "UC_WEB_MVP", parties: [{ id: "c1", email: "c1@x.example", firm: "Shah Product Studio", timezone: "UTC" }, { id: "p1", email: "p1@x.example", firm: "Iyer Studio LLP", timezone: "UTC" }], history: [], now: NOW, ...o });

describe("domains", () => {
  it("every blueprint maps to exactly one mediator domain", () => {
    for (const b of BLUEPRINTS) expect(domainOf(b.code), b.code).not.toBeNull();
  });
  it("domain fit: exact blueprint 1.0 > domain 0.6 > none", () => {
    expect(domainFit(["UC_WEB_MVP"], "UC_WEB_MVP")).toBe("exact");
    expect(domainFit(["digital"], "UC_WEB_MVP")).toBe("category");
    expect(domainFit(["automotive"], "UC_WEB_MVP")).toBe("none");
    expect(cleanDomains(["digital", " UC_CLASSIC_CAR ", "<script>", "digital"])).toEqual(["digital", "UC_CLASSIC_CAR"]);
  });
});

describe("F4.05 router eligibility", () => {
  it("F4.05 each rule excludes with its own reason", () => {
    const k = K({ alreadyOffered: ["m_offered"], history: [{ mediatorId: "m_coi", clientId: "c1", providerId: "zz", at: new Date(NOW.getTime() - 30 * DAY) }] });
    const coi = conflicted(k.history, ["c1", "p1"], NOW);
    const cases: [Candidate, string][] = [
      [cand("c1"), "IS_PARTY"], [cand("m_s", { status: "PROBATION" }), "STATUS"], [cand("m_d", { domains: ["travel"] }), "DOMAIN"],
      [cand("m_l", { languages: ["fr"] }), "LANGUAGE"], [cand("m_coi"), "COI_HISTORY"], [cand("m_dc", { declaredConflicts: ["P1@X.example"] }), "COI_DECLARED"],
      [cand("m_df", { declaredConflicts: ["Iyer Studio"] }), "COI_DECLARED"], [cand("m_f", { firm: "iyer studio llp." }), "SAME_FIRM"],
      [cand("m_c", { credentials: [{ status: "VERIFIED", expiresOn: "2026-11-07" }, { status: "PENDING", expiresOn: null }] }), "CREDENTIALS"],
      [cand("m_p", { paused: true }), "PAUSED"], [cand("m_lv", { leave: { from: "2026-11-01", to: "2026-11-08" } }), "ON_LEAVE"],
      [cand("m_cap", { openCases: 4, maxOpen: 4 }), "AT_CAPACITY"], [cand("m_offered"), "ALREADY_OFFERED"],
    ];
    for (const [c, why] of cases) expect(exclusions(c, k, coi), c.id).toContain(why);
    expect(exclusions(cand("m_ok", { credentials: [{ status: "VERIFIED", expiresOn: "2026-11-08" }] }), k, coi)).toEqual([]); // expires today = still valid
    expect(exclusions(cand("m_sr", { status: "SENIOR", languages: ["EN", "fr"] }), k, coi)).toEqual([]);
  });
  it("F4.05 COI lasts 180 days, then the mediator is eligible again", () => {
    const old = [{ mediatorId: "m1", clientId: "c1", providerId: "p9", at: new Date(NOW.getTime() - 181 * DAY) }];
    expect(rankMediators([cand("m1")], K({ history: old })).ranked.map((r) => r.id)).toEqual(["m1"]);
    const recent = [{ mediatorId: "m1", clientId: "x", providerId: "p1", at: new Date(NOW.getTime() - 179 * DAY) }];
    expect(rankMediators([cand("m1")], K({ history: recent })).excluded[0]).toEqual({ id: "m1", reasons: ["COI_HISTORY"] });
  });
  it("F4.05 firm names compare without case, punctuation or company suffixes", () => {
    expect(normFirm("Iyer Studio LLP")).toBe(normFirm("iyer-studio"));
    expect(normFirm("Costa Coffee Ltd.")).toBe("costacoffee");
    expect(normFirm(null)).toBe("");
  });
});

describe("F4.05 router scoring and ties", () => {
  it("F4.05 weights add to 1,000 and a perfect candidate scores 1,000", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(1000);
    const best = cand("m", { domains: ["UC_WEB_MVP"], sla: { onTime: 4, total: 4 }, ratings: { sum: 10, count: 2 }, secondReview: { agree: 1, disagree: 0 } });
    expect(score(best, K()).total).toBe(1000);
  });
  it("F4.05 exact domain beats category; load, SLA and quality move the score; neutral 0.5 without history", () => {
    const s = (c: Candidate) => score(c, K());
    expect(s(cand("a", { domains: ["UC_WEB_MVP"] })).total - s(cand("b")).total).toBe(160); // 400 × (1.0 − 0.6)
    expect(s(cand("a", { openCases: 2 })).parts.find((p) => p.part === "load")!.points).toBe(100);
    const neutral = s(cand("a")).parts;
    expect(neutral.find((p) => p.part === "sla")!.value).toBe(0.5);
    expect(neutral.find((p) => p.part === "quality")!.value).toBe(0.5);
    expect(s(cand("a", { ratings: { sum: 4, count: 4 } })).parts.find((p) => p.part === "quality")!.points).toBe(0); // all 1-star ratings
  });
  it("F4.05 timezone overlap of 09:00–17:00 days", () => {
    expect(workingOverlap("Europe/London", "Europe/London", NOW)).toBe(1);
    expect(workingOverlap("America/New_York", "Europe/London", NOW)).toBe(3 / 8);
    expect(workingOverlap("America/New_York", "Asia/Kolkata", NOW)).toBe(0);
    expect(workingOverlap("Not/AZone", "UTC", NOW)).toBe(1); // unknown zones count as UTC
  });
  it("F4.05 ties go to the least recently assigned (never assigned first), then id", () => {
    const r = rankMediators([cand("m_b", { lastAssignedAt: new Date("2026-10-01") }), cand("m_c"), cand("m_a", { lastAssignedAt: new Date("2026-09-01") }), cand("m_d")], K());
    expect(r.ranked.map((x) => x.id)).toEqual(["m_c", "m_d", "m_a", "m_b"]);
    const b = breakdownFor(r, 0, K(), "network");
    expect(b.tieBreak).toMatch(/ordered by id/);
    expect(breakdownFor(r, 2, K(), "network").tieBreak).toMatch(/last assignment is older/);
    expect(b.runnersUp.map((x) => x.id)).toEqual(["m_d", "m_a", "m_b"]);
    expect(b.parts.reduce((a, p) => a + p.points, 0)).toBe(b.total);
  });
  it("F4.05 deterministic: input order does not change the ranking or the breakdown", () => {
    const pool = ["a", "b", "c", "d", "e", "f"].map((id, i) => cand(`m_${id}`, { openCases: i % 3, domains: i % 2 ? ["UC_WEB_MVP"] : ["digital"], timezone: ["UTC", "Asia/Tokyo", "America/Chicago"][i % 3] }));
    const a = rankMediators(pool, K()), b = rankMediators([...pool].reverse(), K());
    expect(b).toEqual(a);
    expect(breakdownFor(b, 0, K(), "network")).toEqual(breakdownFor(a, 0, K(), "network"));
  });
  it("F4.05 the legacy pool keeps the old round-robin order", () => {
    const hist = [{ mediatorId: "m1", clientId: "c", providerId: "p", at: new Date(NOW.getTime() - 10 * DAY) }, { mediatorId: "m2", clientId: "x", providerId: "y", at: new Date(NOW.getTime() - 200 * DAY) }];
    expect(pickMediator(["m2", "m1", "m3"], hist, ["q", "z"], NOW)).toBe("m3");
    expect(pickMediator(["m1", "m2"], hist, ["q", "z"], NOW)).toBe("m2"); // m2's last assignment is older
    expect(rankMediators([legacyCandidate("m1")], K()).ranked[0].fit).toBe("generalist");
  });
});

describe("F4.06 co-sign and status rules", () => {
  it("F4.06 a second signature above $5,000 and on a probation mediator's first 5 verdicts", () => {
    expect(cosignReasons(500_001, 500_000, null)).toEqual(["HIGH_VALUE"]);
    expect(cosignReasons(500_000, 500_000, { status: "ACTIVE", verdictCount: 0 })).toEqual([]);
    expect(cosignReasons(100_000, 500_000, { status: "PROBATION", verdictCount: 4 })).toEqual(["PROBATION"]);
    expect(cosignReasons(100_000, 500_000, { status: "PROBATION", verdictCount: 5 })).toEqual([]);
    expect(cosignReasons(900_000, 500_000, { status: "PROBATION", verdictCount: 0 })).toEqual(["HIGH_VALUE", "PROBATION"]);
  });
  it("F4.06 the co-signer is Senior and from another firm (independents are their own firm)", () => {
    expect(cosignerProblem({ status: "ACTIVE", firm: "A" }, { firm: "B" })?.code).toBe("NOT_SENIOR");
    expect(cosignerProblem(null, { firm: "B" })?.code).toBe("NOT_SENIOR");
    expect(cosignerProblem({ status: "SENIOR", firm: "Harbor Mediation Group" }, { firm: "harbor mediation group ltd" })?.code).toBe("SAME_FIRM");
    expect(cosignerProblem({ status: "SENIOR", firm: null }, { firm: null })).toBeNull();
    expect(cosignerProblem({ status: "SENIOR", firm: "A" }, { firm: "B" })).toBeNull();
  });
  it("status moves follow the ladder", () => {
    const ok = { verifiedCredential: true, verdictCount: 12, passedCalibration: true };
    expect(moveProblem("VERIFYING", "CALIBRATING", { ...ok, verifiedCredential: false })).toMatch(/Verify/);
    expect(moveProblem("VERIFYING", "CALIBRATING", ok)).toBeNull();
    expect(moveProblem("CALIBRATING", "PROBATION", ok)).toMatch(/cannot move/);
    expect(moveProblem("PROBATION", "ACTIVE", { ...ok, verdictCount: 3 })).toMatch(/5 co-signed/);
    expect(moveProblem("ACTIVE", "SENIOR", { ...ok, verdictCount: 9 })).toMatch(/10 verdicts/);
    expect(moveProblem("REMOVED", "ACTIVE", ok)).toMatch(/cannot move/);
  });
});

describe("calibration grading", () => {
  const gold = CALIBRATION_CASES.map((c) => ({ caseId: c.id, shareBps: c.gold.providerShareBps, rootCause: c.gold.rootCause }));
  it("pass = every case within 10 points with the right root cause", () => {
    expect(gradeCalibration(gold)).toMatchObject({ passed: true, scorePct: 100 });
    const edge = gold.map((g, i) => (i === 0 ? { ...g, shareBps: Math.max(0, g.shareBps - 1000) } : g));
    expect(gradeCalibration(edge).passed).toBe(true);
    const far = gold.map((g, i) => (i === 0 ? { ...g, shareBps: g.shareBps - 1001 } : g));
    expect(gradeCalibration(far)).toMatchObject({ passed: false, scorePct: 67 });
    const wrongRoot = gold.map((g, i) => (i === 1 ? { ...g, rootCause: "QUALITY_DEFECT" } : g));
    expect(gradeCalibration(wrongRoot).results[1]).toMatchObject({ withinPoints: true, rootOk: false, passed: false });
    expect(gradeCalibration([]).scorePct).toBe(0);
  });
});

describe("application form", () => {
  const good = { name: "Ada Lovelace", email: " Ada@Example.com ", domains: ["digital", "nonsense"], languages: ["en", "xx"], timezone: "Europe/London", credentials: "Accredited mediator, CMC 2024", weeklyHours: "8", firm: "", conflicts: "" };
  it("a valid application is cleaned (lower-case e-mail, known domains and languages only)", () => {
    const r = readApplication(good);
    expect(r.ok && !r.robot && r.data).toMatchObject({ email: "ada@example.com", domains: ["digital"], languages: ["en"], weeklyHours: 8, firm: undefined });
  });
  it("invalid answers come back per field; markup is refused", () => {
    const r = readApplication({ ...good, email: "nope", domains: [], timezone: "Mars/Base", weeklyHours: "1", name: "<b>x</b>" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["domains", "email", "name", "timezone", "weeklyHours"]);
  });
  it("a filled honeypot reads as a robot (told ok, nothing stored)", () => {
    expect(readApplication({ ...good, website: "http://spam.example" })).toMatchObject({ ok: true, robot: true });
    expect(readApplication({ website: "x" })).toMatchObject({ ok: true, robot: true });
  });
  it("credential numbers are masked; the second-review draw is about 5%", () => {
    expect(maskNumber("CMC-2219-4410")).toBe("••••••••4410");
    expect(maskNumber("123")).toBe("•••");
    let n = 0;
    for (let i = 0; i < 4000; i++) if (secondReviewPicked(`sig-${i}`)) n++;
    expect(n / 4000).toBeGreaterThan(0.035);
    expect(n / 4000).toBeLessThan(0.065);
    expect(secondReviewPicked("sig-1")).toBe(secondReviewPicked("sig-1"));
  });
});
