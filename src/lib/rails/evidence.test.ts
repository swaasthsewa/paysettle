/**
 * F4.10 rail.provideEvidence: the mock rail stays deterministic and idempotent (P2) and never touches money
 * (P1: no transaction is recorded); the PayPal rail checks eligibility first, then posts multipart/form-data with an
 * `input` JSON part and one file part per document, carrying PayPal-Request-Id and, for a merchant, PayPal-Auth-Assertion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockRail, mockControl } from "./mock";
import { PayPalRail, authAssertion, evidenceForm } from "./paypal";
import { EVIDENCE_LIMITS, RailError, type EvidenceDossier } from "./types";
import { idemKey, sha256 } from "../ids";

const doc = (n = 1200) => { const bytes = new Uint8Array(n).fill(37); return { name: "dossier.pdf", contentType: "application/pdf" as const, bytes, sha256: sha256(Buffer.from(bytes)) }; };
const dossier = (o: Partial<EvidenceDossier> = {}): EvidenceDossier => ({ hash: "a".repeat(64), evidenceType: "OTHER", notes: "Signed contract and approvals attached.", documents: [doc()], ...o });

describe("F4.10 mock rail provideEvidence", () => {
  beforeEach(() => mockControl.reset());

  it("F4.10 P2 same key → same reference, recorded once; different key → different reference", async () => {
    const r = new MockRail();
    const k = idemKey("representment", "PP-D-1", "h1");
    const a = await r.provideEvidence("PP-D-1", dossier(), k);
    const b = await r.provideEvidence("PP-D-1", dossier(), k);
    expect(a).toEqual(b);
    expect(a.status).toBe("SUBMITTED");
    expect(a.id).toMatch(/^MOCKEVID-[0-9A-F]{17}$/);
    expect(mockControl.evidence()).toHaveLength(1);
    expect(mockControl.evidence()[0]).toMatchObject({ disputeId: "PP-D-1", idemKey: k, hash: "a".repeat(64), evidenceType: "OTHER", documents: [{ name: "dossier.pdf", bytes: 1200 }] });
    const c = await r.provideEvidence("PP-D-1", dossier(), idemKey("representment", "PP-D-1", "h2"));
    expect(c.id).not.toBe(a.id);
    /* deterministic across instances and resets */
    mockControl.reset();
    expect((await new MockRail().provideEvidence("PP-D-1", dossier(), k)).id).toBe(a.id);
  });

  it("F4.10 P1 evidence is not a money movement: no transaction appears for reconciliation", async () => {
    await new MockRail().provideEvidence("PP-D-2", dossier(), idemKey("x", 1));
    expect(mockControl.txns()).toHaveLength(0);
  });

  it("F4.10 not eligible is answered without recording; a transient fault throws once", async () => {
    const r = new MockRail();
    mockControl.closeForEvidence("PP-D-3");
    expect(await r.provideEvidence("PP-D-3", dossier(), idemKey("y", 1))).toMatchObject({ status: "NOT_ELIGIBLE" });
    expect(mockControl.evidence()).toHaveLength(0);
    mockControl.closeForEvidence("PP-D-3", false);
    mockControl.inject("evidence_503");
    await expect(r.provideEvidence("PP-D-3", dossier(), idemKey("y", 1))).rejects.toMatchObject({ kind: "TRANSIENT" });
    expect((await r.provideEvidence("PP-D-3", dossier(), idemKey("y", 1))).status).toBe("SUBMITTED");
  });

  it("F4.10 limits are enforced before anything is sent", async () => {
    const r = new MockRail();
    await expect(r.provideEvidence("bad id!", dossier(), "k")).rejects.toBeInstanceOf(RailError);
    await expect(r.provideEvidence("PP-D-4", dossier({ documents: [] }), "k")).rejects.toThrow(/at least one document/);
    await expect(r.provideEvidence("PP-D-4", dossier({ documents: [doc(EVIDENCE_LIMITS.fileBytes + 1)] }), "k")).rejects.toThrow(/larger/);
    await expect(r.provideEvidence("PP-D-4", dossier(), "")).rejects.toThrow(/idempotency key/);
    expect(mockControl.evidence()).toHaveLength(0);
  });
});

