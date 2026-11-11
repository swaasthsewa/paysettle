/**
 * F2.13 — pure change-order planner: frozen milestones, money plan per tranche state, cents authoritative, shares
 * derived, deterministic document and hash, plain-words money lines. No database.
 */
import { describe, expect, it } from "vitest";
import { canonicalHash } from "@/lib/canonical";
import { formatCents } from "@/lib/money";
import { DomainError } from "../types";
import { evaluateTranche } from "../control/recon";
import { bpsFromCents, moneyLines, planChangeOrder, type CoItem, type PlanInput } from "./change-core";
import type { MsDraft, WsHead } from "./core";

const proof = { artifacts: [{ kind: "PDF" as const, min: 1 }], criteria: ["done"] };
const ms = (code: string, day: number, amountCents: number, state = "LOCKED", trancheIdx = 1, type: "GATE" | "PAY" = "PAY"): MsDraft => ({
  id: `id_${code}`, seq: Number(code.slice(1)) * 10, code, origin: "BASELINE", active: true, prunedBy: null, type, title: `Step ${code}`, targetDay: day, bps: 0,
  amountCents: type === "GATE" ? 0 : amountCents, proof, lockRule: "client approves", disputeRule: "scoped dispute", dependsOn: [], trancheIdx, state,
});
const head: WsHead = { id: "ws_t", title: "T", blueprintCode: "UC_WEB_MVP", currency: "USD", totalCents: 600_000, feeBps: 250, rail: "MOCK", clientId: "c", providerId: "p", inviteEmail: null, reviewTimeoutRule: "ESCALATE", deadline: null };
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  head, baseRevNo: 3, baseHash: "h3", no: 1, actorId: "c", cl: [], withEvidence: new Set(),
  ms: [ms("M01", 2, 0, "RELEASED", 1, "GATE"), ms("M02", 6, 100_000, "RELEASED"), ms("M03", 11, 200_000, "OPEN"), ms("M04", 17, 300_000)],
  tranches: [{ idx: 1, state: "PARTIALLY_RELEASED", amountCents: 600_000 }], items: [], ...over,
});
const code = (f: () => unknown) => { try { f(); return "ok"; } catch (e) { return e instanceof DomainError ? e.code : String(e); } };
const add = (title: string, day: number, amountCents: number): CoItem => ({ action: "ADD", milestone: { title, type: "PAY", day, amountCents, proof, lockRule: "client approves", disputeRule: "scoped dispute" } });

