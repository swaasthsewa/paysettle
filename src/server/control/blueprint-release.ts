/**
 * F5.03 (X2) blueprint publishing rules, pure: version comparison and the readiness check a template must pass before
 * a four-eyes request to publish it can be made. Readiness: payment shares add up to 100%, every payment milestone
 * names concrete proof, lock and dispute rules exist, the timeline does not depend backwards, and no baseline clause
 * reads like a contradiction of the system rules (same R07 patterns the contract room uses).
 */
import type { BlueprintClause, BlueprintMilestone } from "@/db/schema";
import { BPS_FULL } from "@/lib/money";
import { findContradictions } from "@/lib/clause-patterns";

export const SEMVER = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const parts = (v: string) => (SEMVER.test(v) ? v.split(".").map(Number) : [0, 0, 0]);
export function compareVersions(a: string, b: string): number {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
/** Next patch version ("1.0.9" → "1.0.10"); an unreadable version becomes "1.0.0". */
export const bumpVersion = (v: string) => { if (!SEMVER.test(v)) return "1.0.0"; const [a, b, c] = parts(v); return `${a}.${b}.${c + 1}`; };

export function blueprintProblems(b: { milestones: BlueprintMilestone[]; clauses: BlueprintClause[]; recommendedDays: number }): string[] {
  const out: string[] = [];
  const pay = b.milestones.filter((m) => m.type === "PAY");
  if (b.milestones.length < 3) out.push("It needs at least three milestones.");
  const sum = pay.reduce((s, m) => s + m.bps, 0);
  if (sum !== BPS_FULL) out.push(`Payment shares add up to ${(sum / 100).toFixed(2)}%, not 100%.`);
  const noProof = pay.filter((m) => !m.proof.artifacts.some((x) => x.min > 0) && !m.proof.oracle).map((m) => m.code);
  if (noProof.length) out.push(`${noProof.join(", ")} pay${noProof.length === 1 ? "s" : ""} money without naming proof.`);
  const noRules = b.milestones.filter((m) => !m.lockRule.trim() || !m.disputeRule.trim()).map((m) => m.code);
  if (noRules.length) out.push(`${noRules.join(", ")} need${noRules.length === 1 ? "s" : ""} a lock rule and a dispute rule.`);
  const day = new Map(b.milestones.map((m) => [m.code, m.day]));
  const backwards = b.milestones.filter((m) => (m.dependsOn ?? []).some((d) => (day.get(d) ?? 0) > m.day)).map((m) => m.code);
  if (backwards.length) out.push(`${backwards.join(", ")} come${backwards.length === 1 ? "s" : ""} before a milestone it depends on.`);
  const bad = b.clauses.filter((c) => findContradictions(c.body).length).map((c) => c.code);
  if (bad.length) out.push(`Clause ${bad.join(", ")} reads like a contradiction of the system rules.`);
  if (!(b.recommendedDays > 0)) out.push("Recommended days must be positive.");
  return out;
}
