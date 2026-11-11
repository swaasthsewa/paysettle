// F3 (waitlist) · tests: validation, normalisation, honeypot, rate limit; F1.4 tax-id masking and licence checks.
import { describe, expect, it } from "vitest";
import { HONEYPOT, readWaitlist } from "./waitlist";
import { fixedWindow } from "./rate-limit";
import { licenceSchema, maskTaxId, merchantLink, missingCredentials, taxIdFingerprint } from "./provider";
import { buyerLink, profileGaps, profileSchema } from "./profile";

describe("F3 waitlist form", () => {
  it("F3 accepts a valid entry and lower-cases the e-mail", () => {
    const r = readWaitlist({ email: "  Priya@Example.COM ", role: "client", note: "Booking app, 4 weeks" });
    expect(r).toEqual({ ok: true, robot: false, data: { email: "priya@example.com", role: "client", note: "Booking app, 4 weeks" } });
  });
  it("F3 names every bad field", () => {
    const r = readWaitlist({ email: "not-an-email", role: "boss", note: "x".repeat(501) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields.sort()).toEqual(["email", "note", "role"]);
  });
  it("F3 an empty note is dropped, not stored as ''", () => {
    const r = readWaitlist({ email: "a@b.co", role: "provider", note: "   " });
    expect(r.ok && r.data.note).toBeUndefined();
  });
  it("F3 a filled honeypot reads as a robot, even when the rest is invalid", () => {
    expect(readWaitlist({ email: "a@b.co", role: "provider", [HONEYPOT]: "http://spam.example" })).toMatchObject({ ok: true, robot: true });
    expect(readWaitlist({ email: "junk", role: "nope", [HONEYPOT]: "x" })).toMatchObject({ ok: true, robot: true });
    expect(readWaitlist({ email: "a@b.co", role: "provider", [HONEYPOT]: "   " })).toMatchObject({ ok: true, robot: false });
  });
  it("F3 the IP limiter allows the limit in a window, refuses the next, and resets after the window", () => {
    const lim = fixedWindow(3, 60_000);
    expect([1, 2, 3].map(() => lim.hit("1.2.3.4", 0).ok)).toEqual([true, true, true]);
    const fourth = lim.hit("1.2.3.4", 1_000);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterS).toBe(59);
    expect(lim.hit("5.6.7.8", 1_000).ok).toBe(true);
    expect(lim.hit("1.2.3.4", 60_000).ok).toBe(true);
  });
});

describe("F1.4 provider credentials", () => {
  it("F1.4 masks a tax id down to its last four characters, keeping separators", () => {
    expect(maskTaxId("12-3456789")).toBe("••-•••6789");
    expect(maskTaxId("AAAPL1234C")).toBe("••••••234C");
    expect(maskTaxId("123")).toBe("•••");
  });
  it("F1.4 the tax-id fingerprint ignores spacing and case and never contains the number", () => {
    expect(taxIdFingerprint("12-3456789", "s")).toBe(taxIdFingerprint(" 123456789 ", "s"));
    expect(taxIdFingerprint("12-3456789", "s")).not.toContain("3456789");
  });
  it("F1.4 licence files: PDF, PNG or JPEG up to 10 MB with a SHA-256 fingerprint", () => {
    const sha = "a".repeat(64);
    expect(licenceSchema.safeParse({ name: "licence.pdf", kind: "application/pdf", size: 2048, sha256: sha }).success).toBe(true);
    expect(licenceSchema.safeParse({ name: "x.exe", kind: "application/x-msdownload", size: 2048, sha256: sha }).success).toBe(false);
    expect(licenceSchema.safeParse({ name: "big.pdf", kind: "application/pdf", size: 11 * 1024 * 1024, sha256: sha }).success).toBe(false);
    expect(licenceSchema.safeParse({ name: "a.pdf", kind: "application/pdf", size: 1, sha256: "nothex" }).success).toBe(false);
  });
  it("F1.4 lists what is missing before Ops can validate (ERR_104)", () => {
    expect(missingCredentials(undefined, false)).toHaveLength(4);
    expect(missingCredentials({ businessName: "Rao Planning", taxIdMasked: "••6789", licences: [{ id: "l", name: "a", kind: "application/pdf", size: 1, sha256: "a".repeat(64), at: "", review: "QUEUED" }] }, true)).toEqual([]);
  });
});

describe("F1.3 client profile", () => {
  it("F1.3 refuses an incomplete profile (ERR_103) and accepts a full one", () => {
    expect(profileSchema.safeParse({ name: "P", currency: "XYZ", timezone: "Mars/Base", billingCountry: "usa" }).success).toBe(false);
    expect(profileSchema.safeParse({ name: "Priya Shah", currency: "USD", timezone: "America/New_York", billingCountry: "us" }).success).toBe(true);
    expect(profileGaps({ currency: "USD" })).toEqual(["time zone", "billing country"]);
  });
});

describe("F1.5 and F1.6 PayPal links", () => {
  it("F1.5 a buyer link is optional, lower-cased, never receivable, confirmed only by PayPal later", () => {
    expect(buyerLink(" Buyer@Personal.Example.com ")).toEqual({ ok: true, values: { email: "buyer@personal.example.com", receivable: false, emailConfirmed: false } });
    expect(buyerLink("not an email").ok).toBe(false);
  });
  it("F1.6 a merchant link can receive in the sandbox only; production waits for partner onboarding (ERR_106)", () => {
    expect(merchantLink("Shop@Business.example.com", true)).toEqual({ email: "shop@business.example.com", receivable: true, emailConfirmed: true });
    expect(merchantLink("shop@business.example.com", false)).toEqual({ email: "shop@business.example.com", receivable: false, emailConfirmed: false });
  });
});
