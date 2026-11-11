/**
 * A7 duplicate-photo check: dHash maths on generated images (pngjs/jpeg-js), the photograph heuristic,
 * bounded decoding (P11), and the submit-time signal against the local Postgres with money, AI and disputes mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { encode as jpegEncode } from "jpeg-js";
import { db } from "@/db/client";
import { auditChain, evidencePackages, orgs, tranches, users, workspaces, wsMilestones, type ProofSpec } from "@/db/schema";
import { evidenceNotifications, evidencePhotoHashes, evidenceReviews } from "@/db/schema-evidence";
import { simWorkspaces } from "@/db/schema-sim";
import { sha256 } from "@/lib/ids";
import { NotBuilt, type Actor } from "@/server/types";

const h = vi.hoisted(() => ({ release: vi.fn(), verify: vi.fn(), open: vi.fn() }));
vi.mock("@/server/money", () => ({ releaseMilestone: h.release }));
vi.mock("@/server/ai", () => ({ verifyEvidence: h.verify }));
vi.mock("@/server/disputes", () => ({ openDispute: h.open }));

import { SpecFailed, requestFix, submitEvidence } from "./index";
import { DHASH_MAX_DISTANCE, MAX_DECODE_PIXELS, colourCount, dhashHex, duplicateSignal, hamming, hashImage, imageSize, toSigned, toUnsigned } from "./photo-hash";
import { LocalDiskStore, setObjectStore } from "./storage";
import { craftExifJpeg } from "./exif";
import { photoRgba, rgbaToPng, samplePhotoPng, samplePng } from "./samples";

/* ── helpers: altered copies ── */
const brighter = (img: ReturnType<typeof photoRgba>, by: number) => ({ ...img, data: Buffer.from(img.data.map((v, i) => (i % 4 === 3 ? v : Math.min(255, v + by)))) });
const scribble = (img: ReturnType<typeof photoRgba>) => { const d = Buffer.from(img.data); for (let x = 10; x < 22; x++) for (let k = 0; k < 3; k++) d[(30 * img.width + x) * 4 + k] = 255; return { ...img, data: d }; };
const asJpeg = (img: ReturnType<typeof photoRgba>, q = 85) => Buffer.from(jpegEncode({ width: img.width, height: img.height, data: img.data }, q).data);
const dh = (type: string, b: Buffer) => hashImage(type, b, sha256(b));

