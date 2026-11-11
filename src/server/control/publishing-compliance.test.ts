/**
 * Control-plane tests: F5.03 blueprint publishing through four-eyes, F5.09 ops-touch rate, F5.05 Form 1099-K
 * review flag, F2.10 contract PDF access and data. Database tests run in a transaction that is rolled back.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { auditChain, blueprints, disputes, releases, revisions, signatures, tranches, workspaces, wsClauses, wsMilestones, type BlueprintMilestone } from "@/db/schema";
import { blueprintReleases } from "@/db/schema-representment";
import { canonical, canonicalHash } from "@/lib/canonical";
import { newId, sha256 } from "@/lib/ids";
import { contractPdf } from "@/lib/pdf/contract";
import { DomainError } from "../types";
import { Rollback } from "./common";
import { approve, propose } from "./dual";
import { blueprintProblems, bumpVersion, compareVersions } from "./blueprint-release";
import { opsTouch } from "./analytics";
import { FORM_1099K_DEFAULT, taxFlag, taxYearRows } from "./compliance";
import { contractPdfAccess, contractPdfData } from "./documents";

const MKT = { id: "u_mkt", role: "marketing" as const }, OPS = { id: "u_ops", role: "ops" as const }, ADMIN = { id: "u_admin", role: "admin" as const };
const FIN = { id: "u_fin", role: "finance" as const }, MED = { id: "u_med", role: "mediator" as const }, MED2 = { id: "u_med2", role: "mediator" as const };

async function inTx(fn: (tx: Tx) => Promise<void>) {
  try { await db.transaction(async (tx) => { await fn(tx); throw new Rollback(); }); }
  catch (e) { if (!(e instanceof Rollback)) throw e; }
}
const err = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof DomainError ? e.code : String(e); } };

const ms = (code: string, day: number, bps: number, type: "PAY" | "GATE" = "PAY"): BlueprintMilestone => ({ code, title: `Step ${code}`, type, day, bps, proof: { artifacts: [{ kind: "PDF", min: 1 }], criteria: ["done"] }, lockRule: "client approval", disputeRule: "scoped" });
async function testBlueprint(tx: Tx, o: { active?: boolean; version?: string; milestones?: BlueprintMilestone[]; clauseBody?: string } = {}) {
  const code = `BP_TEST_${newId("b").slice(2, 10).toUpperCase()}`;
  await tx.insert(blueprints).values({
    code, title: "Test template", vertical: "Software", kind: "DIGITAL", summary: "x", recommendedDays: 20, version: o.version ?? "1.0.0", active: o.active ?? true,
    milestones: o.milestones ?? [ms("M1", 5, 3000), ms("M2", 10, 3000), ms("M3", 20, 4000)],
    clauses: [{ code: "B1", category: "BASELINE", title: "Ownership", body: o.clauseBody ?? "On each release, the client owns the work delivered in that milestone." }],
  });
  return code;
}

describe("F5.03 blueprint publishing through four-eyes", () => {
  it("F5.03 versions compare numerically; the next patch is suggested", () => {
    expect(compareVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareVersions("2.0.0", "10.0.0")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(bumpVersion("1.0.9")).toBe("1.0.10");
    expect(bumpVersion("junk")).toBe("1.0.0");
  });

  it("F5.03 readiness: shares, proof, rules, order and contradicting clauses are checked", () => {
    const ok = { milestones: [ms("M1", 5, 3000), ms("M2", 10, 3000), ms("M3", 20, 4000)], clauses: [], recommendedDays: 20 };
    expect(blueprintProblems(ok)).toEqual([]);
    expect(blueprintProblems({ ...ok, milestones: [ms("M1", 5, 3000), ms("M2", 10, 3000), ms("M3", 20, 3000)] }).join(" ")).toMatch(/90\.00%/);
    const noProof = { ...ms("M3", 20, 4000), proof: { artifacts: [], criteria: [] } };
    expect(blueprintProblems({ ...ok, milestones: [ms("M1", 5, 3000), ms("M2", 10, 3000), noProof] }).join(" ")).toMatch(/M3 pays money without naming proof/);
    expect(blueprintProblems({ ...ok, clauses: [{ code: "B9", category: "BASELINE", title: "x", body: "The client pays the shop directly to save fees." }] }).join(" ")).toMatch(/B9/);
    expect(blueprintProblems({ ...ok, milestones: [ms("M1", 5, 3000), { ...ms("M2", 3, 3000), dependsOn: ["M1"] }, ms("M3", 20, 4000)] }).join(" ")).toMatch(/M2/);
  });

  it("F5.03 marketing proposes a new version, the proposer cannot approve, Ops approves: live at the new version with history", async () => {
    await inTx(async (tx) => {
      const code = await testBlueprint(tx);
      const id = await propose(MKT, "PUBLISH_BLUEPRINT", code, { active: true, version: "1.1.0", note: "Reworded M2" }, "Clearer acceptance criteria for M2.", { dbx: tx });
      expect(await err(approve(MKT, id, { dbx: tx }))).toBe("FOUR_EYES");
      expect(await err(approve(FIN, id, { dbx: tx }))).toBe("FORBIDDEN");
      const r = await approve(OPS, id, { dbx: tx });
      expect(r.to).toEqual({ active: true, version: "1.1.0" });
      const [b] = await tx.select().from(blueprints).where(eq(blueprints.code, code));
      expect(b).toMatchObject({ active: true, version: "1.1.0" });
      const [h] = await tx.select().from(blueprintReleases).where(eq(blueprintReleases.blueprintCode, code));
      expect(h).toMatchObject({ action: "PUBLISH", fromVersion: "1.0.0", toVersion: "1.1.0", initiatorId: MKT.id, approverId: OPS.id, dualControlId: id, note: "Reworded M2" });
      const trail = await tx.select().from(auditChain).where(eq(auditChain.target, code));
      expect(trail.map((x) => x.action)).toContain("blueprint.published");
    });
  });

  it("F5.03 a live template needs a higher version; an empty version means the next patch; a withdrawal keeps the version", async () => {
    await inTx(async (tx) => {
      const code = await testBlueprint(tx, { version: "1.2.0" });
      expect(await err(propose(MKT, "PUBLISH_BLUEPRINT", code, { active: true, version: "1.2.0" }, "Same version again, should fail.", { dbx: tx }))).toBe("INVALID");
      expect(await err(propose(MKT, "PUBLISH_BLUEPRINT", code, { active: true, version: "v2" }, "Not a version at all here.", { dbx: tx }))).toBe("INVALID");
      const auto = await propose(MKT, "PUBLISH_BLUEPRINT", code, { active: true }, "Small wording fix to clause B1.", { dbx: tx });
      expect((await approve(OPS, auto, { dbx: tx })).to).toEqual({ active: true, version: "1.2.1" });
      const w = await propose(OPS, "PUBLISH_BLUEPRINT", code, { active: false }, "Withdrawn while the M3 dispute rate is reviewed.", { dbx: tx });
      expect((await approve(MKT, w, { dbx: tx })).to).toEqual({ active: false, version: "1.2.1" });
      expect(await err(propose(OPS, "PUBLISH_BLUEPRINT", code, { active: false }, "Withdraw it a second time, refused.", { dbx: tx }))).toBe("STATE");
      /* bring back at the same version */
      const back = await propose(MKT, "PUBLISH_BLUEPRINT", code, { active: true }, "Review done; same version comes back.", { dbx: tx });
      expect((await approve(OPS, back, { dbx: tx })).to).toEqual({ active: true, version: "1.2.1" });
    });
  });

  it("F5.03 a template that fails readiness cannot be proposed; roles without blueprint.publish cannot propose", async () => {
    await inTx(async (tx) => {
      const bad = await testBlueprint(tx, { active: false, milestones: [ms("M1", 5, 5000), ms("M2", 10, 2000), ms("M3", 20, 2000)] });
      expect(await err(propose(MKT, "PUBLISH_BLUEPRINT", bad, { active: true }, "Publish the unbalanced template.", { dbx: tx }))).toBe("INVALID");
      const good = await testBlueprint(tx);
      expect(await err(propose(ADMIN, "PUBLISH_BLUEPRINT", good, { active: true, version: "1.0.1" }, "Admin tries to publish this one.", { dbx: tx }))).toBe("FORBIDDEN");
      expect(await err(propose(FIN, "PUBLISH_BLUEPRINT", good, { active: true, version: "1.0.1" }, "Finance tries to publish this one.", { dbx: tx }))).toBe("FORBIDDEN");
    });
  });
});

