/**
 * F4.05 — the mediator router. Pure and deterministic: same inputs, same ranking, same explanation.
 *
 * 1. Eligibility (any failure excludes, with a reason code): status ACTIVE or SENIOR (Ops assignment and taking an open
 *    case also admit PROBATION, whose verdicts are co-signed) · domain covers the case's blueprint ·
 *    shares a language with every party (default "en") · no case with either party in the last 180 days · no declared
 *    conflict · not in the same firm as a party (when the party's firm is known) · a verified credential that has not
 *    expired · not paused or on leave · open cases below their maximum · not already offered this case · not a party.
 * 2. Score, in whole points out of 1,000 so ties are exact: 400 domain fit (exact blueprint 1.0, its domain 0.6) ·
 *    200 load (1 − open ÷ max) · 150 SLA record (verdicts within 48 h, last 90 days; 0.5 when none) · 150 quality
 *    (mean of rating and second-review agreement; 0.5 when none) · 100 timezone overlap of 09:00–17:00 working hours.
 * 3. Order: total, then least recently assigned (never assigned first), then id.
 * The full breakdown is stored with the offer so the case page can say why this mediator was picked.
 */
import { DAY } from "@/lib/clock";
import type { MediatorStatus } from "@/db/schema-mediators";
import { FIT_VALUE, domainFit, domainOf, type FitKind } from "./domains";

export const COI_DAYS = 180;
export const SLA_HOURS = 48;
export const SLA_WINDOW_DAYS = 90;
export const WEIGHTS = { domain: 400, load: 200, sla: 150, quality: 150, timezone: 100 } as const;
export type Part = keyof typeof WEIGHTS;
export const PART_LABEL: Record<Part, string> = { domain: "Domain fit", load: "Current load", sla: "Verdicts on time", quality: "Quality", timezone: "Working-hours overlap" };
export const ROUTABLE: MediatorStatus[] = ["ACTIVE", "SENIOR"];

export type Exclusion = "IS_PARTY" | "STATUS" | "DOMAIN" | "LANGUAGE" | "COI_HISTORY" | "COI_DECLARED" | "SAME_FIRM" | "CREDENTIALS" | "PAUSED" | "ON_LEAVE" | "AT_CAPACITY" | "ALREADY_OFFERED";
export const EXCLUSION_LABEL: Record<Exclusion, string> = {
  IS_PARTY: "is a party to the contract", STATUS: "not active in the network", DOMAIN: "does not cover this kind of work",
  LANGUAGE: "no shared language with the parties", COI_HISTORY: "had a case with a party in the last 180 days", COI_DECLARED: "declared a conflict with a party",
  SAME_FIRM: "same firm as a party", CREDENTIALS: "no verified, unexpired credential", PAUSED: "paused", ON_LEAVE: "on leave",
  AT_CAPACITY: "at their open-case limit", ALREADY_OFFERED: "already offered this case",
};

export interface CaseHistory { mediatorId: string | null; clientId: string; providerId: string | null; at: Date }
/** Mediators with a case involving either party in the last 180 days (F4.05). */
export function conflicted(history: CaseHistory[], parties: string[], now: Date, days = COI_DAYS): Set<string> {
  const since = now.getTime() - days * DAY;
  const out = new Set<string>();
  for (const h of history) {
    if (!h.mediatorId || h.at.getTime() < since) continue;
    if (parties.includes(h.clientId) || (h.providerId && parties.includes(h.providerId))) out.add(h.mediatorId);
  }
  return out;
}

export interface Candidate {
  id: string;
  status: MediatorStatus;
  domains: string[];
  languages: string[];
  timezone: string;
  maxOpen: number;
  firm: string | null;
  declaredConflicts: string[];
  paused: boolean;
  leave: { from: string | null; to: string | null } | null;
  /** null = the org has no mediator network yet (legacy pool): credentials are not checked */
  credentials: { status: "PENDING" | "VERIFIED" | "REJECTED"; expiresOn: string | null }[] | null;
  openCases: number;
  sla: { onTime: number; total: number };
  ratings: { sum: number; count: number };
  secondReview: { agree: number; disagree: number };
  lastAssignedAt: Date | null;
}
export interface Party { id: string; email?: string | null; firm?: string | null; timezone?: string | null; languages?: string[] }
export interface CaseInput {
  blueprintCode: string; parties: Party[]; history: CaseHistory[]; now: Date; alreadyOffered?: string[];
  /** statuses that may take the case; default ACTIVE and SENIOR. Ops assignment and taking an open case also admit PROBATION (co-signed). */
  statuses?: MediatorStatus[];
}
export const WITH_PROBATION: MediatorStatus[] = [...ROUTABLE, "PROBATION"];

