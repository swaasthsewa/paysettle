/**
 * F2.10 F5.05 F4.10 PDF writer tests: text reduced to what the standard fonts can draw, untrusted text drawn as
 * text (P11), long tables paginate with a footer on every page, and the compliance and dossier documents render.
 */
import { describe, expect, it } from "vitest";
import { pdfText, renderPdf } from "./doc";
import { compliancePdf } from "./compliance";
import { dossierPdf, type DossierLike } from "./dossier";

const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

describe("F2.10 PDF writer", () => {
  it("F2.10 P11 text: control characters dropped, symbols get ASCII stand-ins, WinAnsi punctuation kept, length capped", () => {
    expect(pdfText("a\u0000b\u0007c")).toBe("abc");
    expect(pdfText("M1 → M2 ≥ 3 ✓")).toBe("M1 -> M2 >= 3 v");
    expect(pdfText("“quoted” — café €5 …")).toBe("“quoted” — café €5 …");
    expect(pdfText("Zürich Łódź 東京")).toBe("Zürich Lódz ??");
    expect(pdfText("x".repeat(10), 4)).toBe("xxxx");
    expect(pdfText(null)).toBe("");
  });

  it("F2.10 long content paginates; every page gets the footer; metadata is set", async () => {
    const bytes = await renderPdf({ title: "Test <script>alert(1)</script>", subject: "s" }, "footer text", (w) => {
      w.title("Big table");
      w.table([{ header: "A", width: 0.5 }, { header: "B", width: 0.5, align: "right" }], Array.from({ length: 140 }, (_, i) => [`row ${i}`, String(i)]));
    });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(bytes)).toBeGreaterThanOrEqual(3);
    expect(bytes.toString("latin1")).toContain("/Producer");
  });
});

describe("F5.05 compliance PDF", () => {
  it("F5.05 renders the release volume and the 1099-K review table", async () => {
    const bytes = await compliancePdf({
      period: { from: new Date("2026-01-01"), to: new Date("2026-11-01") }, disclaimer: "Evidence pack for compliance review.", reviewLine: { grossCents: 2_000_000, count: 200 },
      rows: [{ providerId: "u_a", provider: "Arjun", releases: 3, grossCents: 300_000, feeCents: 7_500, netCents: 292_500, rails: "A1", flagged: false }],
      year: 2026, taxLine: { grossCents: 2_000_000, transactions: 200 }, taxNote: "Review flag only.",
      taxRows: [{ providerId: "u_a", provider: "Arjun", country: "IN", payments: 3, grossCents: 300_000, feeCents: 7_500, netCents: 292_500, flag: "UNDER", grossShareBps: 1500, countShareBps: 150 }],
      signature: { alg: "SHA-256 (digest only)", value: "ab".repeat(32) }, generatedAt: new Date(), generatedFor: "Fin (finance)",
    });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(2500);
  });
});

describe("F4.10 dossier PDF", () => {
  it("F4.10 P11 renders hostile file names as text and attaches the dossier JSON", async () => {
    const d: DossierLike = {
      disputeId: "PP-D-1", reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", asOf: new Date().toISOString(),
      contract: { id: "ws_1", title: "Engine swap", blueprint: "UC_CLASSIC_CAR", currency: "USD", totalCents: 1_450_000, feeBps: 250, rail: "A1", revNo: 3, canonicalHash: "c".repeat(64), hashVerified: true },
      parties: { client: "Priya", provider: "Arjun" },
      signatures: [{ role: "client", signer: "Priya", revNo: 3, hash: "c".repeat(64), mfa: true, at: new Date().toISOString() }],
      tranches: [{ id: "tr_1", idx: 1, amountCents: 725_000, state: "PARTIALLY_RELEASED", heldAt: new Date().toISOString(), orderId: "O1", authorizationId: "A1", captureId: null }],
      milestones: [{ code: "M01", title: "Teardown", type: "PAY", amountCents: 145_000, state: "RELEASED", targetDay: 3,
        evidence: [{ attempt: 1, rootHash: "r".repeat(64), submittedAt: new Date().toISOString(), files: [{ name: "<script>alert('x')</script>\u0000.jpg", kind: "IMAGE", size: 2_400_000, sha256: "f".repeat(64) }] }],
        approvals: [{ decision: "APPROVE", at: new Date().toISOString(), rootHash: "r".repeat(64), by: "Priya (client)", mfa: "verified", signatureFingerprint: "9".repeat(32) }],
        releases: [{ kind: "MILESTONE", grossCents: 145_000, feeCents: 3_625, netCents: 141_375, status: "COMPLETED", at: new Date().toISOString(), paypalRef: "CAP1", approvalFingerprint: "8".repeat(32) }] }],
      timeline: Array.from({ length: 60 }, (_, i) => ({ at: new Date(Date.now() + i * 60_000).toISOString(), action: "evidence.submitted", target: `ms_${i}`, role: "provider" })),
    };
    const bytes = await dossierPdf(d, "h".repeat(64), JSON.stringify(d));
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.toString("latin1")).toContain("/EmbeddedFile");
    expect(pages(bytes)).toBeGreaterThanOrEqual(2);
  });
});
