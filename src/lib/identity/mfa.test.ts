// F1.2 · tests: authenticator enrolment, verification, replay refusal and the five-attempt lock.
import { describe, expect, it } from "vitest";
import { beginEnrolment, confirmEnrolment, keyGroups, MFA_MAX_ATTEMPTS, mfaRequired } from "./mfa";
import { base32Decode, hotp, stepOf, totpAt, TOTP, verifyTotp } from "./totp";

const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);

describe("F1.2 TOTP enrolment", () => {
  it("F1.2 begin gives a 160-bit secret, an otpauth address and a typed key in groups of four", () => {
    const e = beginEnrolment("arjun@provider.demo");
    expect(base32Decode(e.secret)).toHaveLength(20);
    expect(e.uri).toMatch(/^otpauth:\/\/totp\/PaySettle:arjun%40provider\.demo\?secret=[A-Z2-7]+&issuer=PaySettle&algorithm=SHA1&digits=6&period=30$/);
    expect(e.groups.replace(/ /g, "")).toBe(e.secret);
    expect(e.groups.split(" ").every((g) => g.length <= 4)).toBe(true);
    expect(keyGroups("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });

  it("F1.2 matches the RFC 6238 SHA-1 reference values", () => {
    const secret = Buffer.from("12345678901234567890");
    expect(hotp(secret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(hotp(secret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
  });

  it("F1.2 the first right code switches MFA on and returns its step", () => {
    const { secret } = beginEnrolment("priya@client.demo");
    const r = confirmEnrolment({ secret, code: totpAt(secret, T0), atMs: T0, attempts: 0 });
    expect(r).toEqual({ ok: true, step: stepOf(T0) });
  });

  it("F1.2 accepts one step of clock drift either side, not two", () => {
    const { secret } = beginEnrolment("x@y.demo");
    const prev = totpAt(secret, T0 - TOTP.stepSeconds * 1000);
    const far = totpAt(secret, T0 - 2 * TOTP.stepSeconds * 1000);
    expect(verifyTotp(secret, prev, T0).ok).toBe(true);
    expect(verifyTotp(secret, far, T0)).toEqual({ ok: false, reason: "wrong" });
  });

  it("F1.2 refuses a replay: the same code at the stored last step is 'used'", () => {
    const { secret } = beginEnrolment("x@y.demo");
    const code = totpAt(secret, T0);
    const first = verifyTotp(secret, code, T0, 0);
    expect(first.ok).toBe(true);
    const step = first.ok ? first.step : 0;
    expect(verifyTotp(secret, code, T0 + 5_000, step)).toEqual({ ok: false, reason: "used" });
    expect(confirmEnrolment({ secret, code, atMs: T0, lastStep: step, attempts: 0 })).toMatchObject({ ok: false, reason: "used", attempts: 1 });
    /* the next step's code still works */
    const next = T0 + TOTP.stepSeconds * 1000;
    expect(verifyTotp(secret, totpAt(secret, next), next, step).ok).toBe(true);
  });

  it("F1.2 a badly shaped code is not counted; wrong codes lock the enrolment at five (ERR_102)", () => {
    const { secret } = beginEnrolment("x@y.demo");
    expect(confirmEnrolment({ secret, code: "12ab", atMs: T0, attempts: 2 })).toMatchObject({ ok: false, reason: "format", attempts: 2, locked: false });
    const good = totpAt(secret, T0);
    const wrong = String((Number(good) + 1) % 1_000_000).padStart(6, "0");
    let attempts = 0, locked = false;
    for (let i = 0; i < MFA_MAX_ATTEMPTS; i++) {
      const r = confirmEnrolment({ secret, code: wrong, atMs: T0, attempts });
      if (r.ok) throw new Error("wrong code accepted");
      attempts = r.attempts; locked = r.locked;
    }
    expect(attempts).toBe(5);
    expect(locked).toBe(true);
  });

  it("F1.2 providers and operational roles need MFA; clients and judges do not", () => {
    expect(mfaRequired("provider")).toBe(true);
    expect(mfaRequired("finance")).toBe(true);
    expect(mfaRequired("client")).toBe(false);
    expect(mfaRequired("judge")).toBe(false);
  });
});