export interface ScorePart { part: Part; label: string; weight: number; value: number; points: number; note: string }
export interface Ranked { id: string; total: number; parts: ScorePart[]; fit: FitKind; lastAssignedAt: string | null }
export interface Ranking { ranked: Ranked[]; excluded: { id: string; reasons: Exclusion[] }[] }

/** Lower-case letters and digits only, with common company suffixes removed: "Iyer Studio LLP" ≡ "iyer studio". */
export function normFirm(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/\b(llp|llc|ltd|limited|inc|incorporated|gmbh|plc|pvt|private|co|corp|corporation)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** UTC offset in minutes for an IANA zone at a moment (deterministic for a given date). Unknown zones count as UTC. */
export function offsetMinutes(tz: string | null | undefined, at: Date): number {
  if (!tz || tz === "UTC") return 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
    return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
  } catch { return 0; }
}
/** Shared hours of two 09:00–17:00 working days, as a share of 8 hours (quarter-hour steps, wraps midnight). */
export function workingOverlap(tzA: string | null | undefined, tzB: string | null | undefined, at: Date): number {
  const slots = (tz: string | null | undefined) => {
    const off = offsetMinutes(tz, at), s = new Set<number>();
    for (let m = 9 * 60; m < 17 * 60; m += 15) s.add((((m - off) % 1440) + 1440) % 1440);
    return s;
  };
  const a = slots(tzA), b = slots(tzB);
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / 32;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function exclusions(c: Candidate, k: CaseInput, coi: Set<string>): Exclusion[] {
  const out: Exclusion[] = [];
  const partyIds = k.parties.map((p) => p.id);
  if (partyIds.includes(c.id)) out.push("IS_PARTY");
  if (!(k.statuses ?? ROUTABLE).includes(c.status)) out.push("STATUS");
  if (domainFit(c.domains, k.blueprintCode) === "none") out.push("DOMAIN");
  const mine = new Set(c.languages.map((l) => l.toLowerCase()));
  if (k.parties.some((p) => !(p.languages?.length ? p.languages : ["en"]).some((l) => mine.has(l.toLowerCase())))) out.push("LANGUAGE");
  if (coi.has(c.id)) out.push("COI_HISTORY");
  const declared = new Set(c.declaredConflicts.map((x) => x.trim().toLowerCase()).filter(Boolean));
  const declaredFirms = new Set(c.declaredConflicts.map(normFirm).filter(Boolean));
  if (k.parties.some((p) => declared.has(p.id.toLowerCase()) || (p.email && declared.has(p.email.toLowerCase())) || (p.firm && declaredFirms.has(normFirm(p.firm))))) out.push("COI_DECLARED");
  const myFirm = normFirm(c.firm);
  if (myFirm && k.parties.some((p) => p.firm && normFirm(p.firm) === myFirm)) out.push("SAME_FIRM");
  if (c.credentials !== null) {
    const today = isoDay(k.now);
    if (!c.credentials.some((x) => x.status === "VERIFIED" && (!x.expiresOn || x.expiresOn >= today))) out.push("CREDENTIALS");
  }
  if (c.paused || c.status === "PAUSED") out.push("PAUSED");
  if (c.leave?.from && c.leave.to) { const today = isoDay(k.now); if (c.leave.from <= today && today <= c.leave.to) out.push("ON_LEAVE"); }
  if (c.openCases >= c.maxOpen) out.push("AT_CAPACITY");
  if (k.alreadyOffered?.includes(c.id)) out.push("ALREADY_OFFERED");
  return out;
}

export function score(c: Candidate, k: CaseInput): { total: number; parts: ScorePart[]; fit: FitKind } {
  const fit = domainFit(c.domains, k.blueprintCode);
  const dom = domainOf(k.blueprintCode);
  const load = c.maxOpen > 0 ? Math.max(0, 1 - c.openCases / c.maxOpen) : 0;
  const sla = c.sla.total > 0 ? c.sla.onTime / c.sla.total : 0.5;
  const q: number[] = [];
  if (c.ratings.count > 0) q.push((c.ratings.sum / c.ratings.count - 1) / 4);
  const reviews = c.secondReview.agree + c.secondReview.disagree;
  if (reviews > 0) q.push(c.secondReview.agree / reviews);
  const quality = q.length ? q.reduce((a, b) => a + b, 0) / q.length : 0.5;
  const tzs = k.parties.filter((p) => p.timezone);
  const tz = tzs.length ? tzs.reduce((a, p) => a + workingOverlap(c.timezone, p.timezone, k.now), 0) / tzs.length : 0.5;
  const v: Record<Part, number> = { domain: FIT_VALUE[fit], load, sla, quality, timezone: tz };
  const notes: Record<Part, string> = {
    domain: fit === "exact" ? `Lists this blueprint (${k.blueprintCode})` : fit === "category" ? `Covers the ${dom ?? "same"} domain` : fit === "generalist" ? "Generalist (no declared domains)" : "No fit",
    load: `${c.openCases} of ${c.maxOpen} open cases`,
    sla: c.sla.total > 0 ? `${c.sla.onTime} of ${c.sla.total} verdicts within ${SLA_HOURS} h (last ${SLA_WINDOW_DAYS} days)` : "No verdicts in the last 90 days: neutral 0.5",
    quality: q.length ? [c.ratings.count ? `rating ${(c.ratings.sum / c.ratings.count).toFixed(1)} of 5 (${c.ratings.count})` : null, reviews ? `${c.secondReview.agree} of ${reviews} second reviews agreed` : null].filter(Boolean).join(" · ") : "No ratings or second reviews yet: neutral 0.5",
    timezone: tzs.length ? `${Math.round(tz * 8 * 10) / 10} of 8 working hours shared on average (${c.timezone})` : "Parties' time zones unknown: neutral 0.5",
  };
  const parts = (Object.keys(WEIGHTS) as Part[]).map((p) => ({ part: p, label: PART_LABEL[p], weight: WEIGHTS[p], value: round3(v[p]), points: Math.round(WEIGHTS[p] * v[p]), note: notes[p] }));
  return { total: parts.reduce((a, p) => a + p.points, 0), parts, fit };
}

/** Rank every candidate for one case. Deterministic: total desc, least recently assigned, id. */
export function rankMediators(cands: Candidate[], k: CaseInput): Ranking {
  const coi = conflicted(k.history, k.parties.map((p) => p.id), k.now);
  const ranked: Ranked[] = [], excluded: Ranking["excluded"] = [];
  for (const c of cands) {
    const why = exclusions(c, k, coi);
    if (why.length) { excluded.push({ id: c.id, reasons: why }); continue; }
    const s = score(c, k);
    ranked.push({ id: c.id, total: s.total, parts: s.parts, fit: s.fit, lastAssignedAt: c.lastAssignedAt ? c.lastAssignedAt.toISOString() : null });
  }
  ranked.sort((a, b) => b.total - a.total || (a.lastAssignedAt ?? "").localeCompare(b.lastAssignedAt ?? "") || a.id.localeCompare(b.id));
  excluded.sort((a, b) => a.id.localeCompare(b.id));
  return { ranked, excluded };
}

export interface ScoreBreakdown {
  version: 1; at: string; blueprintCode: string; domain: string | null; mediatorId: string; rank: number; total: number; parts: ScorePart[];
  tieBreak: string | null; considered: number; eligible: number; runnersUp: { id: string; total: number }[]; excluded: { id: string; reasons: Exclusion[] }[];
  mode: "network" | "legacy";
}
/** The explanation stored with an offer to ranking[index]. */
export function breakdownFor(r: Ranking, index: number, k: CaseInput, mode: "network" | "legacy"): ScoreBreakdown {
  const me = r.ranked[index];
  const next = r.ranked[index + 1];
  const tie = next && next.total === me.total ? (me.lastAssignedAt === next.lastAssignedAt ? "Tied on points and last assignment; ordered by id." : "Tied on points; picked because their last assignment is older.") : null;
  return {
    version: 1, at: k.now.toISOString(), blueprintCode: k.blueprintCode, domain: domainOf(k.blueprintCode), mediatorId: me.id, rank: index + 1, total: me.total, parts: me.parts,
    tieBreak: tie, considered: r.ranked.length + r.excluded.length, eligible: r.ranked.length,
    runnersUp: r.ranked.filter((_, i) => i !== index).slice(0, 3).map((x) => ({ id: x.id, total: x.total })), excluded: r.excluded, mode,
  };
}

/** A candidate from before the network existed (the org has no profiles): active generalist, English, no credential check. */
export function legacyCandidate(id: string, openCases = 0, lastAssignedAt: Date | null = null): Candidate {
  return { id, status: "ACTIVE", domains: ["*"], languages: ["en"], timezone: "UTC", maxOpen: 50, firm: null, declaredConflicts: [], paused: false, leave: null, credentials: null, openCases, sla: { onTime: 0, total: 0 }, ratings: { sum: 0, count: 0 }, secondReview: { agree: 0, disagree: 0 }, lastAssignedAt };
}
