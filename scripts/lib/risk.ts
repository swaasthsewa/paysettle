/**
 * Seed helper (F2.07 risk score): stores the policy risk score of a contract's current terms — riskScore()
 * from src/lib/policy on the contracts module's policy input, with the provider's tier and PayPal readiness — so the stored
 * workspaces.risk_score (shown on /ops) equals the score /ops/clearance recomputes.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import { paypalLinks, users, workspaces, wsClauses, wsMilestones } from "../../src/db/schema";
import { riskScore, type Tier } from "../../src/lib/policy";
import { policyInput } from "../../src/server/contracts/core";

export async function syncRisk(id: string): Promise<number> {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  const ms = await db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, id));
  const cl = await db.select().from(wsClauses).where(eq(wsClauses.workspaceId, id));
  let tier: Tier = "new", payable = false;
  if (w.providerId) {
    const [u] = await db.select({ tier: users.tier }).from(users).where(eq(users.id, w.providerId)).limit(1);
    const [l] = await db.select({ id: paypalLinks.id }).from(paypalLinks).where(and(eq(paypalLinks.userId, w.providerId), eq(paypalLinks.kind, "merchant"), eq(paypalLinks.receivable, true))).limit(1);
    tier = (u?.tier ?? "new") as Tier; payable = Boolean(l);
  }
  const score = riskScore(policyInput({ totalCents: w.totalCents, rail: w.rail }, ms, cl, payable), tier).score;
  if (score !== w.riskScore) await db.update(workspaces).set({ riskScore: score }).where(eq(workspaces.id, id));
  return score;
}