describe("A7 difference hash (pure)", () => {
  it("A7: the same pixels give the same 64-bit hash as PNG and as re-encoded JPEG (distance ≤ 6)", () => {
    const img = photoRgba(11);
    const a = dh("image/png", rgbaToPng(img)), b = dh("image/jpeg", asJpeg(img));
    expect(a.photographic).toBe(true);
    expect(dhashHex(a.dhash!)).toMatch(/^[0-9a-f]{16}$/);
    expect(dh("image/png", rgbaToPng(img)).dhash).toBe(a.dhash);
    expect(hamming(a.dhash!, b.dhash!)).toBeLessThanOrEqual(DHASH_MAX_DISTANCE);
  });
  it("A7: a slightly altered copy (brighter, a small scribble, JPEG at quality 70) stays within 6 bits", () => {
    const img = photoRgba(23, 128, 96);
    const a = dh("image/png", rgbaToPng(img));
    const b = dh("image/jpeg", asJpeg(scribble(brighter(img, 12)), 70));
    expect(hamming(a.dhash!, b.dhash!)).toBeLessThanOrEqual(DHASH_MAX_DISTANCE);
  });
  it("A7: unrelated photos are far apart; resizing keeps the hash close", () => {
    const a = dh("image/png", samplePhotoPng(1)).dhash!, b = dh("image/png", samplePhotoPng(2)).dhash!;
    expect(hamming(a, b)).toBeGreaterThan(DHASH_MAX_DISTANCE);
    const big = photoRgba(5, 180, 135), small = photoRgba(5, 90, 67);
    expect(hamming(dh("image/png", rgbaToPng(big)).dhash!, dh("image/png", rgbaToPng(small)).dhash!)).toBeLessThanOrEqual(DHASH_MAX_DISTANCE + 4);
  });
  it("A7: flat graphics and tiny images are hashed but not treated as photographs", () => {
    const wire = dh("image/png", samplePng(320, 200, 170));
    expect(wire.photographic).toBe(false);
    expect(wire.dhash).not.toBeNull();
    const tiny = dh("image/jpeg", craftExifJpeg({ lat: 1, lng: 2 }));
    expect(tiny).toMatchObject({ photographic: false, dhash: null });
    expect(colourCount(photoRgba(3))).toBeGreaterThanOrEqual(64);
  });
  it("A7 P11: sizes come from headers; oversized images are not decoded; malformed bytes never throw", () => {
    expect(imageSize("image/png", samplePhotoPng(4, 40, 30))).toEqual({ width: 40, height: 30 });
    expect(imageSize("image/jpeg", asJpeg(photoRgba(4, 40, 30)))).toEqual({ width: 40, height: 30 });
    const huge = Buffer.from(samplePhotoPng(4, 10, 10)); huge.writeUInt32BE(10_000, 16); huge.writeUInt32BE(10_000, 20);
    expect(10_000 * 10_000).toBeGreaterThan(MAX_DECODE_PIXELS);
    expect(dh("image/png", huge)).toMatchObject({ photographic: true, dhash: null, width: 10_000 });
    const broken = Buffer.concat([samplePhotoPng(4).subarray(0, 40), Buffer.from("not a png")]);
    expect(() => dh("image/png", broken)).not.toThrow();
    expect(dh("image/png", broken).dhash).toBeNull();
  });
  it("A7: signed/unsigned round trip and popcount", () => {
    const u = BigInt("0xffffffffffffffff");
    expect(toUnsigned(toSigned(u))).toBe(u);
    expect(hamming(u, BigInt(0))).toBe(64);
    expect(hamming(BigInt(5), BigInt(6))).toBe(2);
  });
  it("A7: the signal names another contract only as 'another contract'", () => {
    const s = duplicateSignal("roof.jpg", { name: "x.jpg", sha256: "a", distance: 3, exact: false, sameContract: false, milestoneCode: null, packageId: "ev_secret" });
    expect(s).toMatchObject({ code: "DUPLICATE_PHOTO", level: "fail" });
    expect(s.detail).toContain("another contract");
    expect(s.detail).not.toContain("ev_secret");
    expect(duplicateSignal("roof.jpg", null).level).toBe("ok");
  });
});

/* ── submit-time check against the database ── */
const RUN = Math.random().toString(36).slice(2, 8);
const ORG = `org_t_x1p_${RUN}`, ORG2 = `org_t_x1q_${RUN}`;
const CLIENT = `u_x1pc_${RUN}`, PROVIDER = `u_x1pp_${RUN}`, CLIENT2 = `u_x1qc_${RUN}`, PROVIDER2 = `u_x1qp_${RUN}`;
const provider: Actor = { id: PROVIDER, role: "provider" }, client: Actor = { id: CLIENT, role: "client" }, provider2: Actor = { id: PROVIDER2, role: "provider" };
const SPEC: ProofSpec = { artifacts: [{ kind: "IMAGE", min: 1 }], criteria: ["Photo of the work"] };
const made = { ws: [] as string[], ms: [] as string[] };
let dir = "";

