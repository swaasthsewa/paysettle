/**
 * Tests: F5.01 reconciliation, F5.03 four-eyes, F5.09/F2.12 cohort suppression, F5.10 trust tiers.
 * Every database test runs inside a transaction that is rolled back, so the shared demo database stays as it was.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { auditChain, dualControl, flags, ledgerEntries, tranches, webhookEvents, workspaces, wsMilestones } from "@/db/schema";
import type { Db } from "@/db/client";
import { mockControl } from "@/lib/rails/mock";
import { railFor } from "@/lib/rails";
import { feeFor } from "@/lib/money";
import { idemKey, newId } from "@/lib/ids";
import { DomainError } from "../types";
import { Rollback } from "./common";
import { evaluateTranche, runReconcile } from "./recon";
import { approve, expireDue, propose, registerWebhookReplayHandler, veto } from "./dual";
import { exportPack, DISCLAIMER } from "./compliance";
import { audit, verifyChain } from "@/lib/audit";
import { createHmac } from "node:crypto";
import { rateBps, suppress, suppressRow, shown } from "./analytics";
import { cleanStreak, suggestTier } from "./providers";
import { clearanceStatus } from "./consoles";

const ops = { id: "u_ops", role: "ops" as const };
const fin = { id: "u_fin", role: "finance" as const };
const admin = { id: "u_admin", role: "admin" as const };
const judge = { id: "u_judge", role: "judge" as const };
const AGO = (min: number) => new Date(Date.now() - min * 60_000);

/** Run fn in a transaction and always roll it back. */
async function inTx(fn: (tx: Tx) => Promise<void>) {
  try { await db.transaction(async (tx) => { await fn(tx); throw new Rollback(); }); }
  catch (e) { if (!(e instanceof Rollback)) throw e; }
}

/** A funded MOCK tranche of $60.00 over three PAY milestones; M1 ($10.00) released through the mock rail; ledger written 20 min ago. */
async function fixture(tx: Tx) {
  const ws = newId("ws_test"), tr = newId("tr_test");
  await tx.insert(workspaces).values({ id: ws, orgId: "org_demo", blueprintCode: "UC_WEB_MVP", title: "Recon test", clientId: "u_priya", providerId: "u_arjun", totalCents: 6000, rail: "MOCK", state: "LOCKED" });
  const amounts = [1000, 2000, 3000];
  const ms = amounts.map((a, i) => ({ id: newId("ms_test"), workspaceId: ws, seq: i + 1, code: `M0${i + 1}`, origin: "BASELINE" as const, type: "PAY" as const, title: `M${i + 1}`, targetDay: 5 * (i + 1), bps: [1667, 3333, 5000][i], amountCents: a, proof: { artifacts: [{ kind: "PDF" as const, min: 1 }], criteria: ["x"] }, lockRule: "x", disputeRule: "x", state: i === 0 ? "RELEASED" : "OPEN" }));
  await tx.insert(wsMilestones).values(ms);
  const rail = railFor("MOCK");
  const hold = await rail.fund({ trancheId: tr, amountCents: 6000, currency: "USD", description: "test", returnUrl: "http://x/r", cancelUrl: "http://x/c", idemKey: idemKey(tr, "fund") });
  const st = await rail.confirm(hold.orderId, idemKey(tr, "confirm"));
  await tx.insert(tranches).values({ id: tr, workspaceId: ws, idx: 1, rail: "MOCK", amountCents: 6000, startDay: 0, endDay: 26, state: "PARTIALLY_RELEASED", paypalOrderId: hold.orderId, authorizationId: st.authorizationId, heldAt: AGO(30) });
  const cap = await rail.release({ orderId: hold.orderId, authorizationId: st.authorizationId, amountCents: 1000, currency: "USD", final: false, idemKey: idemKey(ms[0].id, "release"), note: "M1" });
  const fee = feeFor(1000, 250);
  await tx.insert(ledgerEntries).values([
    { trancheId: tr, type: "HOLD", debit: "paypal_hold", credit: "client", amountCents: 6000, paypalRef: st.authorizationId, at: AGO(25) },
    { trancheId: tr, milestoneId: ms[0].id, type: "RELEASE", debit: "provider", credit: "paypal_hold", amountCents: 1000 - fee, paypalRef: cap.id, at: AGO(20) },
    { trancheId: tr, milestoneId: ms[0].id, type: "FEE", debit: "platform_fee", credit: "paypal_hold", amountCents: fee, paypalRef: cap.id, at: AGO(20) },
  ]);
  return { ws, tr, ms, hold, st, rail };
}
const trancheState = async (tx: Tx, id: string) => (await tx.select({ s: tranches.state }).from(tranches).where(eq(tranches.id, id)))[0]?.s;

