/** F3.05 oracle hook inside submitEvidence (money, AI and disputes mocked): the oracle's signal and attestation land with the package. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { evidencePackages, orgs, tranches, users, workspaces, wsMilestones } from "@/db/schema";
import { evidenceNotifications } from "@/db/schema-evidence";
import { oracleAttestations } from "@/db/schema-identity";
import { NotBuilt } from "@/server/types";

vi.mock("@/server/money", () => ({ releaseMilestone: vi.fn() }));
vi.mock("@/server/ai", () => ({ verifyEvidence: vi.fn().mockRejectedValue(new NotBuilt("verifyEvidence")) }));
vi.mock("@/server/disputes", () => ({ openDispute: vi.fn() }));

import { submitEvidence } from "./index";
import { LocalDiskStore, setObjectStore } from "./storage";

const RUN = Math.random().toString(36).slice(2, 8), ORG = `org_orh_${RUN}`, C = `u_orhc_${RUN}`, P = `u_orhp_${RUN}`, WS = `ws_orh_${RUN}`, MS = `ms_orh_${RUN}`;
let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ps-oracle-"));
  setObjectStore(new LocalDiskStore(dir));
  await db.insert(orgs).values({ id: ORG, name: "Oracle hook tests" });
  await db.insert(users).values([{ id: C, orgId: ORG, email: `${C}@t.local`, name: "C", role: "client" }, { id: P, orgId: ORG, email: `${P}@t.local`, name: "P", role: "provider" }]);
  await db.insert(workspaces).values({ id: WS, orgId: ORG, blueprintCode: "UC_WEB_MVP", title: "Oracle hook", clientId: C, providerId: P, totalCents: 50_000, state: "LOCKED" });
  await db.insert(tranches).values({ id: `tr_${WS}`, workspaceId: WS, idx: 1, rail: "MOCK", amountCents: 50_000, startDay: 0, endDay: 20, state: "HELD" });
  await db.insert(wsMilestones).values({ id: MS, workspaceId: WS, seq: 1, code: "M06", origin: "BASELINE", type: "PAY", title: "Delivered", targetDay: 10, bps: 10_000, amountCents: 50_000, proof: { artifacts: [{ kind: "LOG", min: 1 }], oracle: "CARRIER_TRACKING", criteria: ["Tracking shows delivered"] }, lockRule: "x", disputeRule: "y", state: "OPEN" });
});
afterAll(async () => {
  await db.delete(oracleAttestations).where(eq(oracleAttestations.milestoneId, MS));
  await db.delete(evidenceNotifications).where(eq(evidenceNotifications.milestoneId, MS));
  await db.delete(evidencePackages).where(eq(evidencePackages.milestoneId, MS));
  await db.delete(wsMilestones).where(eq(wsMilestones.id, MS));
  await db.delete(tranches).where(eq(tranches.workspaceId, WS));
  await db.delete(workspaces).where(eq(workspaces.id, WS));
  await db.delete(users).where(inArray(users.id, [C, P]));
  await db.delete(orgs).where(eq(orgs.id, ORG));
  setObjectStore(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("F3.05 oracle hook in submitEvidence", () => {
  it("F3.05 a delivery note runs the simulated carrier check, signals ok and records an attestation for this attempt", async () => {
    const r = await submitEvidence({ id: P, role: "provider" }, MS, [{ name: "pod.txt", type: "text/plain", bytes: Buffer.from("Proof of delivery, signed by R. Diaz") }], "Delivered. Tracking: AB12345670");
    const sig = r.signals.find((s) => s.code === "ORACLE_CARRIER_TRACKING");
    expect(sig).toMatchObject({ level: "ok" });
    expect(sig?.detail).toMatch(/^Simulated carrier check/);
    expect(r.signals.some((s) => s.code === "ORACLE_PENDING")).toBe(false);
    const [pkg] = await db.select().from(evidencePackages).where(eq(evidencePackages.id, r.packageId));
    expect(pkg.signals.some((s) => s.code === "ORACLE_CARRIER_TRACKING")).toBe(true);
    const [att] = await db.select().from(oracleAttestations).where(eq(oracleAttestations.milestoneId, MS));
    expect(att).toMatchObject({ attempt: 1, rootHash: r.rootHash, oracle: "CARRIER_TRACKING", mode: "SIMULATED", level: "ok", input: { tracking: "AB12345670" } });
  });
});
