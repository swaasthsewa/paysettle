/** F2.04 F3.03 F3.11 F4.01 — Bryntum timeline builders (contract Gantt, mediator schedule). */
import { describe, expect, it } from "vitest";
import { buildCaseEvent, buildContractPlan, buildProposedPlan, msTone, verdictDue, type CoDocMilestone, type PlanInput } from "./plan";

const H = 3_600_000, D = 24 * H;
const held = new Date("2026-10-29T00:00:00Z");
const ws: PlanInput = {
  id: "ws_1", title: "Booking app", currency: "USD", state: "LOCKED",
  milestones: [
    { id: "m1", seq: 10, code: "M01", title: "Kick-off", type: "GATE", active: true, targetDay: 2, amountCents: 0, dependsOn: [], trancheIdx: 1, state: "APPROVED" },
    { id: "m2", seq: 20, code: "M02", title: "Design", type: "PAY", active: true, targetDay: 6, amountCents: 100000, dependsOn: [], trancheIdx: 1, state: "RELEASED" },
    { id: "m3", seq: 30, code: "M03", title: "Build", type: "PAY", active: true, targetDay: 11, amountCents: 200000, dependsOn: ["M01"], trancheIdx: 1, state: "DISPUTED" },
    { id: "m4", seq: 40, code: "M04", title: "Pruned", type: "PAY", active: false, targetDay: 12, amountCents: 0, dependsOn: [], trancheIdx: 1, state: "DRAFT" },
    { id: "m5", seq: 50, code: "M05", title: "Launch", type: "PAY", active: true, targetDay: 30, amountCents: 50000, dependsOn: [], trancheIdx: 2, state: "LOCKED" },
  ],
  tranches: [
    { id: "t1", idx: 1, amountCents: 300000, startDay: 1, endDay: 11, state: "PARTIALLY_RELEASED", heldAt: held, windowEndsAt: new Date(held.getTime() + 29 * D) },
    { id: "t2", idx: 2, amountCents: 50000, startDay: 30, endDay: 30, state: "PLANNED", heldAt: null, windowEndsAt: null },
  ],
  signatures: [{ voided: false, at: new Date("2026-10-28T00:00:00Z") }],
};

describe("F2.04 contract Gantt plan", () => {
  const now = new Date(held.getTime() + 9 * D);
  const p = buildContractPlan(ws, now, 49);
  it("F2.04 anchors day 0 at the PayPal hold and draws bars from the previous milestone's day", () => {
    expect(p.anchorKind).toBe("funded");
    const t1 = p.tasks[0];
    expect(t1.children!.map((c) => c.code)).toEqual(["M01", "M02", "M03"]);
    const [gate, design, build] = t1.children!;
    expect(gate.startDate).toBe(gate.endDate); // a gate is a milestone diamond
    expect(design.startDate).toBe(new Date(held.getTime() + 2 * D).toISOString());
    expect(design.endDate).toBe(new Date(held.getTime() + 6 * D).toISOString());
    expect(build.dayFrom).toBe(6);
  });
  it("F3.11 colours by where the money is", () => {
    const [gate, design, build] = p.tasks[0].children!;
    expect([gate.tone, design.tone, build.tone]).toEqual(["gate", "released", "disputed"]);
    expect(p.tasks[1].children![0].tone).toBe("draft"); // tranche 2 is not funded yet
    expect(msTone("OPEN", "PAY", true)).toBe("held");
    expect(msTone("REFUNDED", "PAY", true)).toBe("refunded");
  });
  it("F2.04 uses explicit dependencies, else the sequence, and skips pruned milestones", () => {
    expect(p.dependencies.map((d) => `${d.from}>${d.to}:${d.implicit ? "seq" : "dep"}`)).toEqual(["m1>m2:seq", "m1>m3:dep", "m3>m5:seq"]);
    expect(p.rows.map((r) => r.code)).not.toContain("M04");
  });
  it("F3.03 shades each tranche's window and marks the virtual now", () => {
    const b1 = p.timeRanges.find((b) => b.id === "band-1")!;
    expect(b1.startDate).toBe(held.toISOString());
    expect(b1.name).toContain("$3,000.00 held in PayPal");
    const nowLine = p.timeRanges.find((b) => b.id === "now")!;
    expect(nowLine).toMatchObject({ startDate: now.toISOString(), name: "Now (virtual clock, +49 h)" });
    expect(nowLine.endDate).toBeUndefined();
    expect(Date.parse(p.startDate)).toBeLessThan(held.getTime());
    expect(Date.parse(p.endDate)).toBeGreaterThan(held.getTime() + 30 * D);
  });
});

