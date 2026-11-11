/**
 * F4.06 F4.07 — pure rules of the mediator network: the status ladder, who must co-sign, the mediator fee table,
 * the random 5% second review, the sealed calibration cases and their grading, and the public application form.
 * No I/O; the gold answers of the calibration cases never leave the server (this module is not imported by client code).
 */
import { z } from "zod";
import { sha256 } from "@/lib/ids";
import type { MediatorStatus } from "@/db/schema-mediators";
import { normFirm } from "./router";
import { DOMAIN_KEYS, cleanDomains } from "./domains";

/* ───────────── status ladder ───────────── */

export const STATUS_LABEL: Record<MediatorStatus, string> = {
  APPLIED: "Applied", VERIFYING: "Verifying credentials", CALIBRATING: "Calibrating", PROBATION: "Probation",
  ACTIVE: "Active", SENIOR: "Senior", PAUSED: "Paused", REMOVED: "Removed",
};
export const STATUS_CHIP: Record<MediatorStatus, string> = {
  APPLIED: "plain", VERIFYING: "warn", CALIBRATING: "warn", PROBATION: "risk", ACTIVE: "ok", SENIOR: "ok", PAUSED: "none", REMOVED: "danger",
};
/** Moves Ops may make. CALIBRATING → PROBATION happens only by passing calibration; PROBATION → ACTIVE also happens on its own after 5 co-signed verdicts. */
export const OPS_MOVES: Record<MediatorStatus, MediatorStatus[]> = {
  APPLIED: ["VERIFYING", "REMOVED"],
  VERIFYING: ["CALIBRATING", "PAUSED", "REMOVED"],
  CALIBRATING: ["VERIFYING", "PAUSED", "REMOVED"],
  PROBATION: ["ACTIVE", "PAUSED", "REMOVED"],
  ACTIVE: ["SENIOR", "PAUSED", "REMOVED"],
  SENIOR: ["ACTIVE", "PAUSED", "REMOVED"],
  PAUSED: ["PROBATION", "ACTIVE", "REMOVED"],
  REMOVED: [],
};
export const PROBATION_COSIGNS = 5;
export const SENIOR_MIN_VERDICTS = 10;

/** Why Ops cannot make this move now, or null when it is allowed. */
export function moveProblem(from: MediatorStatus, to: MediatorStatus, ctx: { verifiedCredential: boolean; verdictCount: number; passedCalibration: boolean }): string | null {
  if (!OPS_MOVES[from].includes(to)) return `A mediator cannot move from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}.`;
  if (to === "CALIBRATING" && !ctx.verifiedCredential) return "Verify at least one unexpired credential first.";
  if (to === "ACTIVE" && from === "PROBATION" && ctx.verdictCount < PROBATION_COSIGNS) return `Probation ends after ${PROBATION_COSIGNS} co-signed verdicts (${ctx.verdictCount} so far).`;
  if (to === "PROBATION" && !ctx.passedCalibration) return "Only a mediator who passed calibration can return to probation.";
  if (to === "SENIOR" && ctx.verdictCount < SENIOR_MIN_VERDICTS) return `Senior needs ${SENIOR_MIN_VERDICTS} verdicts or more (${ctx.verdictCount} so far).`;
  return null;
}

/* ───────────── co-signature (F4.06) ───────────── */

export type CosignReason = "HIGH_VALUE" | "PROBATION";
export const COSIGN_REASON_LABEL: Record<CosignReason, string> = { HIGH_VALUE: "the amount is above $5,000", PROBATION: "the mediator is on probation (first 5 verdicts)" };

/** Why a new verdict needs a second signature. signer = the signing mediator's profile, or null outside the network. */
export function cosignReasons(amountCents: number, highValueAboveCents: number, signer: { status: MediatorStatus; verdictCount: number } | null): CosignReason[] {
  const out: CosignReason[] = [];
  if (amountCents > highValueAboveCents) out.push("HIGH_VALUE");
  if (signer?.status === "PROBATION" && signer.verdictCount < PROBATION_COSIGNS) out.push("PROBATION");
  return out;
}

/**
 * In a mediator network the co-signer must be SENIOR, in a different firm from the signer (two independents count as
 * different firms) and free of conflicts (checked by the caller). Returns a domain error code and message, or null.
 */