beforeEach(() => mockControl.reset());

describe("F5.01 three-way reconciliation", () => {
  it("F5.01 a clean tranche reconciles CLEAN across planes A, B and C", async () => {
    await inTx(async (tx) => {
      const f = await fixture(tx);
      const r = await runReconcile(null, undefined, { dbx: tx, trancheIds: [f.tr] });
      expect(r.verdict).toBe("CLEAN");
      expect(r.lines[0].status).toBe("MATCHED");
      expect(r.lines[0].planeB).toMatchObject({ holdCents: 6000, releaseCents: 975, feeCents: 25, remainingCents: 5000 });
      expect(r.lines[0].planeC).toMatchObject({ available: true, authorizedCents: 6000, capturedCents: 1000 });
      expect(await trancheState(tx, f.tr)).toBe("PARTIALLY_RELEASED");
    });
  });

  it("F5.01 P6 an injected unbalanced ledger entry older than 15 min is DRIFT and trips the breaker", async () => {
    await inTx(async (tx) => {
      const f = await fixture(tx);
      await tx.insert(ledgerEntries).values({ trancheId: f.tr, milestoneId: f.ms[1].id, type: "RELEASE", debit: "provider", credit: "paypal_hold", amountCents: 500, paypalRef: null, at: AGO(20) });
      const r = await runReconcile(null, undefined, { dbx: tx, trancheIds: [f.tr] });
      expect(r.verdict).toBe("DRIFT");
      expect(r.lines[0].status).toBe("DRIFT");
      expect(r.lines[0].tripped).toBe(true);
      expect(await trancheState(tx, f.tr)).toBe("BREAKER");
      const a = await tx.select().from(auditChain).where(and(eq(auditChain.action, "recon.breaker_tripped"), eq(auditChain.target, f.tr)));
      expect(a).toHaveLength(1);
    });
  });

  it("F5.01 the same difference younger than 15 min is IN_FLIGHT and leaves the tranche alone", async () => {
    await inTx(async (tx) => {
      const f = await fixture(tx);
      await tx.insert(ledgerEntries).values({ trancheId: f.tr, type: "RELEASE", debit: "provider", credit: "paypal_hold", amountCents: 500, paypalRef: null, at: AGO(2) });
      const r = await runReconcile(null, undefined, { dbx: tx, trancheIds: [f.tr] });
      expect(r.verdict).toBe("IN_FLIGHT");
      expect(await trancheState(tx, f.tr)).toBe("PARTIALLY_RELEASED");
    });
  });

  it("F5.01 Plane C: a PayPal capture with no ledger entry becomes DRIFT once past the lag window", async () => {
    await inTx(async (tx) => {
      const f = await fixture(tx);
      await f.rail.release({ orderId: f.hold.orderId, authorizationId: f.st.authorizationId, amountCents: 2000, currency: "USD", final: false, idemKey: idemKey(f.ms[1].id, "release"), note: "M2" });
      const soon = await runReconcile(null, undefined, { dbx: tx, trancheIds: [f.tr] });
      expect(soon.verdict).toBe("IN_FLIGHT");
      const later = await runReconcile(null, { from: AGO(60), to: new Date(Date.now() + 20 * 60_000) }, { dbx: tx, trancheIds: [f.tr] });
      expect(later.verdict).toBe("DRIFT");
      expect(later.lines[0].issues.some((i) => i.plane === "C" && i.actual === 2000)).toBe(true);
    });
  });

  it("F5.01 when the simulated PayPal lost its memory the line is UNAVAILABLE, never a false breaker", async () => {
    await inTx(async (tx) => {
      const f = await fixture(tx);
      mockControl.reset();
      const r = await runReconcile(null, undefined, { dbx: tx, trancheIds: [f.tr] });
      expect(r.lines[0].status).toBe("UNAVAILABLE");
      expect(r.verdict).toBe("IN_FLIGHT");
      expect(await trancheState(tx, f.tr)).toBe("PARTIALLY_RELEASED");
    });
  });

  it("F5.01 pure evaluation: more out than in is flagged on plane B", () => {
    const ev = evaluateTranche({
      tranche: { id: "t", workspaceId: "w", idx: 1, rail: "MOCK", amountCents: 1000, state: "HELD", paypalOrderId: null, authorizationId: null, captureId: null, heldAt: AGO(60) },
      milestones: [{ amountCents: 1000, state: "OPEN", type: "PAY", active: true }],
      ledger: [{ type: "HOLD", amountCents: 1000, paypalRef: null, milestoneId: null, at: AGO(60) }, { type: "RELEASE", amountCents: 1200, paypalRef: null, milestoneId: null, at: AGO(60) }],
      rail: { kind: "mock", txns: [] }, now: new Date(), windowFrom: AGO(60 * 24),
    });
    expect(ev.status).toBe("DRIFT");
    expect(ev.issues.some((i) => i.plane === "B")).toBe(true);
  });

  it("F5.01 a real money-service flow (fund, two releases, void of the remainder) reconciles CLEAN", async () => {
    /* uses the money module's services and fixture (test data in an org_test_ org, ignored by the consoles) */
    const { makeContract, recordApproval } = await import("../money/fixtures");
    const money = await import("../money");
    const f = await makeContract({ milestones: [{ day: 2, amountCents: 10_000 }, { day: 6, amountCents: 25_000 }, { day: 10, amountCents: 33_333 }, { day: 14, amountCents: 41_667 }] });
    const c = { id: f.clientId, role: "client" as const };
    const { approveUrl } = await money.fundTranche(c, f.trancheId);
    await money.confirmTranche(c, f.trancheId, new URL(approveUrl).searchParams.get("token") ?? undefined);
    for (const id of f.milestoneIds.slice(0, 2)) { await db.update(wsMilestones).set({ state: "APPROVED" }).where(eq(wsMilestones.id, id)); await money.releaseMilestone(c, id, { kind: "MILESTONE", approvalSig: await recordApproval(id, { by: c.id }) }); }
    /* the runs themselves are rolled back so test runs never show in the recon history */
    await inTx(async (tx) => { expect((await runReconcile(null, undefined, { dbx: tx, trancheIds: [f.trancheId] })).verdict).toBe("CLEAN"); });
    await money.returnToClient(ops, f.trancheId, 75_000, "terminated in test", idemKey("ctl-test-return", f.trancheId));
    await inTx(async (tx) => {
      const r = await runReconcile(null, undefined, { dbx: tx, trancheIds: [f.trancheId] });
      expect(r.verdict).toBe("CLEAN");
      expect(r.lines[0].planeB.remainingCents).toBe(0);
    });
  });

  it("F5.01 a verdict refund recorded without a milestone id does not count twice (no false breaker)", () => {
    const ev = evaluateTranche({
      tranche: { id: "t", workspaceId: "w", idx: 1, rail: "MOCK", amountCents: 3000, state: "PARTIALLY_RELEASED", paypalOrderId: null, authorizationId: null, captureId: null, heldAt: AGO(60) },
      milestones: [{ amountCents: 1000, state: "SETTLED_BY_VERDICT", type: "PAY", active: true }, { amountCents: 2000, state: "OPEN", type: "PAY", active: true }],
      ledger: [
        { type: "HOLD", amountCents: 3000, paypalRef: null, milestoneId: null, at: AGO(60) },
        { type: "RELEASE", amountCents: 488, paypalRef: null, milestoneId: "m1", at: AGO(50) }, { type: "FEE", amountCents: 12, paypalRef: null, milestoneId: "m1", at: AGO(50) },
        { type: "VOID", amountCents: 500, paypalRef: null, milestoneId: null, at: AGO(50) },
      ],
      rail: { kind: "mock", txns: null, error: "test" }, now: new Date(), windowFrom: AGO(60 * 24),
    });
    expect(ev.issues).toEqual([]);
  });

  it("F5.01 judges (read-only) cannot start a run", async () => {
    await expect(runReconcile(judge, undefined, { trancheIds: ["none"] })).rejects.toBeInstanceOf(DomainError);
  });
});