describe("F4.10 PayPal rail provideEvidence request shape", () => {
  const env = { ...process.env };
  let calls: { url: string; init: RequestInit }[] = [];
  beforeEach(() => {
    process.env.PAYPAL_CLIENT_ID = "client-abc"; process.env.PAYPAL_CLIENT_SECRET = "secret"; delete process.env.PAYPAL_ENV;
    calls = [];
  });
  afterEach(() => { vi.unstubAllGlobals(); process.env = { ...env }; });
  const stub = (answers: ((url: string) => Response | undefined)[]) => vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    for (const a of answers) { const r = a(url); if (r) return r; }
    return new Response("{}", { status: 404 });
  }));

  it("F4.10 eligible dispute: GET details, then multipart POST with input JSON + file1, request id and auth assertion", async () => {
    stub([
      (u) => (u.endsWith("/v1/customer/disputes/PP-D-77") ? new Response(JSON.stringify({ status: "WAITING_FOR_SELLER_RESPONSE", links: [{ rel: "provide_evidence", href: "https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-77/provide-evidence" }] }), { status: 200 }) : undefined),
      (u) => (u.endsWith("/provide-evidence") ? new Response(JSON.stringify({ links: [{ rel: "self", href: "https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-77" }] }), { status: 200 }) : undefined),
    ]);
    const key = idemKey("representment", "PP-D-77", "h");
    const r = await new PayPalRail("A1").provideEvidence("PP-D-77", dossier({ merchantId: "MERCH123" }), key);
    expect(r.status).toBe("SUBMITTED");
    const post = calls.find((c) => c.url.endsWith("/provide-evidence"))!;
    expect(post.url).toBe("https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-77/provide-evidence");
    const h = post.init.headers as Record<string, string>;
    expect(h["PayPal-Request-Id"]).toBe(key);
    expect(h["PayPal-Auth-Assertion"]).toBe(authAssertion("MERCH123"));
    expect(h["Content-Type"]).toBeUndefined(); /* fetch sets the multipart boundary itself */
    const form = post.init.body as FormData;
    const input = JSON.parse(await (form.get("input") as Blob).text());
    expect(input).toEqual({ evidences: [{ evidence_type: "OTHER", notes: "Signed contract and approvals attached.", documents: [{ name: "dossier.pdf" }] }] });
    const file = form.get("file1") as File;
    expect(file.type).toBe("application/pdf");
    expect(file.size).toBe(1200);
    const get = calls.find((c) => c.url.endsWith("/disputes/PP-D-77"))!;
    expect((get.init.headers as Record<string, string>)["PayPal-Auth-Assertion"]).toBe(authAssertion("MERCH123"));
  });

  it("F4.10 no provide-evidence link → NOT_ELIGIBLE and nothing is posted; a 422 maps to a STATE error", async () => {
    stub([(u) => (u.endsWith("/disputes/PP-D-78") ? new Response(JSON.stringify({ status: "UNDER_REVIEW", links: [{ rel: "self", href: "x" }] }), { status: 200 }) : undefined)]);
    expect(await new PayPalRail("A1").provideEvidence("PP-D-78", dossier(), "k1")).toMatchObject({ status: "NOT_ELIGIBLE" });
    expect(calls.some((c) => c.url.endsWith("/provide-evidence"))).toBe(false);
    vi.unstubAllGlobals(); calls = [];
    stub([
      (u) => (u.endsWith("/disputes/PP-D-79") ? new Response(JSON.stringify({ links: [{ rel: "provide_evidence", href: "https://x/v1/customer/disputes/PP-D-79/provide-evidence" }] }), { status: 200 }) : undefined),
      (u) => (u.endsWith("/provide-evidence") ? new Response(JSON.stringify({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INVALID_DISPUTE_STATUS" }] }), { status: 422 }) : undefined),
    ]);
    await expect(new PayPalRail("A1").provideEvidence("PP-D-79", dossier(), "k2")).rejects.toMatchObject({ kind: "STATE" });
  });

  it("F4.10 notes are cut to PayPal's limit and every document gets its own part", async () => {
    const form = evidenceForm(dossier({ notes: "x".repeat(5000), documents: [doc(10), { ...doc(20), name: "b.pdf" }] }));
    const input = JSON.parse(await (form.get("input") as Blob).text());
    expect(input.evidences[0].notes).toHaveLength(EVIDENCE_LIMITS.notesChars);
    expect(input.evidences[0].documents).toEqual([{ name: "dossier.pdf" }, { name: "b.pdf" }]);
    expect((form.get("file2") as File).name).toBe("b.pdf");
  });

  it("F4.10 the auth assertion is an unsigned JWT naming our client id and the merchant", () => {
    process.env.PAYPAL_CLIENT_ID = "client-abc";
    const [h, p, sig] = authAssertion("M1").split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "none" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({ iss: "client-abc", payer_id: "M1" });
    expect(sig).toBe("");
  });
});