/** A signed workspace in the demo org (rolled back), optionally sent to Ops and/or with a Tier 3 dispute. */
async function signedWs(tx: Tx, o: { ops?: boolean; tier3?: boolean; state?: string } = {}) {
  const id = newId("ws_x2");
  await tx.insert(workspaces).values({ id, orgId: "org_demo", blueprintCode: "UC_WEB_MVP", title: "Ops-touch test", clientId: "u_priya", providerId: "u_arjun", totalCents: 10_000, state: o.state ?? "LOCKED" });
  const m = newId("ms_x2");
  await tx.insert(wsMilestones).values({ id: m, workspaceId: id, seq: 1, code: "M1", origin: "BASELINE", type: "PAY", title: "M1", targetDay: 5, bps: 10_000, amountCents: 10_000, proof: { artifacts: [{ kind: "PDF", min: 1 }], criteria: ["x"] }, lockRule: "x", disputeRule: "x", state: "OPEN" });
  if (o.ops) await tx.insert(auditChain).values({ action: "contract.pending_ops", target: id, prevHash: "0".repeat(64), hash: sha256(id), detail: {} });
  if (o.tier3) { const soon = new Date(Date.now() + 86_400_000); await tx.insert(disputes).values({ id: newId("dsp"), milestoneId: m, openedBy: "u_priya", reason: "QUALITY", narrative: "x", amountCents: 10_000, tier: 3, state: "TIER3", tier1Until: soon, vaultUntil: soon }); }
  return { id, m };
}

