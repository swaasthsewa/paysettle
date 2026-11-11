/**
 * Test and seed fixtures for the money module (F3.01–F3.12): a locked contract with one planned tranche, built directly in
 * the database (the contracts module normally does this at lock time). Test data lives in orgs prefixed org_test_ so the
 * finance and ops screens can hide it.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { disputes, evidencePackages, orgs, paypalLinks, simSessions, tranches, users, verdicts, workspaces, wsMilestones } from "@/db/schema";
import { evidenceReviews } from "@/db/schema-evidence";
import { newId, sha256 } from "@/lib/ids";
import { approvalSignature } from "@/server/evidence";

export interface FixtureMilestone { code?: string; title?: string; type?: "GATE" | "PAY"; day: number; amountCents: number; state?: string; dependsOn?: string[] }
export interface Fixture { orgId: string; clientId: string; providerId: string; workspaceId: string; trancheId: string; milestoneIds: string[] }

export async function makeContract(p: {
  milestones: FixtureMilestone[]; rail?: "A1" | "A2" | "B" | "MOCK"; feeBps?: number; title?: string;
  orgId?: string; clientId?: string; providerId?: string; workspaceId?: string; blueprintCode?: string; test?: boolean;
}): Promise<Fixture> {
  const tag = newId("t").slice(2, 12);
  const orgId = p.orgId ?? `org_test_money_${tag}`;
  if (!p.orgId) await db.insert(orgs).values({ id: orgId, name: "money test", demo: true }).onConflictDoNothing();
  const clientId = p.clientId ?? `u_tc_${tag}`, providerId = p.providerId ?? `u_tp_${tag}`;
  if (!p.clientId) await db.insert(users).values({ id: clientId, orgId, email: `client-${tag}@test.invalid`, name: "Test Client", role: "client", onboardingState: "ACTIVE" });
  if (!p.providerId) {
    await db.insert(users).values({ id: providerId, orgId, email: `provider-${tag}@test.invalid`, name: "Test Provider", role: "provider", onboardingState: "ACTIVE" });
    await db.insert(paypalLinks).values({ id: `pl_${tag}`, userId: providerId, kind: "merchant", email: `provider-${tag}@business.example.com`, receivable: true, emailConfirmed: true });
  }
  const total = p.milestones.reduce((s, m) => s + (m.type === "GATE" ? 0 : m.amountCents), 0);
  const workspaceId = p.workspaceId ?? newId("ws");
  await db.insert(workspaces).values({ id: workspaceId, orgId, blueprintCode: p.blueprintCode ?? "UC_WEB_MVP", title: p.title ?? `Money test ${tag}`, clientId, providerId, totalCents: total, feeBps: p.feeBps ?? 250, rail: p.rail ?? "MOCK", state: "LOCKED" });
  const milestoneIds: string[] = [];
  let seq = 0;
  for (const m of p.milestones) {
    const id = newId("ms"); milestoneIds.push(id); seq += 1;
    const code = m.code ?? `M${String(seq).padStart(2, "0")}`;
    await db.insert(wsMilestones).values({
      id, workspaceId, seq, code, origin: "BASELINE", type: m.type ?? "PAY", title: m.title ?? `Step ${seq}`, targetDay: m.day, bps: 0, amountCents: m.type === "GATE" ? 0 : m.amountCents,
      proof: { artifacts: [{ kind: "PDF", min: 1 }], criteria: ["done"] }, lockRule: "client approval", disputeRule: "scoped dispute", dependsOn: m.dependsOn ?? [], trancheIdx: 1, state: m.state ?? "LOCKED",
    });
  }
  const trancheId = newId("tr");
  await db.insert(tranches).values({ id: trancheId, workspaceId, idx: 1, rail: p.rail ?? "MOCK", amountCents: total, startDay: 1, endDay: Math.max(...p.milestones.map((m) => m.day)), state: "PLANNED" });
  return { orgId, clientId, providerId, workspaceId, trancheId, milestoneIds };
}

/** Sets the playground clock offset (hours) for a workspace, as the time machine does. */
export async function setOffset(workspaceId: string, hours: number) {
  const [s] = await db.select().from(simSessions).where(eq(simSessions.workspaceId, workspaceId)).limit(1);
  if (s) await db.update(simSessions).set({ clockOffsetHours: hours }).where(eq(simSessions.id, s.id));
  else await db.insert(simSessions).values({ id: newId("sim"), scenario: "money-test", workspaceId, clockOffsetHours: hours, mode: "MOCK" });
}

export async function setMilestoneState(id: string, state: string) {
  await db.update(wsMilestones).set({ state }).where(eq(wsMilestones.id, id));
}

/**
 * P4 test helper: records what the evidence module records when a client approves — an evidence package (reused
 * when one exists) and an APPROVE review signed with the evidence module's approvalSignature — and returns that signature,
 * so a test can call releaseMilestone through the real authority check. `decision` DEEMED_APPROVED mimics the timer rule.
 */
export async function recordApproval(milestoneId: string, opts: { by?: string; decision?: "APPROVE" | "DEEMED_APPROVED" } = {}): Promise<string> {
  let [pkg] = await db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, milestoneId)).orderBy(desc(evidencePackages.attempt)).limit(1);
  if (!pkg) {
    const note = `test evidence for ${milestoneId}`;
    [pkg] = await db.insert(evidencePackages).values({ id: newId("ev"), milestoneId, attempt: 1, rootHash: sha256(sha256(note)), files: [], note, state: "APPROVED", submittedBy: opts.by ?? "test" }).returning();
  }
  const sig = approvalSignature(milestoneId, pkg.rootHash);
  await db.insert(evidenceReviews).values({ id: newId("rv"), packageId: pkg.id, milestoneId, decision: opts.decision ?? "APPROVE", rootHash: pkg.rootHash, signature: sig, byUser: opts.by ?? null, mfa: opts.decision === "DEEMED_APPROVED" ? "system" : "sandbox-skip" });
  return sig;
}

/** P4 test helper: a signed verdict on the milestone's dispute (dispute opened if none), as the disputes module writes it. Returns the signature. */
export async function recordVerdict(milestoneId: string, p: { refundCents: number; releaseCents: number; mediatorId?: string }): Promise<string> {
  const [m] = await db.select().from(wsMilestones).where(eq(wsMilestones.id, milestoneId)).limit(1);
  let [d] = await db.select().from(disputes).where(eq(disputes.milestoneId, milestoneId)).limit(1);
  if (!d) {
    const soon = new Date(Date.now() + 86_400_000);
    [d] = await db.insert(disputes).values({ id: newId("dsp"), milestoneId, openedBy: "test", reason: "QUALITY", narrative: "test dispute", amountCents: m.amountCents, tier: 3, state: "EXECUTING", tier1Until: soon, vaultUntil: soon }).returning();
  }
  const signature = sha256(`test-verdict:${d.id}:${p.refundCents}:${p.releaseCents}`);
  await db.insert(verdicts).values({ id: newId("vd"), disputeId: d.id, origin: "TIER3", mediatorId: p.mediatorId ?? "u_med", providerShareBps: m.amountCents ? Math.round((p.releaseCents * 10_000) / m.amountCents) : 0, refundCents: p.refundCents, releaseCents: p.releaseCents, findings: "test", rootCause: "SCOPE", disposition: "RESUME", signature }).onConflictDoNothing();
  const [v] = await db.select({ signature: verdicts.signature }).from(verdicts).where(eq(verdicts.disputeId, d.id)).limit(1);
  return v.signature;
}