describe("F2.13 change-order planner", () => {
  it("adds a milestone into a new PLANNED tranche; frozen milestones keep their exact cents; total = sum of milestones", () => {
    const p = planChangeOrder(base({ items: [add("Content and marketing pages", 24, 120_000)] }));
    expect(p.money.fund).toEqual([{ trancheIdx: 2, amountCents: 120_000, startDay: 24, endDay: 24, codes: ["C01"] }]);
    expect(p.money.returns).toEqual([]);
    expect(p.head.totalCents).toBe(720_000);
    expect(p.ms.find((m) => m.code === "M02")!.amountCents).toBe(100_000);
    expect(p.ms.filter((m) => m.active && m.type === "PAY").reduce((s, m) => s + m.bps, 0)).toBe(10_000);
    expect(p.revNo).toBe(4);
    expect(p.doc.amends).toMatchObject({ kind: "paysettle.change_order", changeOrder: 1, baseRevNo: 3, baseHash: "h3" });
    expect(moneyLines(p.money, (c) => formatCents(c))).toEqual(["+$1,200.00 to fund as tranche 2 (C01); the client approves it in PayPal as usual."]);
  });

  it("splits added milestones over new tranches by the rail's hold cap", () => {
    const p = planChangeOrder(base({ items: [add("A", 30, 10_000), add("B", 40, 10_000), add("C", 70, 10_000)] }));
    expect(p.money.fund.map((f) => [f.trancheIdx, f.codes])).toEqual([[2, ["C01", "C02"]], [3, ["C03"]]]);
  });

  it("a reduction or a removal in a held tranche is returned to the client from that hold", () => {
    const p = planChangeOrder(base({ items: [{ action: "EDIT", milestoneCode: "M04", amountCents: 220_000 }, { action: "REMOVE", milestoneCode: "M03" }] }));
    expect(p.money.returns).toEqual([{ trancheIdx: 1, amountCents: 280_000, items: [{ milestoneCode: null, amountCents: 80_000 }, { milestoneCode: "M03", amountCents: 200_000 }] }]);
    expect(p.amendedOut.get(1)).toBe(280_000);
    expect(p.head.totalCents).toBe(320_000);
    expect(moneyLines(p.money, (c) => formatCents(c))).toContain("$2,800.00 goes back to the client's PayPal from tranche 1.");
  });

  it("an increase in a held tranche moves the milestone to a new tranche (a PayPal hold never grows); OPEN goes back to LOCKED", () => {
    const p = planChangeOrder(base({ items: [{ action: "EDIT", milestoneCode: "M03", amountCents: 250_000 }] }));
    expect(p.money.returns).toEqual([{ trancheIdx: 1, amountCents: 200_000, items: [{ milestoneCode: "M03", amountCents: 200_000 }] }]);
    expect(p.money.fund).toEqual([{ trancheIdx: 2, amountCents: 250_000, startDay: 11, endDay: 11, codes: ["M03"] }]);
    expect(p.money.moved).toEqual([{ code: "M03", fromTranche: 1, toTranche: 2 }]);
    expect(p.unfund.has("M03")).toBe(true);
  });

  it("a milestone whose tranche is not funded yet just changes, and the tranche amount follows", () => {
    const p = planChangeOrder(base({ tranches: [{ idx: 1, state: "PLANNED", amountCents: 600_000 }], ms: [ms("M02", 6, 100_000, "OPEN"), ms("M03", 11, 200_000), ms("M04", 17, 300_000)], items: [{ action: "EDIT", milestoneCode: "M04", amountCents: 350_000 }, { action: "REMOVE", milestoneCode: "M02" }] }));
    expect(p.money.returns).toEqual([]);
    expect(p.money.fund).toEqual([]);
    expect(p.money.planned).toEqual([{ trancheIdx: 1, fromCents: 600_000, toCents: 550_000 }]);
  });

  it("frozen milestones (submitted or later, or with evidence) cannot be touched", () => {
    for (const st of ["SUBMITTED", "REMEDIATION", "APPROVED", "RELEASED", "DISPUTED", "ESCALATED", "SETTLED_BY_VERDICT", "REFUNDED"]) {
      expect(code(() => planChangeOrder(base({ ms: [ms("M03", 11, 200_000, st)], items: [{ action: "EDIT", milestoneCode: "M03", day: 12 }] })))).toBe("MILESTONE_FROZEN");
      expect(code(() => planChangeOrder(base({ ms: [ms("M03", 11, 200_000, st)], items: [{ action: "REMOVE", milestoneCode: "M03" }] })))).toBe("MILESTONE_FROZEN");
    }
    expect(code(() => planChangeOrder(base({ withEvidence: new Set(["id_M03"]), items: [{ action: "EDIT", milestoneCode: "M03", day: 12 }] })))).toBe("MILESTONE_FROZEN");
  });

  it("money changes are refused while a tranche waits for PayPal approval, settles, or is paused; terms-only edits still work", () => {
    for (const state of ["AWAITING_APPROVAL", "SETTLING", "ROLLED_OVER", "BREAKER", "CLOSED"]) {
      expect(code(() => planChangeOrder(base({ tranches: [{ idx: 1, state, amountCents: 600_000 }], items: [{ action: "EDIT", milestoneCode: "M04", amountCents: 1_000 }] })))).toBe("TRANCHE_BUSY");
    }
    expect(code(() => planChangeOrder(base({ tranches: [{ idx: 1, state: "HELD", amountCents: 600_000, paused: true }], items: [{ action: "REMOVE", milestoneCode: "M04" }] })))).toBe("TRANCHE_BUSY");
    const p = planChangeOrder(base({ tranches: [{ idx: 1, state: "AWAITING_APPROVAL", amountCents: 600_000 }], items: [{ action: "EDIT", milestoneCode: "M04", day: 20, proof: { artifacts: proof.artifacts, criteria: ["Feature B instead of feature A"] } }] }));
    expect(p.diff.changed[0].fields.map((f) => f.field)).toEqual(["day", "criteria"]);
    expect(moneyLines(p.money, (c) => formatCents(c))).toEqual(["No money moves: only the terms change."]);
  });

  it("refuses empty, duplicate, unknown and no-op items, and new money on a contract with an early bonus pool", () => {
    expect(code(() => planChangeOrder(base({ items: [] })))).toBe("NO_CHANGE");
    expect(code(() => planChangeOrder(base({ items: [{ action: "EDIT", milestoneCode: "M04", day: 18 }, { action: "REMOVE", milestoneCode: "M04" }] })))).toBe("INVALID_INPUT");
    expect(code(() => planChangeOrder(base({ items: [{ action: "REMOVE", milestoneCode: "M99" }] })))).toBe("NOT_FOUND");
    expect(code(() => planChangeOrder(base({ items: [{ action: "EDIT", milestoneCode: "M04", day: 17 }] })))).toBe("NO_CHANGE");
    expect(code(() => planChangeOrder(base({ items: [{ action: "EDIT", milestoneCode: "M04", amountCents: 50 }] })))).toBe("INVALID_INPUT");
    const early = { ...head, deadline: { late: null, early: { poolCents: 10_000, rateBps: 100, capBps: 500, minDaysEarly: 1, milestones: "ALL" as const } } };
    expect(code(() => planChangeOrder(base({ head: early, items: [add("More", 20, 10_000)] })))).toBe("DEADLINE_TERMS");
    expect(code(() => planChangeOrder(base({ head: early, items: [{ action: "EDIT", milestoneCode: "M04", amountCents: 280_000 }] })))).toBe("ok");
  });

  it("the same inputs give the same document and hash (re-planned at signing and at apply time)", () => {
    const i = base({ items: [add("Hotel upgrade", 15, 45_000), { action: "EDIT", milestoneCode: "M04", amountCents: 250_000 }] });
    expect(canonicalHash(planChangeOrder(i).doc)).toBe(canonicalHash(planChangeOrder(i).doc));
    expect(canonicalHash(planChangeOrder({ ...i, tranches: [{ idx: 1, state: "PLANNED", amountCents: 600_000 }] }).doc)).not.toBe(canonicalHash(planChangeOrder(i).doc));
  });

  it("key order in proof artifacts (blueprint data, form input, jsonb) is not a change", () => {
    const m = ms("M04", 17, 300_000);
    m.proof = { artifacts: [{ note: "Signed backlog", min: 1, kind: "PDF" } as never], criteria: ["done"] };
    const i = base({ ms: [m], items: [{ action: "EDIT", milestoneCode: "M04", day: 18, proof: { artifacts: [{ kind: "PDF", min: 1, note: "Signed backlog" }], criteria: ["done"] } }] });
    expect(planChangeOrder(i).diff.changed[0].fields.map((f) => f.field)).toEqual(["day"]);
    expect(code(() => planChangeOrder({ ...i, items: [{ action: "EDIT", milestoneCode: "M04", proof: { artifacts: [{ kind: "PDF", min: 1, note: "Signed backlog" }], criteria: ["done"] } }] }))).toBe("NO_CHANGE");
  });

  it("shares derived from cents add up to exactly 100%", () => {
    const list = [ms("M01", 1, 33_333), ms("M02", 2, 33_333), ms("M03", 3, 33_334)];
    bpsFromCents(list);
    expect(list.reduce((s, m) => s + m.bps, 0)).toBe(10_000);
  });
});