describe("F5.09 ops-touch rate", () => {
  it("F5.09 share of signed contracts needing Ops clearance or a Tier 3 mediator; both count once; drafts are out", async () => {
    await inTx(async (tx) => {
      const ids: string[] = [];
      for (const o of [{ ops: true }, { tier3: true }, { ops: true, tier3: true }, {}, {}, {}, {}, {}, {}, {}]) ids.push((await signedWs(tx, o)).id);
      ids.push((await signedWs(tx, { state: "DRAFT", tier3: true })).id); /* never signed: not in the cohort */
      const t = await opsTouch(tx, { workspaceIds: ids });
      expect(t).toMatchObject({ cohort: 10, touched: null, opsClearance: null, tier3: null });
      /* counts under 5 are suppressed even when the cohort is big enough; the rate needs both parts visible */
      expect(t.rateBps).toBeNull();
      for (let i = 0; i < 6; i++) ids.push((await signedWs(tx, { ops: true })).id);
      const t2 = await opsTouch(tx, { workspaceIds: ids });
      expect(t2).toMatchObject({ cohort: 16, touched: 9, opsClearance: 8, tier3: null, rateBps: Math.round((9 * 10_000) / 16) });
      expect(await opsTouch(tx, { workspaceIds: [] })).toMatchObject({ cohort: 0, rateBps: null });
    });
  });
});

describe("F5.05 Form 1099-K review flag", () => {
  it("F5.05 both parts must be over the line; 80% of either part is 'near'", () => {
    const L = FORM_1099K_DEFAULT;
    expect(taxFlag(L.grossCents + 1, L.transactions + 1).flag).toBe("OVER");
    expect(taxFlag(L.grossCents + 1, 10).flag).toBe("NEAR");
    expect(taxFlag(L.grossCents, L.transactions).flag).toBe("NEAR"); /* "more than", so exactly on the line is not over */
    expect(taxFlag(100_000, 3).flag).toBe("UNDER");
    expect(taxFlag(1_600_000, 3)).toMatchObject({ flag: "NEAR", grossShareBps: 8000 });
  });

  it("F5.05 per provider per calendar year from completed releases only", async () => {
    await inTx(async (tx) => {
      const { id: ws, m } = await signedWs(tx);
      const tr = newId("tr_x2");
      await tx.insert(tranches).values({ id: tr, workspaceId: ws, idx: 1, rail: "MOCK", amountCents: 10_000, startDay: 0, endDay: 26, state: "CLOSED" });
      const rel = (gross: number, at: Date, status: "COMPLETED" | "FAILED" = "COMPLETED") => ({ id: newId("rl"), milestoneId: m, trancheId: tr, idemKey: newId("k"), kind: "MILESTONE" as const, grossCents: gross, feeCents: 25, netCents: gross - 25, status, approvedBy: "u_priya", approvalSig: "x", createdAt: at, completedAt: at });
      await tx.insert(releases).values(rel(1_000, new Date(Date.UTC(2031, 5, 1))));
      await tx.insert(releases).values({ ...rel(9_999, new Date(Date.UTC(2031, 6, 1)), "FAILED"), kind: "VERDICT" as const });
      const rows = await taxYearRows(2031, tx);
      const arjun = rows.find((r) => r.providerId === "u_arjun")!;
      expect(arjun).toMatchObject({ payments: 1, grossCents: 1_000, feeCents: 25, netCents: 975, flag: "UNDER" });
      expect((await taxYearRows(2032, tx)).find((r) => r.providerId === "u_arjun")).toBeUndefined();
    });
  });
});