describe("F5.03 four-eyes dual control", () => {
  it("F5.03 refuses approval by the person who proposed it, then executes CLEAR_BREAKER for a second person", async () => {
    await inTx(async (tx) => {
      const f = await fixture(tx);
      await tx.update(tranches).set({ state: "BREAKER" }).where(eq(tranches.id, f.tr));
      const id = await propose(ops, "CLEAR_BREAKER", f.tr, {}, "Drift explained by a late capture; ledger fixed.", { dbx: tx });
      await expect(approve(ops, id, { dbx: tx })).rejects.toMatchObject({ code: "FOUR_EYES" });
      expect((await tx.select().from(dualControl).where(eq(dualControl.id, id)))[0].state).toBe("AWAITING");
      await approve(fin, id, { dbx: tx });
      const [row] = await tx.select().from(dualControl).where(eq(dualControl.id, id));
      expect(row).toMatchObject({ state: "EXECUTED", approverId: "u_fin" });
      expect(await trancheState(tx, f.tr)).toBe("PARTIALLY_RELEASED");
    });
  });

  it("F5.03 the database constraint blocks self-approval even if the code is bypassed", async () => {
    await expect(inTx(async (tx) => {
      /* drizzle-kit push drops CHECK constraints it does not know; re-apply the guard (transactional DDL, rolled back) */
      const guard = readFileSync("src/db/sql/guards.sql", "utf8").split("\n").filter((l) => /four_eyes/.test(l) && /^ALTER/.test(l)).join("\n");
      await tx.execute(sql.raw(guard));
      const id = await propose(admin, "FLIP_FLAG", "rail.B", { on: true }, "Turn Rail B on for the spike test.", { dbx: tx });
      await tx.update(dualControl).set({ approverId: "u_admin" }).where(eq(dualControl.id, id));
    })).rejects.toSatisfy((e: unknown) => /four_eyes/.test(String((e as { cause?: { message?: string } }).cause?.message ?? e)));
  });

  it("F5.03 requests expire after the 30-minute TTL and cannot be approved", async () => {
    await inTx(async (tx) => {
      const id = await propose(admin, "FLIP_FLAG", "deemed_approval.allowed", { on: true }, "Allow deemed approval for the pilot.", { dbx: tx, now: AGO(31) });
      await expect(approve(ops, id, { dbx: tx })).rejects.toMatchObject({ code: "EXPIRED" });
      expect((await tx.select().from(dualControl).where(eq(dualControl.id, id)))[0].state).toBe("EXPIRED");
      const id2 = await propose(admin, "FLIP_FLAG", "deemed_approval.allowed", { on: true }, "Allow deemed approval for the pilot.", { dbx: tx, now: AGO(40) });
      expect(await expireDue({ dbx: tx })).toBeGreaterThanOrEqual(1);
      expect((await tx.select().from(dualControl).where(eq(dualControl.id, id2)))[0].state).toBe("EXPIRED");
    });
  });

  it("F5.03 a flag flip runs only after a second person approves; veto stops it", async () => {
    await inTx(async (tx) => {
      const id = await propose(admin, "FLIP_FLAG", "playground.live", { on: true }, "Judges asked for the live sandbox run.", { dbx: tx });
      await approve(ops, id, { dbx: tx });
      expect((await tx.select().from(flags).where(eq(flags.key, "playground.live")))[0].on).toBe(true);
      const id2 = await propose(admin, "FLIP_FLAG", "rail.B", { on: true }, "Try delayed disbursement in the demo.", { dbx: tx });
      await veto(ops, id2, "Spike result not in yet.", { dbx: tx });
      await expect(approve(ops, id2, { dbx: tx })).rejects.toMatchObject({ code: "STATE" });
    });
  });

  it("P9 shared demo: AI cannot be switched off and playground blueprints cannot be withdrawn in sandbox mode", async () => {
    await inTx(async (tx) => {
      await expect(propose(admin, "FLIP_FLAG", "ai.enabled", { on: false }, "Pause AI while the cost cap is reviewed.", { dbx: tx })).rejects.toMatchObject({ code: "PROTECTED", message: "Protected in the shared demo." });
      await expect(propose(ops, "PUBLISH_BLUEPRINT", "UC_WEB_MVP", { active: false }, "Withdraw the web MVP template for a review.", { dbx: tx })).rejects.toMatchObject({ code: "PROTECTED" });
      // switching AI on still goes through four-eyes as before
      const on = await propose(admin, "FLIP_FLAG", "ai.enabled", { on: true }, "Make sure AI is on for the demo.", { dbx: tx });
      await approve(ops, on, { dbx: tx });
      expect((await tx.select().from(flags).where(eq(flags.key, "ai.enabled")))[0].on).toBe(true);
      // a request stored before the protection existed is refused at approval too
      const id = newId("dc");
      await tx.insert(dualControl).values({ id, action: "FLIP_FLAG", target: "ai.enabled", payload: { on: false }, reason: "Stored before the protection.", initiatorId: "u_admin", expiresAt: new Date(Date.now() + 10 * 60_000) });
      await expect(approve(ops, id, { dbx: tx })).rejects.toMatchObject({ code: "PROTECTED" });
    });
  });

  it("P9 outside the sandbox the same requests are allowed (four-eyes still applies)", async () => {
    const prev = process.env.PAYSETTLE_ENV;
    process.env.PAYSETTLE_ENV = "production";
    try {
      await inTx(async (tx) => {
        const id = await propose(admin, "FLIP_FLAG", "ai.enabled", { on: false }, "Pause AI while the cost cap is reviewed.", { dbx: tx });
        await approve(ops, id, { dbx: tx });
        expect((await tx.select().from(flags).where(eq(flags.key, "ai.enabled")))[0].on).toBe(false);
      });
    } finally { if (prev === undefined) delete process.env.PAYSETTLE_ENV; else process.env.PAYSETTLE_ENV = prev; }
  });

  it("F5.03 roles outside the action's permission (judge) cannot propose", async () => {
    await expect(propose(judge, "FLIP_FLAG", "rail.B", { on: true }, "Judges should not do this.")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("F5.09 F2.12 cohort suppression (N = 5)", () => {
  it("F5.09 counts 1–4 are suppressed; 0 and 5+ are shown", () => {
    expect(suppress(0)).toBe(0); expect(suppress(1)).toBeNull(); expect(suppress(4)).toBeNull(); expect(suppress(5)).toBe(5);
    expect(shown(suppress(3))).toBe("fewer than 5");
  });
  it("F2.12 a cohort under 5 suppresses the whole row; rates on small bases are hidden", () => {
    expect(suppressRow({ created: 4, signed: 0, funded: 0, completed: 0 }, "created")).toEqual({ created: null, signed: null, funded: null, completed: null });
    expect(suppressRow({ created: 12, signed: 7, funded: 3, completed: 0 }, "created")).toEqual({ created: 12, signed: 7, funded: null, completed: 0 });
    expect(rateBps(3, 10)).toBeNull(); expect(rateBps(5, 4)).toBeNull(); expect(rateBps(5, 20)).toBe(2500);
  });
});

describe("F5.10 provider trust tiers (§6.12)", () => {
  it("F5.10 tiers follow the 90-day dispute ratio", () => {
    expect(suggestTier({ releases: 120, disputes: 1, decided: 121, cleanStreak: 9, current: "standard" }).tier).toBe("platinum");
    expect(suggestTier({ releases: 8, disputes: 0, decided: 8, cleanStreak: 8, current: "standard" }).tier).toBe("standard");
    expect(suggestTier({ releases: 60, disputes: 2, decided: 62, cleanStreak: 0, current: "standard" }).tier).toBe("probation");
  });
  it("F5.10 rehabilitation after 5 clean milestones in a row", () => {
    expect(cleanStreak([{ attempts: 1, disputed: false }, { attempts: 1, disputed: false }, { attempts: 2, disputed: false }, { attempts: 1, disputed: false }])).toBe(2);
    expect(suggestTier({ releases: 30, disputes: 3, decided: 33, cleanStreak: 4, current: "probation" }).tier).toBe("probation");
    expect(suggestTier({ releases: 30, disputes: 3, decided: 33, cleanStreak: 5, current: "probation" }).tier).toBe("standard");
  });
});

describe("F5.02 webhook dead-letter replay", () => {
  it("F5.02 P7 quarantined (unverified) events are never offered for replay", async () => {
    await inTx(async (tx) => {
      await tx.insert(webhookEvents).values({ transmissionId: "t-wh-q", type: "PAYMENT.CAPTURE.COMPLETED", verified: false, payload: {}, state: "QUARANTINED" });
      await expect(propose(admin, "REPLAY_WEBHOOK", "t-wh-q", {}, "Try again please, it failed.", { dbx: tx })).rejects.toMatchObject({ code: "UNVERIFIED" });
    });
  });
  it("F5.02 F5.03 a dead letter is replayed through the handler only after a second person approves", async () => {
    const seen: string[] = [];
    registerWebhookReplayHandler(async (e) => { seen.push(e.transmissionId); return { ok: true }; });
    try {
      await inTx(async (tx) => {
        await tx.insert(webhookEvents).values({ transmissionId: "t-wh-dead", type: "PAYMENT.CAPTURE.COMPLETED", verified: true, payload: { event: { id: "x" } }, state: "DEAD", error: "timeout" });
        const id = await propose(admin, "REPLAY_WEBHOOK", "t-wh-dead", {}, "Handler timed out; safe to re-apply.", { dbx: tx });
        expect(seen).toEqual([]);
        const r = await approve(ops, id, { dbx: tx });
        expect(r.replayed).toBe(true);
        expect(seen).toEqual(["t-wh-dead"]);
      });
    } finally { registerWebhookReplayHandler(null); }
  });
});

describe("F5.04 hash-chained audit trail", () => {
  it("F5.04 the verifier finds the first tampered entry", async () => {
    await inTx(async (tx) => {
      await audit(tx, { id: "u_admin", role: "admin" }, "test.one", "x");
      expect((await verifyChain(tx as unknown as Db)).ok).toBe(true);
      const [forged] = await tx.insert(auditChain).values({ actorId: "u_admin", actorRole: "admin", action: "test.forged", target: "x", detail: {}, prevHash: "f".repeat(64), hash: "e".repeat(64) }).returning({ seq: auditChain.seq });
      await audit(tx, { id: "u_admin", role: "admin" }, "test.after", "x");
      const v = await verifyChain(tx as unknown as Db);
      expect(v).toMatchObject({ ok: false, brokenAt: forged.seq });
    });
  });
});

describe("F5.05 compliance export", () => {
  it("F5.05 CSV and JSON-LD packs carry the disclaimer and a verifiable HMAC signature", async () => {
    const before = process.env.COMPLIANCE_SIGNING_KEY;
    process.env.COMPLIANCE_SIGNING_KEY = "test-key-only";
    try {
      const csv = await exportPack("csv");
      expect(csv.body).toContain(DISCLAIMER);
      expect(csv.signature.alg).toBe("HMAC-SHA256");
      expect(csv.signature.value).toBe(createHmac("sha256", "test-key-only").update(csv.body).digest("hex"));
      const ld = await exportPack("jsonld");
      const doc = JSON.parse(ld.body) as { description: string; hasPart: unknown[] };
      expect(doc.description).toBe(DISCLAIMER);
      expect(Array.isArray(doc.hasPart)).toBe(true);
    } finally { if (before === undefined) delete process.env.COMPLIANCE_SIGNING_KEY; else process.env.COMPLIANCE_SIGNING_KEY = before; }
  });
});

describe("F2.11 Ops clearance SLA", () => {
  it("F2.11 high-risk contracts escalate at 90 minutes and breach at 2 hours", () => {
    expect(clearanceStatus(89 * 60_000)).toBe("ON_TIME");
    expect(clearanceStatus(90 * 60_000)).toBe("ESCALATED");
    expect(clearanceStatus(120 * 60_000)).toBe("BREACHED");
  });
});