async function contract(o: { org?: string; client?: string; provider?: string; codes?: string[]; sim?: boolean } = {}) {
  const ws = `ws_x1p_${RUN}_${made.ws.length}`;
  await db.insert(workspaces).values({ id: ws, orgId: o.org ?? ORG, blueprintCode: "UC_WEB_MVP", title: `Secret title ${ws}`, clientId: o.client ?? CLIENT, providerId: o.provider ?? PROVIDER, totalCents: 100_000, state: "LOCKED" });
  made.ws.push(ws);
  if (o.sim) await db.insert(simWorkspaces).values({ workspaceId: ws, simId: `sim_x1p_${RUN}_${made.ws.length}` });
  await db.insert(tranches).values({ id: `tr_${ws}`, workspaceId: ws, idx: 1, rail: "MOCK", amountCents: 100_000, startDay: 0, endDay: 20, state: "HELD" });
  const ms: string[] = [];
  for (const [i, code] of (o.codes ?? ["M02"]).entries()) {
    const id = `ms_x1p_${RUN}_${made.ms.length}`;
    await db.insert(wsMilestones).values({ id, workspaceId: ws, seq: i + 1, code, origin: "BASELINE", type: "PAY", title: `Work ${code}`, targetDay: 3 + i, bps: 5000, amountCents: 50_000, proof: SPEC, lockRule: "Client approves.", disputeRule: "Redo in 72 h.", state: "OPEN" });
    made.ms.push(id); ms.push(id);
  }
  return { ws, ms };
}
const photo = (name: string, bytes: Buffer, type = bytes[0] === 0xff ? "image/jpeg" : "image/png") => [{ name, type, bytes }];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ps-photo-"));
  setObjectStore(new LocalDiskStore(dir));
  await db.insert(orgs).values([{ id: ORG, name: "Sequence photo tests" }, { id: ORG2, name: "Sequence photo tests 2" }]);
  await db.insert(users).values([
    { id: CLIENT, orgId: ORG, email: `${CLIENT}@test.local`, name: "Photo Client", role: "client" }, { id: PROVIDER, orgId: ORG, email: `${PROVIDER}@test.local`, name: "Photo Provider", role: "provider" },
    { id: CLIENT2, orgId: ORG2, email: `${CLIENT2}@test.local`, name: "Other Client", role: "client" }, { id: PROVIDER2, orgId: ORG2, email: `${PROVIDER2}@test.local`, name: "Other Provider", role: "provider" },
  ]);
});
beforeEach(() => {
  h.release.mockReset().mockResolvedValue({ releaseId: "rel_1", netCents: 1, feeCents: 0 });
  h.verify.mockReset().mockRejectedValue(new NotBuilt("verifyEvidence"));
  h.open.mockReset().mockResolvedValue("dp_1");
});
afterAll(async () => {
  if (made.ms.length) {
    await db.delete(evidenceNotifications).where(inArray(evidenceNotifications.milestoneId, made.ms));
    await db.delete(evidenceReviews).where(inArray(evidenceReviews.milestoneId, made.ms));
    await db.delete(evidencePackages).where(inArray(evidencePackages.milestoneId, made.ms));
    await db.delete(wsMilestones).where(inArray(wsMilestones.id, made.ms));
  }
  if (made.ws.length) {
    await db.delete(simWorkspaces).where(inArray(simWorkspaces.workspaceId, made.ws));
    await db.delete(tranches).where(inArray(tranches.workspaceId, made.ws));
    await db.delete(workspaces).where(inArray(workspaces.id, made.ws));
  }
  await db.delete(users).where(inArray(users.id, [CLIENT, PROVIDER, CLIENT2, PROVIDER2]));
  await db.delete(orgs).where(inArray(orgs.id, [ORG, ORG2]));
  setObjectStore(null);
  rmSync(dir, { recursive: true, force: true });
});