describe("F2.13 reconciliation's contract plane counts what change orders returned", () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000);
  const input = (amendedOutCents: number) => ({
    tranche: { id: "t", workspaceId: "w", idx: 1, rail: "MOCK", amountCents: 600_000, state: "HELD", paypalOrderId: null, authorizationId: "A", captureId: null, heldAt: ago(120), amendedOutCents },
    /* M07 (100,000) removed by a change order; 500,000 of milestones left, all open */
    milestones: [{ amountCents: 500_000, state: "OPEN", type: "PAY", active: true }, { amountCents: 100_000, state: "LOCKED", type: "PAY", active: false }],
    ledger: [{ type: "HOLD", amountCents: 600_000, paypalRef: "A", milestoneId: null, at: ago(120) }, { type: "VOID", amountCents: 100_000, paypalRef: "recorded:r1", milestoneId: "m7", at: ago(60) }],
    rail: { kind: "mock" as const, txns: null, error: "not needed" }, now: new Date(), windowFrom: ago(60 * 24),
  });
  it("matches with amended_out_cents; without it the hold looks larger than the contract (drift)", () => {
    expect(evaluateTranche(input(100_000)).issues).toEqual([]);
    expect(evaluateTranche(input(0)).status).toBe("DRIFT");
  });
});
