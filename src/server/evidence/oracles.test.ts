/**
 * F3.05 External oracle validator: input parsing, GitHub CI via a fake GitHub API, simulated carrier and PNR checks,
 * 3 retries with backoff then hybrid manual mode, signed attestations, the submitEvidence hook, and Ops counter-verification.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { auditChain, evidencePackages, orgs, users, workspaces, wsMilestones } from "@/db/schema";
import { oracleAttestations } from "@/db/schema-identity";
import type { Signal } from "./spec";
import {
  attestationsFor, manualVerify, oracleHook, parseGithub, parsePnr, parseTracking, runOracle, setOracleDeps, simulateCarrier, simulatePnr, verifyAttestation,
} from "./oracles";

type Route = (url: string) => Response | Promise<Response>;
const calls: string[] = [];
const sleeps: number[] = [];
function fakeGithub(route: Route) {
  setOracleDeps({ fetch: async (u) => { calls.push(u); return route(u); }, sleep: async (ms) => { sleeps.push(ms); }, githubToken: () => undefined });
}
const run = (o: Record<string, unknown>) => Response.json({ total_count: 1, workflow_runs: [{ name: "CI", run_number: 42, head_sha: "abc1234def", status: "completed", conclusion: "success", ...o }] });
afterEach(() => { setOracleDeps(); calls.length = 0; sleeps.length = 0; });

describe("F3.05 input parsing (P11: identifiers only)", () => {
  it("F3.05 finds owner/repo/branch in a github.com URL, ignoring other links", () => {
    expect(parseGithub("staging https://app.example.com and https://github.com/acme/shop-api/tree/release/1.2 done")).toEqual({ owner: "acme", repo: "shop-api", branch: "release/1.2" });
    expect(parseGithub("repo https://github.com/acme/web.git")).toEqual({ owner: "acme", repo: "web" });
    expect(parseGithub("https://github.com/acme")).toBeNull();
    expect(parseGithub("no links")).toBeNull();
  });
  it("F3.05 reads a labelled tracking number and PNR", () => {
    expect(parseTracking("Shipped. Tracking: 1z999aa10123456780")).toBe("1Z999AA10123456780");
    expect(parseTracking("tracking number #JD0141234567")).toBe("JD0141234567");
    expect(parseTracking("no number here")).toBeNull();
    expect(parsePnr("Booked, PNR: k7q2lm, 4 pax")).toBe("K7Q2LM");
    expect(parsePnr("booking reference W1X2Y3")).toBe("W1X2Y3");
    expect(parsePnr("SUMMER holidays")).toBeNull();
  });
  it("F3.05 simulators: tracking ending in 0 is delivered; PNR starting with W is waitlisted", () => {
    expect(simulateCarrier("AB12345670")).toEqual({ status: "DELIVERED", level: "ok" });
    expect(simulateCarrier("AB12345671")).toEqual({ status: "IN_TRANSIT", level: "warn" });
    expect(simulatePnr("K7Q2LM")).toEqual({ status: "CONFIRMED_TICKETED", level: "ok" });
    expect(simulatePnr("W7Q2LM")).toEqual({ status: "WAITLISTED", level: "fail" });
  });
});

describe("F3.05 GitHub CI oracle", () => {
  it("F3.05 green run → ok; resolves the default branch when none is given", async () => {
    fakeGithub((u) => (u.endsWith("/repos/acme/api") ? Response.json({ default_branch: "trunk" }) : run({})));
    const o = await runOracle("GITHUB_CI", "CI: https://github.com/acme/api");
    expect(o).toMatchObject({ status: "PASSED", level: "ok", mode: "LIVE", tries: 1, input: { owner: "acme", repo: "api" } });
    expect(calls[1]).toBe("https://api.github.com/repos/acme/api/actions/runs?branch=trunk&per_page=1");
    expect(o.detail).toContain("#42");
  });
  it("F3.05 failed run → fail, running → warn, no runs → warn, 404 → warn", async () => {
    const note = "https://github.com/acme/api/tree/main";
    fakeGithub(() => run({ conclusion: "failure" }));
    expect((await runOracle("GITHUB_CI", note)).level).toBe("fail");
    fakeGithub(() => run({ status: "in_progress", conclusion: null }));
    expect(await runOracle("GITHUB_CI", note)).toMatchObject({ status: "RUNNING", level: "warn" });
    fakeGithub(() => Response.json({ total_count: 0, workflow_runs: [] }));
    expect(await runOracle("GITHUB_CI", note)).toMatchObject({ status: "NO_RUNS", level: "warn" });
    fakeGithub(() => Response.json({ message: "Not Found" }, { status: 404 }));
    expect(await runOracle("GITHUB_CI", note)).toMatchObject({ status: "NOT_FOUND", level: "warn", mode: "LIVE" });
  });
  it("F3.05 transient failures are retried 3 times with exponential backoff", async () => {
    let n = 0;
    fakeGithub(() => (++n < 4 ? new Response("busy", { status: 503 }) : run({})));
    const o = await runOracle("GITHUB_CI", "https://github.com/acme/api/tree/main");
    expect(o).toMatchObject({ level: "ok", tries: 4 });
    expect(sleeps).toEqual([300, 600, 1200]);
  });
  it("F3.05 after 3 retries the check falls back to hybrid manual mode (warn)", async () => {
    fakeGithub(() => { throw new TypeError("fetch failed"); });
    const o = await runOracle("GITHUB_CI", "https://github.com/acme/api/tree/main");
    expect(o).toMatchObject({ mode: "MANUAL_PENDING", level: "warn", tries: 4, status: "MANUAL_PENDING" });
    expect(o.detail).toMatch(/hybrid manual mode.*3 retries.*Operations can counter-verify/);
    expect(calls).toHaveLength(4);
  });
  it("F3.05 nothing to check → warn with how-to, no network call", async () => {
    fakeGithub(() => run({}));
    expect(await runOracle("GITHUB_CI", "see https://staging.example.com")).toMatchObject({ status: "NO_INPUT", level: "warn" });
    expect(calls).toHaveLength(0);
  });
});

describe("F3.05 simulated carrier and PNR checks", () => {
  it("F3.05 sandbox: labelled as simulated", async () => {
    expect(await runOracle("CARRIER_TRACKING", "Tracking: AB12345670")).toMatchObject({ status: "DELIVERED", level: "ok", mode: "SIMULATED" });
    const p = await runOracle("PNR_LOOKUP", "PNR: WQ2LMX");
    expect(p).toMatchObject({ status: "WAITLISTED", level: "fail", mode: "SIMULATED" });
    expect(p.detail).toMatch(/^Simulated PNR check/);
  });
  it("F3.05 P9 production never simulates: it goes to hybrid manual mode", async () => {
    setOracleDeps({ sandbox: () => false });
    expect(await runOracle("CARRIER_TRACKING", "Tracking: AB12345670")).toMatchObject({ mode: "MANUAL_PENDING", level: "warn" });
    expect(await runOracle("PNR_LOOKUP", "PNR: K7Q2LM")).toMatchObject({ mode: "MANUAL_PENDING", level: "warn" });
  });
});

describe("F3.05 attestations, hook and Ops counter-verification", () => {
  const RUN = Math.random().toString(36).slice(2, 8), ORG = `org_orc_${RUN}`, C = `u_orcc_${RUN}`, P = `u_orcp_${RUN}`, OPS = `u_orco_${RUN}`;
  const WS = `ws_orc_${RUN}`, MS = `ms_orc_${RUN}`;
  beforeAll(async () => {
    await db.insert(orgs).values({ id: ORG, name: "Oracle tests" });
    await db.insert(users).values([{ id: C, orgId: ORG, email: `${C}@t.local`, name: "C", role: "client" }, { id: P, orgId: ORG, email: `${P}@t.local`, name: "P", role: "provider" }, { id: OPS, orgId: ORG, email: `${OPS}@t.local`, name: "O", role: "ops" }]);
    await db.insert(workspaces).values({ id: WS, orgId: ORG, blueprintCode: "UC_WEB_MVP", title: "Oracle test", clientId: C, providerId: P, totalCents: 100_000, state: "LOCKED" });
    await db.insert(wsMilestones).values({ id: MS, workspaceId: WS, seq: 1, code: "M03", origin: "BASELINE", type: "PAY", title: "API on staging", targetDay: 11, bps: 10_000, amountCents: 100_000, proof: { artifacts: [], oracle: "GITHUB_CI", criteria: [] }, lockRule: "x", disputeRule: "y", state: "SUBMITTED" });
    await db.insert(evidencePackages).values({ id: `ev_orc_${RUN}`, milestoneId: MS, attempt: 1, rootHash: "r".repeat(64), files: [], submittedBy: P, signals: [] });
  });
  afterAll(async () => {
    await db.delete(oracleAttestations).where(eq(oracleAttestations.milestoneId, MS));
    await db.delete(evidencePackages).where(eq(evidencePackages.milestoneId, MS));
    await db.delete(wsMilestones).where(eq(wsMilestones.id, MS));
    await db.delete(workspaces).where(eq(workspaces.id, WS));
    await db.delete(users).where(inArray(users.id, [C, P, OPS]));
  });

  it("F3.05 the hook replaces ORACLE_PENDING with ORACLE_GITHUB_CI and stores a signed attestation", async () => {
    fakeGithub(() => { throw new TypeError("fetch failed"); });
    const signals: Signal[] = [{ code: "HASH", level: "ok", detail: "x" }, { code: "ORACLE_PENDING", level: "warn", detail: "pending" }];
    await oracleHook(signals, { milestoneId: MS, attempt: 1, rootHash: "r".repeat(64), proof: { artifacts: [], oracle: "GITHUB_CI", criteria: [] }, note: "https://github.com/acme/api/tree/main" });
    expect(signals.map((s) => s.code)).toEqual(["HASH", "ORACLE_GITHUB_CI"]);
    expect(signals[1].level).toBe("warn");
    await db.update(evidencePackages).set({ signals }).where(eq(evidencePackages.milestoneId, MS));
    const [a] = await attestationsFor(MS);
    expect(a).toMatchObject({ oracle: "GITHUB_CI", mode: "MANUAL_PENDING", current: true, valid: true, needsOps: true, tries: 4 });
    expect(verifyAttestation({ ...a, level: "ok" })).toBe(false);
  });
  it("F3.05 no oracle in the proof spec → the hook does nothing", async () => {
    const s: Signal[] = [];
    await oracleHook(s, { milestoneId: MS, attempt: 1, rootHash: "r", proof: { artifacts: [], criteria: [] }, note: "" });
    expect(s).toEqual([]);
  });
  it("F3.05 only Operations can counter-verify; a note is required", async () => {
    const [a] = await attestationsFor(MS);
    await expect(manualVerify({ id: C, role: "client" }, a.id, { decision: "CONFIRMED", note: "looked" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manualVerify({ id: P, role: "provider" }, a.id, { decision: "CONFIRMED", note: "looked" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manualVerify({ id: OPS, role: "ops" }, a.id, { decision: "CONFIRMED", note: " " })).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
  });
  it("F3.05 Ops confirms: a MANUAL attestation supersedes, the package signal turns ok, audited; repeat is refused", async () => {
    const [a] = await attestationsFor(MS);
    const row = await manualVerify({ id: OPS, role: "ops" }, a.id, { decision: "CONFIRMED", note: "Checked the Actions page: run #42 green." });
    expect(row).toMatchObject({ mode: "MANUAL", level: "ok", supersedes: a.id, verifiedBy: OPS });
    const views = await attestationsFor(MS);
    expect(views.find((v) => v.id === a.id)?.current).toBe(false);
    expect(views.find((v) => v.id === row.id)).toMatchObject({ current: true, needsOps: false, valid: true });
    const [pkg] = await db.select().from(evidencePackages).where(eq(evidencePackages.milestoneId, MS));
    expect(pkg.signals.find((s) => s.code === "ORACLE_GITHUB_CI")).toMatchObject({ level: "ok" });
    expect(pkg.signals.filter((s) => s.code === "ORACLE_GITHUB_CI")).toHaveLength(1);
    const audits = await db.select().from(auditChain).where(eq(auditChain.target, MS));
    expect(audits.some((x) => x.action === "oracle.manual_verify" && x.actorId === OPS)).toBe(true);
    await expect(manualVerify({ id: OPS, role: "ops" }, a.id, { decision: "REJECTED", note: "again" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(manualVerify({ id: OPS, role: "ops" }, row.id, { decision: "REJECTED", note: "again" })).rejects.toMatchObject({ code: "BAD_STATE" });
  });
});