describe("A7 duplicate photo on submit", () => {
  const original = photoRgba(1000 + Math.floor(Math.random() * 1e6), 120, 90);
  const originalPng = rgbaToPng(original);

  it("A7: a new photo passes with an ok DUPLICATE_PHOTO signal and its hashes are stored", async () => {
    const { ms } = await contract();
    const r = await submitEvidence(provider, ms[0], photo("engine-bay.png", originalPng), "");
    expect(r.signals.find((s) => s.code === "DUPLICATE_PHOTO")?.level).toBe("ok");
    const rows = await db.select().from(evidencePhotoHashes).where(eq(evidencePhotoHashes.packageId, r.packageId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sha256: sha256(originalPng), photographic: true, width: 120, height: 90 });
    expect(rows[0].dhash).not.toBeNull();
  });

  it("A7: a slightly altered copy in another contract is blocked as DUPLICATE_PHOTO fail without naming that contract", async () => {
    const first = made.ws[0];
    const { ms } = await contract();
    const altered = asJpeg(scribble(brighter(original, 10)), 75);
    const err = await submitEvidence(provider, ms[0], photo("engine-bay-today.jpg", altered), "").catch((e) => e);
    expect(err).toBeInstanceOf(SpecFailed);
    const sig = (err as SpecFailed).signals.find((s) => s.code === "DUPLICATE_PHOTO")!;
    expect(sig.level).toBe("fail");
    expect(sig.detail).toMatch(/another contract/);
    expect(sig.detail).not.toContain(first);
    expect(sig.detail).not.toContain("Secret title");
    expect((await db.select().from(wsMilestones).where(eq(wsMilestones.id, ms[0])))[0].state).toBe("OPEN");
    const logged = await db.select().from(auditChain).where(and(eq(auditChain.action, "evidence.duplicate_photo"), eq(auditChain.target, ms[0])));
    expect(logged).toHaveLength(1);
  });

  it("A7: the identical file in another contract is blocked as an exact match", async () => {
    const { ms } = await contract();
    const err = await submitEvidence(provider, ms[0], photo("same.png", originalPng), "").catch((e) => e);
    expect((err as SpecFailed).signals.find((s) => s.code === "DUPLICATE_PHOTO")?.detail).toMatch(/identical file/);
  });

  it("A7: another milestone of the same contract is named by its code; the same milestone may resubmit its photo", async () => {
    const pic = samplePhotoPng(2_000_000 + Math.floor(Math.random() * 1e6), 100, 75);
    const { ms } = await contract({ codes: ["M03", "M04"] });
    await submitEvidence(provider, ms[0], photo("frame.png", pic), "");
    const err = await submitEvidence(provider, ms[1], photo("frame-again.png", pic), "").catch((e) => e);
    expect((err as SpecFailed).signals.find((s) => s.code === "DUPLICATE_PHOTO")?.detail).toMatch(/M03 of this contract/);
    await requestFix(client, ms[0], ["Show the other side too"]);
    const again = await submitEvidence(provider, ms[0], [...photo("frame.png", pic), ...photo("other-side.png", samplePhotoPng(3_000_000 + Math.floor(Math.random() * 1e6)))], "");
    expect(again.signals.filter((s) => s.code === "DUPLICATE_PHOTO").every((s) => s.level === "ok")).toBe(true);
  });

  it("A7: an unrelated photo and reused flat graphics pass", async () => {
    const { ms } = await contract();
    const r = await submitEvidence(provider, ms[0], [...photo("new.png", samplePhotoPng(4_000_000 + Math.floor(Math.random() * 1e6))), ...photo("screen.png", samplePng(320, 200, 170))], "");
    expect(r.signals.find((s) => s.code === "DUPLICATE_PHOTO")?.level).toBe("ok");
    const { ms: ms2 } = await contract();
    const r2 = await submitEvidence(provider, ms2[0], photo("screen.png", samplePng(320, 200, 170)), "");
    expect(r2.signals.some((s) => s.code === "DUPLICATE_PHOTO")).toBe(false);
  });

  it("A7: data worlds stay apart — another test organisation and a playground simulation do not match this one", async () => {
    const other = await contract({ org: ORG2, client: CLIENT2, provider: PROVIDER2 });
    const r = await submitEvidence(provider2, other.ms[0], photo("engine-bay.png", originalPng), "");
    expect(r.signals.find((s) => s.code === "DUPLICATE_PHOTO")?.level).toBe("ok");
    const sim = await contract({ sim: true });
    const r2 = await submitEvidence(provider, sim.ms[0], photo("engine-bay.png", originalPng), "");
    expect(r2.signals.find((s) => s.code === "DUPLICATE_PHOTO")?.level).toBe("ok");
  });
});