export function cosignerProblem(co: { status: MediatorStatus; firm: string | null } | null, signer: { firm: string | null } | null): { code: string; message: string } | null {
  if (!co || co.status !== "SENIOR") return { code: "NOT_SENIOR", message: "A co-signature needs a Senior mediator." };
  const a = normFirm(co.firm), b = normFirm(signer?.firm);
  if (a && b && a === b) return { code: "SAME_FIRM", message: "The co-signer must be from a different firm than the mediator who signed." };
  return null;
}

/* ───────────── mediator fees: paid by PaySettle from its fee income, never from the hold (P1) ───────────── */

export const MEDIATOR_FEE_CENTS = { PROBATION: 4_000, ACTIVE: 6_000, SENIOR: 9_000 } as const;
export const COSIGN_FEE_CENTS = 2_500;
export type FeeTier = keyof typeof MEDIATOR_FEE_CENTS;
export const feeTier = (status: MediatorStatus | null | undefined): FeeTier => (status === "SENIOR" ? "SENIOR" : status === "PROBATION" ? "PROBATION" : "ACTIVE");

/* ───────────── random 5% second review ───────────── */

export const SECOND_REVIEW_BPS = 500;
/** Picked from the verdict signature's hash, so the draw is random to everyone and the same on every re-run. */
export const secondReviewPicked = (signature: string) => parseInt(sha256(`second-review:${signature}`).slice(0, 8), 16) % 10_000 < SECOND_REVIEW_BPS;

/* ───────────── calibration (three sealed sample cases from the blueprints) ───────────── */

export interface CalibrationCase {
  id: string; blueprintCode: string; milestoneCode: string; title: string; amountCents: number;
  facts: string; client: string; provider: string; evidence: string[];
  gold: { providerShareBps: number; rootCause: string; why: string };
}
export const CALIBRATION_POINTS = 1000; // within 10 points of the gold split
export const CALIBRATION_MAX_ATTEMPTS = 3;
export const CALIBRATION_CASES: CalibrationCase[] = [
  {
    id: "CAL-CAR-M08", blueprintCode: "UC_CLASSIC_CAR", milestoneCode: "M08", title: "Powertrain installed", amountCents: 145_000,
    facts: "M08 is 10% of a $14,500 engine swap. The proof spec asks for a cold-start video, a photo of the engine bay and a dyno sheet.",
    client: "The car starts but the dyno sheet shows 212 hp, not the 240 hp in the build specification. I want most of the milestone back.",
    provider: "The powertrain is in and runs. The 240 hp figure is for the tuned map, which belongs to M10 (ECU and base map). M08 is the installation.",
    evidence: ["Cold-start video, 38 s, engine idles evenly", "Engine bay photo matches the parts catalogue", "Dyno sheet: 212 hp on the stock map"],
    gold: { providerShareBps: 9000, rootCause: "CRITERIA_VAGUE", why: "Installation is proven. The power figure is an M10 criterion that the client read into M08; the acceptance text did not say which map." },
  },
  {
    id: "CAL-ROOF-M06", blueprintCode: "UC_HOME_ROOFING", milestoneCode: "M06", title: "Shingles installed", amountCents: 240_000,
    facts: "M06 is 20% of a $12,000 roof. The proof spec asks for located photos of every roof face and the nailing pattern.",
    client: "The north face photos show exposed nail heads in two rows and the shingles end short of the drip edge.",
    provider: "Three faces are finished. The north face was paused for rain and the photos were taken mid-job.",
    evidence: ["Photos of three faces finished, located on site", "North face: two rows of exposed nails, shingles short of the drip edge", "Weather log: rain on day 8"],
    gold: { providerShareBps: 6000, rootCause: "INCOMPLETE_WORK", why: "Three of four faces are done; the north face is unfinished, not defective. Pay for the finished share and keep the rest for completion." },
  },
  {
    id: "CAL-WEB-M04", blueprintCode: "UC_WEB_MVP", milestoneCode: "M04", title: "Core features on staging", amountCents: 120_000,
    facts: "M04 is 20% of a $6,000 MVP. The criteria list sign-up, booking and payments on staging, with an end-to-end test report.",
    client: "Payments do not work on staging: the checkout button returns an error. The test report has a red line for payments.",
    provider: "Payments need the client's PayPal sandbox keys, which we asked for on day 6 and still do not have. Everything else passes.",
    evidence: ["Test report: 41 of 44 checks pass, 3 payment checks fail with 'missing credentials'", "Message on day 6 asking for sandbox keys, no reply", "Screen recording of sign-up and booking"],
    gold: { providerShareBps: 9500, rootCause: "CLIENT_DEPENDENCY", why: "The only failing part depends on keys the client did not supply; the provider asked in time. Nearly all of the milestone is earned." },
  },
];
/** What a mediator may see of a calibration case: everything except the gold answer. */
export const publicCase = (c: CalibrationCase): Omit<CalibrationCase, "gold"> => { const { gold, ...rest } = c; void gold; return rest; };