describe("F2.10 contract PDF", () => {
  async function sealed(tx: Tx) {
    const { id } = await signedWs(tx);
    await tx.insert(wsClauses).values({ id: newId("cl"), workspaceId: id, category: "SYSTEM", code: "SYS_01_HOLD", title: "Funds held through PayPal", body: "Each tranche is funded through PayPal.", active: true, protective: true });
    const doc = { kind: "paysettle.contract", v: 1, id, revNo: 1, title: "Ops-touch test", blueprint: "UC_WEB_MVP", currency: "USD", totalCents: 10_000, feeBps: 250, rail: "MOCK", clientId: "u_priya", providerId: "u_arjun", reviewTimeoutRule: "ESCALATE",
      milestones: [{ code: "M1", seq: 1, origin: "BASELINE", active: true, type: "PAY", title: "Design → build “v1”", day: 5, bps: 10_000, amountCents: 10_000, proof: { artifacts: [{ kind: "PDF", min: 1 }], criteria: ["signed off"] }, lockRule: "client approval", disputeRule: "scoped", dependsOn: [], tranche: 1 }],
      clauses: [{ code: "SYS_01_HOLD", category: "SYSTEM", title: "Funds held through PayPal", body: "Each tranche is funded through PayPal.", active: true, protective: true, linkedMilestone: null }, { code: "C1", category: "CUSTOM", title: "<b>Weekly</b> demo", body: "Shows progress every Friday ✓ ≥ 1 h", active: true, protective: false, linkedMilestone: null }],
      deadline: { lateDeduction: { rateBps: 50, graceDays: 1, capBps: 1000 } } };
    const hash = canonicalHash(doc);
    await tx.insert(revisions).values({ workspaceId: id, revNo: 1, hash, canonical: JSON.parse(canonical(doc)), authorId: "u_priya", change: { action: "CREATE" } });
    await tx.update(workspaces).set({ revision: 1, canonicalHash: hash }).where(eq(workspaces.id, id));
    for (const [who, role] of [["u_priya", "client"], ["u_arjun", "provider"]] as const) await tx.insert(signatures).values({ id: newId("sig"), workspaceId: id, revNo: 1, hash, signerId: who, role, signature: sha256(who + hash), mfa: true });
    return { id, hash };
  }

  it("F2.10 access: both parties, Ops and admin; a mediator only on an assigned dispute; others refused", async () => {
    await inTx(async (tx) => {
      const { id, m } = await signedWs(tx);
      expect(await contractPdfAccess({ id: "u_priya", role: "client" }, id, tx)).toBe("party");
      expect(await contractPdfAccess({ id: "u_arjun", role: "provider" }, id, tx)).toBe("party");
      expect(await contractPdfAccess(OPS, id, tx)).toBe("back-office");
      expect(await contractPdfAccess(ADMIN, id, tx)).toBe("back-office");
      expect(await err(contractPdfAccess({ id: "u_someone", role: "client" }, id, tx))).toBe("FORBIDDEN");
      expect(await err(contractPdfAccess({ id: "u_priya", role: "provider" }, id, tx))).toBe("FORBIDDEN");
      expect(await err(contractPdfAccess(FIN, id, tx))).toBe("FORBIDDEN");
      expect(await err(contractPdfAccess(MED, id, tx))).toBe("FORBIDDEN");
      const soon = new Date(Date.now() + 86_400_000);
      await tx.insert(disputes).values({ id: newId("dsp"), milestoneId: m, openedBy: "u_priya", reason: "QUALITY", narrative: "x", amountCents: 10_000, tier: 3, state: "TIER3", tier1Until: soon, vaultUntil: soon, mediatorId: MED.id });
      expect(await contractPdfAccess(MED, id, tx)).toBe("mediator");
      expect(await err(contractPdfAccess(MED2, id, tx))).toBe("FORBIDDEN");
      expect(await err(contractPdfAccess(OPS, "ws_does_not_exist", tx))).toBe("NOT_FOUND");
    });
  });

  it("F2.10 P5 the PDF shows what was signed: the sealed revision, its hash (recomputed), both signatures and extra signed terms", async () => {
    await inTx(async (tx) => {
      const { id, hash } = await sealed(tx);
      const d = await contractPdfData({ ...OPS, name: "Olga Ops" }, id, tx);
      expect(d.revision).toMatchObject({ revNo: 1, hash, recomputed: hash });
      expect(d.signatures.map((s) => s.role).sort()).toEqual(["client", "provider"]);
      expect(d.milestones[0]).toMatchObject({ code: "M1", amountCents: 10_000, artifacts: "1 pdf", criteria: ["signed off"] });
      expect(d.clauses.map((c) => c.code)).toEqual(["SYS_01_HOLD", "C1"]);
      expect(d.extraTerms).toHaveProperty("deadline");
      expect(d.canonicalJson && sha256(d.canonicalJson)).toBe(hash);
      const pdf = await contractPdf(d);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      const raw = pdf.toString("latin1");
      expect(raw).toContain("/EmbeddedFile");
      expect(raw).toMatch(/\/Lang \(en-US\)/);
      expect(pdf.byteLength).toBeGreaterThan(3000);
    });
  });
});
