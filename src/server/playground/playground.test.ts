/**
 * Tests — F5.06 (scenario engine, four-quadrant state), F5.07 (time machine bounds), F5.08 (fixtures, chaos), P9 (sandbox only).
 * The S1 end-to-end run is skipped while the contracts, money or evidence modules still throw NotBuilt.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { releases, simSessions, wsMilestones } from "@/db/schema";
import { simEvents } from "@/db/schema-playground";
import { simWorkspaces } from "@/db/schema-sim";
import { NotBuilt } from "../types";
import * as contracts from "../contracts";
import * as money from "../money";
import * as evidence from "../evidence";
import { SCENARIOS, SCENARIO_IDS, injectFault, runAll, runNext } from "./scenarios";
import { MAX_OFFSET_HOURS, SandboxOnly, checkTravel, createSim, getSim, resetSim, timeTravel, withSimLock } from "./session";
import { ownsRun } from "./owner";
import { playgroundState, scenarioFromQuery, scenarioList } from "./state";
import { SITE, SPOOF_POINT, VALID_POINT, haversineM, jpegWithGps, minimalPdf, readJpegGps } from "./fixtures";

const JUDGE = { id: "u_judge", role: "judge" };
const prevEnv = process.env.PAYSETTLE_ENV;
afterEach(() => { if (prevEnv === undefined) delete process.env.PAYSETTLE_ENV; else process.env.PAYSETTLE_ENV = prevEnv; });

async function isBuilt(fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); return true; } catch (e) { return !(e instanceof NotBuilt); }
}
const probe = { id: "u_probe_nobody", role: "marketing" as const };
const modulesBuilt = (await isBuilt(() => contracts.getWorkspace(probe, "ws_probe_none")))
  && (await isBuilt(() => money.fundTranche(probe, "tr_probe_none")))
  && (await isBuilt(() => evidence.submitEvidence(probe, "ms_probe_none", [], "")));

describe("P9 · the playground refuses outside sandbox mode (F5.06–F5.08)", () => {
  it("F5.06/F5.07/F5.08 P9: every entry point throws SandboxOnly in production", async () => {
    process.env.PAYSETTLE_ENV = "production";
    await expect(createSim(JUDGE, "S1", "MOCK")).rejects.toBeInstanceOf(SandboxOnly);
    await expect(getSim("sim_x")).rejects.toBeInstanceOf(SandboxOnly);
    await expect(timeTravel(JUDGE, "sim_x", 24)).rejects.toBeInstanceOf(SandboxOnly);
    await expect(resetSim(JUDGE, "sim_x")).rejects.toBeInstanceOf(SandboxOnly);
    await expect(runNext(JUDGE, "sim_x")).rejects.toBeInstanceOf(SandboxOnly);
    await expect(runAll(JUDGE, "sim_x")).rejects.toBeInstanceOf(SandboxOnly);
    await expect(injectFault(JUDGE, "sim_x", "release_503")).rejects.toBeInstanceOf(SandboxOnly);
    await expect(playgroundState(null)).rejects.toBeInstanceOf(SandboxOnly);
  });

  it("F5.06 P9: the sandbox API answers 404 in production before reading the session", async () => {
    process.env.PAYSETTLE_ENV = "production";
    const state = await import("@/app/api/sandbox/state/route");
    const tt = await import("@/app/api/sandbox/time-travel/route");
    const r1 = await state.GET(new Request("http://x/api/sandbox/state"));
    const r2 = await tt.POST(new Request("http://x/api/sandbox/time-travel", { method: "POST", body: JSON.stringify({ simId: "sim_x", hours: 24 }) }));
    expect(r1.status).toBe(404);
    expect(r2.status).toBe(404);
    expect((await r2.json()).error).toBe("SANDBOX_ONLY");
  });
});

describe("F5.07 time machine bounds", () => {
  it("F5.07: forward only, whole hours, 0–720 h in total", () => {
    expect(() => checkTravel(0, 0)).toThrow(/forward/);
    expect(() => checkTravel(48, -24)).toThrow(/forward/);
    expect(() => checkTravel(0, 1.5)).toThrow(/whole/);
    expect(() => checkTravel(700, 21)).toThrow(/day 30/);
    expect(checkTravel(0, MAX_OFFSET_HOURS)).toBe(720);
    expect(checkTravel(528, 72)).toBe(600);
  });

  it("F5.07: time travel stores the offset, logs it as simulated, and refuses to pass +720 h", async () => {
    const sim = await createSim(JUDGE, "S3", "MOCK");
    const r = await timeTravel(JUDGE, sim.id, 48);
    expect(r.offsetHours).toBe(48);
    expect(r.day).toBe(2);
    expect(new Date(r.simulatedNow).getTime()).toBeGreaterThan(Date.now() + 47 * 3_600_000);
    await expect(timeTravel(JUDGE, sim.id, 700)).rejects.toThrow(/day 30/);
    expect((await getSim(sim.id)).clockOffsetHours).toBe(48);
    const ev = await db.select().from(simEvents).where(eq(simEvents.simId, sim.id));
    expect(ev.some((e) => e.kind === "time" && /simulated/.test(e.response))).toBe(true);
  });

  it("F5.08: reset starts a fresh session at day 0 and keeps the old one", async () => {
    const sim = await createSim(JUDGE, "S1", "MOCK");
    await timeTravel(JUDGE, sim.id, 24);
    const fresh = await resetSim(JUDGE, sim.id);
    expect(fresh.id).not.toBe(sim.id);
    expect(fresh.clockOffsetHours).toBe(0);
    expect(fresh.scenario).toBe("S1");
    const [old] = await db.select().from(simSessions).where(eq(simSessions.id, sim.id));
    expect(old.clockOffsetHours).toBe(24);
  });
});

describe("F5.06 P9 judges sharing one account: runs per browser, one action at a time", () => {
  it("F5.06 a browser may act only on the run it holds", () => {
    expect(ownsRun("sim_a1", "sim_a1")).toBe(true);
    expect(ownsRun("sim_a1", "sim_b2")).toBe(false);
    expect(ownsRun(null, "sim_a1")).toBe(false);
    expect(ownsRun("sim_a1", null)).toBe(false);
    expect(ownsRun("sim a1;", "sim a1;")).toBe(false);
  });

  it("F5.06 a second action on a busy run answers SIM_BUSY; other runs are not blocked", async () => {
    let done!: () => void;
    const first = withSimLock("sim_lock_t1", () => new Promise<void>((r) => { done = r; }));
    await expect(withSimLock("sim_lock_t1", async () => 1)).rejects.toMatchObject({ code: "SIM_BUSY", message: "This run is busy with a step; try again in a moment." });
    expect(await withSimLock("sim_lock_t2", async () => 2)).toBe(2);
    done(); await first;
    expect(await withSimLock("sim_lock_t1", async () => 3)).toBe(3);
  });

  it("F5.07 two time jumps on the same run at once: one runs, the other is refused, the clock moves once", async () => {
    const sim = await createSim(JUDGE, "S3", "MOCK");
    const [a, b] = await Promise.allSettled([timeTravel(JUDGE, sim.id, 24), timeTravel(JUDGE, sim.id, 24)]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(((a.status === "rejected" ? a : b) as PromiseRejectedResult).reason).toMatchObject({ code: "SIM_BUSY" });
    expect((await getSim(sim.id)).clockOffsetHours).toBe(24);
  });
});

describe("F5.08 chaos fixtures", () => {
  it("F5.08: the spoofed photo carries EXIF GPS about 85 km from the site; the valid one about 40 m", () => {
    expect(haversineM(SITE, SPOOF_POINT) / 1000).toBeCloseTo(85, 0);
    expect(haversineM(SITE, VALID_POINT)).toBeLessThan(60);
    const jpg = jpegWithGps(SPOOF_POINT.lat, SPOOF_POINT.lng, new Date("2026-11-08T10:00:00Z"));
    expect(jpg.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(jpg.subarray(-2).toString("hex")).toBe("ffd9");
    const gps = readJpegGps(jpg)!;
    expect(gps.lat).toBeCloseTo(SPOOF_POINT.lat, 4);
    expect(gps.lng).toBeCloseTo(SPOOF_POINT.lng, 4);
    expect(jpg.includes(Buffer.from("2026:11:08 10:00:00"))).toBe(true);
    expect(readJpegGps(jpegWithGps())).toBeNull();
  });

  it("F5.08: the generated PDF has a valid header and a correct startxref", () => {
    const pdf = minimalPdf(["Hello (judge)"]).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    const at = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(at, at + 4)).toBe("xref");
  });
});

describe("F5.06 scenario engine", () => {
  it("F5.06: scenarios S1–S6 (and any later ones such as S7), each with ordered, uniquely named, explained steps", () => {
    expect(SCENARIO_IDS.slice(0, 6)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6"]);
    expect(SCENARIO_IDS.every((id) => /^S\d+$/.test(id))).toBe(true);
    expect(new Set(SCENARIO_IDS).size).toBe(SCENARIO_IDS.length);
    for (const id of SCENARIO_IDS) {
      const s = SCENARIOS[id];
      expect(s.steps.length).toBeGreaterThanOrEqual(5);
      expect(new Set(s.steps.map((x) => x.id)).size).toBe(s.steps.length);
      for (const st of s.steps) { expect(st.label.length).toBeGreaterThan(3); expect(st.explain.length).toBeGreaterThanOrEqual(10); }
    }
  });

  it("F5.06: the playground's scenario list is data-driven — every defined scenario is listed, in order (S7 appears once added)", () => {
    expect(scenarioList().map((s) => s.id)).toEqual(SCENARIO_IDS);
    for (const s of scenarioList()) expect(s.steps).toBe(SCENARIOS[s.id].steps.length);
  });

  it("F5.06: /playground?scenario= accepts only defined scenario ids (case-insensitive), anything else is ignored", () => {
    expect(scenarioFromQuery("S2")).toBe("S2");
    expect(scenarioFromQuery(" s3 ")).toBe("S3");
    expect(scenarioFromQuery(["S1", "S4"])).toBe("S1");
    expect(scenarioFromQuery("S7", ["S1", "S7"])).toBe("S7");
    for (const bad of [undefined, "", "S99", "s1;drop", "<script>", "X1"]) expect(scenarioFromQuery(bad)).toBeNull();
  });

  it.skipIf(modulesBuilt)("F5.06: while a module is not built, a step reports waiting instead of crashing", async () => {
    const sim = await createSim(JUDGE, "S1", "MOCK");
    const r = await runNext(JUDGE, sim.id);
    expect(r?.outcome.status).toBe("waiting");
    expect(r?.outcome.detail).toMatch(/Waiting for module/);
    const st = await playgroundState(sim.id);
    expect(st.steps[0].status).toBe("waiting");
  });
});

describe("F5.06 S1 happy path end to end on the mock rail", () => {
  beforeAll(() => { delete process.env.PAYPAL_CLIENT_ID; });
  it.skipIf(!modulesBuilt)("F5.06 S1: clone → sign ×2 → lock → fund → confirm → three releases → ledger", async () => {
    const sim = await createSim(JUDGE, "S1", "MOCK");
    const results = await runAll(JUDGE, sim.id, { budgetMs: 60_000 });
    const bad = results.filter((r) => r.outcome.status === "error" || r.outcome.status === "waiting");
    expect(bad.map((b) => `${b.stepId}: ${b.outcome.detail}`)).toEqual([]);
    expect(results.length).toBe(SCENARIOS.S1.steps.length);
    const s = await getSim(sim.id);
    const ms = await db.select().from(wsMilestones).where(eq(wsMilestones.workspaceId, s.workspaceId!));
    const rel = (await Promise.all(ms.map((m) => db.select().from(releases).where(eq(releases.milestoneId, m.id))))).flat();
    expect(rel.filter((r) => r.status === "COMPLETED" && r.grossCents > 0).length).toBe(3);
    const st = await playgroundState(sim.id);
    expect(st.wire.some((w) => w.kind === "rail")).toBe(true);
    expect(st.client?.tranches?.[0].releasedCents).toBeGreaterThan(0);
  }, 90_000);
});

describe("playground contracts are tagged and kept off the personas' screens", () => {
  it.skipIf(!modulesBuilt)("F5.06 the contract a scenario creates is recorded in sim_workspaces and hidden from the client's contract list", async () => {
    const sim = await createSim(JUDGE, "S1", "MOCK");
    await runNext(JUDGE, sim.id); // step 1: create
    const s = await getSim(sim.id);
    expect(s.workspaceId).toBeTruthy();
    expect(await db.select().from(simWorkspaces).where(eq(simWorkspaces.workspaceId, s.workspaceId!))).toHaveLength(1);
    const priya = { id: SCENARIOS.S1.personas.client, role: "client" as const };
    expect((await contracts.listWorkspaces(priya)).map((w) => w.id)).not.toContain(s.workspaceId);
    expect((await contracts.listWorkspaces(priya, { sim: "only" })).map((w) => w.id)).toContain(s.workspaceId);
  }, 30_000);
});

describe("F5.06–F5.08 other scenarios end to end on the mock rail", () => {
  const run = async (id: "S2" | "S3" | "S4" | "S5") => {
    const sim = await createSim(JUDGE, id, "MOCK");
    const results = await runAll(JUDGE, sim.id, { budgetMs: 60_000 });
    return { sim, results, bad: results.filter((r) => r.outcome.status === "error" || r.outcome.status === "waiting").map((b) => `${b.stepId}: ${b.outcome.detail}`) };
  };
  it.skipIf(!modulesBuilt)("F5.08 S2: the photo 85 km away is blocked, the valid one passes and is released", async () => {
    const { results, bad } = await run("S2");
    expect(bad).toEqual([]);
    expect(results.find((r) => r.stepId === "spoof")?.outcome.detail).toMatch(/Blocked as expected|Flagged as expected/);
  }, 90_000);
  it.skipIf(!modulesBuilt)("F5.07 S3: day 22 warns, day 25 offers a rollover, the rollover funds a new hold", async () => {
    const { results, bad } = await run("S3");
    expect(bad).toEqual([]);
    expect(results.find((r) => r.stepId === "day22")?.outcome.detail).toMatch(/WARN/);
    expect(results.find((r) => r.stepId === "day25")?.outcome.detail).toMatch(/OFFER_ROLLOVER/);
  }, 90_000);
  it.skipIf(!modulesBuilt)("F5.06 S4: bids miss, the vault seals, a 75/25 verdict executes as two legs", async () => {
    const { results, bad } = await run("S4");
    expect(bad).toEqual([]);
    expect(results.find((r) => r.stepId === "legs")?.outcome.detail).toMatch(/Leg 1 refund .* DONE; leg 2 release .* DONE/);
  }, 90_000);
  it.skipIf(!modulesBuilt)("F5.08 S5: a 503 still gives one payout, the duplicate webhook is deduplicated, drift trips the breaker", async () => {
    const { results, bad } = await run("S5");
    expect(bad).toEqual([]);
    expect(results.find((r) => r.stepId === "dup-webhook")?.outcome.detail).toMatch(/DUPLICATE/);
    expect(results.find((r) => r.stepId === "recon")?.outcome.detail).toMatch(/BREAKER/);
  }, 90_000);
});