describe("F2.13 proposed change order on the Gantt", () => {
  const now = new Date(held.getTime() + 9 * D);
  /* the change order's stored document: M05 re-dated 30 → 34, M03 removed (pruned stays pruned), C01 added in a new tranche 3 */
  const doc: CoDocMilestone[] = [
    ...ws.milestones.map((m) => ({ code: m.code, seq: m.seq, active: m.code === "M03" ? false : m.active, type: m.type, title: m.title, day: m.code === "M05" ? 34 : m.targetDay, amountCents: m.amountCents, dependsOn: m.dependsOn, tranche: m.trancheIdx })),
    { code: "C01", seq: 60, active: true, type: "PAY", title: "Marketing pages", day: 40, amountCents: 120000, dependsOn: [], tranche: 3 },
  ];
  const p = buildProposedPlan(ws, { milestones: doc, fund: [{ trancheIdx: 3, amountCents: 120000, startDay: 40, endDay: 40 }], planned: [{ trancheIdx: 2, toCents: 50000 }] }, now);
  const kids = p.tasks.flatMap((t) => t.children ?? []);
  const byCode = (c: string) => kids.find((k) => k.code === c)!;
  it("F2.13 keeps day 0 of the signed plan and draws the signed bar as a baseline", () => {
    const signed = buildContractPlan(ws, now);
    expect(p.anchor).toBe(signed.anchor);
    const launch = byCode("M05");
    expect(launch.change).toBe("redated");
    expect(launch.changeLabel).toBe("Re-dated");
    expect(launch.endDate).toBe(new Date(held.getTime() + 34 * D).toISOString());
    expect(launch.baselines).toEqual([{ startDate: signed.tasks[1].children![0].startDate, endDate: new Date(held.getTime() + 30 * D).toISOString() }]);
    expect(launch.cls).toContain("ps-co-redated");
  });
  it("F2.13 marks added, removed and unchanged rows in words", () => {
    expect(p.changes).toEqual({ added: 1, removed: 1, redated: 1, changed: 0, same: 2 });
    const added = byCode("C01");
    expect([added.change, added.baselines, added.href]).toEqual(["added", undefined, null]);
    expect(p.tasks.map((t) => t.id)).toEqual(["tranche-1", "tranche-2", "tranche-3"]);
    const removed = byCode("M03");
    expect(removed.change).toBe("removed");
    expect(removed.name).toBe("M03 · Build (removed)");
    expect(removed.baselines).toEqual([{ startDate: removed.startDate, endDate: removed.endDate }]);
    expect(byCode("M02").changeLabel).toBe("No change");
    expect(kids.map((k) => k.code)).not.toContain("M04"); // pruned before the change order: not part of either plan
  });
  it("F2.13 the table repeats the change with the signed and proposed dates", () => {
    const row = (c: string) => p.rows.find((r) => r.code === c)!;
    expect(row("M05")).toMatchObject({ change: "Re-dated", due: new Date(held.getTime() + 34 * D).toISOString(), signedDue: new Date(held.getTime() + 30 * D).toISOString() });
    expect(row("C01")).toMatchObject({ change: "Added", signedDue: null, state: "PROPOSED", open: { href: "/contracts/ws_1#co", label: "Change order" } });
    expect(row("M03").change).toBe("Removed");
    expect(Date.parse(p.endDate)).toBeGreaterThan(held.getTime() + 40 * D);
  });
});

describe("F4.01 mediator schedule", () => {
  const open = new Date("2026-11-07T00:00:00Z");
  const base = { id: "d1", amountCents: 50000, currency: "USD", mediatorId: null, createdAt: open, tier1Until: new Date(open.getTime() + 24 * H), vaultUntil: new Date(open.getTime() + 72 * H), fastTrack: false, workspace: "W", milestone: "M03 · Build" };
  it("F4.01 falls back to the 144 h verdict SLA when no verdict deadline is stored", () => {
    expect(verdictDue({ ...base, tier3Until: null }).getTime()).toBe(open.getTime() + 144 * H);
    expect(verdictDue({ ...base, tier3Until: null, fastTrack: true, vaultUntil: new Date(open.getTime() + 80 * H) }).getTime()).toBe(open.getTime() + 128 * H);
  });
  it("F4.01 one bar per case with its three phases and the next deadline", () => {
    const e = buildCaseEvent({ ...base, state: "TIER2", tier3Until: new Date(open.getTime() + 144 * H), now: new Date(open.getTime() + 30 * H) });
    expect(e.resourceId).toBe("unassigned");
    expect(e.phases.map((x) => [x.key, x.pct, x.current, x.past])).toEqual([["offers", 16.7, false, true], ["vault", 33.3, true, false], ["verdict", 50, false, false]]);
    expect(e.next).toEqual({ label: "Vault seals", at: new Date(open.getTime() + 72 * H).toISOString() });
    expect(e.overdue).toBe(false);
    const late = buildCaseEvent({ ...base, state: "TIER1", tier3Until: null, now: new Date(open.getTime() + 25 * H) });
    expect(late.overdue).toBe(true);
    expect(late.cls).toContain("ps-case-danger");
  });
});
