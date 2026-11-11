/** Pure evidence checks: F3.04 spec signals, type sniffing, EXIF GPS parser; P11 untrusted uploads. */
import { describe, expect, it } from "vitest";
import type { ProofSpec } from "@/db/schema";
import { blocks, buildNote, parseNote, sniffType, specSignals } from "./spec";
import { craftExifJpeg, distanceM, parseJpegExif } from "./exif";
import { samplePdf, samplePng } from "./samples";

const proof: ProofSpec = { artifacts: [{ kind: "IMAGE", min: 2, note: "Site photos" }, { kind: "PDF", min: 1 }, { kind: "LINK", min: 1, note: "Prototype URL" }, { kind: "SIGNATURE", min: 1 }], criteria: ["Done"] };
const level = (s: { code: string; level: string }[], code: string) => s.find((x) => x.code === code)?.level;

describe("F3.04 spec-check signals", () => {
  it("F3.04 counts per artifact kind: shortfalls fail, met counts pass", () => {
    const s = specSignals(proof, [{ name: "a.jpg", type: "image/jpeg" }, { name: "b.pdf", type: "application/pdf" }], "");
    expect(level(s, "COUNT_IMAGE")).toBe("fail");
    expect(level(s, "COUNT_PDF")).toBe("ok");
    expect(level(s, "COUNT_LINK")).toBe("fail");
    expect(level(s, "COUNT_SIGNATURE")).toBe("fail");
    expect(blocks(s)).toBe(true);
  });
  it("F3.04 IMAGE↔image/*, PDF↔application/pdf, VIDEO↔video/*, LOG↔text/plain mapping", () => {
    const p: ProofSpec = { artifacts: [{ kind: "IMAGE", min: 1 }, { kind: "VIDEO", min: 1 }, { kind: "LOG", min: 1 }], criteria: [] };
    const s = specSignals(p, [{ name: "a.png", type: "image/png" }, { name: "v.mp4", type: "video/mp4" }, { name: "ci.log", type: "text/plain" }, { name: "x.pdf", type: "application/pdf" }], "");
    expect([level(s, "COUNT_IMAGE"), level(s, "COUNT_VIDEO"), level(s, "COUNT_LOG")]).toEqual(["ok", "ok", "ok"]);
    expect(level(s, "EXTRA_PDF")).toBe("ok");
    expect(blocks(s)).toBe(false);
  });
  it("F3.04 LINK satisfied by a URL in the note; SIGNATURE/ORACLE by an explicit checkbox marker", () => {
    const note = buildNote("See https://proto.example.com/x", ["SIGNATURE"]);
    const s = specSignals(proof, [{ name: "a.jpg", type: "image/jpeg" }, { name: "b.jpg", type: "image/jpeg" }, { name: "c.pdf", type: "application/pdf" }], note);
    expect(level(s, "COUNT_LINK")).toBe("ok");
    expect(level(s, "COUNT_SIGNATURE")).toBe("ok");
    expect(blocks(s)).toBe(false);
    const p = parseNote(note);
    expect(p.text).toBe("See https://proto.example.com/x");
    expect(p.confirmed).toEqual(["SIGNATURE"]);
  });
  it("F3.04 duplicate kinds add up and an oracle without artifact is a warning only", () => {
    const p: ProofSpec = { artifacts: [{ kind: "PDF", min: 1 }, { kind: "PDF", min: 1 }], oracle: "GITHUB_CI", criteria: [] };
    const s = specSignals(p, [{ name: "a.pdf", type: "application/pdf" }], "");
    expect(level(s, "COUNT_PDF")).toBe("fail");
    expect(level(s, "ORACLE_PENDING")).toBe("warn");
  });
});

describe("F3.04 / P11 type sniffing", () => {
  it("F3.04 recognises the allowed types from their bytes", () => {
    expect(sniffType(samplePng(8, 8))).toBe("image/png");
    expect(sniffType(samplePdf("t", ["x"]))).toBe("application/pdf");
    expect(sniffType(craftExifJpeg({}))).toBe("image/jpeg");
    expect(sniffType(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(8)]))).toBe("video/mp4");
    expect(sniffType(Buffer.from("tests passed: 42\n"))).toBe("text/plain");
  });
  it("P11 binary junk is not accepted as text", () => {
    expect(sniffType(Buffer.from([0x4d, 0x5a, 0x00, 0x01]))).toBeNull();
  });
});

describe("F3.04 EXIF GPS parser", () => {
  it("F3.04 reads GPS and DateTimeOriginal from a crafted JPEG", () => {
    const jpg = craftExifJpeg({ lat: 12.9716, lng: -77.5946, takenAt: "2026-11-07T09:30:00" });
    const x = parseJpegExif(jpg);
    expect(x.hasExif).toBe(true);
    expect(x.lat).toBeCloseTo(12.9716, 4);
    expect(x.lng).toBeCloseTo(-77.5946, 4);
    expect(x.takenAt).toBe("2026-11-07T09:30:00");
  });
  it("F3.04 southern latitude and missing EXIF", () => {
    expect(parseJpegExif(craftExifJpeg({ lat: -33.8688, lng: 151.2093 })).lat).toBeCloseTo(-33.8688, 4);
    const bare = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    expect(parseJpegExif(bare)).toEqual({ hasExif: false });
  });
  it("F3.04 malformed EXIF never throws", () => {
    const jpg = craftExifJpeg({ lat: 1, lng: 2 });
    const broken = Buffer.from(jpg); broken.writeUInt32BE(0xfffffff0, 4 + 2 + 6 + 4); // corrupt IFD0 offset
    expect(() => parseJpegExif(broken)).not.toThrow();
    expect(() => parseJpegExif(jpg.subarray(0, 30))).not.toThrow();
  });
  it("F3.04 haversine distance is in metres", () => {
    const d = distanceM({ lat: 12.9716, lng: 77.5946 }, { lat: 13.0827, lng: 80.2707 });
    expect(d / 1000).toBeGreaterThan(285); expect(d / 1000).toBeLessThan(295);
  });
});