export interface CalibrationAnswer { caseId: string; shareBps: number; rootCause: string }
export function gradeCalibration(answers: CalibrationAnswer[]): { results: { caseId: string; withinPoints: boolean; rootOk: boolean; passed: boolean }[]; passed: boolean; scorePct: number } {
  const results = CALIBRATION_CASES.map((c) => {
    const a = answers.find((x) => x.caseId === c.id);
    const withinPoints = !!a && Math.abs(a.shareBps - c.gold.providerShareBps) <= CALIBRATION_POINTS;
    const rootOk = !!a && a.rootCause === c.gold.rootCause;
    return { caseId: c.id, withinPoints, rootOk, passed: withinPoints && rootOk };
  });
  const n = results.filter((r) => r.passed).length;
  return { results, passed: n === CALIBRATION_CASES.length, scorePct: Math.round((n * 100) / CALIBRATION_CASES.length) };
}

/* ───────────── public application (untrusted input, P11) ───────────── */

export const APPLICATION_TRAP = "website";
export const LANGUAGES = { en: "English", es: "Spanish", fr: "French", de: "German", hi: "Hindi", ar: "Arabic", pt: "Portuguese", ko: "Korean", ja: "Japanese", zh: "Chinese" } as const;
const validTz = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
const oneLine = (max: number) => z.string().trim().max(max).refine((s) => !/[<>]/.test(s), "Angle brackets are not allowed.");

export const ApplicationSchema = z.object({
  name: oneLine(120).pipe(z.string().min(2, "Enter your full name.")),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid e-mail address.")),
  domains: z.array(z.string()).transform(cleanDomains).pipe(z.array(z.string()).min(1, "Pick at least one domain.").max(DOMAIN_KEYS.length)),
  languages: z.array(z.string()).transform((l) => [...new Set(l.filter((x) => x in LANGUAGES))]).pipe(z.array(z.string()).min(1, "Pick at least one language.")),
  timezone: z.string().trim().max(64).refine(validTz, "Pick a time zone from the list."),
  firm: oneLine(120).optional().transform((v) => (v ? v : undefined)),
  credentials: z.string().trim().min(10, "List at least one credential (10 characters or more).").max(2000),
  conflicts: z.string().trim().max(2000).optional().transform((v) => v ?? ""),
  weeklyHours: z.coerce.number().int("Whole hours only.").min(2, "At least 2 hours a week.").max(60, "At most 60 hours a week."),
});
export type Application = z.infer<typeof ApplicationSchema>;
export type ApplicationField = keyof Application;

export type ApplicationRead = { ok: true; robot: boolean; data: Application } | { ok: false; robot: false; errors: Partial<Record<ApplicationField, string>> };
/** Read the posted form. A filled honeypot reads as ok with robot=true: the robot is told all went well and nothing is stored. */
export function readApplication(input: Record<string, unknown>): ApplicationRead {
  const trap = input[APPLICATION_TRAP];
  const robot = typeof trap === "string" && trap.trim().length > 0;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? [v] : []);
  const r = ApplicationSchema.safeParse({
    name: input.name ?? "", email: input.email ?? "", domains: arr(input.domains), languages: arr(input.languages), timezone: input.timezone ?? "",
    firm: typeof input.firm === "string" ? input.firm : undefined, credentials: input.credentials ?? "", conflicts: typeof input.conflicts === "string" ? input.conflicts : undefined, weeklyHours: input.weeklyHours ?? "",
  });
  if (robot) return { ok: true, robot: true, data: r.success ? r.data : { name: "robot", email: "robot@invalid.example", domains: ["digital"], languages: ["en"], timezone: "UTC", firm: undefined, credentials: "robot", conflicts: "", weeklyHours: 2 } };
  if (!r.success) {
    const errors: Partial<Record<ApplicationField, string>> = {};
    for (const i of r.error.issues) { const k = String(i.path[0]) as ApplicationField; errors[k] ??= i.message; }
    return { ok: false, robot: false, errors };
  }
  return { ok: true, robot: false, data: r.data };
}

/** "12345678" → "••••5678": credential numbers are never stored in full. */
export const maskNumber = (n: string) => { const s = n.replace(/\s+/g, ""); return s.length <= 4 ? "•".repeat(s.length) : `${"•".repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`; };
